const connect = require('../db/connect');
const { generateId, toBin } = require('../utils/uuid');

const MESSAGE_TYPES = ['texto', 'imagem', 'audio', 'arquivo'];

async function createMessage({
    conversationId,
    id_user,
    type,
    content,
    id_answer
}) {
    const conversationIdBin = toBin(conversationId);
    const userId = String(id_user).toLowerCase();

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
        `SELECT BIN_TO_UUID(id_user) AS id_user
         FROM conversation_participant
         WHERE id_conversation = ?`,
        [conversationIdBin]
    );

    const participants = participantRows.map((row) => String(row.id_user).toLowerCase());

    if (!participants.includes(userId)) {
        const err = new Error('Usuário não participa desta conversa.');
        err.status = 403;
        throw err;
    }

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

module.exports = {
    MESSAGE_TYPES,
    createMessage
};
