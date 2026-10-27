const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { test, mock } = require("node:test");
const paymentService = require("../src/services/paymentService");
const paymentWebhookService = require("../src/services/paymentWebhookService");

const secret = "payment-route-test-secret";
process.env.SECRET = secret;
process.env.DOCUMENT_ENC_KEY = "a".repeat(64);
process.env.DOCUMENT_HMAC_KEY = "b".repeat(64);

const apiRoutes = require("../src/routes/apiRoutes");

async function startServer(t) {
    const app = express();
    app.use(express.json());
    app.use("/api/reaproveitafranca", apiRoutes);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));
    return `http://127.0.0.1:${server.address().port}`;
}

function tokenFor(role = "user") {
    return jwt.sign({ id: "user-id", role, name: "Test User" }, secret);
}

test("checkout route requires authentication", async (t) => {
    let serviceCalled = false;
    mock.method(paymentService, "createCheckout", async () => { serviceCalled = true; });
    const baseUrl = await startServer(t);

    const response = await fetch(`${baseUrl}/api/reaproveitafranca/payment/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shoppingId: "shopping-id", method: "pix" })
    });

    assert.equal(response.status, 401);
    assert.equal(serviceCalled, false);
});

test("authenticated buyer starts checkout without passing a client total to the service", async (t) => {
    const expected = { id: "payment-id", status: "pending", method: "pix", checkoutUrl: "https://mp.example/test" };
    let received;
    mock.method(paymentService, "createCheckout", async (input) => {
        received = input;
        return expected;
    });
    const baseUrl = await startServer(t);

    const response = await fetch(`${baseUrl}/api/reaproveitafranca/payment/checkout`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${tokenFor()}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ shoppingId: "shopping-id", method: "pix", value: 0.01 })
    });

    assert.equal(response.status, 201);
    assert.deepEqual(received, { userId: "user-id", shoppingId: "shopping-id", method: "pix" });
    assert.deepEqual(await response.json(), expected);
});

test("authenticated buyer can query payment status", async (t) => {
    const expected = { id: "payment-id", status: "approved", method: "pix", value: 40 };
    let received;
    mock.method(paymentService, "getPaymentStatus", async (input) => {
        received = input;
        return expected;
    });
    const baseUrl = await startServer(t);

    const response = await fetch(`${baseUrl}/api/reaproveitafranca/payment/payment-id`, {
        headers: { Authorization: `Bearer ${tokenFor()}` }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(received, { paymentId: "payment-id", userId: "user-id", role: "user" });
    assert.deepEqual(await response.json(), expected);
});

test("Mercado Pago webhook endpoint is public and passes signed notification fields to service", async (t) => {
    let received;
    mock.method(paymentWebhookService, "processNotification", async (input) => { received = input; });
    const baseUrl = await startServer(t);

    const response = await fetch(`${baseUrl}/api/reaproveitafranca/payment/webhook?data.id=123`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-request-id": "request-id",
            "x-signature": "ts=1,v1=signature"
        },
        body: JSON.stringify({ data: { id: "123" } })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(received, { paymentId: "123", requestId: "request-id", signature: "ts=1,v1=signature" });
});
