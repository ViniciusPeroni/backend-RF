// Teste explícito com MySQL local e transporte externo interceptado. Sem cobranças reais.
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const uuid = require("../src/utils/uuid");

if (process.env.RUN_PAYMENT_DB_TESTS !== "1" || process.env.NODE_ENV === "production") {
    console.error("Defina RUN_PAYMENT_DB_TESTS=1 somente em banco de desenvolvimento.");
    process.exit(1);
}
if (!process.env.SECRET) throw new Error("SECRET local necessária para o teste de login.");
process.env.PAYMENT_PROVIDER = "mercado_pago";
process.env.MERCADO_PAGO_ENV = "test";
process.env.MERCADO_PAGO_ACCESS_TOKEN = "TOKEN_FICTICIO_SEM_ACESSO_EXTERNO";
process.env.MERCADO_PAGO_WEBHOOK_SECRET = crypto.randomBytes(32).toString("hex");
process.env.PAYMENT_COMMISSION_PERCENT = "5";
process.env.split_payment = "false";
process.env.MERCADO_PAGO_CLIENT_ID = "123456";
process.env.MERCADO_PAGO_CLIENT_SECRET = "CLIENT_SECRET_FICTICIO";
process.env.MERCADO_PAGO_REDIRECT_URI = "https://example.invalid/payment/mercado-pago/oauth/callback";
process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
delete process.env.PAYMENT_WEBHOOK_URL;

const pool = require("../src/db/connect");
const db = pool.promise();
const gatewayService = require("../src/services/paymentGatewayService");
const orders = new Map();
const idempotency = new Map();
const calls = { create: 0, submit: 0, cancel: 0, refund: 0 };
const splitPayments = new Map();
const splitOwners = new Map();
const splitIdempotency = new Map();
const splitCalls = { submit: 0, create: 0, cancel: 0, refund: 0, refresh: 0, oauth: 0 };
let splitLastInstallments;
let oauthCollector = "90011";
let oauthLiveMode = false;
let oauthFailure = false;
let oauthTokenBarrier;
let blockExternalRequests = false;
let splitNextStatus;
let splitMissingPixKey;
let sellerRegulatoryBlocked = false;
let sellerAuthorizationRevoked = false;
let splitPolicyDenied = false;
let splitCardType;
let splitTimeout = false;
let splitProcessingFailure = false;
let splitRefundFailure = false;
let splitRefundTimeout = false;
let splitCancelTimeout = false;
let failNext;
let timeoutAfterCreate = false;
let processingFailure = false;
let searchFailure = false;
let duplicateSearch = false;
let corruptAmount = false;
let mockAccountId = "90001";
let mockTestUser = true;
let mockApplicationTestToken = "CREDENCIAL_DE_TESTE_DA_APLICACAO";

