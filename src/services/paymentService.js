const connect = require("../db/connect");
const uuid = require("../utils/uuid");
const paymentDistribution = require("./paymentDistributionService");

function createError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

const paymentService = {

    async createPayment(data) {
        let conn;

        try {
            conn = await connect.promise().getConnection();
            await conn.beginTransaction();

            // Serializa a criação de pagamentos desta compra.
            const [shoppings] = await conn.query(
                `SELECT
                    value,
                    status,
                    BIN_TO_UUID(id_user) AS id_user
                 FROM shopping
                 WHERE id = ?
                 FOR UPDATE`,
                [uuid.toBin(data.id_shopping)]
            );

            if (shoppings.length === 0) {
                throw createError("Compra não encontrada.", 404);
            }

            const shopping = shoppings[0];

            const isOwner =
                String(shopping.id_user).toLowerCase() ===
                String(data.userId).toLowerCase();

            if (!isOwner) {
                throw createError(
                    "Acesso negado a esta compra.",
                    403
                );
            }

            // Aceite antes do pagamento: só paga depois que a empresa aceitou.
            if (shopping.status === "pending") {
                throw createError(
                    "A empresa ainda não aceitou esta reserva. O pagamento é liberado depois do aceite.",
                    409
                );
            }

            if (shopping.status !== "accepted") {
                throw createError(
                    "A compra não está disponível para pagamento.",
                    409
                );
            }

            const value = Number(shopping.value);

            if (!Number.isFinite(value) || value <= 0) {
                throw createError(
                    "A compra deve possuir um valor maior que zero.",
                    400
                );
            }

           const [payments] = await conn.query(
                `SELECT
                    BIN_TO_UUID(id) AS id,
                    value,
                    method,
                    status,
                    BIN_TO_UUID(id_card) AS id_card
                FROM payment
                WHERE id_shopping = ?
                AND status IN ('pending', 'approved')
                LIMIT 1
                FOR UPDATE`,
                [uuid.toBin(data.id_shopping)]
            );

            if (payments.length > 0) {
                const existing = payments[0];

                const canReuse =
                    existing.status === "pending" &&
                    existing.method === data.method &&
                    Number(existing.value) === Number(shopping.value);

                if (!canReuse) {
                    throw createError(
                        "Esta compra já possui um pagamento com outro método, valor ou aprovado.",
                        409
                    );
                }

                const [gateways] = await conn.query(
                    "SELECT provider, environment, request_hash FROM payment_gateway WHERE id_payment = ?",
                    [uuid.toBin(existing.id)]
                );
                const gateway = gateways[0];
                if (!gateway || gateway.provider !== data.gateway.provider ||
                    gateway.environment !== data.gateway.environment || gateway.request_hash !== data.gateway.request_hash) {
                    throw createError("Pagamento pendente de outro provedor, ambiente ou conjunto de dados. Consulte-o antes de repetir.", 409);
                }
                await conn.commit();

                return {
                    id: existing.id,
                    value: existing.value,
                    method: existing.method,
                    status: existing.status,
                    id_shopping: data.id_shopping,
                    id_card: existing.id_card,
                    reused: true
                };
            }
            const id = uuid.generateId();

            const [items] = await conn.query(
                `SELECT sp.value, BIN_TO_UUID(p.id_user) AS seller_id
                 FROM shopping_product sp
                 INNER JOIN product p ON p.id = sp.id_product
                 WHERE sp.id_shopping = ?`,
                [uuid.toBin(data.id_shopping)]
            );
            const distribution = paymentDistribution.calculate(items, shopping.value);
            const split = data.gateway.split;
            if (split) {
                await conn.query("SELECT id FROM `user` WHERE id = ? FOR UPDATE", [uuid.toBin(split.seller_id)]);
                const [accounts] = await conn.query(
                    `SELECT id FROM payment_seller_account WHERE id = ? AND id_user = ? AND environment = ?
                     AND collector_id = ? AND marketplace_id = ? AND application_id = ? AND disconnected_at IS NULL FOR UPDATE`,
                    [uuid.toBin(split.account_id), uuid.toBin(split.seller_id), split.environment,
                        split.collector_id, split.marketplace_id, process.env.MERCADO_PAGO_CLIENT_ID]
                );
                if (!accounts.length) throw createError("O vínculo Mercado Pago mudou antes da cobrança. Confira a conexão do vendedor.", 409);
            }
            if (split && (distribution.sellers.length !== 1 || distribution.sellers[0].seller_id !== split.seller_id ||
                distribution.marketplace_amount !== split.application_fee || distribution.gross_amount !== split.gross_amount)) {
                throw createError("Os itens ou a comissão mudaram durante o pagamento. Confira a compra antes de repetir.", 409);
            }

            await conn.query(
                `INSERT INTO payment (
                    id,
                    value,
                    method,
                    status,
                    id_shopping,
                    id_card
                )
                VALUES (?, ?, ?, 'pending', ?, NULL)`,
                [
                    uuid.toBin(id),
                    shopping.value,
                    data.method,
                    uuid.toBin(data.id_shopping)
                ]
            );

            await conn.query(
                `INSERT INTO payment_gateway (id_payment, provider, environment, request_hash) VALUES (?, ?, ?, ?)`,
                [uuid.toBin(id), data.gateway.provider, data.gateway.environment, data.gateway.request_hash]
            );
            await conn.query(
                "INSERT INTO payment_distribution (id_payment, plan) VALUES (?, ?)",
                [uuid.toBin(id), JSON.stringify(distribution)]
            );
            if (split) {
                await conn.query(`INSERT INTO payment_split (id_payment, id_seller, id_account, environment, marketplace_id, collector_id, application_fee, gross_amount)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [uuid.toBin(id), uuid.toBin(split.seller_id), uuid.toBin(split.account_id), split.environment,
                    split.marketplace_id, split.collector_id, split.application_fee, split.gross_amount]);
            }
            await conn.commit();

            return {
                id,
                value: shopping.value,
                method: data.method,
                status: "pending",
                id_shopping: data.id_shopping,
                id_card: null,
                reused: false
            };
        } catch (error) {
            if (conn) {
                try {
                    await conn.rollback();
                } catch (rollbackError) {
                    console.error(
                        "Falha no rollback de createPayment:",
                        rollbackError.code || rollbackError.name
                    );
                }
            }

            throw error;

        } finally {
            if (conn) {
                conn.release();
            }
        }
    },
    async getPaymentById(id, userId) {
        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(p.id) AS id,
                p.value,
                p.method,
                p.status,
                p.datetime,
                BIN_TO_UUID(p.id_shopping) AS id_shopping,
                BIN_TO_UUID(p.id_card) AS id_card
            FROM payment p
            INNER JOIN shopping s ON s.id = p.id_shopping
            WHERE p.id = ?
            AND s.id_user = ?`,
            [
                uuid.toBin(id),
                uuid.toBin(userId)
            ]
        );

        return rows[0] || null;
    },

    async getPaymentsByShoppingId(shoppingId, userId) {
        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(p.id) AS id,
                p.value,
                p.method,
                p.status,
                p.datetime,
                BIN_TO_UUID(p.id_shopping) AS id_shopping,
                BIN_TO_UUID(p.id_card) AS id_card
            FROM payment p
            INNER JOIN shopping s ON s.id = p.id_shopping
            WHERE p.id_shopping = ?
            AND s.id_user = ?
            ORDER BY p.datetime DESC, p.id DESC`,
            [
                uuid.toBin(shoppingId),
                uuid.toBin(userId)
            ]
        );

        return rows;
    }

};

module.exports = paymentService;
