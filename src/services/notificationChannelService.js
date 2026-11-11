const { generateId, toBin } = require('../utils/uuid');
const transport = require('./notificationTransportService');
const preferences = require('./notificationPreferencesService');
const crypto = require('node:crypto');
const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 300;
const db = () => require('../db/connect').promise();

function emailTarget(address) {
    return `email:${crypto.createHash('sha256').update(String(address).trim().toLowerCase()).digest('hex')}`;
}

async function enqueueDeliveries(conn, notification) {
    if (!transport.enabled('email') && !transport.enabled('push')) return 0;
    // A conexão é a mesma do INSERT notification: rollback também remove entregas.
    // O lock serializa opt-out e cadastro de dispositivos com este snapshot.
    const [rows] = await conn.query(`SELECT u.email AS address, COALESCE(p.email, FALSE) AS email, COALESCE(p.push, FALSE) AS push
        FROM \`user\` u LEFT JOIN notification_preferences p ON p.id_user = u.id
        WHERE u.id = ? AND u.status = 'active' FOR UPDATE`, [toBin(notification.id_user)]);
    if (!rows.length) return 0;
    const targets = [];
    if (transport.enabled('email') && rows[0].email) targets.push({ channel: 'email', key: emailTarget(rows[0].address) });
    if (transport.enabled('push') && rows[0].push) {
        const [devices] = await conn.query(`SELECT BIN_TO_UUID(id) AS id, token_hash FROM notification_device
            WHERE id_user = ? AND active = TRUE`, [toBin(notification.id_user)]);
        for (const device of devices) targets.push({ channel: 'push', key: `${device.id}:${device.token_hash}`, device });
    }
    let added = 0;
    for (const target of targets) {
        const [result] = await conn.query(`INSERT INTO notification_delivery
            (id, id_notification, id_user, channel, target_key, id_device, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE id = id`, [toBin(generateId()), toBin(notification.id), toBin(notification.id_user),
            target.channel, target.key, target.device ? toBin(target.device.id) : null, target.device?.token_hash || null]);
        if (result.affectedRows === 1) added += 1;
    }
    return added;
}

async function claimDelivery() {
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();
        // Um processo interrompido na última tentativa deixa dead-letter, nunca some.
        await conn.query(`UPDATE notification_delivery SET state = 'failed', last_error = 'LEASE_EXHAUSTED', lease_token = NULL, lease_until = NULL
            WHERE attempts >= ? AND (state = 'pending' OR (state = 'processing' AND lease_until <= NOW(3)))`, [MAX_ATTEMPTS]);
        const [rows] = await conn.query(`SELECT BIN_TO_UUID(id) AS id, attempts FROM notification_delivery
            WHERE attempts < ? AND ((state = 'pending' AND next_attempt_at <= NOW(3)) OR (state = 'processing' AND lease_until <= NOW(3)))
            ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`, [MAX_ATTEMPTS]);
        if (!rows.length) { await conn.commit(); return null; }
        const row = { ...rows[0], lease: generateId(), attempts: Number(rows[0].attempts) + 1 };
        await conn.query(`UPDATE notification_delivery SET state = 'processing', attempts = attempts + 1,
            lease_token = ?, lease_until = DATE_ADD(NOW(3), INTERVAL ? SECOND) WHERE id = ?`, [toBin(row.lease), LEASE_SECONDS, toBin(row.id)]);
        await conn.commit();
        return row;
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
}

async function currentTarget(row) {
    const [targets] = await db().query(`SELECT d.channel, d.target_key, d.token_hash, BIN_TO_UUID(d.id_user) AS id_user,
        BIN_TO_UUID(d.id_device) AS id_device, u.email AS address, v.token_encrypted,
        u.status, p.email AS email_enabled, p.push AS push_enabled, v.active AS device_active,
        (n.id IS NOT NULL) AS notification_exists
        FROM notification_delivery d
        LEFT JOIN \`user\` u ON u.id = d.id_user
        LEFT JOIN notification_preferences p ON p.id_user = d.id_user
        LEFT JOIN notification n ON n.id = d.id_notification AND n.id_user = d.id_user
        LEFT JOIN notification_device v ON v.id = d.id_device AND v.id_user = d.id_user AND v.token_hash = d.token_hash
        WHERE d.id = ? AND d.state = 'processing' AND d.lease_token = ? AND d.lease_until > NOW(3)`, [toBin(row.id), toBin(row.lease)]);
    return targets[0];
}

async function finish(row, state, code = null) {
    const backoff = Math.min(3600, 30 * (2 ** Math.max(0, row.attempts - 1)));
    const [result] = await db().query(`UPDATE notification_delivery SET state = ?, last_error = ?, lease_token = NULL, lease_until = NULL,
        next_attempt_at = DATE_ADD(NOW(3), INTERVAL ? SECOND) WHERE id = ? AND state = 'processing' AND lease_token = ?`,
    [state, code, backoff, toBin(row.id), toBin(row.lease)]);
    return result.affectedRows > 0;
}

const SAFE_CODES = new Set(['CHANNEL_DISABLED', 'SMTP_CONFIGURATION', 'EMAIL_INVALID', 'SMTP_REJECTED', 'SMTP_TRANSIENT',
    'FCM_CONFIGURATION', 'FCM_UNREGISTERED', 'FCM_INVALID_ARGUMENT', 'FCM_INVALID_REQUEST', 'FCM_TRANSIENT',
    'NOTIFICATION_KEY_UNAVAILABLE', 'NOTIFICATION_TOKEN_INVALID']);

async function retryDeliveries({ limit = 20 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('limit deve estar entre 1 e 100.');
    const result = { processed: 0, delivered: 0, skipped: 0, rescheduled: 0, failed: 0 };
    // Reserva individual evita expirar lease dos últimos itens de um lote lento.
    for (let index = 0; index < limit; index += 1) {
        const row = await claimDelivery();
        if (!row) break;
        result.processed += 1;
        let target;
        try {
            target = await currentTarget(row);
            if (!target) continue; // Lease perdida: outro worker/opt-out já é dono.
            if (target.status !== 'active' || !target.notification_exists || !transport.enabled(target.channel) ||
                !target[target.channel === 'email' ? 'email_enabled' : 'push_enabled'] ||
                (target.channel === 'push' && !target.device_active) ||
                (target.channel === 'email' && target.target_key !== emailTarget(target.address))) {
                if (await finish(row, 'skipped', 'NO_LONGER_ELIGIBLE')) result.skipped += 1;
                continue;
            }
            if (target.channel === 'email') await transport.sendEmail(target.address);
            else await transport.sendPush(preferences.decryptToken(target.token_encrypted));
            if (await finish(row, 'sent')) result.delivered += 1;
        } catch (error) {
            if (error.invalidToken && target?.id_device) {
                await db().query(`UPDATE notification_device SET active = FALSE WHERE id = ? AND id_user = ? AND token_hash = ?`,
                    [toBin(target.id_device), toBin(target.id_user), target.token_hash]);
            }
            const state = error.terminal || row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
            const code = SAFE_CODES.has(error.code) ? error.code : 'DELIVERY_ERROR';
            if (await finish(row, state, code)) result[state === 'failed' ? 'failed' : 'rescheduled'] += 1;
        }
    }
    return result;
}

module.exports = { enqueueDeliveries, retryDeliveries };
