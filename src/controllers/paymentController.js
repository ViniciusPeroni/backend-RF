const paymentService = require("../services/paymentService");
const shoppingService = require("../services/shoppingService");
const paymentProviderService = require(
    "../services/paymentProviderService"
);
const uuid = require("../utils/uuid");

const VALID_METHODS = ["pix", "credit_card", "debit_card"];

function paymentFailure(error, fallback) {
    return {
        error: error.status ? error.message : fallback,
        ...(error.providerDetails || {})
    };
}

const createPayment = async (req, res) => {
    try {
        const { id_shopping, method } = req.body || {};

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Autenticação necessária."
            });
        }

        if (!uuid.isValid(id_shopping)) {
            return res.status(400).json({
                error: "ID da compra inválido."
            });
        }

        if (!VALID_METHODS.includes(method)) {
            return res.status(400).json({
                error: "Método inválido. Use pix, credit_card ou debit_card."
            });
        }

        const shopping = await shoppingService.getShoppingById(
            id_shopping
        );

        if (!shopping) {
            return res.status(404).json({
                error: "Compra não encontrada."
            });
        }

        const isOwner =
            String(shopping.id_user).toLowerCase() ===
            String(req.userId).toLowerCase();

        if (!isOwner) {
            return res.status(403).json({
                error: "Acesso negado a esta compra."
            });
        }

        if (shopping.status !== "pending") {
            return res.status(409).json({
                error: "A compra não está disponível para pagamento."
            });
        }

        const value = Number(shopping.value);

        if (!Number.isFinite(value) || value <= 0) {
            return res.status(400).json({
                error: "A compra deve possuir um valor maior que zero."
            });
        }

        const prepared = await paymentProviderService.prepare(method, req.body || {}, shopping.user_email, shopping.id);
        const result = await paymentService.createPayment({
            id_shopping: shopping.id,
            userId: req.userId,
            method,
            gateway: prepared.gateway
        });

        const { reused, ...payment } = result;

        const checkout = await paymentProviderService.createPayment(payment, prepared);
        const updatedPayment = await paymentService.getPaymentById(payment.id, req.userId);

        return res.status(reused ? 200 : 201).json({
            message: reused
                ? "Pagamento recuperado com sucesso."
                : "Pagamento registrado com sucesso.",
            payment: updatedPayment,
            checkout
        });

    } catch (error) {
        if (error.status) {
            return res.status(error.status).json(paymentFailure(error, "Erro ao registrar pagamento."));
        }

        console.error(
            "Erro em createPayment:",
            error.code || error.name
        );

        return res.status(500).json({
            error: "Erro ao registrar pagamento."
        });
    }
};

const getPaymentById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Autenticação necessária."
            });
        }

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID do pagamento inválido."
            });
        }

        const payment = await paymentService.getPaymentById(
            id,
            req.userId
        );

        if (!payment) {
            return res.status(404).json({
                error: "Pagamento não encontrado."
            });
        }

        return res.status(200).json(payment);

    } catch (error) {
        console.error(
            "Erro em getPaymentById:",
            error.code || error.name
        );

        return res.status(500).json({
            error: "Erro ao consultar pagamento."
        });
    }
};

const getPaymentsByShoppingId = async (req, res) => {
    try {
        const { shoppingId } = req.params;

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Autenticação necessária."
            });
        }

        if (!uuid.isValid(shoppingId)) {
            return res.status(400).json({
                error: "ID da compra inválido."
            });
        }

        const shopping = await shoppingService.getShoppingById(
            shoppingId
        );

        if (!shopping) {
            return res.status(404).json({
                error: "Compra não encontrada."
            });
        }

        const isOwner =
            String(shopping.id_user).toLowerCase() ===
            String(req.userId).toLowerCase();

        if (!isOwner) {
            return res.status(403).json({
                error: "Acesso negado a esta compra."
            });
        }

        const payments = await paymentService.getPaymentsByShoppingId(
            shoppingId,
            req.userId
        );

        return res.status(200).json(payments);

    } catch (error) {
        console.error(
            "Erro em getPaymentsByShoppingId:",
            error.code || error.name
        );

        return res.status(500).json({
            error: "Erro ao consultar pagamentos da compra."
        });
    }
};

function paymentOperation(operation) {
    return async (req, res) => {
        try {
            if (!uuid.isValid(req.userId)) return res.status(401).json({ error: "Autenticação necessária." });
            if (!uuid.isValid(req.params.id)) return res.status(400).json({ error: "ID do pagamento inválido." });
            if (operation === "refund" && req.role !== "admin") return res.status(403).json({ error: "Reembolso exige um administrador." });
            return res.status(200).json(await paymentProviderService[operation](req.params.id, req.userId, req.body?.status));
        } catch (error) {
            if (!error.status) console.error("Erro na operação de pagamento:", error.code || error.name);
            return res.status(error.status || 500).json(paymentFailure(error, "Erro ao processar pagamento."));
        }
    };
}

const getCheckout = async (req, res) => {
    try {
        if (!uuid.isValid(req.userId)) return res.status(401).json({ error: "Autenticação necessária." });
        if (!uuid.isValid(req.params.id)) return res.status(400).json({ error: "ID do pagamento inválido." });
        const payment = await paymentService.getPaymentById(req.params.id, req.userId);
        if (!payment) return res.status(404).json({ error: "Pagamento não encontrado." });
        return res.status(200).json({ payment, checkout: await paymentProviderService.getCheckout(payment.id) });
    } catch (error) {
        return res.status(error.status || 500).json({ error: error.status ? error.message : "Erro ao consultar checkout." });
    }
};

const webhook = async (req, res) => {
    try {
        await paymentProviderService.webhook(req);
        return res.status(200).json({ received: true });
    } catch (error) {
        if (!error.status) console.error("Erro no webhook de pagamento:", error.code || error.name);
        return res.status(error.status || 500).json(paymentFailure(error, "Falha ao processar webhook."));
    }
};

module.exports = {
    webhook,
    getCheckout,
    sync: paymentOperation("sync"),
    cancel: paymentOperation("cancel"),
    refund: paymentOperation("refund"),
    simulate: paymentOperation("simulate"),
    createPayment,
    getPaymentById,
    getPaymentsByShoppingId
};
