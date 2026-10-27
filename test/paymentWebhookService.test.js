const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test, mock } = require("node:test");
const mercadoPagoService = require("../src/services/mercadoPagoService");
const paymentService = require("../src/services/paymentService");

const secret = "webhook-signing-secret";

function makeSignature(paymentId, requestId, timestamp = "1761600000") {
    const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
    const digest = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    return `ts=${timestamp},v1=${digest}`;
}

test("rejects missing or invalid webhook signatures before querying Mercado Pago", async (t) => {
    process.env.MP_WEBHOOK_SECRET = secret;
    let providerCalled = false;
    mock.method(mercadoPagoService, "getPayment", async () => { providerCalled = true; });
    const webhookService = require("../src/services/paymentWebhookService");

    await assert.rejects(
        webhookService.processNotification({ paymentId: "123", requestId: "request-1", signature: "" }),
        (error) => error.status === 401
    );
    await assert.rejects(
        webhookService.processNotification({ paymentId: "123", requestId: "request-1", signature: "ts=1,v1=00" }),
        (error) => error.status === 401
    );
    assert.equal(providerCalled, false);
});

test("verifies signature, fetches provider truth and applies the payment", async (t) => {
    process.env.MP_WEBHOOK_SECRET = secret;
    const requestId = "request-abc";
    const providerPayment = {
        id: 123,
        external_reference: "local-payment-id",
        status: "approved",
        transaction_amount: 40,
        currency_id: "BRL",
        payment_method: { id: "pix", type: "bank_transfer" }
    };
    let requestedId;
    let appliedPayment;
    mock.method(mercadoPagoService, "getPayment", async (id) => {
        requestedId = id;
        return providerPayment;
    });
    mock.method(paymentService, "applyProviderPayment", async (payment) => {
        appliedPayment = payment;
        return { id: "local-payment-id", status: "approved" };
    });
    const webhookService = require("../src/services/paymentWebhookService");

    const result = await webhookService.processNotification({
        paymentId: "123",
        requestId,
        signature: makeSignature("123", requestId)
    });

    assert.equal(requestedId, "123");
    assert.equal(appliedPayment, providerPayment);
    assert.deepEqual(result, { id: "local-payment-id", status: "approved" });
});

test("rejects a webhook when provider payment ID differs from the signed notification", async (t) => {
    process.env.MP_WEBHOOK_SECRET = secret;
    mock.method(mercadoPagoService, "getPayment", async () => ({ id: 456 }));
    let applyCalled = false;
    mock.method(paymentService, "applyProviderPayment", async () => { applyCalled = true; });
    const webhookService = require("../src/services/paymentWebhookService");
    const requestId = "request-id-mismatch";

    await assert.rejects(
        webhookService.processNotification({
            paymentId: "123",
            requestId,
            signature: makeSignature("123", requestId)
        }),
        (error) => error.status === 409
    );
    assert.equal(applyCalled, false);
});
