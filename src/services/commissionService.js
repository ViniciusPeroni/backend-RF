const pool = require("../db/connect");
const uuid = require("../utils/uuid");

const COMMISSION_PERCENTAGE = 8;

function createError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function amountToCents(value) {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
    if (!match) {
        throw createError("Valor do pagamento inválido.", 422);
    }

    return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
}

function formatCommission(row) {
    return {
        id: row.id,
        percentage: Number(row.percentage),
        value: Number(row.value),
        id_payment: row.id_payment
    };
}

async function generateCommission(paymentId) {
    if (!uuid.isValid(paymentId)) {
        throw createError("ID do pagamento inválido.", 400);
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();

        const paymentIdBinary = uuid.toBin(paymentId);
        const [payments] = await connection.query(
            `SELECT value, status
             FROM payment
             WHERE id = ?
             FOR UPDATE`,
            [paymentIdBinary]
        );

        if (payments.length === 0) {
            throw createError("Pagamento não encontrado.", 404);
        }

        const [existingCommissions] = await connection.query(
            `SELECT
                BIN_TO_UUID(id) AS id,
                percentage,
                value,
                BIN_TO_UUID(id_payment) AS id_payment
             FROM commission
             WHERE id_payment = ?`,
            [paymentIdBinary]
        );

        if (existingCommissions.length > 0) {
            await connection.commit();
            return formatCommission(existingCommissions[0]);
        }

        if (payments[0].status !== "approved") {
            throw createError("A comissão só pode ser gerada para pagamentos aprovados.", 409);
        }

        const paymentCents = amountToCents(payments[0].value);
        const commissionCents = Math.round(paymentCents * COMMISSION_PERCENTAGE / 100);
        const commissionId = uuid.generateId();
        const commissionValue = (commissionCents / 100).toFixed(2);

        await connection.query(
            `INSERT INTO commission (id, percentage, value, id_payment)
             VALUES (?, ?, ?, ?)`,
            [uuid.toBin(commissionId), COMMISSION_PERCENTAGE, commissionValue, paymentIdBinary]
        );

        await connection.commit();

        return {
            id: commissionId,
            percentage: COMMISSION_PERCENTAGE,
            value: Number(commissionValue),
            id_payment: paymentId
        };
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Falha no rollback de generateCommission:", rollbackError);
            }
        }
        throw error;
    } finally {
        if (connection) connection.release();
    }
}

module.exports = { generateCommission };
