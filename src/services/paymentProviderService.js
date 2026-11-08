const crypto = require("crypto");
const simulated = require("./providers/simulatedPaymentProvider");
const mercadoPago = require("./providers/mercadoPagoPaymentProvider");
const paymentService = require("./paymentService");
const gatewayService = require("./paymentGatewayService");
const splitService = require("./paymentSplitService");
const splitProvider = require("./providers/mercadoPagoSplitProvider");
const paymentError = require("../utils/paymentError");

async function prepare(method, body, email, shoppingId) {
    const provider = process.env.PAYMENT_PROVIDER;
    if (!["simulated", "mercado_pago"].includes(provider)) {
        throw paymentError("Provedor de pagamento não configurado.", 503);
    }

    if (provider === "simulated" && process.env.NODE_ENV === "production") {
        throw paymentError("Simulação desabilitada em produção.", 503);
    }

    const input = provider === "mercado_pago" ? mercadoPago.normalizeInput(method, body, email) : { method };
    const environment = provider === "mercado_pago" ? mercadoPago.configuration().environment : "simulated";
    const account = provider === "mercado_pago" ? await mercadoPago.verifyAccount() : null;
    const split = await splitService.prepare(shoppingId);

    return {
        input,
        gateway: {
            provider,
            environment,
            split,
            request_hash: crypto.createHash("sha256").update(JSON.stringify({ input, accountId: account?.id || null,
                credential: account ? crypto.createHash("sha256").update(mercadoPago.configuration().token).digest("hex") : null,
                ...(split ? { split } : {}) })).digest("hex")
        }
    };
}

function assertEnvironment(gateway) {
    if (gateway.provider !== "mercado_pago" || gateway.environment !== mercadoPago.configuration().environment) {
        throw paymentError("Pagamento de outro provedor ou ambiente.", 409);
    }
}

async function applyOrder(order, payment) {
    await gatewayService.applyCheckout(payment.id, await mercadoPago.normalizeOrder(order, payment));
    return gatewayService.getCheckout(payment.id);
}

async function applySplit(data, payment, binding) {
    await gatewayService.applyCheckout(payment.id, await splitProvider.normalizePayment(data, payment, binding));
    return gatewayService.getCheckout(payment.id);
}

async function reconcileOrder(payment) {
    const gateway = await gatewayService.getGateway(payment.id);
    assertEnvironment(gateway);
    const binding = await splitService.getBinding(payment.id);
    if (binding) {
        const data = gateway.transaction_id ? await splitProvider.get(gateway.transaction_id, binding) : await splitProvider.find(payment, binding);
        if (!data) {
            const error = paymentError("Pagamento ainda não localizado. Sincronize novamente; não crie outra cobrança.", 409);
            error.providerDetails = { payment_id: payment.id, reconciliation_required: true };
            throw error;
        }
        return applySplit(data, payment, binding);
    }
    const order = gateway.order_id
        ? await mercadoPago.getOrder(gateway.order_id)
        : await mercadoPago.findOrder(await gatewayService.getPayment(payment.id));
    if (!order) {
        const error = paymentError("Order ainda não localizada. Use a sincronização novamente; não crie outra cobrança.", 409);
        error.providerDetails = { payment_id: payment.id, reconciliation_required: true };
        throw error;
    }
    return applyOrder(order, payment);
}

async function ownedPayment(id, userId) {
    const payment = await paymentService.getPaymentById(id, userId);
    if (!payment) {
        throw paymentError("Pagamento não encontrado.", 404);
    }

    return payment;
}

