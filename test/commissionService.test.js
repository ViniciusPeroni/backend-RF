const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const pool = require("../src/db/connect");
const uuid = require("../src/utils/uuid");
const commissionService = require("../src/services/commissionService");

function setupDatabase(t, { payments = [], commissions = [] } = {}) {
    const queries = [];
    const connection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql, params) => {
            queries.push({ sql, params });

            if (sql.includes("FROM payment")) return [payments];
            if (sql.includes("FROM commission")) return [commissions];
            return [{ affectedRows: 1 }];
        }
    };

    mock.method(pool, "promise", () => ({ getConnection: async () => connection }));
    return { queries };
}

test("creates an 8% commission for an approved payment", async (t) => {
    const paymentId = uuid.generateId();
    const { queries } = setupDatabase(t, {
        payments: [{ id: paymentId, value: "123.45", status: "approved" }]
    });

    const commission = await commissionService.generateCommission(paymentId);

    assert.equal(commission.percentage, 8);
    assert.equal(commission.value, 9.88);
    assert.equal(commission.id_payment, paymentId);
    assert.ok(queries.some(({ sql }) => sql.includes("INSERT INTO commission")));
});

test("rejects a payment that is not approved", async (t) => {
    const paymentId = uuid.generateId();
    const { queries } = setupDatabase(t, {
        payments: [{ id: paymentId, value: "123.45", status: "pending" }]
    });

    await assert.rejects(
        commissionService.generateCommission(paymentId),
        (error) => error.status === 409
    );
    assert.ok(!queries.some(({ sql }) => sql.includes("INSERT INTO commission")));
});

test("returns the existing commission instead of duplicating it", async (t) => {
    const paymentId = uuid.generateId();
    const existing = {
        id: uuid.generateId(),
        percentage: "8.00",
        value: "9.88",
        id_payment: paymentId
    };
    const { queries } = setupDatabase(t, {
        payments: [{ id: paymentId, value: "123.45", status: "approved" }],
        commissions: [existing]
    });

    const commission = await commissionService.generateCommission(paymentId);

    assert.equal(commission.id, existing.id);
    assert.ok(!queries.some(({ sql }) => sql.includes("INSERT INTO commission")));
});

test("rejects an invalid payment UUID before opening a transaction", async (t) => {
    let connectionRequested = false;
    mock.method(pool, "promise", () => ({
        getConnection: async () => {
            connectionRequested = true;
            throw new Error("unexpected database access");
        }
    }));

    await assert.rejects(
        commissionService.generateCommission("not-a-uuid"),
        (error) => error.status === 400
    );
    assert.equal(connectionRequested, false);
});
