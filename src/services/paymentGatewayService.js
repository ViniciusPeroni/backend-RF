const connect = require("../db/connect");
const uuid = require("../utils/uuid");
const paymentError = require("../utils/paymentError");

async function getGateway(id) {
    const [rows] = await connect.promise().query("SELECT * FROM payment_gateway WHERE id_payment = ?", [uuid.toBin(id)]);
    if (!rows[0]) throw paymentError("Pagamento legado sem vínculo com provedor; cobrança automática bloqueada.", 409);
    return rows[0];
}

async function getPayment(id) {
    if (!uuid.isValid(id)) return null;
    const [rows] = await connect.promise().query(
        `SELECT BIN_TO_UUID(p.id) AS id, p.value, p.method, p.status,
                BIN_TO_UUID(p.id_shopping) AS id_shopping,
                BIN_TO_UUID(s.id_user) AS id_user, s.status AS shopping_status
         FROM payment p INNER JOIN shopping s ON s.id = p.id_shopping WHERE p.id = ?`, [uuid.toBin(id)]
    );
    return rows[0] || null;
}

async function restoreStock(conn, shoppingId) {
    const [items] = await conn.query("SELECT id_product, quantity FROM shopping_product WHERE id_shopping = ? ORDER BY id_product", [shoppingId]);
    for (const item of items) {
        await conn.query("UPDATE product SET quantity = quantity + ?, status = 'available' WHERE id = ?", [item.quantity, item.id_product]);
    }
}

module.exports = {
    getGateway, getPayment,
    async getCheckout(id) {
        const [rows] = await connect.promise().query(
            `SELECT g.checkout, d.plan, p.status FROM payment_gateway g
             INNER JOIN payment p ON p.id = g.id_payment
             LEFT JOIN payment_distribution d ON d.id_payment = g.id_payment
             WHERE g.id_payment = ?`, [uuid.toBin(id)]
        );
        const value = rows[0]?.checkout;
        if (!value) return null;
        const checkout = typeof value === "string" ? JSON.parse(value) : value;
        const plan = typeof rows[0].plan === "string" ? JSON.parse(rows[0].plan) : rows[0].plan;
        if (plan) {
            checkout.distribution = {
                ...plan,
                settlement_status: ["refused", "refunded"].includes(rows[0].status) ? "not_applicable" : "not_configured"
            };
        }
        return checkout;
    },
    async applyCheckout(id, checkout) {
        const payment = await getPayment(id);
        if (!payment) throw paymentError("Pagamento não encontrado.", 404);
        const conn = await connect.promise().getConnection();
        try {
            await conn.beginTransaction();
            // Ordem de bloqueios: compra, pagamento, provedor.
            const [shoppings] = await conn.query("SELECT status, value FROM shopping WHERE id = ? FOR UPDATE", [uuid.toBin(payment.id_shopping)]);
            const [payments] = await conn.query("SELECT status FROM payment WHERE id = ? FOR UPDATE", [uuid.toBin(id)]);
            const [gateways] = await conn.query("SELECT * FROM payment_gateway WHERE id_payment = ? FOR UPDATE", [uuid.toBin(id)]);
            const shopping = shoppings[0];
            const current = payments[0];
            const gateway = gateways[0];
            if (!shopping || !current || !gateway || gateway.provider !== checkout.provider || gateway.environment !== checkout.environment ||
                (gateway.order_id && gateway.order_id !== checkout.provider_order_id) ||
                (gateway.transaction_id && gateway.transaction_id !== checkout.provider_payment_id) ||
                Number(shopping.value) !== Number(payment.value)) {
                throw paymentError("Vínculo do pagamento divergente.", 409);
            }
            const transitions = {
                pending: ["pending", "approved", "refused", "refunded"],
                approved: ["approved", "refunded"], refused: ["refused"], refunded: ["refunded"]
            };
            // Respostas atrasadas não rebaixam um estado já confirmado.
            if (!transitions[current.status]?.includes(checkout.status)) {
                if (gateway.provider === "simulated") {
                    throw paymentError("O pagamento simulado já foi finalizado com outro resultado.", 409);
                }
                await conn.commit();
                return;
            }
            const stored = { ...checkout };
            stored.needs_review = checkout.status === "approved" && ["cancelled", "refused"].includes(shopping.status);
            if (checkout.status !== "pending") {
                stored.qr_code = null;
                stored.qr_code_base64 = null;
                stored.ticket_url = null;
            }
            await conn.query(
                `UPDATE payment_gateway SET order_id = ?, transaction_id = ?, provider_status = ?, status_detail = ?, checkout = ? WHERE id_payment = ?`,
                [checkout.provider_order_id, checkout.provider_payment_id, checkout.provider_status, checkout.status_detail || null, JSON.stringify(stored), uuid.toBin(id)]
            );
            await conn.query("UPDATE payment SET status = ? WHERE id = ?", [checkout.status, uuid.toBin(id)]);
            if (checkout.status === "approved" && shopping.status === "pending") {
                await conn.query("UPDATE shopping SET status = 'accepted' WHERE id = ?", [uuid.toBin(payment.id_shopping)]);
            }
            const cancel = checkout.status === "refunded" || ["canceled", "cancelled", "expired"].includes(checkout.provider_status);
            if (cancel && ["pending", "accepted"].includes(shopping.status)) {
                const [others] = await conn.query("SELECT id FROM payment WHERE id_shopping = ? AND id <> ? AND status IN ('pending', 'approved') LIMIT 1", [uuid.toBin(payment.id_shopping), uuid.toBin(id)]);
                if (!others.length) {
                    await restoreStock(conn, uuid.toBin(payment.id_shopping));
                    await conn.query("UPDATE shopping SET status = 'cancelled' WHERE id = ?", [uuid.toBin(payment.id_shopping)]);
                }
            }
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }
};
