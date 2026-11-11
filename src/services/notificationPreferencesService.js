const crypto = require('node:crypto');
const { toBin, isValid } = require('../utils/uuid');

function failure(status, code) {
    return Object.assign(new Error(code), { status, code });
}

function strictObject(body, keys) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== keys.length || !keys.every(key => Object.hasOwn(body, key))) {
        throw failure(400, 'INVALID_NOTIFICATION_INPUT');
    }
}

function validatePreferences(body) {
    strictObject(body, ['email', 'push']);
    if (typeof body.email !== 'boolean' || typeof body.push !== 'boolean') throw failure(400, 'INVALID_NOTIFICATION_INPUT');
    return { email: body.email, push: body.push };
}

function validateDevice(body) {
    strictObject(body, ['token', 'platform']);
    if (typeof body.token !== 'string' || !body.token.trim() || Buffer.byteLength(body.token, 'utf8') > 4096 ||
        /[\s\x00-\x1f\x7f]/.test(body.token) || !['android', 'ios', 'web'].includes(body.platform)) {
        throw failure(400, 'INVALID_NOTIFICATION_INPUT');
    }
    return { token: body.token, platform: body.platform };
}

function key() {
    const value = process.env.NOTIFICATION_TOKEN_KEY;
    if (!/^[a-fA-F0-9]{64}$/.test(value || '')) throw failure(503, 'NOTIFICATION_KEY_UNAVAILABLE');
    return Buffer.from(value, 'hex');
}

function encryptToken(token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
}

function decryptToken(value) {
    if (!Buffer.isBuffer(value) || value.length < 30 || value[0] !== 1) throw failure(503, 'NOTIFICATION_TOKEN_INVALID');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), value.subarray(1, 13));
    decipher.setAuthTag(value.subarray(13, 29));
    return Buffer.concat([decipher.update(value.subarray(29)), decipher.final()]).toString('utf8');
}

function hashToken(token) {
    const derived = crypto.createHmac('sha256', key()).update('notification-device-dedup-v1').digest();
    return crypto.createHmac('sha256', derived).update(token, 'utf8').digest('hex');
}

const db = () => require('../db/connect').promise();

async function getPreferences(userId) {
    const [rows] = await db().query('SELECT email, push FROM notification_preferences WHERE id_user = ?', [toBin(userId)]);
    return { email: Boolean(rows[0]?.email), push: Boolean(rows[0]?.push) };
}

async function transaction(callback) {
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();
        const result = await callback(conn);
        await conn.commit();
        return result;
    } catch (error) {
        await conn.rollback();
        if (error.code === 'ER_DUP_ENTRY') throw failure(409, 'DEVICE_CONFLICT');
        throw error;
    } finally { conn.release(); }
}

async function lockUser(conn, userId) {
    const [rows] = await conn.query('SELECT id FROM `user` WHERE id = ? AND status = \'active\' FOR UPDATE', [toBin(userId)]);
    if (!rows.length) throw failure(403, 'NOTIFICATION_USER_INACTIVE');
}

async function updatePreferences(userId, body) {
    const value = validatePreferences(body);
    return transaction(async conn => {
        await lockUser(conn, userId);
        await conn.query(`INSERT INTO notification_preferences (id_user, email, push) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE email = VALUES(email), push = VALUES(push)`, [toBin(userId), value.email, value.push]);
        for (const channel of ['email', 'push']) {
            if (!value[channel]) await conn.query(`UPDATE notification_delivery SET state = 'skipped', last_error = 'OPT_OUT', lease_token = NULL, lease_until = NULL
                WHERE id_user = ? AND channel = ? AND state IN ('pending', 'processing')`, [toBin(userId), channel]);
        }
        return value;
    });
}

async function putDevice(userId, deviceId, body) {
    if (!isValid(deviceId)) throw failure(400, 'INVALID_DEVICE_ID');
    const { token, platform } = validateDevice(body);
    const hash = hashToken(token);
    const encrypted = encryptToken(token);
    return transaction(async conn => {
        await lockUser(conn, userId);
        const [conflicts] = await conn.query(`SELECT BIN_TO_UUID(id) AS id, BIN_TO_UUID(id_user) AS id_user
            FROM notification_device WHERE id = ? OR token_hash = ? FOR UPDATE`, [toBin(deviceId), hash]);
        if (conflicts.some(row => row.id_user.toLowerCase() !== userId.toLowerCase() || row.id.toLowerCase() !== deviceId.toLowerCase())) {
            throw failure(409, 'DEVICE_CONFLICT');
        }
        if (!conflicts.length) {
            const [count] = await conn.query('SELECT COUNT(*) AS total FROM notification_device WHERE id_user = ?', [toBin(userId)]);
            if (Number(count[0].total) >= 10) throw failure(409, 'DEVICE_LIMIT_REACHED');
        }
        // Rotação ou reativação não pode entregar notificações antigas ao novo token.
        await conn.query(`UPDATE notification_delivery SET state = 'skipped', last_error = 'DEVICE_CHANGED', lease_token = NULL, lease_until = NULL
            WHERE id_device = ? AND state IN ('pending','processing') AND token_hash <> ?`, [toBin(deviceId), hash]);
        await conn.query(`INSERT INTO notification_device (id, id_user, platform, token_encrypted, token_hash) VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE platform = VALUES(platform), token_encrypted = VALUES(token_encrypted), token_hash = VALUES(token_hash), active = TRUE`,
        [toBin(deviceId), toBin(userId), platform, encrypted, hash]);
        return { id: deviceId, platform, active: true };
    });
}

async function deleteDevice(userId, deviceId) {
    if (!isValid(deviceId)) throw failure(400, 'INVALID_DEVICE_ID');
    return transaction(async conn => {
        // Desvinculação também deve funcionar para conta recém-desativada.
        const [rows] = await conn.query('SELECT id FROM `user` WHERE id = ? FOR UPDATE', [toBin(userId)]);
        if (!rows.length) throw failure(404, 'DEVICE_NOT_FOUND');
        const [result] = await conn.query('DELETE FROM notification_device WHERE id = ? AND id_user = ?', [toBin(deviceId), toBin(userId)]);
        if (!result.affectedRows) throw failure(404, 'DEVICE_NOT_FOUND');
        await conn.query(`UPDATE notification_delivery SET state = 'skipped', last_error = 'DEVICE_REMOVED', lease_token = NULL, lease_until = NULL
            WHERE id_device = ? AND id_user = ? AND state IN ('pending','processing')`, [toBin(deviceId), toBin(userId)]);
    });
}

module.exports = { validatePreferences, validateDevice, encryptToken, decryptToken, hashToken, getPreferences, updatePreferences, putDevice, deleteDevice };
