const pool = require("../db/connect");
const uuid = require("../utils/uuid");
const mercadoPagoService = require("./mercadoPagoService");
const commissionService = require("./commissionService");

const PAYMENT_METHODS = new Set(["pix", "debit_card", "credit_card"]);

function createError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function amountToCents(value) {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
    if (!match) throw createError("Valor da compra inválido.", 422);
    return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
}

function paymentMethodFilter(method, availableMethods) {
    const accepted = availableMethods.filter((item) => {
        if (item.id === "account_money" || item.payment_type_id === "account_money") return true;
        if (method === "pix") return item.id === "pix";
        return item.payment_type_id === method;
    });
    const chosenMethodAvailable = method === "pix"
        ? accepted.some((item) => item.id === "pix")
        : accepted.some((item) => item.payment_type_id === method);
    if (!chosenMethodAvailable) {
        throw createError("O método escolhido não está disponível no Mercado Pago.", 422);
    }

    const acceptedIds = new Set(accepted.map((item) => item.id));
    return {
        excluded_payment_methods: availableMethods
            .filter((item) => !acceptedIds.has(item.id) && item.id !== "account_money" && item.payment_type_id !== "account_money")
            .map(({ id }) => ({ id }))
    };
}

function formatPayment(payment, checkoutUrl) {
    return {
        id: payment.id,
        status: payment.status,
        method: payment.method,
        checkoutUrl
    };
}

async function createCheckout({ userId, shoppingId, method }) {
    if (!uuid.isValid(userId) || !uuid.isValid(shoppingId)) {
        throw createError("ID de usuário ou compra inválido.", 400);
    }
    if (!PAYMENT_METHODS.has(method)) {
        throw createError("Método de pagamento inválido.", 400);
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();

        const [shoppingRows] = await connection.query(
            `SELECT BIN_TO_UUID(s.id) AS id,
                    BIN_TO_UUID(s.id_user) AS id_user,
                    s.value,
                    s.status
             FROM shopping s
             WHERE s.id = ?
             FOR UPDATE`,
            [uuid.toBin(shoppingId)]
        );
        if (shoppingRows.length === 0) throw createError("Compra não encontrada.", 404);
        const shopping = shoppingRows[0];
        if (String(shopping.id_user).toLowerCase() !== userId.toLowerCase()) {
            throw createError("Acesso negado a esta compra.", 403);
        }
        if (shopping.status !== "accepted") {
            throw createError("O checkout só pode ser iniciado para compras aceitas.", 409);
        }
        const totalCents = amountToCents(shopping.value);
        if (totalCents <= 0) throw createError("Compras com valor zero não podem gerar checkout.", 422);

        const [paymentRows] = await connection.query(
            `SELECT BIN_TO_UUID(id) AS id, value, method, status, mp_preference_id
             FROM payment
             WHERE id_shopping = ?
             ORDER BY datetime DESC, id DESC
             LIMIT 1
             FOR UPDATE`,
            [uuid.toBin(shoppingId)]
        );
        const existing = paymentRows[0];
        if (existing?.status === "approved") {
            throw createError("Esta compra já possui um pagamento aprovado.", 409);
        }
        if (existing?.status === "pending" && existing.method !== method) {
            throw createError("Já existe um checkout pendente com outro método de pagamento.", 409);
        }
        if (existing?.status === "pending" && amountToCents(existing.value) !== totalCents) {
            throw createError("O valor do checkout pendente não corresponde mais à compra.", 409);
        }
        if (existing?.status === "pending" && existing.mp_preference_id) {
            const preference = await mercadoPagoService.getPreference(existing.mp_preference_id);
            await connection.commit();
            return formatPayment(existing, preference.checkoutUrl);
        }

        const [itemRows] = await connection.query(
            `SELECT p.name AS product_name, sp.quantity, sp.value AS subtotal
             FROM shopping_product sp
             INNER JOIN product p ON p.id = sp.id_product
             WHERE sp.id_shopping = ?`,
            [uuid.toBin(shoppingId)]
        );
        if (itemRows.length === 0) throw createError("A compra não possui itens para cobrança.", 422);

        const itemTotalCents = itemRows.reduce((sum, item) => sum + amountToCents(item.subtotal), 0);
        if (itemTotalCents !== totalCents) {
            throw createError("O total dos itens não corresponde ao valor da compra.", 409);
        }

        const reusablePayment = existing?.status === "pending" ? existing : null;
        const paymentId = reusablePayment?.id || uuid.generateId();
        if (!reusablePayment) {
            await connection.query(
                `INSERT INTO payment (id, value, method, status, id_shopping)
                 VALUES (?, ?, ?, 'pending', ?)`,
                [uuid.toBin(paymentId), (totalCents / 100).toFixed(2), method, uuid.toBin(shoppingId)]
            );
        }

        const availableMethods = await mercadoPagoService.getPaymentMethods();
        const preferenceBody = {
            items: itemRows.map((item) => ({
                title: `${item.product_name} (quantidade ${item.quantity})`,
                quantity: 1,
                unit_price: Number(item.subtotal),
                currency_id: "BRL"
            })),
            external_reference: paymentId,
            payment_methods: paymentMethodFilter(method, availableMethods)
        };
        if (process.env.MP_NOTIFICATION_URL) {
            preferenceBody.notification_url = process.env.MP_NOTIFICATION_URL;
        }

        const preference = await mercadoPagoService.createPreference(preferenceBody);
        await connection.query(
            `UPDATE payment
             SET mp_preference_id = ?
             WHERE id = ?`,
            [preference.id, uuid.toBin(paymentId)]
        );
        await connection.commit();

        return formatPayment({ id: paymentId, method, status: "pending" }, preference.checkoutUrl);
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Falha no rollback de createCheckout:", rollbackError);
            }
        }
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

