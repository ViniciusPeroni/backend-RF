const axios = require("axios");

const API_URL = "https://api.mercadopago.com";
const REQUEST_TIMEOUT_MS = 10000;

function createError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function getAccessToken() {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
        throw createError("Mercado Pago não está configurado.", 503);
    }
    return token;
}

function getEnvironment() {
    const environment = process.env.MP_ENVIRONMENT || "sandbox";
    if (!["sandbox", "production"].includes(environment)) {
        throw createError("Ambiente do Mercado Pago inválido.", 503);
    }
    return environment;
}

function requestConfig(accessToken) {
    return {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: REQUEST_TIMEOUT_MS
    };
}

async function createPreference(preferenceBody) {
    const accessToken = getAccessToken();
    const environment = getEnvironment();

    let data;
    try {
        ({ data } = await axios.post(
            `${API_URL}/checkout/preferences`,
            preferenceBody,
            requestConfig(accessToken)
        ));
    } catch {
        throw createError("Não foi possível criar o checkout no Mercado Pago.", 502);
    }

    const checkoutUrl = environment === "production" ? data?.init_point : data?.sandbox_init_point;
    if (!data?.id || !checkoutUrl) {
        throw createError("O Mercado Pago retornou uma preferência de checkout inválida.", 502);
    }

    return { id: String(data.id), checkoutUrl };
}

async function getPayment(paymentId) {
    if (!/^\d+$/.test(String(paymentId))) {
        throw createError("ID de pagamento do Mercado Pago inválido.", 400);
    }

    const accessToken = getAccessToken();
    try {
        const { data } = await axios.get(
            `${API_URL}/v1/payments/${encodeURIComponent(paymentId)}`,
            requestConfig(accessToken)
        );
        return data;
    } catch {
        throw createError("Não foi possível consultar o pagamento no Mercado Pago.", 502);
    }
}

async function getPreference(preferenceId) {
    if (!/^[\w-]+$/.test(String(preferenceId))) {
        throw createError("ID de preferência do Mercado Pago inválido.", 400);
    }

    const accessToken = getAccessToken();
    const environment = getEnvironment();
    let data;
    try {
        ({ data } = await axios.get(
            `${API_URL}/checkout/preferences/${encodeURIComponent(preferenceId)}`,
            requestConfig(accessToken)
        ));
    } catch {
        throw createError("Não foi possível consultar a preferência no Mercado Pago.", 502);
    }

    const checkoutUrl = environment === "production" ? data?.init_point : data?.sandbox_init_point;
    if (!data?.id || !checkoutUrl) {
        throw createError("O Mercado Pago retornou uma preferência inválida.", 502);
    }
    return { id: String(data.id), checkoutUrl };
}

async function getPaymentMethods() {
    const accessToken = getAccessToken();
    try {
        const { data } = await axios.get(`${API_URL}/v1/payment_methods`, requestConfig(accessToken));
        if (!Array.isArray(data)) {
            throw new Error("Resposta inválida");
        }
        return data;
    } catch {
        throw createError("Não foi possível consultar os meios de pagamento.", 502);
    }
}

module.exports = { createPreference, getPayment, getPreference, getPaymentMethods };
