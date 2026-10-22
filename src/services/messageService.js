const connect = require('../db/connect');
const { generateId, toBin } = require('../utils/uuid');

const MESSAGE_TYPES = ['texto', 'imagem', 'audio', 'arquivo'];

async function getConversation(conversationId) {
    const [rows] = await connect.promise().query(
        `SELECT
            BIN_TO_UUID(id) AS id,
            BIN_TO_UUID(id_user_a) AS id_user_a,
            BIN_TO_UUID(id_user_b) AS id_user_b
         FROM conversation
         WHERE id = ?`,
        [toBin(conversationId)]
    );

    if (rows.length === 0) return null;

    return rows[0];
}

async function createMessage({
    conversationId,
    id_user,
    type,
    content,
    id_answer
}) {
    const conversation = await getConversation(conversationId);

    if (!conversation) {
        const err = new Error('Conversa não encontrada.');
        err.status = 404;
        throw err;
    }

    const userId = String(id_user).toLowerCase();
    const isUserA = String(conversation.id_user_a).toLowerCase() === userId;
    const isUserB = String(conversation.id_user_b).toLowerCase() === userId;

    if (!isUserA && !isUserB) {
        const err = new Error('Usuário não participa desta conversa.');
        err.status = 403;
        throw err;
    }

    const recipient = isUserA ? conversation.id_user_b : conversation.id_user_a;
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
            toBin(conversationId),
            id_answer ? toBin(id_answer) : null
        ]
    );

    await connect.promise().query(
        `UPDATE conversation
         SET
            updated_in = NOW(),
            id_last_message = ?,
            read_by_a_until = IF(id_user_a = ?, ?, read_by_a_until),
            read_by_b_until = IF(id_user_b = ?, ?, read_by_b_until)
         WHERE id = ?`,
        [
            toBin(id),
            toBin(id_user),
            toBin(id),
            toBin(id_user),
            toBin(id),
            toBin(conversationId)
        ]
    );

    return { id, recipient };
}

module.exports = {
    MESSAGE_TYPES,
    getConversation,
    createMessage
};
