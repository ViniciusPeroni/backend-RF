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

const pool = require("../src/db/connect");
const db = pool.promise();
const gatewayService = require("../src/services/paymentGatewayService");
const orders = new Map();
const idempotency = new Map();
const calls = { create: 0, cancel: 0, refund: 0 };
let failNext;
let timeoutAfterCreate = false;
let corruptAmount = false;

axios.defaults.adapter = async config => {
    const url = new URL(config.url);
    assert.equal(url.origin, "https://api.mercadopago.com");
    const data = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    const segments = url.pathname.split("/").filter(Boolean);
    let result;
    if (failNext) {
        const status = failNext;
        failNext = null;
        throw new axios.AxiosError("Falha externa de teste", "ERR_BAD_RESPONSE", config, null, { status, data: {}, headers: {}, config });
    }
    if (config.method === "post" && segments.length === 2) {
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
async function shopping() {
    const response = await request("POST", "/shopping/create", { items: [{ id_product: ids.product, quantity: 2 }] });
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
            await conn.query("DELETE FROM payment WHERE id_shopping = ?", [uuid.toBin(id)]);
            await conn.query("DELETE FROM shopping_product WHERE id_shopping = ?", [uuid.toBin(id)]);
            await conn.query("DELETE FROM shopping WHERE id = ? AND id_user = ?", [uuid.toBin(id), uuid.toBin(ids.buyer)]);
        }
        await conn.query("DELETE FROM product WHERE id = ? AND id_user = ?", [uuid.toBin(ids.product), uuid.toBin(ids.seller)]);
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
