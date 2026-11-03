const pool = require('../db/connect');
const uuid = require('../utils/uuid');

function failure(status, message) { const error = new Error(message); error.status = status; return error; }
function assertActive(user) {
    if (!['active', 'firstLogin', 'awaitingForEmail'].includes(user.status)) throw failure(403, 'Conta inativa. Entre em contato com o suporte.');
}

// Google-only flow. LinkedIn's existing helper is deliberately untouched.
async function findOrCreateGoogleUser(payload, attempt = 0) {
    const email = payload.email.trim().toLowerCase();
    const authoritativeEmail = email.endsWith('@gmail.com') || (payload.email_verified === true && typeof payload.hd === 'string' && payload.hd.length > 0);
    const connection = await pool.promise().getConnection();
    let released = false;
    try {
        await connection.beginTransaction();
        const projection = 'BIN_TO_UUID(id) AS id, role, name, email, status, google_id';
        const [linked] = await connection.query(`SELECT ${projection} FROM \`user\` WHERE google_id = ? FOR UPDATE`, [payload.sub]);
        const [matching] = linked.length ? [linked] : await connection.query(`SELECT ${projection} FROM \`user\` WHERE email = ? FOR UPDATE`, [email]);
        let user = matching[0], created = false;
        if (user) {
            assertActive(user);
            if (!linked.length) {
                if (user.google_id && user.google_id !== payload.sub) throw failure(409, 'Conta vinculada a outro acesso Google.');
                if (!authoritativeEmail) throw failure(403, 'Entre com e-mail e senha para confirmar o vínculo desta conta.');
            }
            if (!linked.length || user.status === 'awaitingForEmail') {
                await connection.query("UPDATE `user` SET google_id = ?, status = CASE WHEN status = 'awaitingForEmail' THEN 'active' ELSE status END WHERE id = ?", [payload.sub, uuid.toBin(user.id)]);
                if (user.status === 'awaitingForEmail') user.status = 'active';
            }
        } else {
            const id = uuid.generateId();
            const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 100) : email.split('@')[0].slice(0, 100);
            await connection.query("INSERT INTO `user` (id, role, name, email, password, cellphone, status, google_id) VALUES (?, 'user', ?, ?, NULL, NULL, 'active', ?)", [uuid.toBin(id), name, email, payload.sub]);
            user = { id, role: 'user', name, email, status: 'active' }; created = true;
        }
        await connection.commit();
        const { google_id, ...safeUser } = user;
        return { user: safeUser, created };
    } catch (error) {
        await connection.rollback();
        if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK'].includes(error.code) && attempt < 2) {
            connection.release(); released = true;
            return findOrCreateGoogleUser(payload, attempt + 1);
        }
        throw error;
    } finally {
        if (!released) connection.release();
    }
}
module.exports = { findOrCreateGoogleUser };
