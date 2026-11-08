// Opt-in: cartões oficiais no sandbox do Mercado Pago e banco temporário vazio.
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const axios = require("axios");
const bcrypt = require("bcrypt");

async function main() {
    if (process.env.RUN_PAYMENT_DB_TESTS !== "1" || process.env.RUN_MERCADO_PAGO_CARD_TESTS !== "1" || process.env.NODE_ENV === "production") {
        throw new Error("Defina RUN_PAYMENT_DB_TESTS=1 e RUN_MERCADO_PAGO_CARD_TESTS=1 somente em desenvolvimento.");
    }
    const clientId = process.env.MERCADO_PAGO_CLIENT_ID;
    assert.match(clientId || "", /^\d{1,40}$/);
    const applicationUrl = `https://api.mercadopago.com/applications/${clientId}`;
    const application = (await axios.get(applicationUrl, { timeout: 15000, maxRedirects: 0,
        headers: { Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}` } })).data;
    const testToken = application.test_access_token;
    assert.equal(String(application.id), clientId);
    assert.ok(typeof testToken === "string" && testToken.length > 10, "A aplicação precisa fornecer test_access_token.");
    const testHeaders = { Authorization: `Bearer ${testToken}`, "Content-Type": "application/json" };
    const confirmed = (await axios.get(applicationUrl, { headers: testHeaders, timeout: 15000, maxRedirects: 0 })).data;
    assert.equal(confirmed.test_access_token, testToken, "A credencial precisa ser a de teste da aplicação.");
    assert.equal(String(confirmed.id), clientId);

    const database = `rf_payment_cards_${crypto.randomBytes(8).toString("hex")}`;
    assert.match(database, /^rf_payment_cards_[a-f0-9]{16}$/);
    assert.notEqual(database.toLowerCase(), String(process.env.DB_NAME).toLowerCase());
    const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    const results = [];
    let createdDatabase = false;
    let server;
    let pool;
    try {
        await connection.query("CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", [database]);
        createdDatabase = true;
        await connection.query("USE ??", [database]);
        const schema = fs.readFileSync(path.join(__dirname, "../src/mysql-init/RFScript.sql"), "utf8").replace(/^\s*--.*$/gm, "");
        const statements = schema.split(";").map(sql => sql.trim()).filter(sql => /^(CREATE TABLE|ALTER TABLE)\s/i.test(sql));
        assert.ok(statements.length >= 20 && statements.every(sql => !/\bReaproveita_Franca\b/i.test(sql)));
        await connection.query("SET FOREIGN_KEY_CHECKS=0");
        for (const sql of statements) await connection.query(sql);
        await connection.query("SET FOREIGN_KEY_CHECKS=1");
        for (const file of ["migration_payment_gateway.sql", "migration_payment_distribution.sql", "migration_payment_split.sql", "migration_payment_account_disconnect.sql"]) {
            const source = fs.readFileSync(path.join(__dirname, "../src/mysql-init", file), "utf8").replace(/^\s*--.*$/gm, "");
            for (const sql of source.split(";").filter(sql => sql.trim())) await connection.query(sql);
        }
        Object.assign(process.env, { DB_NAME: database, NODE_ENV: "test", PAYMENT_PROVIDER: "mercado_pago", MERCADO_PAGO_ENV: "test",
            MERCADO_PAGO_ACCESS_TOKEN: testToken, split_payment: "false", SECRET: crypto.randomBytes(32).toString("hex"),
            DOCUMENT_ENC_KEY: crypto.randomBytes(32).toString("hex"), DOCUMENT_HMAC_KEY: crypto.randomBytes(32).toString("hex") });
        delete process.env.PAYMENT_WEBHOOK_URL;
        const uuid = require("../src/utils/uuid");
        const ids = { buyer: uuid.generateId(), seller: uuid.generateId(), admin: uuid.generateId(), location: uuid.generateId(), product: uuid.generateId() };
        const password = crypto.randomBytes(24).toString("hex");
        const hash = await bcrypt.hash(password, 10);
        const email = `rf-card-${ids.buyer}@example.com`;
        for (const [key, role] of [["buyer", "user"], ["seller", "company"], ["admin", "admin"]]) {
            await connection.query("INSERT INTO `user` (id,role,name,email,password,cellphone,status) VALUES (?,?, 'TESTE CARTAO SANDBOX',?,?, '11900000000','active')",
                [uuid.toBin(ids[key]), role, key === "buyer" ? email : `rf-${key}-${ids[key]}@example.com`, hash]);
        }
        await connection.query("INSERT INTO localization (id,zip_code,street,neighborhood,number,city,state,id_user) VALUES (?,'00000000','Teste','Teste','0','Teste','SP',?)", [uuid.toBin(ids.location), uuid.toBin(ids.seller)]);
        await connection.query("INSERT INTO product (id,name,price,quantity,category,type_negotiation,weight,conservation_state,id_user,id_localization) VALUES (?,'TESTE CARTAO SANDBOX',25,100,'madeira','sale',1,'good',?,?)", [uuid.toBin(ids.product), uuid.toBin(ids.seller), uuid.toBin(ids.location)]);
        pool = require("../src/db/connect");
        const app = require("../src/index");
        server = app.listen(0, "127.0.0.1");
        await new Promise(resolve => server.once("listening", resolve));
        const base = `http://127.0.0.1:${server.address().port}/api/reaproveitafranca`;
        async function request(method, route, body, token) {
            const response = await fetch(`${base}${route}`, { method,
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: response.status, body: await response.json() };
        }
        const login = await request("POST", "/user/login", { email, password });
        assert.equal(login.status, 200);
        const jwt = login.body.token;
        let ordersCredentialRejected = process.env.PAYMENT_SKIP_ORDERS_TEST === "1";
        for (const scenario of [
            { name: "Mastercard aprovado", number: "5480832801033311", method: "credit_card", brand: "master", holder: "APRO", expected: "approved", installments: 1 },
            { name: "Visa aprovado à vista", number: "4235647728025682", method: "credit_card", brand: "visa", holder: "APRO", expected: "approved", installments: 1 },
            { name: "Mastercard sem saldo", number: "5480832801033311", method: "credit_card", brand: "master", holder: "FUND", expected: "refused", installments: 1 },
            { name: "Mastercard pendente", number: "5480832801033311", method: "credit_card", brand: "master", holder: "CONT", expected: "pending", installments: 1 },
            { name: "Elo débito", number: "5067766783888311", method: "debit_card", brand: "debelo", holder: "APRO", expected: "approved", installments: 1 }
        ]) {
            if (process.env.PAYMENT_CARD_DIAGNOSTICS === "1" && scenario.brand === "master" && scenario.holder !== "FUND") continue;
            const result = { scenario: scenario.name, method: scenario.method, expected: scenario.expected };
            try {
                const tokenized = await axios.post("https://api.mercadopago.com/v1/card_tokens", {
                    card_number: scenario.number, expiration_month: 11, expiration_year: 2030, security_code: "123",
                    cardholder: { name: scenario.holder, identification: { type: "CPF", number: "12345678909" } }
                }, { headers: testHeaders, timeout: 15000, maxRedirects: 0 });
                result.tokenizationHttp = tokenized.status;
                assert.equal(tokenized.status, 201);
                const reference = crypto.randomUUID();
                let external;
                try {
                    external = await axios.post("https://api.mercadopago.com/v1/payments", {
                        transaction_amount: 50, description: "TESTE CARTAO SANDBOX", external_reference: reference,
                        token: tokenized.data.id, payment_method_id: scenario.brand, installments: scenario.installments,
                        payer: { email, identification: { type: "CPF", number: "12345678909" } }
                    }, { headers: { ...testHeaders, "X-Idempotency-Key": reference }, timeout: 15000, maxRedirects: 0 });
                    assert.equal(external.data.live_mode, false);
                    const checked = await axios.get(`https://api.mercadopago.com/v1/payments/${external.data.id}`, { headers: testHeaders, timeout: 15000, maxRedirects: 0 });
                    assert.equal(checked.data.live_mode, false);
                    assert.equal(checked.data.external_reference, reference);
                    result.paymentsApi = { createHttp: external.status, getHttp: checked.status, liveMode: checked.data.live_mode,
                        status: checked.data.status, statusDetail: checked.data.status_detail };
                    assert.equal(checked.data.status, scenario.expected === "refused" ? "rejected" : scenario.expected === "pending" ? "in_process" : "approved");
                    result.paymentsApi.outcome = "PASS";
                } catch (error) {
                    result.paymentsApi = { ...result.paymentsApi, outcome: "FAIL", providerHttp: error.response?.status || null,
                        providerCode: String(error.response?.data?.cause?.[0]?.code || error.response?.data?.error || "unexpected_response").replace(/[^a-zA-Z0-9_-]/g, "").slice(0,80),
                        providerDescription: String(error.response?.data?.cause?.[0]?.description || error.response?.data?.message || "")
                            .replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi, "[email]").replace(/\b\d{7,}\b/g, "[dado]").slice(0,180) };
                    if (scenario.method === "debit_card" && result.paymentsApi.providerCode === "10102" &&
                        result.paymentsApi.providerDescription === "No result found for the given parameters") {
                        result.paymentsApi.outcome = "BLOCKED_BY_PROVIDER";
                    }
                }
                if (ordersCredentialRejected) {
                    result.ordersApi = process.env.PAYMENT_SKIP_ORDERS_TEST === "1" ? "SKIPPED_BY_OPTION" : "BLOCKED_BY_TEST_CREDENTIAL";
                    result.outcome = result.paymentsApi.outcome;
                    results.push(result);
                    console.log(JSON.stringify(result));
                    continue;
                }
                const orderToken = await axios.post("https://api.mercadopago.com/v1/card_tokens", {
                    card_number: scenario.number, expiration_month: 11, expiration_year: 2030, security_code: "123",
                    cardholder: { name: scenario.holder, identification: { type: "CPF", number: "12345678909" } }
                }, { headers: testHeaders, timeout: 15000, maxRedirects: 0 });
                const purchase = await request("POST", "/shopping/create", { items: [{ id_product: ids.product, quantity: 2 }] }, jwt);
                assert.equal(purchase.status, 201);
                const input = { id_shopping: purchase.body.shopping.id, method: scenario.method, token: orderToken.data.id,
                    payment_method_id: scenario.brand, installments: scenario.installments, payer: { email, first_name: scenario.holder } };
                const payment = await request("POST", "/payment/create", input, jwt);
                result.createHttp = payment.status;
                result.providerCode = payment.body.provider_code || null;
                if (result.providerCode === "invalid_credentials") {
                    ordersCredentialRejected = true;
                    result.ordersApi = "BLOCKED_BY_TEST_CREDENTIAL";
                    result.outcome = result.paymentsApi.outcome;
                    results.push(result);
                    console.log(JSON.stringify(result));
                    continue;
                }
                let paymentId = payment.body.payment?.id || payment.body.payment_id;
                if (!paymentId) {
                    const list = await request("GET", `/payment/shopping/${purchase.body.shopping.id}`, undefined, jwt);
                    paymentId = list.body[0]?.id;
                }
                if (paymentId) {
                    const retrieved = await request("GET", `/payment/${paymentId}`, undefined, jwt);
                    const synced = await request("POST", `/payment/${paymentId}/sync`, undefined, jwt);
                    result.getHttp = retrieved.status;
                    result.syncHttp = synced.status;
                    result.paymentStatus = synced.body.payment?.status || retrieved.body.status;
                    result.providerStatus = synced.body.checkout?.provider_status || null;
                    result.statusDetail = synced.body.checkout?.status_detail || null;
                    if (synced.status === 200) {
                        assert.equal(synced.body.checkout.environment, "test");
                        assert.equal(synced.body.payment.id_card, null);
                        assert.equal(synced.body.checkout.qr_code, null);
                        assert.equal(result.paymentStatus, scenario.expected);
                        const [records] = await connection.query("SELECT COUNT(*) AS count FROM payment WHERE id_shopping=?", [uuid.toBin(purchase.body.shopping.id)]);
                        assert.equal(records[0].count, 1);
                        result.localPayments = records[0].count;
                        result.outcome = "PASS";
                    }
                }
                if (!result.outcome && payment.body.provider_code === "payment_method_not_allowed_for_collector") result.outcome = "BLOCKED_BY_PROVIDER";
                if (!result.outcome) result.outcome = "FAIL";
                if (result.paymentsApi.outcome === "FAIL") result.outcome = "FAIL";
            } catch (error) {
                result.outcome = "FAIL";
                result.error = error.code === "ERR_ASSERTION" ? "Resultado diferente do esperado; consulte os status registrados." : "Falha técnica no teste.";
                if (error.response?.status) result.providerHttp = error.response.status;
            }
            results.push(result);
            console.log(JSON.stringify(result));
        }
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.promise().end();
        if (createdDatabase) {
            assert.match(database, /^rf_payment_cards_[a-f0-9]{16}$/);
            await connection.query("DROP DATABASE ??", [database]);
        }
        await connection.end();
        console.log(JSON.stringify({ temporaryDatabaseRemoved: createdDatabase, productionEnvironmentFileChanged: false, splitExternalValidated: false }));
    }
    console.log(JSON.stringify({ summary: { pass: results.filter(result => result.outcome === "PASS").length,
        fail: results.filter(result => result.outcome === "FAIL").length,
        blocked: results.filter(result => result.outcome.includes("BLOCKED")).length },
        externalSplitValidated: false, allPaymentMethodsApproved: results.length === 5 && results.every(result => result.outcome === "PASS" && !result.ordersApi) }));
    if (results.some(result => result.outcome === "FAIL")) process.exitCode = 1;
}

main().catch(error => {
    console.error(JSON.stringify({ error: "Não foi possível concluir o teste de cartões no sandbox.", code: error.code || null, providerHttp: error.response?.status || null }));
    process.exitCode = 1;
});
