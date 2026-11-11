const notificationService = require('../services/notificationService');
const { isValid } = require('../utils/uuid');
const { emitToUser } = require('../sockets/notificationSocket');

const { NOTIFICATION_TYPES } = notificationService;

function validateNotification({
    type,
    title,
    content,
    reference_table,
    reference_id
}) {
    if (!type || !title) {
        return 'type e title são obrigatórios.';
    }

    if (typeof title !== 'string' || !title.trim()) {
        return 'title deve ser um texto não vazio.';
    }

    if (!NOTIFICATION_TYPES.includes(type)) {
        return `type inválido. Valores permitidos: ${NOTIFICATION_TYPES.join(', ')}.`;
    }

    if (title.length > 100) {
        return 'title deve ter no máximo 100 caracteres.';
    }

    if (content !== undefined && content !== null) {
        if (typeof content !== 'string') {
            return 'content deve ser um texto.';
        }
        if (Buffer.byteLength(content, 'utf8') > 65535) {
            return 'content deve ter no máximo 65535 bytes em UTF-8.';
        }
    }

    if (reference_table !== undefined && reference_table !== null) {
        if (typeof reference_table !== 'string' || !reference_table.trim()) {
            return 'reference_table deve ser um texto não vazio.';
        }
        if (reference_table.length > 30) {
            return 'reference_table deve ter no máximo 30 caracteres.';
        }
    }

    if (reference_id !== undefined && reference_id !== null && !isValid(reference_id)) {
        return 'reference_id inválido. Deve ser um UUID válido.';
    }

    return null;
}

const createNotification = async (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'O corpo deve ser um objeto JSON.' });
    }
    const { type, title, content, reference_table, reference_id } = req.body;

    const validationError = validateNotification({ type, title, content, reference_table, reference_id });

    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    try {
        const notification = await notificationService.notifyUser({
            id_user: req.userId,
            type,
            title,
            content,
            reference_table,
            reference_id
        });

        return res.status(201).json({
            message: 'Notificação criada com sucesso.',
            id: notification.id
        });
    } catch (err) {
        console.error('Erro em createNotification:', err);
        return res.status(500).json({ error: 'Erro ao criar notificação.' });
    }
};

const listNotifications = async (req, res) => {
    const { read, type, reference_id } = req.query;
    const reference_table = req.query.reference_table;
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;

    if (read && !['sim', 'nao'].includes(read)) {
        return res.status(400).json({ error: "read inválido. Valores permitidos: 'sim' ou 'nao'." });
    }

    if (type && !NOTIFICATION_TYPES.includes(type)) {
        return res.status(400).json({ error: 'type inválido.' });
    }

    let referenceTable;
    if (reference_table !== undefined) {
        if (typeof reference_table !== 'string' || !reference_table.trim()) {
            return res.status(400).json({ error: 'reference_table deve ser um texto não vazio.' });
        }
        referenceTable = reference_table.trim();
        if (referenceTable.length > 30) {
            return res.status(400).json({ error: 'reference_table deve ter no máximo 30 caracteres.' });
        }
    }

    if (reference_id !== undefined && !isValid(reference_id)) {
        return res.status(400).json({ error: 'reference_id inválido.' });
    }

    let limit;
    if (limitRaw !== undefined) {
        limit = Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return res.status(400).json({ error: 'limit deve ser um inteiro entre 1 e 100.' });
        }
    }

    let offset;
    if (offsetRaw !== undefined) {
        offset = Number(offsetRaw);
        if (!Number.isInteger(offset) || offset < 0 || offset > 2147483647) {
            return res.status(400).json({ error: 'offset deve ser um inteiro entre 0 e 2147483647.' });
        }
    }

    try {
        const notifications = await notificationService.listNotifications(req.userId, {
            read,
            type,
            reference_table: referenceTable,
            reference_id,
            ...(limit !== undefined ? { limit } : {}),
            ...(offset !== undefined ? { offset } : {})
        });

        return res.status(200).json(notifications);
    } catch (err) {
        console.error('Erro em listNotifications:', err);
        return res.status(500).json({ error: 'Erro ao buscar notificações.' });
    }
};

const getNotificationById = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({ error: 'ID da notificação inválido.' });
    }

    try {
        const notification = await notificationService.getNotificationById(id, req.userId);

        if (!notification) {
            return res.status(404).json({ error: 'Notificação não encontrada.' });
        }

        return res.status(200).json(notification);
    } catch (err) {
        console.error('Erro em getNotificationById:', err);
        return res.status(500).json({ error: 'Erro ao buscar notificação.' });
    }
};

const countUnread = async (req, res) => {
    try {
        const total = await notificationService.countUnread(req.userId);

        return res.status(200).json({ total });
    } catch (err) {
        console.error('Erro em countUnread:', err);
        return res.status(500).json({ error: 'Erro ao contar notificações não lidas.' });
    }
};

const markAsRead = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({ error: 'ID da notificação inválido.' });
    }

    try {
        const notification = await notificationService.markAsRead(id, req.userId);

        if (!notification) {
            return res.status(404).json({ error: 'Notificação não encontrada.' });
        }

        emitToUser(req.userId, 'notification_read', { id });

        return res.status(200).json({
            message: 'Notificação marcada como lida.',
            notification
        });
    } catch (err) {
        console.error('Erro em markAsRead:', err);
        return res.status(500).json({ error: 'Erro ao marcar notificação como lida.' });
    }
};

const markAllAsRead = async (req, res) => {
    try {
        const updated = await notificationService.markAllAsRead(req.userId);

        emitToUser(req.userId, 'notifications_read_all', { updated });

        return res.status(200).json({
            message: 'Notificações marcadas como lidas.',
            updated
        });
    } catch (err) {
        console.error('Erro em markAllAsRead:', err);
        return res.status(500).json({ error: 'Erro ao marcar notificações como lidas.' });
    }
};

const deleteNotification = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({ error: 'ID da notificação inválido.' });
    }

    try {
        const deleted = await notificationService.deleteNotification(id, req.userId);

        if (!deleted) {
            return res.status(404).json({ error: 'Notificação não encontrada.' });
        }

        emitToUser(req.userId, 'notification_deleted', { id });

        return res.status(200).json({ message: 'Notificação excluída com sucesso.' });
    } catch (err) {
        console.error('Erro em deleteNotification:', err);
        return res.status(500).json({ error: 'Erro ao excluir notificação.' });
    }
};

module.exports = {
    createNotification,
    listNotifications,
    getNotificationById,
    countUnread,
    markAsRead,
    markAllAsRead,
    deleteNotification
};
