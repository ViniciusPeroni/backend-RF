const connect = require("../db/connect");
const uuid = require("../utils/uuid");
const notifications = require("./notificationService");

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

module.exports = { confirmed };