async function getPaymentStatus({ paymentId, userId, role }) {
    if (!uuid.isValid(paymentId) || !uuid.isValid(userId)) {
        throw createError("ID de usuário ou pagamento inválido.", 400);
    }

    const [rows] = await pool.promise().query(
        `SELECT BIN_TO_UUID(p.id) AS id,
                BIN_TO_UUID(s.id_user) AS owner_id,
                p.status,
                p.method,
                p.value
         FROM payment p
         INNER JOIN shopping s ON s.id = p.id_shopping
         WHERE p.id = ?`,
        [uuid.toBin(paymentId)]
    );
    if (rows.length === 0) throw createError("Pagamento não encontrado.", 404);
    const payment = rows[0];
    if (role !== "admin" && payment.owner_id.toLowerCase() !== userId.toLowerCase()) {
        throw createError("Acesso negado a este pagamento.", 403);
    }

    return {
        id: payment.id,
        status: payment.status,
        method: payment.method,
        value: Number(payment.value)
    };
}

function providerStatus(status) {
    const statuses = {
        approved: "approved",
        refunded: "refunded",
        charged_back: "refunded",
        rejected: "refused",
        cancelled: "refused",
        pending: "pending",
        in_process: "pending",
        authorized: "pending"
    };
    const mapped = statuses[status];
    if (!mapped) throw createError("Status de pagamento do Mercado Pago não suportado.", 422);
    return mapped;
}

function providerMethod(payment) {
    const type = payment.payment_method?.type;
    const id = payment.payment_method?.id;
    if (id === "pix") return "pix";
    if (["credit_card", "debit_card", "account_money"].includes(type)) return type;
    throw createError("Método de pagamento do Mercado Pago não suportado.", 422);
}

async function applyProviderPayment(providerPayment) {
    const externalReference = providerPayment?.external_reference;
    if (!uuid.isValid(externalReference) || !/^\d+$/.test(String(providerPayment?.id))) {
        throw createError("Referência ou ID de pagamento do Mercado Pago inválido.", 400);
    }
    const incomingStatus = providerStatus(providerPayment.status);
    const method = providerMethod(providerPayment);
    const amountCents = amountToCents(providerPayment.transaction_amount);
    if (providerPayment.currency_id !== "BRL") {
        throw createError("Moeda do pagamento não corresponde ao checkout.", 409);
    }

    let connection;
    let finalStatus;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();
        const [rows] = await connection.query(
            `SELECT BIN_TO_UUID(id) AS id, value, status, mp_payment_id, mp_preference_id
             FROM payment
             WHERE id = ?
             FOR UPDATE`,
            [uuid.toBin(externalReference)]
        );
        if (rows.length === 0) throw createError("Pagamento local não encontrado.", 404);

        const payment = rows[0];
        if (!payment.mp_preference_id) {
            throw createError("O pagamento local não possui preferência Mercado Pago associada.", 409);
        }
        if (amountToCents(payment.value) !== amountCents) {
            throw createError("Valor do pagamento não corresponde ao checkout.", 409);
        }
        const providerPaymentId = String(providerPayment.id);
        if (payment.mp_payment_id && String(payment.mp_payment_id) !== providerPaymentId) {
            throw createError("Outro pagamento do Mercado Pago já está associado a esta cobrança.", 409);
        }

        finalStatus = payment.status === "refunded"
            ? "refunded"
            : payment.status === "approved" && incomingStatus !== "refunded"
                ? "approved"
                : incomingStatus;

        await connection.query(
            `UPDATE payment
             SET status = ?, method = ?, mp_payment_id = ?
             WHERE id = ?`,
            [finalStatus, method, providerPaymentId, uuid.toBin(externalReference)]
        );
        await connection.commit();
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Falha no rollback de applyProviderPayment:", rollbackError);
            }
        }
        throw error;
    } finally {
        if (connection) connection.release();
    }

    if (finalStatus === "approved") {
        await commissionService.generateCommission(externalReference);
    }
    return { id: externalReference, status: finalStatus };
}

module.exports = { createCheckout, getPaymentStatus, applyProviderPayment };
