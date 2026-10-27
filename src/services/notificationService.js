const connect = require('../db/connect');
const { generateId, toBin } = require('../utils/uuid');
const { emitToUser } = require('../sockets/notificationSocket');

const NOTIFICATION_TYPES = [
    'reserva_solicitada',
    'reserva_aceita',
    'reserva_recusada',
    'pagamento_confirmado',
    'nova_mensagem',
    'nova_review',
    'disputa_aberta',
    'disputa_resolvida',
    'sistema'
];

const SELECT_FIELDS = `
    BIN_TO_UUID(id) AS id,
    type,
    title,
    content,
    reference_table,
    BIN_TO_UUID(reference_id) AS reference_id,
    \`read\`,
    created_in,
    read_in,
    BIN_TO_UUID(id_user) AS id_user
`;

async function createNotification({
    id_user,
    type,
    title,
    content,
    reference_table,
    reference_id
}) {
    const id = generateId();

    await connect.promise().query(
        `INSERT INTO notification (
            id,
            type,
            title,
            content,
            reference_table,
            reference_id,
            id_user
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            toBin(id),
            type,
            title,
            content || null,
            reference_table || null,
            reference_id ? toBin(reference_id) : null,
            toBin(id_user)
        ]
    );

    return id;
}

async function notifyUser(data) {
    const id = await createNotification(data);
    const notification = await getNotificationById(id, data.id_user);

    emitToUser(data.id_user, 'notification', notification);

    return notification;
}

async function listNotifications(id_user, { read, type } = {}) {
    const conditions = ['id_user = ?'];
    const params = [toBin(id_user)];

    if (read) {
        conditions.push('`read` = ?');
        params.push(read);
    }

    if (type) {
        conditions.push('type = ?');
        params.push(type);
    }

    const [rows] = await connect.promise().query(
        `SELECT ${SELECT_FIELDS}
         FROM notification
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_in DESC`,
        params
    );

    return rows;
}

async function getNotificationById(id, id_user) {
    const [rows] = await connect.promise().query(
        `SELECT ${SELECT_FIELDS}
         FROM notification
         WHERE id = ? AND id_user = ?`,
        [toBin(id), toBin(id_user)]
    );

    if (rows.length === 0) return null;

    return rows[0];
}

async function countUnread(id_user) {
    const [rows] = await connect.promise().query(
        "SELECT COUNT(*) AS total FROM notification WHERE id_user = ? AND `read` = 'nao'",
        [toBin(id_user)]
    );

    return Number(rows[0].total);
}

async function markAsRead(id, id_user) {
    const notification = await getNotificationById(id, id_user);

    if (!notification) return null;

    if (notification.read !== 'sim') {
        await connect.promise().query(
            "UPDATE notification SET `read` = 'sim', read_in = NOW() WHERE id = ? AND id_user = ?",
            [toBin(id), toBin(id_user)]
        );
    }

    return getNotificationById(id, id_user);
}

async function markAllAsRead(id_user) {
    const [result] = await connect.promise().query(
        "UPDATE notification SET `read` = 'sim', read_in = NOW() WHERE id_user = ? AND `read` = 'nao'",
        [toBin(id_user)]
    );

    return result.affectedRows;
}

async function deleteNotification(id, id_user) {
    const [result] = await connect.promise().query(
        'DELETE FROM notification WHERE id = ? AND id_user = ?',
        [toBin(id), toBin(id_user)]
    );

    return result.affectedRows > 0;
}

module.exports = {
    NOTIFICATION_TYPES,
    createNotification,
    notifyUser,
    listNotifications,
    getNotificationById,
    countUnread,
    markAsRead,
    markAllAsRead,
    deleteNotification
};
