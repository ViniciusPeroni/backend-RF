const axios = require('axios');
const pool = require('../db/connect');
const uuid = require('../utils/uuid');
const imageType = require('../utils/imageType');
const notificationOutbox = require('./notificationOutboxService');

function failure(status, message) { const error = new Error(message); error.status = status; return error; }
function assertActive(user) {
    if (!['active', 'firstLogin', 'awaitingForEmail'].includes(user.status)) throw failure(403, 'Conta inativa. Entre em contato com o suporte.');
}

async function fetchGoogleAvatarBuffer(url) {
    if (typeof url !== 'string' || !url.startsWith('https://')) return null;
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000, maxContentLength: 5 * 1024 * 1024 });
        const buffer = Buffer.from(response.data);
        if (buffer.length && buffer.length <= 5 * 1024 * 1024 && imageType(buffer)) {
            return buffer;
        }
        return null;
    } catch {
        return null;
    }
}

// Google-only flow. LinkedIn's existing helper is deliberately untouched.
async function findOrCreateGoogleUser(payload, attempt = 0) {
    const email = payload.email.trim().toLowerCase();
    const authoritativeEmail = email.endsWith('@gmail.com') || (payload.email_verified === true && typeof payload.hd === 'string' && payload.hd.length > 0);
    const photoBuffer = await fetchGoogleAvatarBuffer(payload.picture);
    const connection = await pool.promise().getConnection();
    let released = false;
    try {
        await connection.beginTransaction();
        const projection = 'BIN_TO_UUID(id) AS id, role, name, email, status, photo, google_id';
        const [linked] = await connection.query(`SELECT ${projection} FROM \`user\` WHERE google_id = ? FOR UPDATE`, [payload.sub]);
        const [matching] = linked.length ? [linked] : await connection.query(`SELECT ${projection} FROM \`user\` WHERE email = ? FOR UPDATE`, [email]);
        let user = matching[0], created = false;
        const notifications = [];
        if (user) {
            assertActive(user);
            if (!linked.length) {
                if (user.google_id && user.google_id !== payload.sub) throw failure(409, 'Conta vinculada a outro acesso Google.');
                if (!authoritativeEmail) throw failure(403, 'Entre com e-mail e senha para confirmar o vínculo desta conta.');
            }
            const updateFields = [];
            const updateParams = [];

            updateFields.push('google_id = ?');
            updateParams.push(payload.sub);

            updateFields.push("status = CASE WHEN status = 'awaitingForEmail' THEN 'active' ELSE status END");

            if (!user.photo && photoBuffer) {
                updateFields.push('photo = ?');
                updateParams.push(photoBuffer);
            }

            updateParams.push(uuid.toBin(user.id));
            await connection.query(`UPDATE \`user\` SET ${updateFields.join(', ')} WHERE id = ?`, updateParams);
            if (user.status === 'awaitingForEmail') user.status = 'active';
        } else {
            const id = uuid.generateId();
            const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 100) : email.split('@')[0].slice(0, 100);
            await connection.query(
                "INSERT INTO `user` (id, role, name, email, password, cellphone, status, photo, google_id) VALUES (?, 'user', ?, ?, NULL, NULL, 'active', ?, ?)",
                [uuid.toBin(id), name, email, photoBuffer, payload.sub]
            );
            user = { id, role: 'user', name, email, status: 'active' }; created = true;
            notifications.push(await notificationOutbox.enqueue(connection, {
                id_user: id, type: 'sistema', title: 'Bem-vindo(a) ao Reaproveita Franca',
                content: 'Sua conta foi criada. Confirme seu e-mail para ativar a conta.'
            }));
        }
        await connection.commit();
        const { google_id, photo, ...safeUser } = user;
        return { user: safeUser, created, notifications };
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
