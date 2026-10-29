const axios = require("axios");
const QRCode = require("qrcode");
const crypto = require("crypto");
const paymentError = require("../../utils/paymentError");
let accountCache;

function configuration() {
    const environment = process.env.MERCADO_PAGO_ENV;
    if (!["test", "production"].includes(environment) || !process.env.MERCADO_PAGO_ACCESS_TOKEN) {
        throw paymentError("Configure o ambiente e o Access Token do Mercado Pago.", 503);
    }
    return { environment, token: process.env.MERCADO_PAGO_ACCESS_TOKEN };
}

function providerFailure(error) {
    const status = error.response?.status;
    const data = error.response?.data;
    const values = [data?.code, data?.error, ...(Array.isArray(data?.errors) ? data.errors.map(item => item.code) : [])];
    const code = values.find(value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value));
    let failure;

    if (status === 404) {
        failure = paymentError("Pagamento não encontrado na conta Mercado Pago atual. Confira se ele foi criado em outra conta ou no ambiente de teste. Não recrie a cobrança antes de conciliar.", 409);
    } else if (status === 402) {
        failure = paymentError("O Mercado Pago informou falha no processamento da transação. Consulte a order antes de criar outra tentativa.", 402);
    } else if ([400, 422].includes(status)) {
        failure = paymentError("O Mercado Pago rejeitou os dados ou a operação. Confira o código retornado pelo provedor.", 422);
        failure.definitive = true;
    } else if (status === 409) {
        failure = paymentError("Operação em conflito no Mercado Pago. Consulte o pagamento antes de tentar novamente.", 409);
    } else if ([401, 403].includes(status)) {
        failure = paymentError("Credenciais ou permissões do Mercado Pago inválidas.", 503);
    } else {
        failure = paymentError("Não foi possível confirmar a resposta do Mercado Pago. Repita com os mesmos dados; não crie outra cobrança.", 503);
    }

    failure.providerDetails = {
        ...(status ? { provider_status: status } : {}),
        ...(code ? { provider_code: code } : {})
    };

    return failure;
}

async function verifyAccount() {
    const config = configuration();
    if (accountCache?.token === config.token && accountCache.environment === config.environment && accountCache.expires > Date.now()) {
        return accountCache.account;
    }

    let data;
    try {
        const response = await axios({
            method: "GET",
            url: "https://api.mercadopago.com/users/me",
            timeout: 10000,
            maxRedirects: 0,
            headers: { Authorization: `Bearer ${config.token}` }
        });
        data = response.data;
    } catch (error) {
        throw providerFailure(error);
    }

    if (!data?.id || !Array.isArray(data.tags)) {
        throw paymentError("Não foi possível identificar a conta do Mercado Pago.", 503);
    }

    const testUser = data.tags.includes("test_user");
    if ((config.environment === "test") !== testUser) {
        throw paymentError("A conta Mercado Pago não corresponde a MERCADO_PAGO_ENV. Use test com usuário de teste ou production com conta real. Trocar a chave não converte pagamentos antigos.", 409);
    }

    const account = { id: String(data.id), environment: config.environment };
    accountCache = { token: config.token, environment: config.environment, account, expires: Date.now() + 60000 };
    return account;
}

async function request(method, path, body, key) {
    const config = configuration();
    await verifyAccount();
    try {
        const response = await axios({
            method,
            url: `https://api.mercadopago.com/v1/orders${path}`,
            timeout: 10000,
            maxRedirects: 0,
            headers: {
                Authorization: `Bearer ${config.token}`,
                "Content-Type": "application/json",
                ...(key ? { "X-Idempotency-Key": key } : {})
            },
            ...(body !== undefined ? { data: body } : {})
        });
        return response.data;
    } catch (error) {
        throw providerFailure(error);
    }
}

function orderPath(id) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        throw paymentError("ID da order inválido.", 400);
    }
    return `/${encodeURIComponent(id)}`;
}

function normalizeInput(method, input, email) {
    configuration();
    const payerInput = input.payer || {};
    const payerEmail = payerInput.email || email;
    if (typeof payerEmail !== "string" || payerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
        throw paymentError("Informe um e-mail válido em payer.email.", 400);
    }
    const payer = { email: payerEmail };
    if (payerInput.first_name !== undefined) {
        if (typeof payerInput.first_name !== "string" || !payerInput.first_name.trim() || payerInput.first_name.length > 80) {
            throw paymentError("Nome do pagador inválido.", 400);
        }
        payer.first_name = payerInput.first_name.trim();
    }
    const payment_method = method === "pix" ? { id: "pix", type: "bank_transfer" } : {
        id: input.payment_method_id,
        type: method,
        token: input.token,
        installments: input.installments ?? 1
    };
    if (method !== "pix") {
        if (typeof input.token !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(input.token)) {
            throw paymentError("Envie o token do cartão gerado pelo SDK do Mercado Pago.", 400);
        }
        if (typeof input.payment_method_id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(input.payment_method_id)) {
            throw paymentError("Informe payment_method_id retornado pelo Mercado Pago.", 400);
        }
        if (!Number.isInteger(payment_method.installments) || payment_method.installments < 1 || payment_method.installments > 24 ||
            (method === "debit_card" && payment_method.installments !== 1)) {
            throw paymentError("Parcelas inválidas para este método.", 400);
        }
    }
    return { payer, payment_method };
}