const paymentProviderService = {
    prepare,
    getCheckout: gatewayService.getCheckout,

    async simulate(id, userId, status) {
        if (process.env.PAYMENT_PROVIDER !== "simulated" || process.env.NODE_ENV === "production") {
            throw paymentError("Simulação desabilitada neste ambiente.", 403);
        }

        if (!["approved", "refused"].includes(status)) {
            throw paymentError("Na simulação, use approved ou refused.", 400);
        }

        const payment = await ownedPayment(id, userId);
        const gateway = await gatewayService.getGateway(id);

        if (gateway.provider !== "simulated" || gateway.environment !== "simulated") {
            throw paymentError("Somente pagamentos simulados podem ser alterados nesta rota.", 409);
        }

        if (payment.status !== "pending" && payment.status !== status) {
            throw paymentError("O pagamento simulado já foi finalizado.", 409);
        }

        const checkout = await gatewayService.getCheckout(id);

        if (!checkout) {
            throw paymentError("Recupere o checkout antes de simular o resultado.", 409);
        }

        await gatewayService.applyCheckout(id, {
            ...checkout,
            status,
            provider_status: status,
            status_detail: "simulated"
        });

        return {
            payment: await ownedPayment(id, userId),
            checkout: await gatewayService.getCheckout(id)
        };
    },

    async createPayment(payment, prepared) {
        const gateway = await gatewayService.getGateway(payment.id);
        if (gateway.provider === "simulated") {
            const checkout = await simulated.createPayment(payment);
            await gatewayService.applyCheckout(payment.id, { ...checkout, environment: "simulated", provider_order_id: null, provider_status: "pending" });
            return gatewayService.getCheckout(payment.id);
        }
        assertEnvironment(gateway);
        const binding = await splitService.getBinding(payment.id);
        if (gateway.provider_status === "reconciliation_required") return reconcileOrder(payment);
        try {
            if (binding) {
                const data = gateway.transaction_id ? await splitProvider.get(gateway.transaction_id, binding) : await splitProvider.create(payment, prepared.input, binding);
                return await applySplit(data, payment, binding);
            }
            const order = gateway.order_id ? await mercadoPago.getOrder(gateway.order_id) : await mercadoPago.createOrder(payment, prepared.input);
            return await applyOrder(order, payment);
        } catch (error) {
            if (error.providerDetails?.provider_status === 402 || [400, 422].includes(error.providerDetails?.provider_status) && !error.definitive) {
                await gatewayService.requireReconciliation(payment.id);
                error.providerDetails = { ...error.providerDetails, payment_id: payment.id, reconciliation_required: true };
                let checkout;
                try {
                    checkout = await reconcileOrder(payment);
                } catch (reconciliationError) {
                    // Sem confirmação externa, preserva o pendente e impede novo POST de cobrança.
                    throw error;
                }
                if (checkout.status !== "refused") return checkout;
                error.message = "O Mercado Pago confirmou a falha do pagamento. Consulte status_detail para o motivo.";
                error.providerDetails = {
                    ...error.providerDetails,
                    reconciliation_required: false,
                    provider_order_id: checkout.provider_order_id,
                    provider_payment_id: checkout.provider_payment_id,
                    payment_status: checkout.status,
                    status_detail: checkout.status_detail
                };
                throw error;
            }
            if (error.definitive && !gateway.order_id) {
                await gatewayService.applyCheckout(payment.id, {
                    provider: "mercado_pago", environment: gateway.environment,
                    ...(binding ? { provider_api: "payments", split_payment: true } : {}),
                    provider_order_id: null, provider_payment_id: null,
                    provider_status: "request_rejected", status_detail: "invalid_request",
                    status: "refused", method: payment.method, simulation: false
                });
            }
            throw error;
        }
    },
    async sync(id, userId) {
        const payment = await ownedPayment(id, userId);
        const gateway = await gatewayService.getGateway(id);
        assertEnvironment(gateway);
        const checkout = await reconcileOrder(payment);
        return { payment: await ownedPayment(id, userId), checkout };
    },
    async cancel(id, userId) {
        const current = await this.sync(id, userId);
        if (["canceled", "cancelled", "expired"].includes(current.checkout.provider_status)) return current;
        if (current.payment.status !== "pending") throw paymentError("Somente pagamentos pendentes podem ser cancelados.", 409);
        const binding = await splitService.getBinding(id);
        if (binding) await splitProvider.cancel(current.checkout.provider_payment_id, id, binding);
        else await mercadoPago.cancelOrder(current.checkout.provider_order_id, id);
        return this.sync(id, userId);
    },
    async refund(id) {
        const payment = await gatewayService.getPayment(id);
        if (!payment) throw paymentError("Pagamento não encontrado.", 404);
        const current = await this.sync(id, payment.id_user);
        if (current.payment.status === "refunded") return current;
        if (current.payment.status !== "approved" || payment.shopping_status === "completed") {
            throw paymentError("Reembolso automático disponível somente para pagamento aprovado de compra não concluída.", 409);
        }
        if (["in_mediation", "charged_back"].includes(current.checkout.provider_status) || current.checkout.status_detail === "partially_refunded" || current.checkout.partial_refund) {
            throw paymentError("Pagamento com disputa ou estorno parcial exige conciliação administrativa.", 409);
        }
        const binding = await splitService.getBinding(id);
        if (binding) await splitProvider.refund(current.checkout.provider_payment_id, id, binding);
        else await mercadoPago.refundOrder(current.checkout.provider_order_id, id);
        return this.sync(id, payment.id_user);
    },
    async webhook(req) {
        const orderId = mercadoPago.validateWebhook(req);
        const topic = req.query.type || req.body?.type;
        if (!["order", "payment"].includes(topic) || req.query.type && req.body?.type && req.query.type !== req.body.type) {
            throw paymentError("Configure os tópicos Orders e Pagamentos no webhook.", 400);
        }
        if (req.body?.data?.id && String(req.body.data.id).toLowerCase() !== orderId.toLowerCase()) throw paymentError("IDs do webhook divergentes.", 400);
        if (topic === "payment") {
            const accountId = await splitService.accountForWebhook(orderId, req.body?.user_id);
            if (!accountId) return;
            const data = await splitProvider.get(orderId, { account_id: accountId });
            if (String(data.id) !== orderId) throw paymentError("Pagamento divergente no webhook.", 502);
            const payment = await gatewayService.getPayment(data.external_reference);
            if (!payment) return;
            const binding = await splitService.getBinding(payment.id);
            if (!binding || binding.account_id !== accountId) throw paymentError("Webhook sem vínculo com o split local.", 409);
            assertEnvironment(await gatewayService.getGateway(payment.id));
            await applySplit(data, payment, binding);
            return;
        }
        // O body não é fonte de verdade: consulta autenticada ao provedor.
        const order = await mercadoPago.getOrder(orderId);
        if (String(order.id).toLowerCase() !== orderId.toLowerCase()) throw paymentError("Order divergente.", 502);
        const payment = await gatewayService.getPayment(order.external_reference);
        if (!payment) return;
        assertEnvironment(await gatewayService.getGateway(payment.id));
        if (await splitService.getBinding(payment.id)) throw paymentError("O pagamento usa Payments API, não Orders.", 409);
        await applyOrder(order, payment);
    }
};

module.exports = paymentProviderService;
