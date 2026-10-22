const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const commissionService = require("../src/services/commissionService");
const commissionController = require("../src/controllers/commissionController");

function createResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

test("allows only admins to generate commissions", async (t) => {
    let serviceCalled = false;
    mock.method(commissionService, "generateCommission", async () => {
        serviceCalled = true;
    });
    const res = createResponse();

    await commissionController.generateCommission({ role: "user", params: { paymentId: "payment-id" } }, res);

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "Acesso não autorizado." });
    assert.equal(serviceCalled, false);
});

test("generates a commission for an admin and returns the service result", async (t) => {
    const commission = { id: "commission-id", percentage: 8, value: 9.88, id_payment: "payment-id" };
    let receivedPaymentId;
    mock.method(commissionService, "generateCommission", async (paymentId) => {
        receivedPaymentId = paymentId;
        return commission;
    });
    const res = createResponse();

    await commissionController.generateCommission({
        role: "admin",
        params: { paymentId: "payment-id" }
    }, res);

    assert.equal(receivedPaymentId, "payment-id");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        message: "Comissão gerada com sucesso.",
        commission
    });
});

test("returns service validation errors without hiding their status", async (t) => {
    const error = Object.assign(new Error("Pagamento não encontrado."), { status: 404 });
    mock.method(commissionService, "generateCommission", async () => {
        throw error;
    });
    const res = createResponse();

    await commissionController.generateCommission({ role: "admin", params: { paymentId: "payment-id" } }, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "Pagamento não encontrado." });
});

test("returns a generic error for unexpected service failures", async (t) => {
    mock.method(commissionService, "generateCommission", async () => {
        throw new Error("database credentials leaked");
    });
    const res = createResponse();

    await commissionController.generateCommission({ role: "admin", params: { paymentId: "payment-id" } }, res);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "Erro ao gerar comissão." });
});
