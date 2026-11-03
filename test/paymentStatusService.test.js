const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const pool = require("../src/db/connect");
const uuid = require("../src/utils/uuid");

function setupDatabase(t, rows) {
    const queries = [];
    mock.method(pool, "promise", () => ({
        query: async (sql, params) => {
            queries.push({ sql, params });
            return [rows];
        }
    }));
    return { queries };
}

test("payment owner can query status without receiving provider secrets", async (t) => {
    const paymentId = uuid.generateId();
    const userId = uuid.generateId();
    const { queries } = setupDatabase(t, [{
        id: paymentId,
        owner_id: userId,
        status: "pending",
        method: "pix",
        value: "40.00",
        mp_preference_id: "internal-preference-id"
    }]);
    const paymentService = require("../src/services/paymentService");

    const payment = await paymentService.getPaymentStatus({ paymentId, userId });

    assert.deepEqual(payment, { id: paymentId, status: "pending", method: "pix", value: 40 });
    assert.equal(queries.length, 1);
    assert.ok(queries[0].sql.includes("BIN_TO_UUID(s.id_user) AS owner_id"));
});

test("payment status is limited to its owner unless the requester is admin", async (t) => {
    const paymentId = uuid.generateId();
    const ownerId = uuid.generateId();
    const otherUserId = uuid.generateId();
    setupDatabase(t, [{ id: paymentId, owner_id: ownerId, status: "approved", method: "pix", value: "40.00" }]);
    const paymentService = require("../src/services/paymentService");

    await assert.rejects(
        paymentService.getPaymentStatus({ paymentId, userId: otherUserId, role: "user" }),
        (error) => error.status === 403
    );
    const adminView = await paymentService.getPaymentStatus({ paymentId, userId: otherUserId, role: "admin" });
    assert.equal(adminView.status, "approved");
});

test("payment status returns not found for unknown IDs", async (t) => {
    const { queries } = setupDatabase(t, []);
    const paymentService = require("../src/services/paymentService");

    await assert.rejects(
        paymentService.getPaymentStatus({ paymentId: uuid.generateId(), userId: uuid.generateId() }),
        (error) => error.status === 404
    );
    assert.equal(queries.length, 1);
});
