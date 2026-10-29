const connect = require('../db/connect');
const { generateId, toBin, isValid } = require('../utils/uuid');

const MESSAGE_TYPES = ['texto', 'imagem', 'audio', 'arquivo'];

async function ensureUserBelongsToConversation(conversationId, userId) {
    if (!isValid(conversationId) || !userId) {
        const err = new Error('conversationId ou userId inválido.');
        err.status = 400;
        throw err;
    }

    const conversationIdBin = toBin(conversationId);
    const userIdBin = toBin(userId);

    const [conversationRows] = await connect.promise().query(
        'SELECT id FROM conversation WHERE id = ?',
        [conversationIdBin]
    );

    if (conversationRows.length === 0) {
        const err = new Error('Conversa não encontrada.');
        err.status = 404;
        throw err;
    }

    const [participantRows] = await connect.promise().query(
        `SELECT 1
         FROM conversation_participant
         WHERE id_conversation = ? AND id_user = ?
         LIMIT 1`,
        [conversationIdBin, userIdBin]
    );

    if (participantRows.length === 0) {
        const err = new Error('Usuário não participa desta conversa.');
        err.status = 403;
        throw err;
    }
}

async function createMessage({
    conversationId,
    id_user,
    type,
    content,
    id_answer
}) {
    const conversationIdBin = toBin(conversationId);
    const userId = String(id_user).toLowerCase();

    await ensureUserBelongsToConversation(conversationId, id_user);

    const [participantRows] = await connect.promise().query(
        `SELECT BIN_TO_UUID(id_user) AS id_user
         FROM conversation_participant
         WHERE id_conversation = ?`,
        [conversationIdBin]
    );

    const participants = participantRows.map((row) => String(row.id_user).toLowerCase());

    const recipients = participants.filter((participantId) => participantId !== userId);
    const id = generateId();

    await connect.promise().query(
        `INSERT INTO message (
            id,
            type,
            content,
            id_user,
            id_conversation,
            id_answer
        )
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
            toBin(id),
            type,
            content ?? null,
            toBin(id_user),
            conversationIdBin,
            id_answer ? toBin(id_answer) : null
        ]
    );

    await connect.promise().query(
        `UPDATE conversation
         SET
            updated_in = NOW(),
            id_last_message = ?
         WHERE id = ?`,
        [toBin(id), conversationIdBin]
    );

    await connect.promise().query(
        `UPDATE conversation_participant
         SET id_last_read_message = ?
         WHERE id_conversation = ? AND id_user = ?`,
        [toBin(id), conversationIdBin, toBin(id_user)]
    );

    return { id, recipients };
}

async function listMessages({ conversationId, userId, limit = 50, before = null }) {
    if (!isValid(conversationId) || !userId) {
        const err = new Error('conversationId ou userId inválido.');
        err.status = 400;
        throw err;
    }

    const limitNumber = Number(limit);
    const safeLimit = Number.isInteger(limitNumber) && limitNumber > 0 && limitNumber <= 100 ? limitNumber : 50;

    await ensureUserBelongsToConversation(conversationId, userId);

    const conversationIdBin = toBin(conversationId);
    const conditions = ['m.id_conversation = ?'];
    const params = [conversationIdBin];

    if (before && isValid(before)) {
        conditions.push('m.id < ?');
        params.push(toBin(before));
    }

    params.push(safeLimit);

    const [rows] = await connect.promise().query(
        `SELECT 
            BIN_TO_UUID(m.id) AS id,
            m.type,
            CASE WHEN m.deleted_in IS NOT NULL THEN NULL ELSE m.content END AS content,
            m.media IS NOT NULL AS hasMedia,
            m.created_in,
            m.edited_in,
            m.deleted_in,
            BIN_TO_UUID(m.id_user) AS id_user,
            BIN_TO_UUID(m.id_conversation) AS id_conversation,
            BIN_TO_UUID(m.id_answer) AS id_answer,
            (m.deleted_in IS NOT NULL) AS isDeleted,
            (m.edited_in IS NOT NULL AND m.deleted_in IS NULL) AS isEdited
         FROM message m
         WHERE ${conditions.join(' AND ')}
         ORDER BY m.created_in DESC
         LIMIT ?`,
        params
    );

    return rows.reverse();
}

async function markConversationAsRead({ conversationId, userId, upToMessageId = null }) {
    if (!isValid(conversationId) || !userId) {
        const err = new Error('conversationId ou userId inválido.');
        err.status = 400;
        throw err;
    }

    await ensureUserBelongsToConversation(conversationId, userId);

    const conversationIdBin = toBin(conversationId);
    const userIdBin = toBin(userId);

    if (upToMessageId && isValid(upToMessageId)) {
        await connect.promise().query(
            `UPDATE conversation_participant
             SET id_last_read_message = ?
             WHERE id_conversation = ? AND id_user = ?`,
            [toBin(upToMessageId), conversationIdBin, userIdBin]
        );
        return { success: true };
    }

    const [rows] = await connect.promise().query(
        `SELECT id
         FROM message
         WHERE id_conversation = ?
         ORDER BY created_in DESC
         LIMIT 1`,
        [conversationIdBin]
    );

    if (rows.length === 0) {
        return { success: true };
    }

    await connect.promise().query(
        `UPDATE conversation_participant
         SET id_last_read_message = ?
         WHERE id_conversation = ? AND id_user = ?`,
        [rows[0].id, conversationIdBin, userIdBin]
    );

    return { success: true };
}

async function editMessage({ messageId, userId, content }) {
    if (!isValid(messageId) || !userId) {
        const err = new Error('messageId ou userId inválido.');
        err.status = 400;
        throw err;
    }

    if (typeof content !== 'string' || !content.trim()) {
        const err = new Error('content é obrigatório.');
        err.status = 400;
        throw err;
    }

    const messageIdBin = toBin(messageId);
    const userIdBin = toBin(userId);

    const [rows] = await connect.promise().query(
        `SELECT id, id_user, id_conversation, type, deleted_in
         FROM message
         WHERE id = ?`,
        [messageIdBin]
    );

    if (rows.length === 0) {
        const err = new Error('Mensagem não encontrada.');
        err.status = 404;
        throw err;
    }

    const message = rows[0];

    if (Buffer.compare(message.id_user, userIdBin) !== 0) {
        const err = new Error('Somente o autor pode editar esta mensagem.');
        err.status = 403;
        throw err;
    }

    if (message.deleted_in) {
        const err = new Error('Não é possível editar uma mensagem excluída.');
        err.status = 400;
        throw err;
    }

    if (message.type !== 'texto') {
        const err = new Error('Somente mensagens de texto podem ser editadas.');
        err.status = 400;
        throw err;
    }

    await connect.promise().query(
        `UPDATE message
         SET content = ?, edited_in = NOW()
         WHERE id = ?`,
        [content.trim(), messageIdBin]
    );

    return {
        id: messageId,
        id_conversation: message.id_conversation,
        content: content.trim(),
        edited_in: new Date().toISOString()
    };
}

async function deleteMessage({ messageId, userId }) {
    if (!isValid(messageId) || !userId) {
        const err = new Error('messageId ou userId inválido.');
        err.status = 400;
        throw err;
    }

    const messageIdBin = toBin(messageId);
    const userIdBin = toBin(userId);

    const [rows] = await connect.promise().query(
        `SELECT id, id_user, id_conversation, deleted_in
         FROM message
         WHERE id = ?`,
        [messageIdBin]
    );

    if (rows.length === 0) {
        const err = new Error('Mensagem não encontrada.');
        err.status = 404;
        throw err;
    }

    const message = rows[0];

    if (Buffer.compare(message.id_user, userIdBin) !== 0) {
        const err = new Error('Somente o autor pode excluir esta mensagem.');
        err.status = 403;
        throw err;
    }

    if (message.deleted_in) {
        return {
            id: messageId,
            id_conversation: message.id_conversation,
            alreadyDeleted: true
        };
    }

    await connect.promise().query(
        `UPDATE message
         SET deleted_in = NOW()
         WHERE id = ?`,
        [messageIdBin]
    );

    return {
        id: messageId,
        id_conversation: message.id_conversation,
        deleted_in: new Date().toISOString()
    };
}

module.exports = {
    MESSAGE_TYPES,
    createMessage,
    listMessages,
    markConversationAsRead,
    editMessage,
    deleteMessage
};