async function normalizeOrder(order, payment) {
    const transactions = order?.transactions?.payments;
    if (!order || typeof order.id !== "string" || !Array.isArray(transactions) || transactions.length !== 1 ||
        String(order.external_reference).toLowerCase() !== payment.id.toLowerCase() ||
        Number(order.total_amount) !== Number(payment.value) ||
        (order.currency && order.currency !== "BRL") ||
        (order.currency_id && order.currency_id !== "BRL") ||
        (order.country_code && order.country_code !== "BRA")) {
        throw paymentError("A order recebida não corresponde ao pagamento local.", 502);
    }
    const transaction = transactions[0];
    const method = transaction.payment_method || {};
    const expectedType = payment.method === "pix" ? "bank_transfer" : payment.method;
    if (Number(transaction.amount) !== Number(payment.value) || method.type !== expectedType ||
        (payment.method === "pix" && method.id !== "pix")) {
        throw paymentError("Valor ou método divergente no Mercado Pago.", 502);
    }
    let status = "pending";
    if (order.status === "refunded" && transaction.status === "refunded") status = "refunded";
    else if (order.status === "processed" && transaction.status === "processed" &&
        ["accredited", "partially_refunded"].includes(transaction.status_detail)) status = "approved";
    else if (["failed", "canceled", "cancelled", "expired"].includes(order.status)) status = "refused";
    const qr_code = typeof method.qr_code === "string" ? method.qr_code : null;
    let qr_code_base64 = typeof method.qr_code_base64 === "string" && method.qr_code_base64 ? method.qr_code_base64 : null;
    if (qr_code && !qr_code_base64) {
        qr_code_base64 = (await QRCode.toDataURL(qr_code, { width: 320, margin: 2 })).split(",")[1];
    }
    const ticket_url = typeof method.ticket_url === "string" && /^https:\/\//.test(method.ticket_url) ? method.ticket_url : null;
    return {
        provider: "mercado_pago", simulation: false,
        environment: configuration().environment,
        provider_order_id: order.id,
        provider_payment_id: transaction.id || null,
        provider_status: order.status,
        status_detail: transaction.status_detail || order.status_detail || null,
        status, method: payment.method, qr_code, qr_code_base64, ticket_url
    };
}

function validateWebhook(req) {
    const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    if (!secret) throw paymentError("Assinatura do webhook não configurada.", 503);
    const id = req.query["data.id"];
    const requestId = req.get("x-request-id");
    const signature = req.get("x-signature") || "";
    const fields = Object.fromEntries(signature.split(",").map(part => part.trim().split("=")));
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
        !requestId || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ||
        !/^\d{1,16}$/.test(fields.ts || "") || !/^[a-fA-F0-9]{64}$/.test(fields.v1 || "")) {
        throw paymentError("Assinatura do webhook inválida.", 401);
    }
    const manifest = `id:${id};request-id:${requestId};ts:${fields.ts};`;
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(fields.v1, "hex"))) {
        throw paymentError("Assinatura do webhook inválida.", 401);
    }
    return id;
}

module.exports = {
    configuration, verifyAccount, normalizeInput, normalizeOrder, validateWebhook,
    createOrder(payment, input) {
        const amount = Number(payment.value).toFixed(2);
        return request("POST", "", {
            type: "online", processing_mode: "automatic",
            total_amount: amount, external_reference: payment.id,
            payer: input.payer,
            transactions: { payments: [{ amount, payment_method: input.payment_method }] }
        }, payment.id);
    },
    getOrder(id) { return request("GET", orderPath(id)); },
    async findOrder(payment) {
        const created = new Date(payment.datetime).getTime();
        if (!Number.isFinite(created)) throw paymentError("Data do pagamento inválida para conciliação.", 409);
        const params = new URLSearchParams({
            begin_date: new Date(created - 86400000).toISOString(),
            end_date: new Date().toISOString(),
            external_reference: payment.id,
            type: "online", page_size: "2"
        });
        const result = await request("GET", `?${params}`);
        if (!Array.isArray(result?.data)) throw paymentError("Resposta de busca de orders inválida.", 502);
        const total = Number(result.paging?.total);
        if (!Number.isInteger(total) || total < 0) throw paymentError("Paginação de orders inválida.", 502);
        if (total > 1 || result.data.length > 1) throw paymentError("Mais de uma order encontrada. Conciliação manual necessária; não crie outra cobrança.", 409);
        if (total !== result.data.length) throw paymentError("Busca de orders incompleta. Consulte novamente antes de criar outra cobrança.", 502);
        if (!total) return null;
        const order = result.data[0];
        if (String(order.external_reference).toLowerCase() !== payment.id.toLowerCase()) {
            throw paymentError("Referência divergente na busca da order.", 502);
        }
        return request("GET", orderPath(order.id));
    },
    cancelOrder(id, paymentId) { return request("POST", `${orderPath(id)}/cancel`, undefined, `${paymentId}-cancel`); },
    refundOrder(id, paymentId) { return request("POST", `${orderPath(id)}/refund`, undefined, `${paymentId}-refund`); }
};
