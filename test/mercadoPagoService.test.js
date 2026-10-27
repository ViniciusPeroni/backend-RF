const assert = require("node:assert/strict");
const axios = require("axios");
const { test, mock } = require("node:test");
const mercadoPagoService = require("../src/services/mercadoPagoService");

function setEnv(t, name, value) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    t.after(() => {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
    });
}

test("creates a preference using the sandbox checkout URL", async (t) => {
    setEnv(t, "MP_ACCESS_TOKEN", "TEST-access-token");
    setEnv(t, "MP_ENVIRONMENT", "sandbox");
    let request;
    mock.method(axios, "post", async (...args) => {
        request = args;
        return {
            data: {
                id: "preference-id",
                init_point: "https://mercadopago.example/checkout",
                sandbox_init_point: "https://mercadopago.example/sandbox-checkout"
            }
        };
    });

    const preferenceBody = { items: [{ title: "Material", quantity: 1, unit_price: 100 }] };
    const result = await mercadoPagoService.createPreference(preferenceBody);

    assert.equal(request[0], "https://api.mercadopago.com/checkout/preferences");
    assert.deepEqual(request[1], preferenceBody);
    assert.equal(request[2].headers.Authorization, "Bearer TEST-access-token");
    assert.deepEqual(result, {
        id: "preference-id",
        checkoutUrl: "https://mercadopago.example/sandbox-checkout"
    });
});

test("uses the production checkout URL only when explicitly configured", async (t) => {
    setEnv(t, "MP_ACCESS_TOKEN", "APP_USR-access-token");
    setEnv(t, "MP_ENVIRONMENT", "production");
    mock.method(axios, "post", async () => ({
        data: {
            id: "preference-id",
            init_point: "https://mercadopago.example/checkout",
            sandbox_init_point: "https://mercadopago.example/sandbox-checkout"
        }
    }));

    const result = await mercadoPagoService.createPreference({ items: [] });

    assert.equal(result.checkoutUrl, "https://mercadopago.example/checkout");
});

test("fetches a payment by Mercado Pago ID", async (t) => {
    setEnv(t, "MP_ACCESS_TOKEN", "TEST-access-token");
    let request;
    mock.method(axios, "get", async (...args) => {
        request = args;
        return { data: { id: 123, status: "approved" } };
    });

    const payment = await mercadoPagoService.getPayment("123");

    assert.equal(request[0], "https://api.mercadopago.com/v1/payments/123");
    assert.equal(request[1].headers.Authorization, "Bearer TEST-access-token");
    assert.deepEqual(payment, { id: 123, status: "approved" });
});

test("fetches a preference and returns the environment-specific checkout URL", async (t) => {
    setEnv(t, "MP_ACCESS_TOKEN", "TEST-access-token");
    setEnv(t, "MP_ENVIRONMENT", "sandbox");
    let request;
    mock.method(axios, "get", async (...args) => {
        request = args;
        return { data: { id: "pref-123", init_point: "https://mp.example/live", sandbox_init_point: "https://mp.example/test" } };
    });

    const preference = await mercadoPagoService.getPreference("pref-123");

    assert.equal(request[0], "https://api.mercadopago.com/checkout/preferences/pref-123");
    assert.equal(preference.id, "pref-123");
    assert.equal(preference.checkoutUrl, "https://mp.example/test");
});

test("loads Mercado Pago payment methods", async (t) => {
    setEnv(t, "MP_ACCESS_TOKEN", "TEST-access-token");
    let request;
    mock.method(axios, "get", async (...args) => {
        request = args;
        return { data: [{ id: "pix", payment_type_id: "bank_transfer" }] };
    });

    const methods = await mercadoPagoService.getPaymentMethods();

    assert.equal(request[0], "https://api.mercadopago.com/v1/payment_methods");
    assert.deepEqual(methods, [{ id: "pix", payment_type_id: "bank_transfer" }]);
});

test("requires an access token without making a provider request", async (t) => {
    setEnv(t, "MP_ACCESS_TOKEN", undefined);
    let requestCalled = false;
    mock.method(axios, "post", async () => {
        requestCalled = true;
    });

    await assert.rejects(
        mercadoPagoService.createPreference({ items: [] }),
        (error) => error.status === 503
    );
    assert.equal(requestCalled, false);
});

test("rejects invalid Mercado Pago payment IDs before requesting the API", async (t) => {
    setEnv(t, "MP_ACCESS_TOKEN", "TEST-access-token");
    let requestCalled = false;
    mock.method(axios, "get", async () => {
        requestCalled = true;
    });

    await assert.rejects(
        mercadoPagoService.getPayment("not-a-number"),
        (error) => error.status === 400
    );
    assert.equal(requestCalled, false);
});
