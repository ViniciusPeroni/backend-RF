const crypto = require("node:crypto");
const mercadoPagoService = require("./mercadoPagoService");
const paymentService = require("./paymentService");

function createError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function isValidSignature({ paymentId, requestId, signature, secret }) {
    if (typeof signature !== "string" || typeof requestId !== "string" || !requestId.trim()) return false;
    const parts = Object.fromEntries(signature.split(",").map((part) => {
        const [key, ...value] = part.trim().split("=");
        return [key, value.join("=")];
    }));
    if (!/^\d+$/.test(parts.ts || "") || !/^[a-f\d]{64}$/i.test(parts.v1 || "")) return false;

    const manifest = `id:${String(paymentId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest();
    const received = Buffer.from(parts.v1, "hex");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function processNotification({ paymentId, requestId, signature }) {
    if (!/^\d+$/.test(String(paymentId)) || typeof requestId !== "string" || !requestId.trim()) {
        throw createError("Notificação do Mercado Pago inválida.", 400);
    }
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret) throw createError("Webhook do Mercado Pago não está configurado.", 503);
    if (!isValidSignature({ paymentId, requestId, signature, secret })) {
        throw createError("Assinatura do webhook inválida.", 401);
    }

    const payment = await mercadoPagoService.getPayment(String(paymentId));
    if (String(payment.id) !== String(paymentId)) {
        throw createError("O ID consultado não corresponde à notificação.", 409);
    }
    return paymentService.applyProviderPayment(payment);
}

module.exports = { processNotification };
