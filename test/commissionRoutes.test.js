const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { test, mock } = require("node:test");
const commissionService = require("../src/services/commissionService");

const secret = "commission-route-test-secret";
process.env.SECRET = secret;
process.env.DOCUMENT_ENC_KEY = "a".repeat(64);
process.env.DOCUMENT_HMAC_KEY = "b".repeat(64);

const apiRoutes = require("../src/routes/apiRoutes");

async function startServer(t) {
    const app = express();
    app.use("/api/reaproveitafranca", apiRoutes);
    const server = http.createServer(app);

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));

    return `http://127.0.0.1:${server.address().port}`;
}

function tokenFor(role) {
    return jwt.sign({ id: "user-id", role, name: "Test User" }, secret);
}

test("commission generation route requires authentication", async (t) => {
    let serviceCalled = false;
    mock.method(commissionService, "generateCommission", async () => {
        serviceCalled = true;
    });
    const baseUrl = await startServer(t);

    const response = await fetch(`${baseUrl}/api/reaproveitafranca/commission/payment/payment-id`, {
        method: "POST"
    });

    assert.equal(response.status, 401);
    assert.equal(serviceCalled, false);
});

test("commission generation route is restricted to admins", async (t) => {
    let serviceCalled = false;
    mock.method(commissionService, "generateCommission", async () => {
        serviceCalled = true;
    });
    const baseUrl = await startServer(t);

    const response = await fetch(`${baseUrl}/api/reaproveitafranca/commission/payment/payment-id`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenFor("user")}` }
    });

    assert.equal(response.status, 403);
    assert.equal(serviceCalled, false);
});

test("admin can invoke commission generation for a payment", async (t) => {
    const commission = { id: "commission-id", percentage: 8, value: 9.88, id_payment: "payment-id" };
    let receivedPaymentId;
    mock.method(commissionService, "generateCommission", async (paymentId) => {
        receivedPaymentId = paymentId;
        return commission;
    });
    const baseUrl = await startServer(t);

    const response = await fetch(`${baseUrl}/api/reaproveitafranca/commission/payment/payment-id`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenFor("admin")}` }
    });

    assert.equal(response.status, 200);
    assert.equal(receivedPaymentId, "payment-id");
    assert.deepEqual(await response.json(), {
        message: "Comissão gerada com sucesso.",
        commission
    });
});
