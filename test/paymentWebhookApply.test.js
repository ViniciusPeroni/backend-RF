const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const pool = require("../src/db/connect");
const uuid = require("../src/utils/uuid");
const commissionService = require("../src/services/commissionService");

function providerPayment(paymentId, overrides = {}) {
    return {
        id: 12345,
        external_reference: paymentId,
        status: "approved",
        transaction_amount: 20,
        currency_id: "BRL",
        payment_method: { id: "pix", type: "bank_transfer" },
        ...overrides
    };
}

function setupDatabase(t, payment) {
    const queries = [];
    let current = payment;
    const connection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql, params) => {
            queries.push({ sql, params });
            if (sql.includes("FROM payment")) return [current ? [current] : []];
            if (sql.includes("UPDATE payment")) {
                current = { ...current, status: params[0], method: params[1], mp_payment_id: params[2] };
            }
            return [{ affectedRows: 1 }];
        }
    };
    mock.method(pool, "promise", () => ({ getConnection: async () => connection }));
    return { queries, getPayment: () => current };
}

test("approved provider payment updates local status and generates commission", async (t) => {
    const paymentId = uuid.generateId();
    const database = setupDatabase(t, {
        id: paymentId,
        value: "20.00",
        method: "pix",
        status: "pending",
        mp_payment_id: null,
        mp_preference_id: "preference-1"
    });
    let commissionPaymentId;
    mock.method(commissionService, "generateCommission", async (id) => {
        commissionPaymentId = id;
        return { id: "commission-id" };
    });
    const paymentService = require("../src/services/paymentService");

    const result = await paymentService.applyProviderPayment(providerPayment(paymentId));

    assert.equal(result.status, "approved");
    assert.equal(database.getPayment().mp_payment_id, "12345");
    assert.equal(commissionPaymentId, paymentId);
});

test("repeated approval uses the same provider payment association and rechecks idempotent commission", async (t) => {
    const paymentId = uuid.generateId();
    const database = setupDatabase(t, {
        id: paymentId,
        value: "20.00",
        method: "pix",
        status: "pending",
        mp_payment_id: null,
        mp_preference_id: "preference-1"
    });
    let commissionCalls = 0;
    mock.method(commissionService, "generateCommission", async () => {
        commissionCalls += 1;
        return { id: "same-commission" };
    });
    const paymentService = require("../src/services/paymentService");
    const provider = providerPayment(paymentId);

    await paymentService.applyProviderPayment(provider);
    const duplicateResult = await paymentService.applyProviderPayment(provider);

    assert.equal(duplicateResult.status, "approved");
    assert.equal(database.getPayment().mp_payment_id, "12345");
    assert.equal(commissionCalls, 2);
});

test("rejects provider amount/currency mismatches without updating payment", async (t) => {
    const paymentId = uuid.generateId();
    const database = setupDatabase(t, {
        id: paymentId,
        value: "20.00",
        method: "pix",
        status: "pending",
        mp_payment_id: null,
        mp_preference_id: "preference-1"
    });
    const paymentService = require("../src/services/paymentService");

    await assert.rejects(
        paymentService.applyProviderPayment(providerPayment(paymentId, { transaction_amount: 19.99 })),
        (error) => error.status === 409
    );
    assert.equal(database.getPayment().status, "pending");
    await assert.rejects(
        paymentService.applyProviderPayment(providerPayment(paymentId, { currency_id: "USD" })),
        (error) => error.status === 409
    );
});

test("maps refunds without deleting existing commission records", async (t) => {
    const paymentId = uuid.generateId();
    const database = setupDatabase(t, {
        id: paymentId,
        value: "20.00",
        method: "pix",
        status: "approved",
        mp_payment_id: "12345",
        mp_preference_id: "preference-1"
    });
    let commissionCalled = false;
    mock.method(commissionService, "generateCommission", async () => { commissionCalled = true; });
    const paymentService = require("../src/services/paymentService");

    const result = await paymentService.applyProviderPayment(providerPayment(paymentId, { status: "refunded" }));

    assert.equal(result.status, "refunded");
    assert.equal(commissionCalled, false);
    assert.equal(database.queries.some(({ sql }) => /DELETE\s+FROM\s+commission/i.test(sql)), false);
});

test("rejects unknown or conflicting local payment references", async (t) => {
    const paymentId = uuid.generateId();
    const database = setupDatabase(t, {
        id: paymentId,
        value: "20.00",
        method: "pix",
        status: "pending",
        mp_payment_id: "other-provider-id",
        mp_preference_id: "preference-1"
    });
    const paymentService = require("../src/services/paymentService");

    await assert.rejects(
        paymentService.applyProviderPayment(providerPayment(paymentId)),
        (error) => error.status === 409
    );
    await assert.rejects(
        paymentService.applyProviderPayment(providerPayment("not-a-uuid")),
        (error) => error.status === 400
    );
    assert.equal(database.queries.length, 1);
});
