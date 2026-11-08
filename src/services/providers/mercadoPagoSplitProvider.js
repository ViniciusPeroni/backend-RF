const axios = require("axios");
const QRCode = require("qrcode");
const accounts = require("../paymentAccountService");
const mercadoPago = require("./mercadoPagoPaymentProvider");
const paymentError = require("../../utils/paymentError");

function resourcePath(id) {
    if (!/^[1-9]\d{0,39}$/.test(String(id))) throw paymentError("ID do pagamento Mercado Pago inválido.", 400);
    return `/${id}`;
}

async function request(method, path, binding, body, key) {
    const credentials = await accounts.credentials(binding.account_id);
    if (binding.collector_id && (binding.collector_id !== credentials.collectorId || binding.marketplace_id !== credentials.marketplaceId)) {
        throw paymentError("O recebedor vinculado ao pagamento diverge da credencial OAuth.", 409);
    }
    try {
        return (await axios({ method, url: `https://api.mercadopago.com/v1/payments${path}`, timeout: 10000, maxRedirects: 0,
            headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json", ...(key ? { "X-Idempotency-Key": key } : {}) },
            ...(body !== undefined ? { data: body } : {}) })).data;
    } catch (error) {
        const failure = mercadoPago.providerFailure(error);
        if ([401, 403].includes(error.response?.status)) {
            // No split a chamada usa o token OAuth do vendedor, não a credencial do marketplace.
            failure.message = "O Mercado Pago negou a operação com a autorização do vendedor. Confira provider_code, a habilitação da conta recebedora e refaça a vinculação se ela foi revogada.";
            const message = error.response.data?.message;
            if (typeof message === "string" && message.length <= 200) failure.providerDetails.provider_message = message;
        }
        throw failure;
    }
}

async function normalizePayment(data, payment, binding) {
    if (!data || !/^[1-9]\d{0,39}$/.test(String(data.id)) || typeof data.id === "number" && !Number.isSafeInteger(data.id) || String(data.external_reference).toLowerCase() !== payment.id.toLowerCase() ||
        Number(data.transaction_amount) !== Number(payment.value) || data.currency_id !== "BRL" ||
        String(data.collector_id) !== binding.collector_id || data.live_mode !== (binding.environment === "production") ||
        !mercadoPago.matchesMethod(payment.method, data.payment_type_id) || (payment.method === "pix" && data.payment_method_id !== "pix")) {
        throw paymentError("O pagamento Mercado Pago diverge do vínculo, valor, método ou ambiente local.", 502);
    }
    let status = "pending";
    const refundedAmount = Number(data.transaction_amount_refunded || 0);
    if (!Number.isFinite(refundedAmount) || refundedAmount < 0 || refundedAmount > Number(payment.value)) {
        throw paymentError("Valor de estorno divergente no Mercado Pago.", 502);
    }
    if (data.status === "approved") status = "approved";
    else if (data.status === "refunded") {
        if (Number(data.transaction_amount_refunded) !== Number(payment.value)) throw paymentError("Reembolso parcial exige conciliação administrativa.", 409);
        status = "refunded";
    } else if (["rejected", "cancelled"].includes(data.status)) status = "refused";
    else if (!["pending", "in_process", "authorized", "in_mediation", "charged_back"].includes(data.status)) {
        throw paymentError("Status de pagamento desconhecido; conciliação necessária.", 502);
    }
    if (["in_mediation", "charged_back"].includes(data.status)) status = payment.status;
    const feeItems = Array.isArray(data.fee_details) ? data.fee_details.filter(item => item.type === "application_fee") : null;
    const fee = feeItems?.reduce((sum, item) => sum + Number(item.amount), 0);
    if (data.status === "approved" && !refundedAmount &&
        (!feeItems || feeItems.some(item => item.fee_payer !== "collector" || !/^\d{1,9}(?:\.\d{1,2})?$/.test(String(item.amount))) ||
            !Number.isFinite(fee) || Math.round(fee * 100) !== Math.round(Number(binding.application_fee) * 100))) {
        throw paymentError("A comissão retornada pelo Mercado Pago diverge do split contratado.", 502);
    }
    const pix = data.point_of_interaction?.transaction_data || {};
    const pixPending = payment.method === "pix" && status === "pending" && !["in_mediation", "charged_back"].includes(data.status);
    const qr_code = pixPending && typeof pix.qr_code === "string" ? pix.qr_code : null;
    const qr_code_base64 = qr_code ? (await QRCode.toDataURL(qr_code, { width: 320, margin: 2 })).split(",")[1] : null;
    return { provider: "mercado_pago", provider_api: "payments", simulation: false, environment: binding.environment,
        provider_order_id: null, provider_payment_id: String(data.id), provider_status: data.status,
        status_detail: typeof data.status_detail === "string" ? data.status_detail : null,
        status, method: payment.method, qr_code, qr_code_base64,
        ticket_url: pixPending && typeof pix.ticket_url === "string" && /^https:\/\//.test(pix.ticket_url) ? pix.ticket_url : null,
        split_payment: true, application_fee: Number(binding.application_fee).toFixed(2),
        needs_review: ["in_mediation", "charged_back"].includes(data.status) || refundedAmount > 0 && status !== "refunded",
        partial_refund: refundedAmount > 0 && status !== "refunded" };
}

module.exports = {
    normalizePayment,
    create(payment, input, binding) {
        const notificationUrl = process.env.PAYMENT_WEBHOOK_URL;
        if (notificationUrl) {
            let url;
            try { url = new URL(notificationUrl); } catch (error) { throw paymentError("PAYMENT_WEBHOOK_URL inválida.", 503); }
            if (url.protocol !== "https:" || url.username || url.password || url.hash || notificationUrl.length >= 500) {
                throw paymentError("PAYMENT_WEBHOOK_URL deve ser uma URL HTTPS pública válida.", 503);
            }
        }
        return request("POST", "", binding, {
            transaction_amount: Number(payment.value), description: "Pagamento de compra Reaproveita Franca", external_reference: payment.id,
            payment_method_id: input.payment_method.id, payer: input.payer, application_fee: Number(binding.application_fee),
            ...(notificationUrl ? { notification_url: notificationUrl } : {}),
            ...(payment.method === "pix" ? {} : { token: input.payment_method.token, installments: input.payment_method.installments })
        }, payment.id);
    },
    get(id, binding) { return request("GET", resourcePath(id), binding); },
    async find(payment, binding) {
        const params = new URLSearchParams({ external_reference: payment.id, sort: "date_created", criteria: "desc", limit: "2" });
        const data = await request("GET", `/search?${params}`, binding);
        if (!Array.isArray(data?.results) || !Number.isInteger(data.paging?.total) || data.paging.total !== data.results.length || data.results.length > 1) {
            throw paymentError("Busca de pagamentos inconclusiva ou duplicada; conciliação necessária.", 409);
        }
        if (!data.results.length) return null;
        return request("GET", resourcePath(data.results[0].id), binding);
    },
    cancel(id, paymentId, binding) { return request("PUT", resourcePath(id), binding, { status: "cancelled" }, `${paymentId}-cancel`); },
    refund(id, paymentId, binding) { return request("POST", `${resourcePath(id)}/refunds`, binding, {}, `${paymentId}-refund`); }
};
