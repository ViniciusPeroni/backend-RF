const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const pool = require("../src/db/connect");
const uuid = require("../src/utils/uuid");
const mercadoPagoService = require("../src/services/mercadoPagoService");

function setupDatabase(t, { shopping = [], items = [], payments = [] } = {}) {
    const queries = [];
    const connection = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        query: async (sql, params) => {
            queries.push({ sql, params });
            if (sql.includes("FROM shopping s")) return [shopping];
            if (sql.includes("FROM shopping_product")) return [items];
            if (sql.includes("FROM payment")) return [payments];
            return [{ affectedRows: 1 }];
        }
    };
    mock.method(pool, "promise", () => ({ getConnection: async () => connection }));
    return { queries };
}

function setupMercadoPago(t, { checkoutUrl = "https://mp.example/sandbox" } = {}) {
    const createPreference = mock.method(mercadoPagoService, "createPreference", async (body) => {
        return { id: "pref-123", checkoutUrl, body };
    });
    const getPreference = mock.method(mercadoPagoService, "getPreference", async (id) => ({
        id,
        checkoutUrl
    }));
    mock.method(mercadoPagoService, "getPaymentMethods", async () => [
        { id: "pix", payment_type_id: "bank_transfer" },
        { id: "visa", payment_type_id: "credit_card" },
        { id: "account_money", payment_type_id: "account_money" },
        { id: "boleto", payment_type_id: "ticket" }
    ]);
    return { createPreference, getPreference };
}

function fixture() {
    const userId = uuid.generateId();
    const shoppingId = uuid.generateId();
    return {
        userId,
        shoppingId,
        shopping: [{ id: shoppingId, id_user: userId, status: "accepted", value: "25.00" }],
        items: [{ product_name: "Madeira", quantity: 2, subtotal: "25.00" }]
    };
}

test("rejects a checkout requested by someone other than the shopping owner", async (t) => {
    const data = fixture();
    const otherUserId = uuid.generateId();
    setupDatabase(t, { ...data, shopping: [{ ...data.shopping[0], id_user: otherUserId }] });
    const mp = setupMercadoPago(t);
    const paymentService = require("../src/services/paymentService");

    await assert.rejects(
        paymentService.createCheckout({ userId: data.userId, shoppingId: data.shoppingId, method: "pix" }),
        (error) => error.status === 403
    );
    assert.equal(mp.createPreference.mock.calls.length, 0);
});

test("requires the shopping to be accepted before creating checkout", async (t) => {
    const data = fixture();
    setupDatabase(t, { ...data, shopping: [{ ...data.shopping[0], status: "pending" }] });
    const mp = setupMercadoPago(t);
    const paymentService = require("../src/services/paymentService");

    await assert.rejects(
        paymentService.createCheckout({ userId: data.userId, shoppingId: data.shoppingId, method: "pix" }),
        (error) => error.status === 409
    );
    assert.equal(mp.createPreference.mock.calls.length, 0);
});

test("rejects zero-value purchases and unsupported methods without calling Mercado Pago", async (t) => {
    const data = fixture();
    setupDatabase(t, { ...data, shopping: [{ ...data.shopping[0], value: "0.00" }] });
    const mp = setupMercadoPago(t);
    const paymentService = require("../src/services/paymentService");

    await assert.rejects(
        paymentService.createCheckout({ userId: data.userId, shoppingId: data.shoppingId, method: "pix" }),
        (error) => error.status === 422
    );
    await assert.rejects(
        paymentService.createCheckout({ userId: data.userId, shoppingId: data.shoppingId, method: "boleto" }),
        (error) => error.status === 400
    );
    assert.equal(mp.createPreference.mock.calls.length, 0);
});

test("creates a pending payment using only values loaded from the database", async (t) => {
    const data = fixture();
    const { queries } = setupDatabase(t, data);
    const mp = setupMercadoPago(t);
    const paymentService = require("../src/services/paymentService");

    const result = await paymentService.createCheckout({
        userId: data.userId,
        shoppingId: data.shoppingId,
        method: "pix",
        value: 0.01
    });

    assert.equal(result.status, "pending");
    assert.equal(result.method, "pix");
    assert.equal(result.checkoutUrl, "https://mp.example/sandbox");
    const body = mp.createPreference.mock.calls[0].arguments[0];
    assert.equal(body.external_reference, result.id);
    assert.equal(body.items[0].title, "Madeira (quantidade 2)");
    assert.equal(body.items[0].quantity, 1);
    assert.equal(body.items[0].unit_price, 25);
    assert.equal(body.payment_methods.excluded_payment_methods.some(({ id }) => id === "account_money"), false);
    assert.ok(queries.some(({ sql }) => sql.includes("INSERT INTO payment")));
});

test("filters Checkout Pro to the selected card category while leaving account balance available", async (t) => {
    const data = fixture();
    setupDatabase(t, data);
    const mp = setupMercadoPago(t);
    const paymentService = require("../src/services/paymentService");

    await paymentService.createCheckout({
        userId: data.userId,
        shoppingId: data.shoppingId,
        method: "credit_card"
    });

    const body = mp.createPreference.mock.calls[0].arguments[0];
    const excludedIds = body.payment_methods.excluded_payment_methods.map(({ id }) => id);
    assert.equal(excludedIds.includes("visa"), false);
    assert.equal(excludedIds.includes("pix"), true);
    assert.equal(excludedIds.includes("account_money"), false);
});

test("resumes an existing pending payment without creating another preference", async (t) => {
    const data = fixture();
    const paymentId = uuid.generateId();
    const { queries } = setupDatabase(t, {
        ...data,
        payments: [{ id: paymentId, value: "25.00", method: "pix", status: "pending", mp_preference_id: "pref-existing" }]
    });
    const mp = setupMercadoPago(t);
    const paymentService = require("../src/services/paymentService");

    const result = await paymentService.createCheckout({
        userId: data.userId,
        shoppingId: data.shoppingId,
        method: "pix"
    });

    assert.equal(result.id, paymentId);
    assert.equal(result.checkoutUrl, "https://mp.example/sandbox");
    assert.equal(mp.createPreference.mock.calls.length, 0);
    assert.equal(mp.getPreference.mock.calls[0].arguments[0], "pref-existing");
    assert.equal(queries.some(({ sql }) => sql.includes("INSERT INTO payment")), false);
});