axios.defaults.adapter = async config => {
    if (blockExternalRequests) throw new axios.AxiosError("Provedor indisponível no teste", "ECONNABORTED", config);
    const url = new URL(config.url);
    assert.equal(url.origin, "https://api.mercadopago.com");
    if (url.pathname === "/users/me") {
        const authorization = config.headers.get("Authorization") || "";
        const seller = /^Bearer SELLER_ACCESS_(\d+)_FICTICIO$/.exec(authorization);
        if (seller && sellerAuthorizationRevoked) throw new axios.AxiosError("Token revogado", "ERR_BAD_REQUEST", config, null, { status: 401, data: { message: "invalid_token" }, headers: {}, config });
        if (seller) return { status: 200, data: { id: seller[1], tags: ["test_user"],
            status: { sell: { allow: !sellerRegulatoryBlocked, codes: Array.isArray(sellerRegulatoryBlocked) ? sellerRegulatoryBlocked : sellerRegulatoryBlocked ? ["rejected_by_regulations"] : [] } } }, headers: {}, config };
        return { status: 200, statusText: "OK", data: { id: mockAccountId, tags: mockTestUser ? ["test_user"] : [] }, headers: {}, config };
    }
    if (url.pathname === "/applications/123456") {
        return { status: 200, data: { id: "123456", test_access_token: mockApplicationTestToken }, headers: {}, config };
    }
    if (url.pathname === "/oauth/token") {
        if (oauthFailure) throw new axios.AxiosError("OAuth rejeitado", "ERR_BAD_RESPONSE", config, null, { status: 400, data: { error: "invalid_grant" }, headers: {}, config });
        const fields = new URLSearchParams(config.data);
        assert.equal(fields.get("client_id"), "123456");
        assert.equal(fields.get("client_secret"), "CLIENT_SECRET_FICTICIO");
        if (fields.get("grant_type") === "refresh_token") splitCalls.refresh++;
        else {
            assert.equal(fields.get("grant_type"), "authorization_code");
            assert.ok(fields.get("code_verifier").length >= 43);
            splitCalls.oauth++;
            if (oauthTokenBarrier) await oauthTokenBarrier();
        }
        return { status: 200, data: { access_token: `SELLER_ACCESS_${oauthCollector}_FICTICIO`, refresh_token: "REFRESH_FICTICIO",
            user_id: Number(oauthCollector), live_mode: oauthLiveMode, expires_in: 3600 }, headers: {}, config };
    }
    const data = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[1] === "payments") {
        const authorized = /^Bearer SELLER_ACCESS_(\d+)_FICTICIO$/.exec(config.headers.get("Authorization"));
        assert.ok(authorized);
        const collector = Number(authorized[1]);
        let result;
        if (config.method === "post" && segments.length === 2) {
            splitCalls.submit++;
            splitLastInstallments = data.installments;
            const key = config.headers.get("X-Idempotency-Key");
            assert.equal(data.external_reference, key);
            assert.equal(data.application_fee, 2.5);
            assert.equal(data.transaction_amount, 50);
            assert.ok(!JSON.stringify(data).includes("CLIENT_SECRET_FICTICIO"));
            if (splitPolicyDenied) {
                splitPolicyDenied = false;
                throw new axios.AxiosError("Política negou", "ERR_BAD_REQUEST", config, null,
                    { status: 403, data: { code: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES", message: "At least one policy returned UNAUTHORIZED." }, headers: {}, config });
            }
            if (splitMissingPixKey) {
                const description = splitMissingPixKey === "known" ? "Collector user without key enabled for QR render" : "Falha não identificada";
                splitMissingPixKey = undefined;
                throw new axios.AxiosError("Pix indisponível", "ERR_BAD_RESPONSE", config, null,
                    { status: 400, data: { message: description, cause: [{ code: 13253, description }] }, headers: {}, config });
            }
            if (!splitIdempotency.has(key)) {
                const id = String(100000001 + splitPayments.size);
                const status = splitNextStatus || (data.payment_method_id === "pix" ? "pending" : "approved");
                splitNextStatus = undefined;
                result = { id: Number(id), external_reference: key, transaction_amount: data.transaction_amount, transaction_amount_refunded: 0,
                    collector_id: collector, live_mode: false, currency_id: "BRL", payment_method_id: data.payment_method_id,
                    payment_type_id: data.payment_method_id === "pix" ? "bank_transfer" : splitCardType || (data.payment_method_id === "debelo" ? "debit_card" : "credit_card"),
                    status, status_detail: status === "approved" ? "accredited" : status === "rejected" ? "cc_rejected_other_reason" : "pending_waiting_transfer",
                    fee_details: [{ type: "application_fee", amount: data.application_fee, fee_payer: "collector" }],
                    point_of_interaction: { transaction_data: data.payment_method_id === "pix" ? { qr_code: "QR_SPLIT_FICTICIO_SEM_VALOR", ticket_url: "https://example.invalid/pix" } : {} } };
                splitPayments.set(id, result);
                splitOwners.set(id, collector);
                splitIdempotency.set(key, id);
                splitCalls.create++;
            }
            result = splitPayments.get(splitIdempotency.get(key));
            if (splitTimeout) { splitTimeout = false; throw new axios.AxiosError("Timeout após criar split", "ECONNABORTED", config); }
            if (splitProcessingFailure) {
                splitProcessingFailure = false; result.status = "rejected"; result.status_detail = "processing_error";
                throw new axios.AxiosError("Falha 402 split", "ERR_BAD_RESPONSE", config, null, { status: 402, data: { errors: [{ code: "failed" }] }, headers: {}, config });
            }
        } else if (segments[2] === "search") {
            const results = [...splitPayments.values()].filter(payment => splitOwners.get(String(payment.id)) === collector && payment.external_reference === url.searchParams.get("external_reference"));
            result = { results, paging: { total: results.length } };
        } else {
            result = splitPayments.get(segments[2]);
            assert.ok(result, "Pagamento split deve existir");
            assert.equal(splitOwners.get(segments[2]), collector, "Consulta deve usar a credencial do recebedor histórico");
            if (config.method === "put") {
                assert.equal(data.status, "cancelled");
                result.status = "cancelled"; result.status_detail = "by_collector"; splitCalls.cancel++;
                if (splitCancelTimeout) { splitCancelTimeout = false; throw new axios.AxiosError("Timeout após cancelar split", "ECONNABORTED", config); }
            } else if (config.method === "post" && segments[3] === "refunds") {
                if (splitRefundFailure) throw new axios.AxiosError("Estorno recusado", "ERR_BAD_RESPONSE", config, null, { status: 422, data: {}, headers: {}, config });
                result.status = "refunded"; result.status_detail = "refunded"; result.transaction_amount_refunded = result.transaction_amount; splitCalls.refund++;
                if (splitRefundTimeout) { splitRefundTimeout = false; throw new axios.AxiosError("Timeout após estornar split", "ECONNABORTED", config); }
            }
        }
        return { status: 200, data: structuredClone(result), headers: {}, config };
    }
    let result;
    if (config.method === "post" && segments.length === 2) calls.submit++;
    if (failNext) {
        const status = failNext;
        failNext = null;
        const failureData = [402, 404, 422].includes(status) ? { errors: [{ code: status === 404 ? "order_not_found" : status === 422 ? "property_value" : "failed" }] } : {};
        throw new axios.AxiosError("Falha externa de teste", "ERR_BAD_RESPONSE", config, null, { status, data: failureData, headers: {}, config });
    }
    if (config.method === "get" && segments.length === 2) {
        assert.ok(Number.isFinite(Date.parse(url.searchParams.get("begin_date"))));
        assert.ok(Number.isFinite(Date.parse(url.searchParams.get("end_date"))));
        assert.equal(url.searchParams.get("type"), "online");
        if (searchFailure) throw new axios.AxiosError("Busca indisponível", "ERR_BAD_RESPONSE", config, null, { status: 503, data: {}, headers: {}, config });
        const matching = [...orders.values()].filter(order => order.external_reference === url.searchParams.get("external_reference"));
        if (duplicateSearch && matching.length) matching.push(structuredClone(matching[0]));
        result = { data: matching, paging: { total: String(matching.length) } };
    } else if (config.method === "post" && segments.length === 2) {
        const key = config.headers.get("X-Idempotency-Key");
        assert.equal(key, data.external_reference);
        if (!idempotency.has(key)) {
            calls.create++;
            const id = `ORD${key.replaceAll("-", "").toUpperCase()}`;
            result = {
                id, type: "online", external_reference: key, total_amount: data.total_amount,
                country_code: "BRA", status: "action_required", status_detail: "waiting_transfer",
                transactions: { payments: [{
                    id: `PAY${key.replaceAll("-", "")}`, amount: data.total_amount,
                    status: "action_required", status_detail: "waiting_transfer",
                    payment_method: { id: data.transactions.payments[0].payment_method.id,
                        type: data.transactions.payments[0].payment_method.type,
                        ...(data.transactions.payments[0].payment_method.id === "pix" ? { qr_code: "PIX_FICTICIO_SEM_VALOR", ticket_url: "https://example.invalid/ticket" } : {}) }
                }] }
            };
            idempotency.set(key, id);
            orders.set(id, result);
        }
        result = orders.get(idempotency.get(key));
        if (processingFailure) {
            processingFailure = false;
            result.status = "failed";
            result.status_detail = "failed";
            result.transactions.payments[0].status = "failed";
            result.transactions.payments[0].status_detail = "processing_error";
            throw new axios.AxiosError("Falha de processamento", "ERR_BAD_RESPONSE", config, null, { status: 402, data: { errors: [{ code: "failed" }] }, headers: {}, config });
        }
        if (timeoutAfterCreate) {
            timeoutAfterCreate = false;
            throw new axios.AxiosError("Timeout de teste", "ECONNABORTED", config);
        }
    } else {
        result = orders.get(segments[2]);
        assert.ok(result, "Order de teste deve existir");
        if (config.method === "post") {
            const operation = segments[3];
            const status = operation === "refund" ? "refunded" : "canceled";
            if (result.status !== status) calls[operation]++;
            result.status = status;
            result.status_detail = status;
            result.transactions.payments[0].status = status;
            result.transactions.payments[0].status_detail = status;
        }
    }
    result = structuredClone(result);
    if (corruptAmount) result.total_amount = "0.01";
    return { status: 200, statusText: "OK", data: result, headers: {}, config };
};

const ids = { buyer: uuid.generateId(), seller: uuid.generateId(), admin: uuid.generateId(), location: uuid.generateId(), product: uuid.generateId() };
const shoppingIds = [];
const extraProducts = [];
const password = crypto.randomBytes(24).toString("hex");
const email = `payment-${ids.buyer}@example.invalid`;
let server;
let base;
let token;
let passed = 0;

async function request(method, route, body, auth = token, extraHeaders = {}) {
    const response = await fetch(`${base}${route}`, {
        method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
}
async function check(name, fn) {
    await fn();
    passed++;
    console.log(`OK ${passed}: ${name}`);
}
async function shopping(items = [{ id_product: ids.product, quantity: 2 }]) {
    const response = await request("POST", "/shopping/create", { items });
    assert.equal(response.status, 201);
    shoppingIds.push(response.body.shopping.id);
    return response.body.shopping.id;
}
async function create(id, method = "pix", extra = {}) {
    return request("POST", "/payment/create", {
        id_shopping: id, method,
        ...(method === "pix" ? {} : { token: "card_token_ficticio", payment_method_id: method === "debit_card" ? "debelo" : "master", installments: 1 }), ...extra
    });
}
async function stock() {
    const [rows] = await db.query("SELECT quantity FROM product WHERE id = ?", [uuid.toBin(ids.product)]);
    return rows[0].quantity;
}
function approved(orderId) {
    const order = orders.get(orderId);
    order.status = "processed";
    order.status_detail = "accredited";
    order.transactions.payments[0].status = "processed";
    order.transactions.payments[0].status_detail = "accredited";
}
function webhookHeaders(id) {
    const ts = String(Date.now());
    const requestId = crypto.randomUUID();
    const digest = crypto.createHmac("sha256", process.env.MERCADO_PAGO_WEBHOOK_SECRET)
        .update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
    return { "x-request-id": requestId, "x-signature": `ts=${ts},v1=${digest}` };
}
async function cleanup() {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        for (const id of shoppingIds) {
            await conn.query("DELETE FROM notification WHERE reference_table = 'payment' AND reference_id IN (SELECT id FROM payment WHERE id_shopping = ?)", [uuid.toBin(id)]);
            await conn.query("DELETE FROM payment WHERE id_shopping = ?", [uuid.toBin(id)]);
            await conn.query("DELETE FROM shopping_product WHERE id_shopping = ?", [uuid.toBin(id)]);
            await conn.query("DELETE FROM shopping WHERE id = ? AND id_user = ?", [uuid.toBin(id), uuid.toBin(ids.buyer)]);
        }
        await conn.query("DELETE FROM product WHERE id = ? AND id_user = ?", [uuid.toBin(ids.product), uuid.toBin(ids.seller)]);
        for (const item of extraProducts) await conn.query("DELETE FROM product WHERE id = ? AND id_user = ?", [uuid.toBin(item.id), uuid.toBin(item.owner)]);
        await conn.query("DELETE FROM localization WHERE id = ? AND id_user = ?", [uuid.toBin(ids.location), uuid.toBin(ids.seller)]);
        for (const id of [ids.buyer, ids.seller, ids.admin]) await conn.query("DELETE FROM `user` WHERE id = ?", [uuid.toBin(id)]);
        await conn.commit();
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
}

(async () => {
    try {
        // Única DDL: tabela nova; nunca lê/executa o script destrutivo do schema.
        await db.query(fs.readFileSync(path.join(__dirname, "../src/mysql-init/migration_payment_gateway.sql"), "utf8"));
        await db.query(fs.readFileSync(path.join(__dirname, "../src/mysql-init/migration_payment_distribution.sql"), "utf8"));
        const splitMigration = fs.readFileSync(path.join(__dirname, "../src/mysql-init/migration_payment_split.sql"), "utf8").replace(/^--.*$/gm, "");
        for (const sql of splitMigration.split(";").filter(sql => sql.trim())) await db.query(sql);
        await db.query(fs.readFileSync(path.join(__dirname, "../src/mysql-init/migration_payment_account_disconnect.sql"), "utf8"));
        const hash = await bcrypt.hash(password, 10);
        for (const [key, role] of [["buyer", "user"], ["seller", "company"], ["admin", "admin"]]) {
            await db.query("INSERT INTO `user` (id, role, name, email, password, cellphone, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
                [uuid.toBin(ids[key]), role, "TESTE AUTOMATIZADO PAGAMENTO", key === "buyer" ? email : `${key}-${ids[key]}@example.invalid`, hash, "11900000000"]);
        }
        await db.query("INSERT INTO localization (id, zip_code, street, neighborhood, number, city, state, id_user) VALUES (?, '00000000', 'Rua de teste', 'Teste', '0', 'Teste', 'SP', ?)", [uuid.toBin(ids.location), uuid.toBin(ids.seller)]);
        await db.query("INSERT INTO product (id, name, price, quantity, category, type_negotiation, weight, conservation_state, id_user, id_localization) VALUES (?, 'TESTE AUTOMATIZADO PAGAMENTO', 25, 1000, 'madeira', 'sale', 1, 'good', ?, ?)", [uuid.toBin(ids.product), uuid.toBin(ids.seller), uuid.toBin(ids.location)]);
        const app = require("../src/index");
        server = app.listen(0, "127.0.0.1");
        await new Promise(resolve => server.once("listening", resolve));
        base = `http://127.0.0.1:${server.address().port}/api/reaproveitafranca`;
        await check("login HTTP real de usuário sintético", async () => {
            const login = await request("POST", "/user/login", { email, password }, null);
            assert.equal(login.status, 200);
            assert.ok(login.body.token);
            token = login.body.token;
        });
        const otherToken = jwt.sign({ id: ids.seller, role: "company" }, process.env.SECRET, { expiresIn: "5m" });
        const adminToken = jwt.sign({ id: ids.admin, role: "admin" }, process.env.SECRET, { expiresIn: "5m" });
        const firstShopping = await shopping();
        let first;
        await check("Pix usa valor do banco, gera PNG e salva IDs externos", async () => {
            const response = await create(firstShopping, "pix", { value: 0.01, status: "approved" });
            assert.equal(response.status, 201);
            first = response.body;
            assert.equal(Number(first.payment.value), 50);
            assert.equal(first.payment.status, "pending");
            assert.ok(first.checkout.qr_code_base64.startsWith("iVBOR"));
            assert.ok(first.checkout.provider_order_id);
        });
        await check("repetição não cria outra cobrança", async () => {
            const before = calls.create;
            const response = await create(firstShopping);
            assert.equal(response.status, 200);
            assert.equal(response.body.payment.id, first.payment.id);
            assert.equal(calls.create, before);
        });
        await check("outro método ou pagador no mesmo pendente retorna 409", async () => {
            assert.equal((await create(firstShopping, "credit_card")).status, 409);
            assert.equal((await create(firstShopping, "pix", { payer: { email: "outro@example.invalid" } })).status, 409);
        });
        await check("checkout: 401 sem JWT e 404 para outro usuário", async () => {
            assert.equal((await request("GET", `/payment/${first.payment.id}/checkout`, undefined, null)).status, 401);
            assert.equal((await request("GET", `/payment/${first.payment.id}/checkout`, undefined, otherToken)).status, 404);
            assert.equal((await request("GET", `/payment/${first.payment.id}/checkout`)).status, 200);
        });
        await check("consultas por ID e compra preservam contrato", async () => {
            assert.equal((await request("GET", `/payment/${first.payment.id}`)).body.id, first.payment.id);
            assert.equal((await request("GET", `/payment/shopping/${firstShopping}`)).body.length, 1);
            assert.equal((await request("GET", `/payment/shopping/${firstShopping}`, undefined, otherToken)).status, 403);
        });
        await check("webhook sem assinatura ou com IDs divergentes é rejeitado", async () => {
            const id = first.checkout.provider_order_id;
            assert.equal((await request("POST", `/payment/webhook/mercado-pago?data.id=${id}&type=order`, { data: { status: "processed" } }, null)).status, 401);
            assert.equal((await request("POST", `/payment/webhook/mercado-pago?data.id=${id}&type=order`, { data: { id: "OUTRO" } }, null, webhookHeaders(id))).status, 400);
            assert.equal((await request("POST", `/payment/webhook/mercado-pago?data.id=${id}&type=order`, { data: { id } }, null, webhookHeaders(id.toLowerCase()))).status, 401);
        });
        await check("webhook assinado ignora aprovação falsa no body", async () => {
            const id = first.checkout.provider_order_id;
            assert.equal((await request("POST", `/payment/webhook/mercado-pago?data.id=${id}&type=order`, { type: "order", data: { id, status: "processed" } }, null, webhookHeaders(id))).status, 200);
            assert.equal((await request("GET", `/payment/${first.payment.id}`)).body.status, "pending");
        });
        await check("aprovação confirmada e webhook repetido não alteram estoque", async () => {
            const before = await stock();
            const id = first.checkout.provider_order_id;
            approved(id);
            for (let i = 0; i < 2; i++) assert.equal((await request("POST", `/payment/webhook/mercado-pago?data.id=${id}&type=order`, { type: "order", data: { id } }, null, webhookHeaders(id))).status, 200);
            assert.equal((await request("GET", `/payment/${first.payment.id}`)).body.status, "approved");
            assert.equal((await request("GET", `/shopping/${firstShopping}`)).body.status, "accepted");
            assert.equal(await stock(), before);
        });
        await check("resposta pendente atrasada não rebaixa aprovação", async () => {
            await gatewayService.applyCheckout(first.payment.id, first.checkout);
            assert.equal((await request("GET", `/payment/${first.payment.id}`)).body.status, "approved");
        });
        await check("reembolso exige admin e restaura estoque uma única vez", async () => {
            const before = await stock();
            assert.equal((await request("POST", `/payment/${first.payment.id}/refund`)).status, 403);
            for (let i = 0; i < 2; i++) {
                const response = await request("POST", `/payment/${first.payment.id}/refund`, undefined, adminToken);
                assert.equal(response.status, 200);
                assert.equal(response.body.payment.status, "refunded");
            }
            assert.equal(calls.refund, 1);
            assert.equal(await stock(), before + 2);
        });
        await check("cancelamento confirmado e repetido devolve estoque uma vez", async () => {
            const id = await shopping();
            const response = await create(id);
            const before = await stock();
            for (let i = 0; i < 2; i++) {
                const result = await request("POST", `/payment/${response.body.payment.id}/cancel`);
                assert.equal(result.status, 200);
                assert.equal(result.body.payment.status, "refused");
            }
            assert.equal(await stock(), before + 2);
            assert.equal(calls.cancel, 1);
        });
        await check("timeout após criar order recupera o mesmo ID sem duplicar", async () => {
            const id = await shopping();
            timeoutAfterCreate = true;
            const before = calls.create;
            assert.equal((await create(id)).status, 503);
            const payments = await request("GET", `/payment/shopping/${id}`);
            const response = await create(id);
            assert.equal(response.status, 200);
            assert.equal(response.body.payment.id, payments.body[0].id);
            assert.equal(calls.create, before + 1);
        });
        await check("concorrência no mesmo método mantém um pagamento", async () => {
            const id = await shopping();
            const before = calls.create;
            const responses = await Promise.all([create(id), create(id)]);
            assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
            assert.equal(responses[0].body.payment.id, responses[1].body.payment.id);
            assert.equal(calls.create, before + 1);
        });
        await check("crédito e débito tokenizados mantêm id_card nulo", async () => {
            for (const method of ["credit_card", "debit_card"]) {
                const id = await shopping();
                const response = await create(id, method);
                assert.equal(response.status, 201);
                assert.equal(response.body.payment.id_card, null);
                assert.equal(response.body.checkout.qr_code, null);
                const gateway = await gatewayService.getGateway(response.body.payment.id);
                assert.ok(!JSON.stringify(gateway).includes("card_token_ficticio"));
            }
        });
        await check("cartão sem token não persiste pagamento", async () => {
            const id = await shopping();
            assert.equal((await create(id, "credit_card", { token: null })).status, 400);
            assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
        });
        await check("erro definitivo permite corrigir e abrir nova tentativa", async () => {
            const id = await shopping();
            failNext = 422;
            assert.equal((await create(id)).status, 422);
            assert.equal((await request("GET", `/payment/shopping/${id}`)).body[0].status, "refused");
            assert.equal((await create(id)).status, 201);
        });
        await check("divergência de valor no provedor não aprova pagamento", async () => {
            const id = await shopping();
            const response = await create(id);
            approved(response.body.checkout.provider_order_id);
            corruptAmount = true;
            try { assert.equal((await request("POST", `/payment/${response.body.payment.id}/sync`)).status, 502); }
            finally { corruptAmount = false; }
            assert.equal((await request("GET", `/payment/${response.body.payment.id}`)).body.status, "pending");
        });
        await check("troca de ambiente ou provedor não reaproveita cobrança", async () => {
            const id = await shopping();
            const response = await create(id);
            process.env.MERCADO_PAGO_ENV = "production";
            assert.equal((await request("POST", `/payment/${response.body.payment.id}/sync`)).status, 409);
            process.env.MERCADO_PAGO_ENV = "test";
            process.env.PAYMENT_PROVIDER = "simulated";
            assert.equal((await create(id)).status, 409);
        });
        await check("simulado continua funcional e não vira cobrança real", async () => {
            const id = await shopping();
            const response = await create(id);
            assert.equal(response.status, 201);
            assert.equal(response.body.checkout.simulation, true);
            process.env.PAYMENT_PROVIDER = "mercado_pago";
            assert.equal((await create(id)).status, 409);
        });
        await check("simulação confirma compra e impede trocar o resultado final", async () => {
            process.env.PAYMENT_PROVIDER = "simulated";
            const id = await shopping();
            const created = await create(id);
            const route = `/payment/${created.body.payment.id}/simulate`;
            assert.equal((await request("POST", route, { status: "approved" }, otherToken)).status, 404);
            assert.equal((await request("POST", route, { status: "outro" })).status, 400);
            for (let i = 0; i < 2; i++) {
                const response = await request("POST", route, { status: "approved" });
                assert.equal(response.status, 200);
                assert.equal(response.body.payment.status, "approved");
                assert.equal(response.body.checkout.qr_code, null);
            }
            assert.equal((await request("GET", `/shopping/${id}`)).body.status, "accepted");
            assert.equal((await request("POST", route, { status: "refused" })).status, 409);
        });
        await check("resultados simulados concorrentes não confirmam dois desfechos", async () => {
            const id = await shopping();
            const created = await create(id);
            const route = `/payment/${created.body.payment.id}/simulate`;
            const results = await Promise.all([
                request("POST", route, { status: "approved" }),
                request("POST", route, { status: "refused" })
            ]);
            assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
        });
        await check("simulação não altera pagamentos reais e é bloqueada em produção", async () => {
            process.env.PAYMENT_PROVIDER = "mercado_pago";
            const id = await shopping();
            const created = await create(id);
            const route = `/payment/${created.body.payment.id}/simulate`;
            assert.equal((await request("POST", route, { status: "approved" })).status, 403);
            process.env.PAYMENT_PROVIDER = "simulated";
            assert.equal((await request("POST", route, { status: "approved" })).status, 409);
            const previousNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = "production";
            try {
                assert.equal((await request("POST", route, { status: "approved" })).status, 403);
                assert.equal((await create(await shopping())).status, 503);
            } finally {
                if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
                else process.env.NODE_ENV = previousNodeEnv;
            }
        });
        await check("configuração ausente retorna 503 antes de persistir cobrança", async () => {
            process.env.PAYMENT_PROVIDER = "mercado_pago";
            const id = await shopping();
            const previousToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
            delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
            try {
                assert.equal((await create(id)).status, 503);
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
            } finally {
                process.env.MERCADO_PAGO_ACCESS_TOKEN = previousToken;
            }
        });
        await check("pagamento após cancelamento local exige revisão e reembolso não duplica estoque", async () => {
            const id = await shopping();
            const created = await create(id);
            const before = await stock();
            assert.equal((await request("PATCH", `/shopping/${id}/cancel`)).status, 200);
            approved(created.body.checkout.provider_order_id);
            const sync = await request("POST", `/payment/${created.body.payment.id}/sync`);
            assert.equal(sync.status, 200);
            assert.equal(sync.body.payment.status, "approved");
            assert.equal(sync.body.checkout.needs_review, true);
            assert.equal((await request("GET", `/shopping/${id}`)).body.status, "cancelled");
            assert.equal(await stock(), before + 2);
            const refund = await request("POST", `/payment/${created.body.payment.id}/refund`, undefined, adminToken);
            assert.equal(refund.status, 200);
            assert.equal(refund.body.payment.status, "refunded");
            assert.equal(await stock(), before + 2);
        });
        await check("comissão de 5% vem do banco e é preservada na repetição", async () => {
            const id = await shopping();
            const created = await create(id, "pix", { commission: 0, commission_percent: 0 });
            assert.equal(created.status, 201);
            const plan = created.body.checkout.distribution;
            assert.equal(plan.percentage, "5.00");
            assert.equal(plan.gross_amount, "50.00");
            assert.equal(plan.marketplace_amount, "2.50");
            assert.equal(plan.sellers_amount_before_provider_fees, "47.50");
            assert.equal(plan.sellers[0].seller_id, ids.seller);
            assert.equal(plan.transfers_executed, false);
            assert.equal(plan.settlement_status, "disabled");
            process.env.PAYMENT_COMMISSION_PERCENT = "10";
            try {
                const repeated = await create(id);
                assert.equal(repeated.status, 200);
                assert.deepEqual(repeated.body.checkout.distribution, plan);
            } finally {
                process.env.PAYMENT_COMMISSION_PERCENT = "5";
            }
        });
        await check("arredondamento por fornecedor conserva todos os centavos", async () => {
            const distribution = require("../src/services/paymentDistributionService");
            const sellerIds = [uuid.generateId(), uuid.generateId(), uuid.generateId()];
            const plan = distribution.calculate(sellerIds.map(seller_id => ({ seller_id, value: "0.10" })), "0.30", 500);
            assert.equal(plan.marketplace_amount, "0.02");
            assert.equal(plan.sellers_amount_before_provider_fees, "0.28");
            const cents = value => Math.round(Number(value) * 100);
            assert.equal(plan.sellers.reduce((sum, item) => sum + cents(item.commission_amount), 0), 2);
            assert.equal(plan.sellers.reduce((sum, item) => sum + cents(item.amount_before_provider_fees), 0), 28);
            assert.throws(() => distribution.calculate([{ seller_id: sellerIds[0], value: "0.31" }], "0.30"), { status: 409 });
        });
        await check("credencial de produção em ambiente de teste não cria pagamento", async () => {
            const id = await shopping();
            const previousToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
            mockTestUser = false;
            process.env.MERCADO_PAGO_ACCESS_TOKEN = "CREDENCIAL_FICTICIA_DE_OUTRO_AMBIENTE";
            try {
                const response = await create(id);
                assert.equal(response.status, 409);
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
            } finally {
                mockTestUser = true;
                process.env.MERCADO_PAGO_ACCESS_TOKEN = previousToken;
            }
        });
        await check("credencial de teste da aplicação funciona com conta real e é rejeitada em production", async () => {
            const previousToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
            const previousClientId = process.env.MERCADO_PAGO_CLIENT_ID;
            const submits = calls.submit;
            mockTestUser = false;
            process.env.MERCADO_PAGO_ACCESS_TOKEN = mockApplicationTestToken;
            try {
                assert.equal((await create(await shopping(), "credit_card")).status, 201);
                process.env.MERCADO_PAGO_ENV = "production";
                const id = await shopping();
                assert.equal((await create(id, "credit_card")).status, 409);
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
                assert.equal(calls.submit, submits + 1);
                delete process.env.MERCADO_PAGO_CLIENT_ID;
                assert.equal((await create(id, "credit_card")).status, 503);
                assert.equal(calls.submit, submits + 1);
            } finally {
                mockTestUser = true;
                process.env.MERCADO_PAGO_CLIENT_ID = previousClientId;
                process.env.MERCADO_PAGO_ACCESS_TOKEN = previousToken;
                process.env.MERCADO_PAGO_ENV = "test";
            }
        });
        await check("troca da conta recebedora não reaproveita pendente", async () => {
            const id = await shopping();
            const created = await create(id);
            assert.equal(created.status, 201);
            const previousToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
            const before = calls.create;
            mockAccountId = "90002";
            process.env.MERCADO_PAGO_ACCESS_TOKEN = "CREDENCIAL_FICTICIA_DE_OUTRA_CONTA";
            try {
                assert.equal((await create(id)).status, 409);
                assert.equal(calls.create, before);
            } finally {
                mockAccountId = "90001";
                process.env.MERCADO_PAGO_ACCESS_TOKEN = previousToken;
            }
        });
        await check("order de outra conta retorna motivo claro em vez de falha genérica", async () => {
            const created = await create(await shopping());
            assert.equal(created.status, 201);
            failNext = 404;
            const response = await request("POST", `/payment/${created.body.payment.id}/sync`);
            assert.equal(response.status, 409);
            assert.equal(response.body.provider_status, 404);
            assert.equal(response.body.provider_code, "order_not_found");
        });
        await check("erro 402 é informado sem descartar cobrança que pode existir", async () => {
            const id = await shopping();
            failNext = 402;
            const response = await create(id);
            assert.equal(response.status, 402);
            assert.equal(response.body.provider_code, "failed");
            const payments = await request("GET", `/payment/shopping/${id}`);
            assert.equal(payments.body.length, 1);
            assert.equal(payments.body[0].status, "pending");
            assert.equal(response.body.payment_id, payments.body[0].id);
            assert.equal(response.body.reconciliation_required, true);
            const before = calls.submit;
            assert.equal((await create(id)).status, 409);
            assert.equal((await request("POST", `/payment/${payments.body[0].id}/sync`)).status, 409);
            assert.equal(calls.submit, before);
        });
        await check("402 com order criada concilia Pix e crédito e informa motivo sem duplicar", async () => {
            for (const method of ["pix", "credit_card"]) {
                const id = await shopping();
                const before = await stock();
                processingFailure = true;
                const response = await create(id, method);
                assert.equal(response.status, 402);
                assert.equal(response.body.provider_code, "failed");
                assert.equal(response.body.reconciliation_required, false);
                assert.equal(response.body.payment_status, "refused");
                assert.equal(response.body.status_detail, "processing_error");
                const paymentId = response.body.payment_id;
                const gateway = await gatewayService.getGateway(paymentId);
                assert.equal(gateway.order_id, response.body.provider_order_id);
                assert.ok(gateway.transaction_id);
                assert.equal(gateway.provider_status, "failed");
                assert.equal(gateway.status_detail, "processing_error");
                const submits = calls.submit;
                for (let i = 0; i < 2; i++) {
                    const synced = await request("POST", `/payment/${paymentId}/sync`);
                    assert.equal(synced.status, 200);
                    assert.equal(synced.body.payment.status, "refused");
                    assert.equal(synced.body.checkout.qr_code, null);
                    assert.equal(synced.body.checkout.qr_code_base64, null);
                }
                assert.equal(calls.submit, submits);
                assert.equal((await request("GET", `/shopping/${id}`)).body.status, "pending");
                assert.equal(await stock(), before);
            }
        });
        await check("busca indisponível após 402 bloqueia reenvio e permite conciliar depois", async () => {
            const id = await shopping();
            processingFailure = true;
            searchFailure = true;
            let paymentId;
            const submits = calls.submit;
            try {
                const response = await create(id);
                assert.equal(response.status, 402);
                paymentId = response.body.payment_id;
                assert.equal(response.body.reconciliation_required, true);
                assert.equal((await request("GET", `/payment/${paymentId}`)).body.status, "pending");
                assert.equal((await create(id)).status, 503);
                assert.equal(calls.submit, submits + 1);
            } finally {
                searchFailure = false;
            }
            const response = await create(id);
            assert.equal(response.status, 200);
            assert.equal(response.body.payment.id, paymentId);
            assert.equal(response.body.payment.status, "refused");
            assert.equal(calls.submit, submits + 1);
        });
        await check("sync recupera order antiga sem ID e mantém autorização do proprietário", async () => {
            const id = await shopping();
            timeoutAfterCreate = true;
            assert.equal((await create(id)).status, 503);
            const paymentId = (await request("GET", `/payment/shopping/${id}`)).body[0].id;
            const submits = calls.submit;
            assert.equal((await request("POST", `/payment/${paymentId}/sync`, undefined, otherToken)).status, 404);
            const synced = await request("POST", `/payment/${paymentId}/sync`);
            assert.equal(synced.status, 200);
            assert.equal(synced.body.payment.status, "pending");
            assert.ok(synced.body.checkout.provider_order_id);
            assert.ok(synced.body.checkout.qr_code_base64);
            assert.equal(calls.submit, submits);
        });
        await check("conciliação não vincula order duplicada ou de valor divergente", async () => {
            const id = await shopping();
            processingFailure = true;
            duplicateSearch = true;
            let paymentId;
            try {
                const response = await create(id);
                assert.equal(response.status, 402);
                paymentId = response.body.payment_id;
                assert.equal((await request("POST", `/payment/${paymentId}/sync`)).status, 409);
            } finally {
                duplicateSearch = false;
            }
            corruptAmount = true;
            try {
                assert.equal((await request("POST", `/payment/${paymentId}/sync`)).status, 502);
                assert.equal((await request("GET", `/payment/${paymentId}`)).body.status, "pending");
                assert.equal((await gatewayService.getGateway(paymentId)).order_id, null);
            } finally {
                corruptAmount = false;
            }
            assert.equal((await request("POST", `/payment/${paymentId}/sync`)).body.payment.status, "refused");
        });
        const connectSeller = async (auth = otherToken) => {
            const started = await request("POST", "/payment/mercado-pago/connect", {}, auth);
            assert.equal(started.status, 200);
            return new URL(started.body.authorization_url);
        };
        const callback = url => request("GET", `/payment/mercado-pago/oauth/callback?state=${encodeURIComponent(url.searchParams.get("state"))}&code=AUTH_CODE_FICTICIO`, undefined, null);
        const splitRecord = response => splitPayments.get(response.body.checkout.provider_payment_id);
        await check("split flag aceita só true/false e não grava pagamento com configuração inválida", async () => {
            const id = await shopping();
            process.env.split_payment = "yes";
            try {
                assert.equal((await create(id)).status, 503);
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
            } finally { process.env.split_payment = "false"; }
        });
        await check("configuração pública exige JWT e não expõe Access Token nem Client Secret", async () => {
            assert.equal((await request("GET", "/payment/configuration", undefined, null)).status, 401);
            const response = await request("GET", "/payment/configuration");
            assert.equal(response.status, 200);
            assert.equal(response.body.split_payment, false);
            assert.equal(response.body.oauth_configured, true);
            assert.ok(!JSON.stringify(response.body).includes("TOKEN_FICTICIO"));
            assert.ok(!JSON.stringify(response.body).includes("CLIENT_SECRET_FICTICIO"));
            const previous = process.env.MERCADO_PAGO_PUBLIC_KEY;
            process.env.MERCADO_PAGO_PUBLIC_KEY = "APP_USR-CHAVE_PRIVADA_NAO_DEVE_SER_PUBLICADA";
            try { assert.equal((await request("GET", "/payment/configuration")).body.public_key, null); }
            finally { if (previous === undefined) delete process.env.MERCADO_PAGO_PUBLIC_KEY; else process.env.MERCADO_PAGO_PUBLIC_KEY = previous; }
        });
        await check("OAuth exige autenticação no início e não vaza tokens no status", async () => {
            assert.equal((await request("POST", "/payment/mercado-pago/connect", {}, null)).status, 401);
            const status = await request("GET", "/payment/mercado-pago/account", undefined, otherToken);
            assert.equal(status.status, 200);
            assert.equal(status.body.connected, false);
        });
        await check("autorização OAuth usa state opaco e PKCE S256", async () => {
            const url = await connectSeller();
            assert.equal(url.origin, "https://auth.mercadopago.com.br");
            assert.equal(url.searchParams.get("code_challenge_method"), "S256");
            assert.equal(url.searchParams.get("code_challenge").length, 43);
            assert.equal(url.searchParams.get("state").length, 43);
            assert.ok(!url.href.includes("CLIENT_SECRET_FICTICIO"));
            assert.ok(!url.href.includes(ids.seller));
        });
        await check("callback rejeita state inválido, desconhecido, expirado e autorização negada", async () => {
            assert.equal((await request("GET", "/payment/mercado-pago/oauth/callback?state=invalid&code=x", undefined, null)).status, 400);
            assert.equal((await callback(new URL(`https://example.invalid?state=${crypto.randomBytes(32).toString("base64url")}`))).status, 409);
            const url = await connectSeller();
            const hash = crypto.createHash("sha256").update(url.searchParams.get("state")).digest("hex");
            await db.query("UPDATE payment_oauth_state SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE state_hash = ?", [hash]);
            assert.equal((await callback(url)).status, 409);
            assert.equal((await request("GET", "/payment/mercado-pago/oauth/callback?error=access_denied", undefined, null)).status, 400);
        });
        await check("OAuth não aceita a conta do marketplace como vendedor nem credencial de outro ambiente", async () => {
            oauthCollector = "90001";
            try {
                const response = await callback(await connectSeller());
                assert.equal(response.status, 409);
                assert.equal(response.body.provider_code, "seller_is_marketplace");
            } finally { oauthCollector = "90011"; }
            oauthLiveMode = true;
            try { assert.equal((await callback(await connectSeller())).status, 409); }
            finally { oauthLiveMode = false; }
            assert.equal((await request("GET", "/payment/mercado-pago/account", undefined, otherToken)).body.connected, false);
        });
        await check("vinculação persiste tokens criptografados e impede repetição do callback", async () => {
            const url = await connectSeller();
            const response = await callback(url);
            assert.equal(response.status, 200);
            assert.equal(response.body.connected, true);
            assert.ok(!JSON.stringify(response.body).includes("SELLER_ACCESS"));
            const [rows] = await db.query("SELECT access_token_enc, refresh_token_enc FROM payment_seller_account WHERE id_user = ?", [uuid.toBin(ids.seller)]);
            assert.equal(rows.length, 1);
            assert.ok(!JSON.stringify(rows).includes("SELLER_ACCESS"));
            assert.ok(!JSON.stringify(rows).includes("REFRESH_FICTICIO"));
            assert.equal((await callback(url)).status, 409);
            assert.equal((await request("GET", "/payment/mercado-pago/account", undefined, otherToken)).body.connected, true);
            assert.equal((await request("GET", "/payment/mercado-pago/account")).body.connected, false);
        });
        await check("callbacks simultâneos trocam o código uma vez e conta externa não é compartilhada entre vendedores", async () => {
            const url = await connectSeller();
            const before = splitCalls.oauth;
            const responses = await Promise.all([callback(url), callback(url)]);
            assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
            assert.equal(splitCalls.oauth, before + 1);
            assert.equal((await callback(await connectSeller(token))).status, 409);
        });
        await check("split true sem configuração OAuth ou chave de criptografia não cria pagamento", async () => {
            process.env.split_payment = "true";
            for (const key of ["MERCADO_PAGO_CLIENT_ID", "MERCADO_PAGO_CLIENT_SECRET", "MERCADO_PAGO_REDIRECT_URI", "PAYMENT_TOKEN_ENCRYPTION_KEY"]) {
                const id = await shopping();
                const previous = process.env[key];
                delete process.env[key];
                try {
                    assert.equal((await create(id)).status, 503);
                    assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
                } finally { process.env[key] = previous; }
            }
        });
        const extraProduct = { id: uuid.generateId(), owner: ids.admin };
        extraProducts.push(extraProduct);
        await db.query("INSERT INTO product (id, name, price, quantity, category, type_negotiation, weight, conservation_state, id_user, id_localization) VALUES (?, 'TESTE OUTRO FORNECEDOR', 25, 100, 'madeira', 'sale', 1, 'good', ?, ?)", [uuid.toBin(extraProduct.id), uuid.toBin(extraProduct.owner), uuid.toBin(ids.location)]);
        await check("split exige vendedor vinculado e bloqueia compra com múltiplos vendedores antes de cobrar", async () => {
            for (const items of [[{ id_product: extraProduct.id, quantity: 2 }], [{ id_product: ids.product, quantity: 1 }, { id_product: extraProduct.id, quantity: 1 }]]) {
                const id = await shopping(items);
                const before = splitCalls.submit;
                assert.equal((await create(id)).status, 409);
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
                assert.equal(splitCalls.submit, before);
            }
        });
        let splitPix;
        let splitShopping;
        await check("Pix split cobra na conta OAuth do vendedor e ignora comissão/recebedor enviados pelo cliente", async () => {
            splitShopping = await shopping();
            splitPix = await create(splitShopping, "pix", { application_fee: 0, collector_id: "conta_invasora", split_payment: false });
            assert.equal(splitPix.status, 201);
            assert.equal(splitPix.body.checkout.provider_api, "payments");
            assert.equal(splitPix.body.checkout.provider_order_id, null);
            assert.equal(splitPix.body.checkout.split_payment, true);
            assert.equal(splitPix.body.payment.status, "pending");
            assert.ok(splitPix.body.checkout.qr_code_base64.startsWith("iVBOR"));
            assert.equal(splitPix.body.checkout.distribution.marketplace_amount, "2.50");
            assert.equal(splitPix.body.checkout.distribution.settlement_status, "awaiting_payment");
            assert.equal(splitPix.body.checkout.distribution.transfers_executed, false);
            const before = splitCalls.submit;
            const repeated = await create(splitShopping);
            assert.equal(repeated.status, 200);
            assert.equal(repeated.body.payment.id, splitPix.body.payment.id);
            assert.equal(splitCalls.submit, before);
            assert.equal((await request("GET", `/payment/${splitPix.body.payment.id}/checkout`, undefined, otherToken)).status, 404);
        });
        await check("webhook Payments assinado consulta o provedor e notifica comprador, vendedor e admin uma única vez", async () => {
            const payment = splitRecord(splitPix);
            payment.status = "approved"; payment.status_detail = "accredited";
            const route = `/payment/webhook/mercado-pago?data.id=${payment.id}&type=payment`;
            assert.equal((await request("POST", route, { type: "payment", user_id: 90011, data: { id: payment.id } }, null)).status, 401);
            const body = { type: "payment", user_id: 90011, data: { id: payment.id, status: "rejected" } };
            const before = await stock();
            const replies = await Promise.all([request("POST", route, body, null, webhookHeaders(String(payment.id))), request("POST", route, body, null, webhookHeaders(String(payment.id)))]);
            assert.deepEqual(replies.map(r => r.status), [200, 200]);
            const checkout = await request("GET", `/payment/${splitPix.body.payment.id}/checkout`);
            assert.equal(checkout.body.payment.status, "approved");
            assert.equal(checkout.body.checkout.distribution.settlement_status, "provider_confirmed");
            assert.equal(checkout.body.checkout.distribution.transfers_executed, true);
            assert.equal(checkout.body.checkout.qr_code, null);
            assert.equal((await request("GET", `/shopping/${splitShopping}`)).body.status, "accepted");
            assert.equal(await stock(), before);
            const [notifications] = await db.query("SELECT BIN_TO_UUID(id_user) AS id FROM notification WHERE type='pagamento_confirmado' AND reference_id=?", [uuid.toBin(splitPix.body.payment.id)]);
            assert.deepEqual(notifications.map(n => n.id).sort(), [ids.buyer, ids.seller, ids.admin].sort());
            const [commissions] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(splitPix.body.payment.id)]);
            assert.equal(commissions.length, 1);
            assert.equal(Number(commissions[0].value), 2.5);
        });
        await check("crédito e débito com split aprovam sem QR e preservam id_card nulo", async () => {
            for (const method of ["credit_card", "debit_card"]) {
                const response = await create(await shopping(), method);
                assert.equal(response.status, 201);
                assert.equal(response.body.payment.status, "approved");
                assert.equal(response.body.payment.id_card, null);
                assert.equal(response.body.checkout.qr_code, null);
                assert.equal(response.body.checkout.split_payment, true);
            }
        });
        await check("crédito parcelado com split envia parcelas e mantém comissão calculada no total", async () => {
            const response = await create(await shopping(), "credit_card", { installments: 3 });
            assert.equal(response.status, 201);
            assert.equal(splitLastInstallments, 3);
            assert.equal(response.body.payment.status, "approved");
            const [rows] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(response.body.payment.id)]);
            assert.deepEqual(rows.map(row => Number(row.value)), [2.5]);
        });
        await check("crédito e débito recusados com split não comissionam e aceitam nova tentativa tokenizada", async () => {
            for (const method of ["credit_card", "debit_card"]) {
                const id = await shopping();
                const submits = splitCalls.submit;
                splitNextStatus = "rejected";
                const declined = await create(id, method);
                assert.equal(declined.status, 201);
                assert.equal(declined.body.payment.status, "refused");
                assert.equal(declined.body.checkout.status_detail, "cc_rejected_other_reason");
                assert.equal(declined.body.checkout.qr_code, null);
                assert.equal((await request("GET", `/shopping/${id}`)).body.status, "pending");
                const [rows] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(declined.body.payment.id)]);
                assert.equal(rows.length, 0);
                const retried = await create(id, method, { token: "novo_card_token_ficticio" });
                assert.equal(retried.status, 201);
                assert.equal(retried.body.payment.status, "approved");
                assert.notEqual(retried.body.payment.id, declined.body.payment.id);
                assert.equal(splitCalls.submit, submits + 2);
            }
        });
        await check("cartões com split pendentes são consultados sem nova cobrança e aprovados pelo webhook", async () => {
            for (const method of ["credit_card", "debit_card"]) {
                splitNextStatus = "in_process";
                const created = await create(await shopping(), method);
                assert.equal(created.status, 201);
                assert.equal(created.body.payment.status, "pending");
                assert.equal(created.body.checkout.qr_code, null);
                const id = created.body.payment.id;
                const submits = splitCalls.submit;
                assert.equal((await request("GET", `/payment/${id}/checkout`)).body.payment.status, "pending");
                assert.equal((await request("POST", `/payment/${id}/sync`)).body.payment.status, "pending");
                const external = splitRecord(created);
                external.status = "approved"; external.status_detail = "accredited";
                const route = `/payment/webhook/mercado-pago?data.id=${external.id}&type=payment`;
                const body = { type: "payment", user_id: 90011, data: { id: external.id } };
                for (let i = 0; i < 2; i++) assert.equal((await request("POST", route, body, null, webhookHeaders(String(external.id)))).status, 200);
                const synced = await request("POST", `/payment/${id}/sync`);
                assert.equal(synced.body.payment.status, "approved");
                assert.equal(synced.body.checkout.distribution.settlement_status, "provider_confirmed");
                const [rows] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(id)]);
                assert.deepEqual(rows.map(row => Number(row.value)), [2.5]);
                assert.equal(splitCalls.submit, submits);
            }
        });
        await check("timeout em cartões com split recupera a aprovação sem duplicar cobrança ou comissão", async () => {
            for (const method of ["credit_card", "debit_card"]) {
                const id = await shopping();
                const submits = splitCalls.submit;
                splitTimeout = true;
                const created = await create(id, method);
                assert.equal(created.status, 503);
                const paymentId = (await request("GET", `/payment/shopping/${id}`)).body[0].id;
                for (let i = 0; i < 2; i++) {
                    const synced = await request("POST", `/payment/${paymentId}/sync`);
                    assert.equal(synced.status, 200);
                    assert.equal(synced.body.payment.status, "approved");
                }
                const [rows] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(paymentId)]);
                assert.deepEqual(rows.map(row => Number(row.value)), [2.5]);
                assert.equal(splitCalls.submit, submits + 1);
            }
        });
        await check("estorno integral de crédito e débito com split zera comissão e restaura estoque uma vez", async () => {
            for (const method of ["credit_card", "debit_card"]) {
                const created = await create(await shopping(), method);
                const id = created.body.payment.id;
                const before = await stock();
                const refunds = splitCalls.refund;
                for (let i = 0; i < 2; i++) {
                    const refunded = await request("POST", `/payment/${id}/refund`, undefined, adminToken);
                    assert.equal(refunded.status, 200);
                    assert.equal(refunded.body.payment.status, "refunded");
                }
                assert.equal(splitCalls.refund, refunds + 1);
                assert.equal(await stock(), before + 2);
                const [rows] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(id)]);
                assert.deepEqual(rows.map(row => Number(row.value)), [0]);
            }
        });
        await check("desativar split preserva consulta e estorno do split antigo, com comissão zerada e estoque único", async () => {
            process.env.split_payment = "false";
            const before = await stock();
            const refunds = splitCalls.refund;
            assert.equal((await request("POST", `/payment/${splitPix.body.payment.id}/refund`)).status, 403);
            for (let i = 0; i < 2; i++) {
                const response = await request("POST", `/payment/${splitPix.body.payment.id}/refund`, undefined, adminToken);
                assert.equal(response.status, 200);
                assert.equal(response.body.payment.status, "refunded");
                assert.equal(response.body.checkout.split_payment, true);
            }
            assert.equal(splitCalls.refund, refunds + 1);
            assert.equal(await stock(), before + 2);
            const [rows] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(splitPix.body.payment.id)]);
            assert.equal(Number(rows[0].value), 0);
            process.env.split_payment = "true";
        });
        await check("troca de split no cadastro não converte pendente e cancelamento antigo mantém o vendedor correto", async () => {
            const id = await shopping();
            const created = await create(id);
            process.env.split_payment = "false";
            const before = await stock();
            const cancels = splitCalls.cancel;
            assert.equal((await create(id)).status, 409);
            for (let i = 0; i < 2; i++) assert.equal((await request("POST", `/payment/${created.body.payment.id}/cancel`)).body.payment.status, "refused");
            assert.equal(splitCalls.cancel, cancels + 1);
            assert.equal(await stock(), before + 2);
            process.env.split_payment = "true";
        });
        await check("timeout no split recupera pagamento pela referência sem repetir POST", async () => {
            const id = await shopping();
            const submits = splitCalls.submit;
            splitTimeout = true;
            assert.equal((await create(id)).status, 503);
            const paymentId = (await request("GET", `/payment/shopping/${id}`)).body[0].id;
            const synced = await request("POST", `/payment/${paymentId}/sync`);
            assert.equal(synced.status, 200);
            assert.ok(synced.body.checkout.provider_payment_id);
            assert.equal(splitCalls.submit, submits + 1);
        });
        await check("webhook recupera split criado antes do timeout usando recebedor como localizador e GET autenticado", async () => {
            const id = await shopping();
            splitTimeout = true;
            assert.equal((await create(id)).status, 503);
            const paymentId = (await request("GET", `/payment/shopping/${id}`)).body[0].id;
            const external = splitPayments.get(splitIdempotency.get(paymentId));
            external.status = "approved"; external.status_detail = "accredited";
            const response = await request("POST", `/payment/webhook/mercado-pago?data.id=${external.id}&type=payment`, { type: "payment", user_id: 90011, data: { id: external.id } }, null, webhookHeaders(String(external.id)));
            assert.equal(response.status, 200);
            assert.equal((await request("GET", `/payment/${paymentId}`)).body.status, "approved");
        });
        await check("recusa financeira do split é persistida sem aprovação, comissão recebida ou QR", async () => {
            splitNextStatus = "rejected";
            const response = await create(await shopping());
            assert.equal(response.status, 201);
            assert.equal(response.body.payment.status, "refused");
            assert.equal(response.body.checkout.qr_code, null);
            const payment = await gatewayService.getPayment(response.body.payment.id);
            const binding = await require("../src/services/paymentSplitService").getBinding(payment.id);
            const external = splitPayments.get(splitIdempotency.get(payment.id));
            const normalized = await require("../src/services/providers/mercadoPagoSplitProvider").normalizePayment(external, payment, binding);
            assert.equal(normalized.qr_code, null);
            assert.equal(normalized.qr_code_base64, null);
            assert.equal(normalized.ticket_url, null);
            const [rows] = await db.query("SELECT id FROM commission WHERE id_payment=?", [uuid.toBin(response.body.payment.id)]);
            assert.equal(rows.length, 0);
        });
        await check("restrição regulatória bloqueia nova cobrança antes de persistir e mantém OAuth e conciliação", async () => {
            const existing = await create(await shopping());
            assert.equal(existing.status, 201);
            const id = await shopping();
            const submits = splitCalls.submit;
            sellerRegulatoryBlocked = true;
            try {
                const response = await create(id);
                assert.equal(response.status, 409);
                assert.equal(response.body.provider_code, "seller_account_restricted");
                assert.match(response.body.error, /regularizar a conta/);
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
                assert.equal(splitCalls.submit, submits);
                assert.equal((await request("GET", "/payment/mercado-pago/account", undefined, otherToken)).body.connected, true);
                assert.equal((await request("POST", `/payment/${existing.body.payment.id}/sync`)).status, 200);
            } finally { sellerRegulatoryBlocked = false; }
            assert.equal((await create(id)).status, 201);
        });
        await check("qualquer bloqueio de venda do recebedor impede a cobrança e informa os códigos", async () => {
            const id = await shopping();
            const submits = splitCalls.submit;
            sellerRegulatoryBlocked = ["address_pending"];
            try {
                const response = await create(id);
                assert.equal(response.status, 409);
                assert.equal(response.body.provider_code, "seller_account_restricted");
                assert.deepEqual(response.body.seller_codes, ["address_pending"]);
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
                assert.equal(splitCalls.submit, submits);
            } finally { sellerRegulatoryBlocked = false; }
            assert.equal((await create(id)).status, 201);
        });
        await check("autorização do vendedor revogada bloqueia a cobrança antes de persistir", async () => {
            const id = await shopping();
            const submits = splitCalls.submit;
            sellerAuthorizationRevoked = true;
            try {
                const response = await create(id);
                assert.equal(response.status, 409);
                assert.equal(response.body.provider_code, "seller_authorization_revoked");
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
                assert.equal(splitCalls.submit, submits);
            } finally { sellerAuthorizationRevoked = false; }
            assert.equal((await create(id)).status, 201);
        });
        await check("permissão negada no split informa o código do provedor e a repetição não duplica cobrança", async () => {
            const id = await shopping();
            const created = splitCalls.create;
            splitPolicyDenied = true;
            const response = await create(id);
            assert.equal(response.body.provider_status, 403);
            assert.equal(response.body.provider_code, "PA_UNAUTHORIZED_RESULT_FROM_POLICIES");
            assert.equal(response.body.provider_message, "At least one policy returned UNAUTHORIZED.");
            assert.match(response.body.error, /autorização do vendedor/);
            assert.equal(splitCalls.create, created);
            const retry = await create(id);
            assert.equal(retry.status, 200);
            assert.equal(splitCalls.create, created + 1);
        });
        await check("cartão classificado pelo provedor como pré-pago é conciliado sem travar o pagamento", async () => {
            splitCardType = "prepaid_card";
            try {
                const response = await create(await shopping(), "credit_card");
                assert.equal(response.status, 201);
                assert.equal(response.body.payment.status, "approved");
                assert.equal(response.body.checkout.provider_status, "approved");
                assert.equal(response.body.checkout.method, "credit_card");
                const [rows] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(response.body.payment.id)]);
                assert.equal(Number(rows[0].value), 2.5);
            } finally { splitCardType = undefined; }
        });
        await check("cartão retornado como Pix continua divergente e não aprova", async () => {
            const response = await create(await shopping(), "credit_card");
            const id = response.body.checkout.provider_payment_id;
            const original = structuredClone(splitPayments.get(id));
            splitPayments.get(id).payment_type_id = "bank_transfer";
            splitPayments.get(id).status = "pending";
            try {
                assert.equal((await request("POST", `/payment/${response.body.payment.id}/sync`)).status, 502);
            } finally { splitPayments.set(id, original); }
        });
        await check("Pix sem chave confirmada pelo provedor retorna orientação e permite nova tentativa após correção", async () => {
            const id = await shopping();
            const created = splitCalls.create;
            splitMissingPixKey = "known";
            const response = await create(id);
            assert.equal(response.status, 422);
            assert.equal(response.body.provider_code, "13253");
            assert.match(response.body.error, /chave Pix.*vendedor/);
            assert.notEqual(response.body.reconciliation_required, true);
            assert.equal(splitCalls.create, created);
            const previous = (await request("GET", `/payment/shopping/${id}`)).body;
            assert.equal(previous.length, 1);
            assert.equal(previous[0].status, "refused");
            const retry = await create(id);
            assert.equal(retry.status, 201);
            assert.notEqual(retry.body.payment.id, previous[0].id);
            assert.equal(retry.body.payment.status, "pending");
            assert.equal(splitCalls.create, created + 1);
        });
        await check("13253 sem causa confirmada mantém conciliação e não repete POST", async () => {
            const id = await shopping();
            const submits = splitCalls.submit;
            splitMissingPixKey = "unknown";
            const response = await create(id);
            assert.equal(response.status, 422);
            assert.equal(response.body.reconciliation_required, true);
            assert.equal((await create(id)).status, 409);
            assert.equal(splitCalls.submit, submits + 1);
        });
        await check("402 no split recupera o ID e motivo de recusa na Payments API", async () => {
            splitProcessingFailure = true;
            const response = await create(await shopping());
            assert.equal(response.status, 402);
            assert.equal(response.body.payment_status, "refused");
            assert.equal(response.body.status_detail, "processing_error");
            assert.ok(response.body.provider_payment_id);
            assert.equal(response.body.reconciliation_required, false);
        });
        await check("refresh OAuth concorrente é serializado e não expõe refresh token", async () => {
            const created = await create(await shopping());
            await db.query("UPDATE payment_seller_account SET expires_at=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id_user=?", [uuid.toBin(ids.seller)]);
            const before = splitCalls.refresh;
            const responses = await Promise.all([request("POST", `/payment/${created.body.payment.id}/sync`), request("POST", `/payment/${created.body.payment.id}/sync`)]);
            assert.deepEqual(responses.map(r => r.status), [200, 200]);
            assert.equal(splitCalls.refresh, before + 1);
            assert.ok(!JSON.stringify(responses).includes("REFRESH_FICTICIO"));
        });
        await check("refresh inválido e chave de criptografia incorreta bloqueiam cobrança antes de persistir", async () => {
            await db.query("UPDATE payment_seller_account SET expires_at=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id_user=?", [uuid.toBin(ids.seller)]);
            const id = await shopping();
            oauthFailure = true;
            try { assert.equal((await create(id)).status, 503); }
            finally { oauthFailure = false; }
            assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
            const previous = process.env.PAYMENT_TOKEN_ENCRYPTION_KEY;
            process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
            try { assert.equal((await create(id)).status, 503); }
            finally { process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = previous; }
            assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
        });
        for (const [name, change] of [
            ["valor", data => data.transaction_amount = 0.01],
            ["recebedor", data => data.collector_id = 90099],
            ["moeda", data => data.currency_id = "USD"],
            ["ambiente", data => data.live_mode = true],
            ["método", data => data.payment_type_id = "credit_card"],
            ["comissão", data => { data.status = "approved"; data.fee_details[0].amount = 0; }]
        ]) {
            await check(`split rejeita divergência de ${name} sem aprovar o pagamento`, async () => {
                const response = await create(await shopping());
                const id = response.body.checkout.provider_payment_id;
                const original = structuredClone(splitPayments.get(id));
                change(splitPayments.get(id));
                try {
                    assert.equal((await request("POST", `/payment/${response.body.payment.id}/sync`)).status, 502);
                    assert.equal((await request("GET", `/payment/${response.body.payment.id}`)).body.status, "pending");
                } finally { splitPayments.set(id, original); }
            });
        }
        await check("estorno recusado preserva aprovação e timeout após estorno é conciliado sem reembolsar duas vezes", async () => {
            const created = await create(await shopping(), "credit_card");
            const route = `/payment/${created.body.payment.id}/refund`;
            const before = await stock();
            splitRefundFailure = true;
            try { assert.equal((await request("POST", route, undefined, adminToken)).status, 422); }
            finally { splitRefundFailure = false; }
            assert.equal((await request("GET", `/payment/${created.body.payment.id}`)).body.status, "approved");
            assert.equal(await stock(), before);
            const refunds = splitCalls.refund;
            splitRefundTimeout = true;
            assert.equal((await request("POST", route, undefined, adminToken)).status, 503);
            assert.equal((await request("POST", route, undefined, adminToken)).body.payment.status, "refunded");
            assert.equal(splitCalls.refund, refunds + 1);
            assert.equal(await stock(), before + 2);
        });
        await check("timeout após cancelamento do split consulta o resultado antes de cancelar novamente", async () => {
            const created = await create(await shopping());
            const route = `/payment/${created.body.payment.id}/cancel`;
            const before = await stock();
            const cancels = splitCalls.cancel;
            splitCancelTimeout = true;
            assert.equal((await request("POST", route)).status, 503);
            assert.equal((await request("POST", route)).body.payment.status, "refused");
            assert.equal(splitCalls.cancel, cancels + 1);
            assert.equal(await stock(), before + 2);
        });
        await check("chargeback e reembolso parcial exigem revisão sem rebaixar aprovação nem emitir novo estorno", async () => {
            for (const status of ["charged_back", "approved"]) {
                const response = await create(await shopping(), "credit_card");
                const external = splitRecord(response);
                external.status = status;
                if (status === "approved") external.transaction_amount_refunded = 10;
                const refundCalls = splitCalls.refund;
                const synced = await request("POST", `/payment/${response.body.payment.id}/sync`);
                assert.equal(synced.status, 200);
                assert.equal(synced.body.payment.status, "approved");
                assert.equal(synced.body.checkout.needs_review, true);
                assert.equal((await request("POST", `/payment/${response.body.payment.id}/refund`, undefined, adminToken)).status, 409);
                assert.equal(splitCalls.refund, refundCalls);
            }
        });
        await check("duas criações simultâneas com split mantêm um pagamento e uma cobrança", async () => {
            const id = await shopping();
            const before = splitCalls.create;
            const responses = await Promise.all([create(id), create(id)]);
            assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
            assert.equal(responses[0].body.payment.id, responses[1].body.payment.id);
            assert.equal(splitCalls.create, before + 1);
        });
        await check("webhook Payments exige segredo, assinatura válida, tópico e ID consistentes", async () => {
            const response = await create(await shopping());
            const id = response.body.checkout.provider_payment_id;
            const route = `/payment/webhook/mercado-pago?data.id=${id}&type=payment`;
            const headers = webhookHeaders(id);
            const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
            delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
            try { assert.equal((await request("POST", route, { type: "payment", data: { id } }, null, headers)).status, 503); }
            finally { process.env.MERCADO_PAGO_WEBHOOK_SECRET = secret; }
            assert.equal((await request("POST", route, { type: "payment", data: { id: "99999" } }, null, headers)).status, 400);
            assert.equal((await request("POST", route, { type: "order", data: { id } }, null, headers)).status, 400);
            assert.equal((await request("POST", route, { type: "payment", data: { id } }, null, { ...headers, "x-signature": "ts=1,v1=" + "0".repeat(64) })).status, 401);
            assert.equal((await request("GET", `/payment/${response.body.payment.id}`)).body.status, "pending");
        });
        await check("erro 400 ambíguo do provedor não libera nova cobrança", async () => {
            process.env.split_payment = "false";
            const id = await shopping();
            failNext = 400;
            const response = await create(id);
            assert.equal(response.status, 422);
            assert.equal(response.body.reconciliation_required, true);
            assert.equal((await request("GET", `/payment/${response.body.payment_id}`)).body.status, "pending");
            const before = calls.submit;
            assert.equal((await create(id)).status, 409);
            assert.equal(calls.submit, before);
            process.env.split_payment = "true";
        });
        await check("split não usa o simulador como repasse real", async () => {
            const id = await shopping();
            process.env.PAYMENT_PROVIDER = "simulated";
            try {
                assert.equal((await create(id)).status, 503);
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
            } finally { process.env.PAYMENT_PROVIDER = "mercado_pago"; }
        });
        await check("JSON inválido para método, compra, pagador ou parcelas é recusado antes de cobrar", async () => {
            const id = await shopping();
            const before = splitCalls.submit;
            assert.equal((await request("POST", "/payment/create", {})).status, 400);
            assert.equal((await create(id, "cash")).status, 400);
            assert.equal((await create("id-invalido")).status, 400);
            assert.equal((await create(uuid.generateId())).status, 404);
            assert.equal((await request("POST", "/payment/create", { id_shopping: id, method: "pix" }, otherToken)).status, 403);
            assert.equal((await create(id, "pix", { payer: { email: "email-invalido" } })).status, 400);
            assert.equal((await create(id, "credit_card", { installments: 0 })).status, 400);
            assert.equal((await create(id, "debit_card", { installments: 2 })).status, 400);
            assert.equal(splitCalls.submit, before);
        });
        await check("consultas e operações rejeitam UUID inválido e JWT expirado", async () => {
            const expired = jwt.sign({ id: ids.buyer, role: "user", exp: Math.floor(Date.now() / 1000) - 10 }, process.env.SECRET);
            for (const route of ["/payment/invalid", "/payment/invalid/checkout"]) assert.equal((await request("GET", route)).status, 400);
            for (const action of ["sync", "cancel", "refund", "simulate"]) assert.equal((await request("POST", `/payment/invalid/${action}`)).status, 400);
            assert.equal((await request("GET", "/payment/configuration", undefined, expired)).status, 401);
            assert.equal((await request("POST", "/payment/create", { id_shopping: await shopping(), method: "pix" }, expired)).status, 401);
        });
        await check("configuração rejeita callback inseguro antes de consumir state ou criar cobrança", async () => {
            const previous = process.env.MERCADO_PAGO_REDIRECT_URI;
            const id = await shopping();
            process.env.MERCADO_PAGO_REDIRECT_URI = "http://example.invalid/callback";
            try {
                assert.equal((await create(id)).status, 503);
                assert.equal((await request("POST", "/payment/mercado-pago/connect", {}, otherToken)).status, 503);
                assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
            } finally { process.env.MERCADO_PAGO_REDIRECT_URI = previous; }
        });
        await check("falha de notificação não desfaz pagamento aprovado ou comissão confirmada", async () => {
            const notifications = require("../src/services/notificationService");
            const original = notifications.notifyUser;
            notifications.notifyUser = async () => { throw new Error("Falha sintética de entrega"); };
            let response;
            try { response = await create(await shopping(), "credit_card"); }
            finally { notifications.notifyUser = original; }
            assert.equal(response.status, 201);
            assert.equal(response.body.payment.status, "approved");
            const [rows] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(response.body.payment.id)]);
            assert.equal(Number(rows[0].value), 2.5);
        });
        await check("notificação de pagamento Orders também é emitida uma vez para todos os destinatários", async () => {
            process.env.split_payment = "false";
            const response = await create(await shopping());
            approved(response.body.checkout.provider_order_id);
            await Promise.all([request("POST", `/payment/${response.body.payment.id}/sync`), request("POST", `/payment/${response.body.payment.id}/sync`)]);
            const [rows] = await db.query("SELECT BIN_TO_UUID(id_user) AS id FROM notification WHERE type='pagamento_confirmado' AND reference_id=?", [uuid.toBin(response.body.payment.id)]);
            assert.deepEqual(rows.map(row => row.id).sort(), [ids.buyer, ids.seller, ids.admin].sort());
        });
        await check("trocar credencial da mesma conta não reenvia um pagamento cuja criação ficou inconclusiva", async () => {
            const id = await shopping();
            failNext = 503;
            assert.equal((await create(id)).status, 503);
            const previous = process.env.MERCADO_PAGO_ACCESS_TOKEN;
            const submits = calls.submit;
            process.env.MERCADO_PAGO_ACCESS_TOKEN = "CREDENCIAL_FICTICIA_ROTACIONADA";
            try { assert.equal((await create(id)).status, 409); }
            finally { process.env.MERCADO_PAGO_ACCESS_TOKEN = previous; }
            assert.equal(calls.submit, submits);
        });
        await check("identificação opcional do pagador é validada e não fica em texto puro no vínculo de pagamento", async () => {
            process.env.split_payment = "true";
            const id = await shopping();
            assert.equal((await create(id, "pix", { payer: { identification: { type: "CPF", number: "123" } } })).status, 400);
            const created = await create(id, "credit_card", { payer: { first_name: "Teste", last_name: "Pagador", identification: { type: "CPF", number: "12345678909" } } });
            assert.equal(created.status, 201);
            const gateway = await gatewayService.getGateway(created.body.payment.id);
            assert.ok(!JSON.stringify(gateway).includes("12345678909"));
            assert.ok(!JSON.stringify(gateway).includes("card_token_ficticio"));
            assert.ok(!JSON.stringify(created.body).includes("12345678909"));
            process.env.split_payment = "false";
        });
        await check("split aprovado após cancelamento local registra comissão real, exige revisão e estorna sem duplicar estoque", async () => {
            process.env.split_payment = "true";
            const shoppingId = await shopping();
            const response = await create(shoppingId);
            const before = await stock();
            assert.equal((await request("PATCH", `/shopping/${shoppingId}/cancel`)).status, 200);
            const external = splitRecord(response);
            external.status = "approved"; external.status_detail = "accredited";
            const synced = await request("POST", `/payment/${response.body.payment.id}/sync`);
            assert.equal(synced.status, 200);
            assert.equal(synced.body.payment.status, "approved");
            assert.equal(synced.body.checkout.needs_review, true);
            assert.equal(synced.body.checkout.distribution.transfers_executed, true);
            assert.equal((await request("GET", `/shopping/${shoppingId}`)).body.status, "cancelled");
            const [rows] = await db.query("SELECT value FROM commission WHERE id_payment=?", [uuid.toBin(response.body.payment.id)]);
            assert.equal(Number(rows[0].value), 2.5);
            assert.equal((await request("POST", `/payment/${response.body.payment.id}/refund`, undefined, adminToken)).body.payment.status, "refunded");
            assert.equal(await stock(), before + 2);
            process.env.split_payment = "false";
        });
        process.env.split_payment = "true";
        const accounts = require("../src/services/paymentAccountService");
        const splitService = require("../src/services/paymentSplitService");
        const reconnect = async () => new URL((await accounts.start(ids.seller)).authorization_url);
        const disconnectRoute = "/payment/mercado-pago/account";
        let historicalPix;
        let historicalCredit;
        let historicalBinding;
        let staleAuthorization;
        let stalePreparation;
        let staleShopping;
        await check("desvincular exige JWT e ignora usuário escolhido no body", async () => {
            assert.equal((await request("DELETE", disconnectRoute, undefined, null)).status, 401);
            const expired = jwt.sign({ id: ids.seller, role: "company", exp: Math.floor(Date.now() / 1000) - 10 }, process.env.SECRET);
            assert.equal((await request("DELETE", disconnectRoute, undefined, expired)).status, 401);
            assert.equal((await request("DELETE", disconnectRoute, { userId: ids.seller })).status, 200);
            assert.equal((await request("GET", disconnectRoute, undefined, otherToken)).body.connected, true);
        });
        await check("desvincular é local, idempotente e preserva pagamentos e credenciais históricas criptografadas", async () => {
            historicalPix = await create(await shopping());
            historicalCredit = await create(await shopping(), "credit_card");
            historicalBinding = await splitService.getBinding(historicalPix.body.payment.id);
            staleAuthorization = await reconnect();
            staleShopping = await shopping();
            stalePreparation = await require("../src/services/paymentProviderService").prepare("pix", {}, email, staleShopping);
            const [before] = await db.query("SELECT access_token_enc,refresh_token_enc FROM payment_seller_account WHERE id=?", [uuid.toBin(historicalBinding.account_id)]);
            blockExternalRequests = true;
            try {
                const responses = await Promise.all([request("DELETE", disconnectRoute, undefined, otherToken), request("DELETE", disconnectRoute, undefined, otherToken)]);
                assert.deepEqual(responses.map(response => response.status), [200, 200]);
                assert.equal(responses[0].body.connected, false);
                assert.equal(responses[0].body.provider_authorization_revoked, false);
                assert.equal(responses[0].body.historical_payments_preserved, true);
                assert.ok(!JSON.stringify(responses).includes("SELLER_ACCESS"));
            } finally { blockExternalRequests = false; }
            assert.equal((await request("GET", disconnectRoute, undefined, otherToken)).body.connected, false);
            const [after] = await db.query("SELECT access_token_enc,refresh_token_enc FROM payment_seller_account WHERE id=?", [uuid.toBin(historicalBinding.account_id)]);
            assert.deepEqual(after, before);
            assert.deepEqual(await splitService.getBinding(historicalPix.body.payment.id), historicalBinding);
        });
        await check("desconexão bloqueia novas cobranças e preparação anterior não persiste pagamento", async () => {
            const submits = splitCalls.submit;
            const id = await shopping();
            assert.equal((await create(id)).status, 409);
            assert.equal((await request("GET", `/payment/shopping/${id}`)).body.length, 0);
            await assert.rejects(() => require("../src/services/paymentService").createPayment({ id_shopping: staleShopping,
                userId: ids.buyer, method: "pix", gateway: stalePreparation.gateway }), error => error.status === 409);
            assert.equal((await request("GET", `/payment/shopping/${staleShopping}`)).body.length, 0);
            assert.equal(splitCalls.submit, submits);
        });
        await check("desconexão invalida autorização antiga e mantém consulta e cancelamento do Pix anterior", async () => {
            assert.equal((await callback(staleAuthorization)).status, 409);
            assert.equal((await request("GET", disconnectRoute, undefined, otherToken)).body.connected, false);
            const id = historicalPix.body.payment.id;
            assert.equal((await request("GET", `/payment/${id}/checkout`)).status, 200);
            assert.equal((await request("POST", `/payment/${id}/sync`)).body.payment.status, "pending");
            assert.equal((await request("POST", `/payment/${id}/cancel`)).body.payment.status, "refused");
        });
        await check("outra conta só conecta após desvincular e pagamentos antigos mantêm o recebedor original", async () => {
            oauthCollector = "90012";
            assert.equal((await callback(await reconnect())).status, 200);
            assert.equal((await request("GET", disconnectRoute, undefined, otherToken)).body.connected, true);
            const current = await create(await shopping(), "credit_card");
            assert.equal(current.status, 201);
            assert.equal(splitRecord(current).collector_id, 90012);
            const currentBinding = await splitService.getBinding(current.body.payment.id);
            assert.notEqual(currentBinding.account_id, historicalBinding.account_id);
            const [active] = await db.query("SELECT COUNT(*) AS count FROM payment_seller_account WHERE id_user=? AND environment='test' AND disconnected_at IS NULL", [uuid.toBin(ids.seller)]);
            assert.equal(active[0].count, 1);
            const oldId = historicalCredit.body.payment.id;
            assert.equal((await request("POST", `/payment/${oldId}/sync`)).body.payment.status, "approved");
            assert.equal((await request("POST", `/payment/${oldId}/refund`, undefined, adminToken)).body.payment.status, "refunded");
            oauthCollector = "90011";
            assert.equal((await callback(await reconnect())).status, 409);
        });
        await check("reautorizar recebedor histórico reutiliza seu vínculo sem sobrescrever a outra conta", async () => {
            assert.equal((await request("DELETE", disconnectRoute, undefined, otherToken)).status, 200);
            assert.equal((await callback(await reconnect())).status, 200);
            const [rows] = await db.query("SELECT BIN_TO_UUID(id) AS id,collector_id,disconnected_at FROM payment_seller_account WHERE id_user=? AND environment='test'", [uuid.toBin(ids.seller)]);
            assert.equal(rows.length, 2);
            assert.equal(rows.find(row => row.disconnected_at === null).id, historicalBinding.account_id);
            assert.equal(rows.find(row => row.collector_id === "90012").disconnected_at !== null, true);
        });
        await check("callback em andamento não reconecta depois de desvincular", async () => {
            const url = await reconnect();
            let reached;
            let release;
            const started = new Promise(resolve => { reached = resolve; });
            const gate = new Promise(resolve => { release = resolve; });
            oauthTokenBarrier = async () => { reached(); await gate; };
            const pending = callback(url);
            try {
                await Promise.race([started, pending.then(() => { throw new Error("Callback não alcançou a troca de credenciais"); })]);
                assert.equal((await request("DELETE", disconnectRoute, undefined, otherToken)).status, 200);
            } finally { oauthTokenBarrier = undefined; release(); }
            assert.equal((await pending).status, 409);
            assert.equal((await request("GET", disconnectRoute, undefined, otherToken)).body.connected, false);
            assert.equal((await callback(await reconnect())).status, 200);
        });
        await check("criação concorrente com desconexão não gera erro interno nem perde o vínculo histórico", async () => {
            for (let i = 0; i < 5; i++) {
                if (i) assert.equal((await callback(await reconnect())).status, 200);
                const shoppingId = await shopping();
                const [created, disconnected] = await Promise.all([create(shoppingId), request("DELETE", disconnectRoute, undefined, otherToken)]);
                assert.equal(disconnected.status, 200);
                assert.ok([201, 409].includes(created.status), `Status inesperado na concorrência: ${created.status}`);
                assert.equal((await request("GET", disconnectRoute, undefined, otherToken)).body.connected, false);
                if (created.status === 201) {
                    const synced = await request("POST", `/payment/${created.body.payment.id}/sync`);
                    assert.equal(synced.status, 200);
                    assert.equal(synced.body.checkout.split_payment, true);
                }
            }
        });
        await check("desvinculação afeta só o ambiente atual e preserva o vínculo de produção", async () => {
            const prodId = uuid.generateId();
            await db.query(`INSERT INTO payment_seller_account (id,id_user,environment,application_id,marketplace_id,collector_id,access_token_enc,refresh_token_enc,expires_at)
                VALUES (?,?,'production','123456','90001','90013','CIFRA_FICTICIA','CIFRA_FICTICIA',DATE_ADD(NOW(),INTERVAL 1 DAY))`, [uuid.toBin(prodId), uuid.toBin(ids.seller)]);
            assert.equal((await request("DELETE", disconnectRoute, undefined, otherToken)).status, 200);
            const [rows] = await db.query("SELECT disconnected_at FROM payment_seller_account WHERE id=?", [uuid.toBin(prodId)]);
            assert.equal(rows[0].disconnected_at, null);
        });
        process.env.split_payment = "false";
        console.log(`PASSOU: ${passed} cenários; HTTP + MySQL reais, Mercado Pago interceptado, zero cobranças externas.`);
    } catch (error) {
        console.error("FALHOU:", error.code || error.name, error.message);
        process.exitCode = 1;
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        try { await cleanup(); console.log("Fixtures removidas por IDs exclusivos desta execução."); }
        catch (error) { console.error("Falha na limpeza:", error.code || error.name); process.exitCode = 1; }
        await db.end();
    }
})();
