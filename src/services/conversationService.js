const connect = require('../db/connect');
const { generateId, toBin, fromBin, isValid, ordenatePair } = require('../utils/uuid');

async function getConversationParticipants(conversationId) {
    if (!isValid(conversationId)) {
        const err = new Error('conversationId inválido.');
        err.status = 400;
        throw err;
    }

    const conversationIdBin = toBin(conversationId);

    const [rows] = await connect.promise().query(
        `SELECT BIN_TO_UUID(id_user) AS id_user
         FROM conversation_participant
         WHERE id_conversation = ?`,
        [conversationIdBin]
    );

    return rows.map((row) => String(row.id_user).toLowerCase());
}

async function userBelongsToConversation(conversationId, userId) {
    if (!isValid(conversationId) || !userId) return false;

    const conversationIdBin = toBin(conversationId);
    const userIdBin = toBin(userId);

    const [rows] = await connect.promise().query(
        `SELECT 1
         FROM conversation_participant
         WHERE id_conversation = ? AND id_user = ?
         LIMIT 1`,
        [conversationIdBin, userIdBin]
    );

    return rows.length > 0;
}

async function findConversationBetween(userIdA, userIdB) {
    if (!isValid(userIdA) || !isValid(userIdB)) {
        const err = new Error('UUID de usuário inválido.');
        err.status = 400;
        throw err;
    }

    if (String(userIdA).toLowerCase() === String(userIdB).toLowerCase()) {
        const err = new Error('Não é possível criar uma conversa consigo mesmo.');
        err.status = 400;
        throw err;
    }

    const [userA, userB] = ordenatePair(userIdA, userIdB);
    const userABin = toBin(userA);
    const userBBin = toBin(userB);

    const [rows] = await connect.promise().query(
        `SELECT BIN_TO_UUID(cp1.id_conversation) AS conversationId
         FROM conversation_participant cp1
         INNER JOIN conversation_participant cp2
             ON cp1.id_conversation = cp2.id_conversation
         WHERE cp1.id_user = ? AND cp2.id_user = ?
         LIMIT 1`,
        [userABin, userBBin]
    );

    if (rows.length === 0) return null;
    return rows[0].conversationId;
}

async function createConversationWithParticipants(userIdA, userIdB) {
    if (!isValid(userIdA) || !isValid(userIdB)) {
        const err = new Error('UUID de usuário inválido.');
        err.status = 400;
        throw err;
    }

    if (String(userIdA).toLowerCase() === String(userIdB).toLowerCase()) {
        const err = new Error('Não é possível criar uma conversa consigo mesmo.');
        err.status = 400;
        throw err;
    }

    const existing = await findConversationBetween(userIdA, userIdB);
    if (existing) {
        const err = new Error('Já existe uma conversa entre estes usuários.');
        err.status = 409;
        throw err;
    }

    const conversationId = generateId();
    const conversationIdBin = toBin(conversationId);
    const userABin = toBin(userIdA);
    const userBBin = toBin(userIdB);

    const conn = await connect.promise().getConnection();
    try {
        await conn.beginTransaction();

        await conn.query(
            `INSERT INTO conversation (id) VALUES (?)`,
            [conversationIdBin]
        );

        await conn.query(
            `INSERT INTO conversation_participant (id_conversation, id_user) VALUES (?, ?), (?, ?)`,
            [conversationIdBin, userABin, conversationIdBin, userBBin]
        );

        await conn.commit();
        return conversationId;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function getOrCreateConversation(userIdA, userIdB) {
    const existing = await findConversationBetween(userIdA, userIdB);
    if (existing) {
        return { conversationId: existing, created: false };
    }

    const conversationId = await createConversationWithParticipants(userIdA, userIdB);
    return { conversationId, created: true };
}

async function listConversationsForUser(userId) {
    if (!isValid(userId)) {
        const err = new Error('UUID de usuário inválido.');
        err.status = 400;
        throw err;
    }

    const userIdBin = toBin(userId);

    const [rows] = await connect.promise().query(
        `SELECT 
            BIN_TO_UUID(c.id) AS conversationId,
            c.created_in,
            c.updated_in,
            BIN_TO_UUID(c.id_last_message) AS id_last_message,
            BIN_TO_UUID(otherCp.id_user) AS otherUserId,
            otherUser.name AS otherUserName,
            otherUser.photo AS otherUserPhoto,
            otherUser.role AS otherUserRole,
            (SELECT COUNT(*)
               FROM message m
               WHERE m.id_conversation = c.id
                 AND m.id_user != ?
                 AND m.deleted_in IS NULL
                 AND (cp.id_last_read_message IS NULL OR m.id > cp.id_last_read_message)
            ) AS unreadCount
         FROM conversation_participant cp
         INNER JOIN conversation c ON c.id = cp.id_conversation
         INNER JOIN conversation_participant otherCp ON otherCp.id_conversation = c.id AND otherCp.id_user != cp.id_user
         INNER JOIN user otherUser ON otherUser.id = otherCp.id_user
         WHERE cp.id_user = ?
         ORDER BY c.updated_in DESC`,
        [userIdBin, userIdBin]
    );

    return rows;
}

async function leaveConversation(conversationId, userId) {
    if (!isValid(conversationId) || !userId) {
        const err = new Error('conversationId ou userId inválido.');
        err.status = 400;
        throw err;
    }

    const conversationIdBin = toBin(conversationId);
    const userIdBin = toBin(userId);

    const belongs = await userBelongsToConversation(conversationId, userId);
    if (!belongs) {
        const err = new Error('Você não participa desta conversa.');
        err.status = 403;
        throw err;
    }

    const conn = await connect.promise().getConnection();
    try {
        await conn.beginTransaction();

        await conn.query(
            `DELETE FROM conversation_participant WHERE id_conversation = ? AND id_user = ?`,
            [conversationIdBin, userIdBin]
        );

        const [countRows] = await conn.query(
            `SELECT COUNT(*) AS total FROM conversation_participant WHERE id_conversation = ?`,
            [conversationIdBin]
        );

        const total = countRows[0] ? countRows[0].total : 0;

        if (Number(total) === 0) {
            await conn.query(
                `DELETE FROM conversation WHERE id = ?`,
                [conversationIdBin]
            );
        }

        await conn.commit();
        return { left: true, deletedConversation: Number(total) === 0 };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    getConversationParticipants,
    userBelongsToConversation,
    findConversationBetween,
    createConversationWithParticipants,
    getOrCreateConversation,
    listConversationsForUser,
    leaveConversation
};
