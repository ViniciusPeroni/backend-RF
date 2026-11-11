const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const uuid = require("../src/utils/uuid");

function loadWithStubs(path, stubs) {
    const original = Module._load;
    const resolved = require.resolve(path);
    delete require.cache[resolved];
    Module._load = function (name, parent, isMain) {
        if (Object.hasOwn(stubs, name)) return stubs[name];
        return original.call(this, name, parent, isMain);
    };
    try { return require(resolved); }
    finally { Module._load = original; delete require.cache[resolved]; }
}

const payment = { id: uuid.generateId(), id_shopping: uuid.generateId(), value: 10 };
const buyer = uuid.generateId();
const seller = uuid.generateId();
const admin = uuid.generateId();

function notificationHarness({ failure } = {}) {
    const queries = [];
    const queued = [];
    const conn = { async query(sql, params) {
        queries.push({ sql, params });
        return [sql.includes("UNION") ? [{ id: buyer }, { id: seller }, { id: admin }, { id: seller }] : [{ id: buyer }]];
    } };
    const service = loadWithStubs("../src/services/paymentNotificationService", {
        "../db/connect": {},
        "./notificationService": {},
        "./notificationOutboxService": { async enqueue(connection, data) {
            assert.equal(connection, conn);
            if (failure) throw failure;
            const entry = { ...data, id: uuid.generateId() };
            queued.push(entry);
            return entry;
        } }
    });
    return { service, conn, queries, queued };
}

for (const [status, type, title, content, recipients] of [
    ["approved", "pagamento_confirmado", "Pagamento confirmado", "O pagamento da reserva foi confirmado.", [buyer, seller, admin]],
    ["refused", "sistema", "Pagamento recusado", "O pagamento da sua reserva não foi aprovado.", [buyer]],
    ["refunded", "sistema", "Pagamento estornado", "O pagamento da reserva foi estornado.", [buyer, seller, admin]]
]) {
    test(`enfileira ${status} com destinatários deduplicados e texto fixo na conexão recebida`, async () => {
        const { service, conn, queries, queued } = notificationHarness();
        const entries = await service.enqueueTransition(conn, { ...payment, status_detail: "segredo do gateway" }, status);
        assert.deepEqual(entries, queued);
        assert.deepEqual(entries.map(entry => entry.id_user), recipients);
        for (const entry of entries) {
            assert.deepEqual(entry, { id: entry.id, id_user: entry.id_user, type, title, content,
                reference_table: "payment", reference_id: payment.id });
            assert.equal(uuid.isValid(entry.id), true);
        }
        assert.deepEqual(queries[0].params, status === "refused"
            ? [uuid.toBin(payment.id_shopping)] : [uuid.toBin(payment.id_shopping), uuid.toBin(payment.id_shopping)]);
        if (status !== "refused") assert.match(queries[0].sql, /role = 'admin' AND status = 'active'/);
    });
}

test("pending não consulta destinatários nem enfileira avisos", async () => {
    const { service, conn, queries, queued } = notificationHarness();
    assert.deepEqual(await service.enqueueTransition(conn, payment, "pending"), []);
    assert.equal(queries.length, 0);
    assert.equal(queued.length, 0);
});

test("falha de enqueue propaga para rollback do chamador", async () => {
    const failure = new Error("falha sintética");
    const { service, conn } = notificationHarness({ failure });
    await assert.rejects(service.enqueueTransition(conn, payment, "refused"), error => error === failure);
});

