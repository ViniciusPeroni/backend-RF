const connect = require("../db/connect");
const uuid = require("../utils/uuid");
const notifications = require("./notificationService");
const outbox = require("./notificationOutboxService");

async function enqueueTransition(conn, payment, status) {
    const messages = {
        approved: { type: "pagamento_confirmado", title: "Pagamento confirmado", content: "O pagamento da reserva foi confirmado." },
        refused: { type: "sistema", title: "Pagamento recusado", content: "O pagamento da sua reserva não foi aprovado." },
        refunded: { type: "sistema", title: "Pagamento estornado", content: "O pagamento da reserva foi estornado." }
    };
    if (!Object.hasOwn(messages, status)) return [];
    const shoppingId = uuid.toBin(payment.id_shopping);
    const [users] = await conn.query(
        status === "refused"
            ? "SELECT BIN_TO_UUID(id_user) AS id FROM shopping WHERE id = ?"
            : `SELECT BIN_TO_UUID(id_user) AS id FROM shopping WHERE id = ?
               UNION SELECT BIN_TO_UUID(p.id_user) AS id FROM shopping_product sp
               INNER JOIN product p ON p.id = sp.id_product WHERE sp.id_shopping = ?
               UNION SELECT BIN_TO_UUID(id) AS id FROM \`user\` WHERE role = 'admin' AND status = 'active'`,
        status === "refused" ? [shoppingId] : [shoppingId, shoppingId]
    );
    const entries = [];
    for (const id_user of new Set(users.map(user => user.id))) {
        entries.push(await outbox.enqueue(conn, { id_user, ...messages[status], reference_table: "payment", reference_id: payment.id }));
    }
    return entries;
}

async function confirmed(payment) {
    try {
        const [users] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id_user) AS id FROM shopping WHERE id = ?
             UNION SELECT BIN_TO_UUID(p.id_user) AS id FROM shopping_product sp
             INNER JOIN product p ON p.id = sp.id_product WHERE sp.id_shopping = ?
             UNION SELECT BIN_TO_UUID(id) AS id FROM \`user\` WHERE role = 'admin' AND status = 'active'`,
            [uuid.toBin(payment.id_shopping), uuid.toBin(payment.id_shopping)]
        );
        for (const user of users) {
            try {
                await notifications.notifyUser({ id_user: user.id, type: "pagamento_confirmado", title: "Pagamento confirmado",
                    content: "O pagamento da reserva foi confirmado.", reference_table: "payment", reference_id: payment.id });
            } catch (error) { console.error("Falha ao notificar pagamento:", error.code || error.name); }
        }
    } catch (error) { console.error("Falha ao consultar destinatários do pagamento:", error.code || error.name); }
}

module.exports = { confirmed, enqueueTransition };
