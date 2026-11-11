const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const channels = require('../../src/services/notificationChannelService');
const preferences = require('../../src/services/notificationPreferencesService');
const transport = require('../../src/services/notificationTransportService');

// Chamado SOMENTE pela suíte principal já conectada ao banco temporário.
// Não lê .env, não abre servidor, não cria banco e substitui ambos os transportes.
async function runNotificationChannelTests({ req, checkAsync, buyerId, tokenA, tokenB, db, uuid }) {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.match(process.env.DB_NAME || '', /^rf_notification_test_[0-9a-f]{16}$/);
    const keys = ['NOTIFICATION_EMAIL_ENABLED', 'NOTIFICATION_PUSH_ENABLED', 'NOTIFICATION_TOKEN_KEY'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const originalEmail = transport.sendEmail;
    const originalPush = transport.sendPush;
    const base = '/api/reaproveitafranca/notification';
    const devices = [];
    const notificationIds = [];
    const calls = [];
    transport.sendEmail = async address => { calls.push({ channel: 'email', address }); };
    transport.sendPush = async token => { calls.push({ channel: 'push', token }); };
    Object.assign(process.env, { NOTIFICATION_EMAIL_ENABLED: 'true', NOTIFICATION_PUSH_ENABLED: 'true', NOTIFICATION_TOKEN_KEY: crypto.randomBytes(32).toString('hex') });
    const deviceId = uuid.generateId();
    const token = `synthetic-fcm-${crypto.randomUUID()}`;
    const binaryUser = uuid.toBin(buyerId);
    const preference = value => req('PUT', `${base}/preferences`, tokenA, value);
    async function register(id = uuid.generateId(), value = `synthetic-${crypto.randomUUID()}`) {
        devices.push(id);
        const response = await req('PUT', `${base}/devices/${id}`, tokenA, { token: value, platform: 'android' });
        assert.equal(response.status, 200);
        return id;
    }
    async function create({ rollback = false } = {}) {
        const id = uuid.generateId();
        notificationIds.push(id);
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query(`INSERT INTO notification (id, id_user, type, title, content) VALUES (?, ?, 'sistema', 'Privado', 'Não transmitir conteúdo livre')`, [uuid.toBin(id), binaryUser]);
            const notification = { id, id_user: buyerId, type: 'sistema', title: 'Privado', content: 'Não transmitir conteúdo livre' };
            await channels.enqueueDeliveries(conn, notification);
            // Repetição na MESMA transação não duplica destinos.
            await channels.enqueueDeliveries(conn, notification);
            if (rollback) await conn.rollback(); else await conn.commit();
        } finally { conn.release(); }
        return id;
    }
    const deliveries = async id => (await db.query('SELECT channel, state, attempts, last_error FROM notification_delivery WHERE id_notification = ?', [uuid.toBin(id)]))[0];
    const due = async id => db.query("UPDATE notification_delivery SET next_attempt_at = NOW(3) WHERE id_notification = ? AND state = 'pending'", [uuid.toBin(id)]);
    try {
        await checkAsync('canais: preferências e dispositivos exigem autenticação', async () => {
            for (const [method, path, body] of [['GET', '/preferences'], ['PUT', '/preferences', { email: true, push: true }], ['PUT', `/devices/${deviceId}`, { token, platform: 'android' }], ['DELETE', `/devices/${deviceId}`]]) {
                const response = await req(method, `${base}${path}`, null, body);
                assert.ok([401, 403].includes(response.status));
            }
        });
        await checkAsync('canais: preferências padrão não autorizam email/push e não criam fila retroativa', async () => {
            const response = await req('GET', `${base}/preferences`, tokenA);
            assert.equal(response.status, 200);
            assert.deepEqual(response.body, { email: false, push: false });
            const id = await create();
            assert.equal((await deliveries(id)).length, 0);
            assert.equal((await preference({ email: true, push: true })).status, 200);
            assert.equal((await deliveries(id)).length, 0);
        });
        await checkAsync('canais: validação estrita recusa identidade, tipo e token excessivo', async () => {
            for (const body of [{ email: true, push: 'true' }, { email: true, push: true, id_user: buyerId }, {}]) {
                assert.equal((await preference(body)).status, 400);
            }
            for (const body of [{ token, platform: 'android', id_user: buyerId }, { token: 'a'.repeat(4097), platform: 'ios' }, { token, platform: 'unknown' }]) {
                assert.equal((await req('PUT', `${base}/devices/${deviceId}`, tokenA, body)).status, 400);
            }
            assert.equal((await req('PUT', `${base}/devices/invalido`, tokenA, { token, platform: 'ios' })).status, 400);
            assert.equal((await req('DELETE', `${base}/devices/${deviceId}`, tokenA, { token })).status, 400);
        });
        await checkAsync('canais: dispositivo criptografado não expõe token nem aceita sequestro', async () => {
            await register(deviceId, token);
            const response = await req('PUT', `${base}/devices/${deviceId}`, tokenA, { token, platform: 'ios' });
            assert.equal(response.status, 200);
            assert.deepEqual(Object.keys(response.body).sort(), ['active', 'id', 'platform']);
            const [rows] = await db.query('SELECT token_encrypted, token_hash FROM notification_device WHERE id = ?', [uuid.toBin(deviceId)]);
            assert.equal(preferences.decryptToken(rows[0].token_encrypted), token);
            assert.ok(!rows[0].token_encrypted.includes(Buffer.from(token)));
            assert.equal(rows[0].token_hash, preferences.hashToken(token));
            assert.equal((await req('PUT', `${base}/devices/${deviceId}`, tokenB, { token: 'another-token', platform: 'ios' })).status, 409);
            assert.equal((await req('PUT', `${base}/devices/${uuid.generateId()}`, tokenB, { token, platform: 'ios' })).status, 409);
            assert.equal((await req('DELETE', `${base}/devices/${deviceId}`, tokenB)).status, 404);
        });
        await checkAsync('canais: rollback remove fila; commit idempotente envia email cadastrado e dispositivo snapshot', async () => {
            const rolled = await create({ rollback: true });
            assert.equal((await deliveries(rolled)).length, 0);
            const id = await create();
            assert.equal((await deliveries(id)).length, 2);
            await channels.retryDeliveries();
            assert.ok((await deliveries(id)).every(row => row.state === 'sent'));
            assert.equal(calls.filter(call => call.channel === 'push' && call.token === token).length, 1);
            const [users] = await db.query('SELECT email FROM `user` WHERE id = ?', [binaryUser]);
            assert.ok(calls.some(call => call.address === users[0].email));
            const count = calls.length;
            await channels.retryDeliveries();
            assert.equal(calls.length, count);
        });
        await checkAsync('canais: opt-out cancela fila e re-opt-in não ressuscita avisos', async () => {
            const id = await create();
            await preference({ email: false, push: false });
            await preference({ email: true, push: true });
            const count = calls.length;
            await channels.retryDeliveries();
            assert.equal(calls.length, count);
            assert.ok((await deliveries(id)).every(row => row.state === 'skipped'));
        });
        await checkAsync('canais: troca do email cadastrado não envia avisos antigos à nova caixa', async () => {
            await preference({ email: true, push: false });
            const id = await create();
            const [rows] = await db.query('SELECT email FROM `user` WHERE id = ?', [binaryUser]);
            const before = calls.length;
            try {
                await db.query('UPDATE `user` SET email = ? WHERE id = ?', [`changed-${crypto.randomUUID()}@example.invalid`, binaryUser]);
                await channels.retryDeliveries();
                assert.equal(calls.length, before);
                assert.equal((await deliveries(id))[0].state, 'skipped');
            } finally { await db.query('UPDATE `user` SET email = ? WHERE id = ?', [rows[0].email, binaryUser]); }
        });
        await checkAsync('canais: falha transitória usa backoff e preserva dead-letter no limite', async () => {
            await preference({ email: true, push: false });
            const id = await create();
            transport.sendEmail = async () => { throw Object.assign(new Error('token e conteúdo não devem vazar'), { code: 'SMTP_TRANSIENT' }); };
            await channels.retryDeliveries();
            let rows = await deliveries(id);
            assert.equal(rows[0].state, 'pending'); assert.equal(rows[0].attempts, 1);
            await channels.retryDeliveries();
            assert.equal((await deliveries(id))[0].attempts, 1);
            for (let attempt = 2; attempt <= 5; attempt++) { await due(id); await channels.retryDeliveries(); }
            rows = await deliveries(id);
            assert.equal(rows[0].state, 'failed'); assert.equal(rows[0].attempts, 5); assert.equal(rows[0].last_error, 'SMTP_TRANSIENT');
            transport.sendEmail = async address => { calls.push({ channel: 'email', address }); };
        });
        await checkAsync('canais: token FCM terminal desativa somente o dispositivo afetado', async () => {
            await preference({ email: false, push: true });
            const other = await register();
            const id = await create();
            transport.sendPush = async value => {
                if (value === token) throw Object.assign(new Error('segredo'), { code: 'FCM_UNREGISTERED', invalidToken: true, terminal: true });
                calls.push({ channel: 'push', token: value });
            };
            await channels.retryDeliveries();
            const [rows] = await db.query('SELECT BIN_TO_UUID(id) AS id, active FROM notification_device WHERE id_user = ?', [binaryUser]);
            assert.equal(rows.find(row => row.id === deviceId).active, 0);
            assert.equal(rows.find(row => row.id === other).active, 1);
            assert.deepEqual((await deliveries(id)).map(row => row.state).sort(), ['failed', 'sent']);
            transport.sendPush = async value => { calls.push({ channel: 'push', token: value }); };
        });
        await checkAsync('canais: usuário desativado não recebe tentativa pendente', async () => {
            const id = await create();
            try {
                await db.query("UPDATE `user` SET status = 'inactive' WHERE id = ?", [binaryUser]);
                const count = calls.length;
                await channels.retryDeliveries();
                assert.equal(calls.length, count);
                assert.ok((await deliveries(id)).every(row => row.state === 'skipped'));
            } finally { await db.query("UPDATE `user` SET status = 'active' WHERE id = ?", [binaryUser]); }
        });
        await checkAsync('canais: worker antigo não conclui entrega após perder lease', async () => {
            await preference({ email: true, push: false });
            const id = await create();
            transport.sendEmail = async () => {
                await db.query("UPDATE notification_delivery SET lease_token = ?, lease_until = DATE_ADD(NOW(3), INTERVAL 300 SECOND) WHERE id_notification = ?", [uuid.toBin(uuid.generateId()), uuid.toBin(id)]);
            };
            const result = await channels.retryDeliveries({ limit: 1 });
            assert.equal(result.delivered, 0);
            assert.equal((await deliveries(id))[0].state, 'processing');
            await db.query("UPDATE notification_delivery SET attempts = 5, lease_until = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id_notification = ?", [uuid.toBin(id)]);
            await channels.retryDeliveries();
            const rows = await deliveries(id);
            assert.equal(rows[0].state, 'failed'); assert.equal(rows[0].last_error, 'LEASE_EXHAUSTED');
            transport.sendEmail = async address => { calls.push({ channel: 'email', address }); };
        });
        await checkAsync('canais: desligar flag antes da tentativa suprime envio pendente', async () => {
            const id = await create();
            process.env.NOTIFICATION_EMAIL_ENABLED = 'false';
            const count = calls.length;
            try {
                await channels.retryDeliveries();
                assert.equal(calls.length, count);
                assert.ok((await deliveries(id)).every(row => row.state === 'skipped'));
            } finally { process.env.NOTIFICATION_EMAIL_ENABLED = 'true'; }
        });
        await checkAsync('canais: máximo dez dispositivos inclui inativos e logout libera posição', async () => {
            while (devices.length < 10) await register();
            assert.equal((await req('PUT', `${base}/devices/${uuid.generateId()}`, tokenA, { token: 'eleventh-synthetic-token', platform: 'web' })).status, 409);
            assert.equal((await req('DELETE', `${base}/devices/${deviceId}`, tokenA)).status, 204);
            devices.splice(devices.indexOf(deviceId), 1);
            await register();
            assert.equal((await req('GET', `${base}/devices/${devices[0]}`, tokenA)).status, 404);
        });
    } finally {
        transport.sendEmail = originalEmail; transport.sendPush = originalPush;
        for (const id of notificationIds) {
            await db.query('DELETE FROM notification_delivery WHERE id_notification = ?', [uuid.toBin(id)]);
            await db.query('DELETE FROM notification WHERE id = ?', [uuid.toBin(id)]);
        }
        for (const id of devices) await db.query('DELETE FROM notification_device WHERE id = ? AND id_user = ?', [uuid.toBin(id), binaryUser]);
        await db.query('DELETE FROM notification_preferences WHERE id_user = ?', [binaryUser]);
        for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    }
}

module.exports = { runNotificationChannelTests };