function gatewayHarness({ current = "pending", checkoutStatus = "approved", enqueueFailure, commitFailure, flushFailure, needsReview = false } = {}) {
    const events = [];
    const entries = [{ id: uuid.generateId() }];
    const checkout = { provider: "mercado_pago", environment: "test", status: checkoutStatus, needs_review: needsReview };
    const conn = {
        async beginTransaction() { events.push("begin"); },
        async commit() { events.push("commit"); if (commitFailure) throw commitFailure; },
        async rollback() { events.push("rollback"); },
        release() { events.push("release"); },
        async query(sql) {
            if (sql.startsWith("SELECT status, value")) return [[{ status: "completed", value: 10 }]];
            if (sql.startsWith("SELECT status FROM payment")) { events.push("lock"); return [[{ status: current }]]; }
            if (sql.startsWith("SELECT * FROM payment_gateway")) return [[{ provider: checkout.provider, environment: checkout.environment }]];
            return [[]];
        }
    };
    const service = loadWithStubs("../src/services/paymentGatewayService", {
        "../db/connect": { promise: () => ({ query: async () => [[{ ...payment, status: "pending" }]], getConnection: async () => conn }) },
        "./paymentNotificationService": { async confirmed() { events.push("legacy-notify"); }, async enqueueTransition(connection, receivedPayment, status) {
            assert.equal(connection, conn);
            assert.equal(receivedPayment.id, payment.id);
            assert.equal(status, checkoutStatus);
            events.push("enqueue");
            if (enqueueFailure) throw enqueueFailure;
            return entries;
        } },
        "./notificationOutboxService": { async flush(received) {
            assert.equal(received, entries);
            events.push("flush");
            if (flushFailure) throw flushFailure;
        } }
    });
    return { service, checkout, events };
}

for (const [current, checkoutStatus] of [["pending", "approved"], ["pending", "refused"], ["pending", "refunded"], ["approved", "refunded"]]) {
    test(`${current}->${checkoutStatus}: enfileira sob lock antes do commit, entrega após release`, async () => {
        const { service, checkout, events } = gatewayHarness({ current, checkoutStatus });
        await service.applyCheckout(payment.id, checkout);
        assert.deepEqual(events, ["begin", "lock", "enqueue", "commit", "release", "flush"]);
    });
}

for (const current of ["approved", "refused", "refunded", "pending"]) {
    test(`${current} repetido sob lock não cria novo aviso apesar da leitura inicial pending`, async () => {
        const { service, checkout, events } = gatewayHarness({ current, checkoutStatus: current });
        await service.applyCheckout(payment.id, checkout);
        assert.deepEqual(events, ["begin", "lock", "commit", "release"]);
    });
}

test("approved com needs_review não vira aviso falso de recusa/estorno", async () => {
    const { service, checkout, events } = gatewayHarness({ needsReview: true });
    await service.applyCheckout(payment.id, checkout);
    assert.deepEqual(events, ["begin", "lock", "enqueue", "commit", "release", "flush"]);
});

test("falha de outbox causa rollback e não entrega", async () => {
    const failure = new Error("falha sintética de outbox");
    const { service, checkout, events } = gatewayHarness({ enqueueFailure: failure });
    await assert.rejects(service.applyCheckout(payment.id, checkout), error => error === failure);
    assert.deepEqual(events, ["begin", "lock", "enqueue", "rollback", "release"]);
});

test("falha de commit não entrega os envelopes já enfileirados", async () => {
    const failure = new Error("falha sintética de commit");
    const { service, checkout, events } = gatewayHarness({ commitFailure: failure });
    await assert.rejects(service.applyCheckout(payment.id, checkout), error => error === failure);
    assert.deepEqual(events, ["begin", "lock", "enqueue", "commit", "rollback", "release"]);
});

test("resposta atrasada refused após approved não gera aviso de recusa", async () => {
    const { service, checkout, events } = gatewayHarness({ current: "approved", checkoutStatus: "refused" });
    await service.applyCheckout(payment.id, checkout);
    assert.deepEqual(events, ["begin", "lock", "commit", "release"]);
});

test("falha inesperada de flush não desfaz pagamento confirmado", async () => {
    const { service, checkout, events } = gatewayHarness({ flushFailure: new Error("dado sensível não deve ser logado") });
    const original = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(" "));
    try { await service.applyCheckout(payment.id, checkout); }
    finally { console.error = original; }
    assert.deepEqual(events, ["begin", "lock", "enqueue", "commit", "release", "flush"]);
    assert.equal(logs.some(log => log.includes("dado sensível")), false);
});
