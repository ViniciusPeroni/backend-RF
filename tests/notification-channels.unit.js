const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const preferences = require('../src/services/notificationPreferencesService');
const transport = require('../src/services/notificationTransportService');
const channels = require('../src/services/notificationChannelService');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const env = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });

test('preferências exigem booleanos e objeto estrito', () => {
    assert.deepEqual(preferences.validatePreferences({ email: true, push: false }), { email: true, push: false });
    for (const body of [null, [], {}, { email: 'true', push: false }, { email: true, push: true, id_user: 'x' }]) {
        assert.throws(() => preferences.validatePreferences(body), { status: 400 });
    }
});
test('dispositivo exige token limitado, plataforma válida e nenhuma identidade no corpo', () => {
    assert.deepEqual(preferences.validateDevice({ token: 'abc', platform: 'android' }), { token: 'abc', platform: 'android' });
    for (const body of [null, [], { token: 'x' }, { token: '', platform: 'ios' }, { token: 'á'.repeat(2049), platform: 'web' }, { token: 'x', platform: 'android', id_user: 'x' }, { token: 'a\nb', platform: 'ios' }]) {
        assert.throws(() => preferences.validateDevice(body), { status: 400 });
    }
});
test('AES-GCM aleatório autenticado e HMAC estável dependem somente da chave independente', () => {
    delete process.env.NOTIFICATION_TOKEN_KEY;
    process.env.DOCUMENT_ENC_KEY = 'a'.repeat(64);
    assert.throws(() => preferences.encryptToken('token'), { code: 'NOTIFICATION_KEY_UNAVAILABLE' });
    process.env.NOTIFICATION_TOKEN_KEY = crypto.randomBytes(32).toString('hex');
    const first = preferences.encryptToken('token');
    const second = preferences.encryptToken('token');
    assert.notDeepEqual(first, second);
    assert.equal(preferences.decryptToken(first), 'token');
    assert.equal(preferences.hashToken('token'), preferences.hashToken('token'));
    assert.notEqual(preferences.hashToken('token'), preferences.hashToken('other'));
    const tampered = Buffer.from(first); tampered[tampered.length - 1] ^= 1;
    assert.throws(() => preferences.decryptToken(tampered));
});
test('transportes desativados não fazem I/O', async () => {
    delete process.env.NOTIFICATION_EMAIL_ENABLED; delete process.env.NOTIFICATION_PUSH_ENABLED;
    await assert.rejects(transport.sendEmail('x@example.invalid'), { code: 'CHANNEL_DISABLED' });
    await assert.rejects(transport.sendPush('token'), { code: 'CHANNEL_DISABLED' });
});
test('SMTP usa TLS obrigatório, timeouts e somente texto genérico', async (t) => {
    Object.assign(process.env, { NOTIFICATION_EMAIL_ENABLED: 'true', NOTIFICATION_SMTP_HOST: 'smtp.example.invalid', NOTIFICATION_SMTP_PORT: '587', NOTIFICATION_SMTP_USER: 'user', NOTIFICATION_SMTP_PASS: 'secret', NOTIFICATION_EMAIL_FROM: 'app@example.invalid' });
    let options, message;
    t.mock.method(nodemailer, 'createTransport', config => { options = config; return { sendMail: async data => { message = data; return { accepted: [data.to] }; }, close() {} }; });
    await transport.sendEmail('recipient@example.invalid');
    assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true);
    assert.equal(options.tls.minVersion, 'TLSv1.2'); assert.ok(options.socketTimeout <= 15000);
    assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
    assert.equal(message.text, transport.GENERIC_TEXT); assert.equal(message.subject, 'Reaproveita Franca');
    assert.equal(message.html, undefined);
});
test('SMTP recusa credenciais incompletas antes de criar transporte', async (t) => {
    Object.assign(process.env, { NOTIFICATION_EMAIL_ENABLED: 'true', NOTIFICATION_SMTP_HOST: 'smtp.example.invalid', NOTIFICATION_SMTP_PORT: '465', NOTIFICATION_EMAIL_FROM: 'app@example.invalid' });
    delete process.env.NOTIFICATION_SMTP_USER; delete process.env.NOTIFICATION_SMTP_PASS;
    let created = false;
    t.mock.method(nodemailer, 'createTransport', () => { created = true; return { sendMail: async () => ({ accepted: ['x'] }), close() {} }; });
    await assert.rejects(transport.sendEmail('recipient@example.invalid'), { code: 'SMTP_CONFIGURATION' });
    assert.equal(created, false);
});
test('timeout SMTP destrói o socket efetivo antes de permitir retry', async (t) => {
    Object.assign(process.env, { NOTIFICATION_EMAIL_ENABLED: 'true', NOTIFICATION_SMTP_HOST: 'smtp.example.invalid', NOTIFICATION_SMTP_PORT: '587', NOTIFICATION_SMTP_USER: 'fixture', NOTIFICATION_SMTP_PASS: 'fixture', NOTIFICATION_EMAIL_FROM: 'app@example.invalid' });
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.destroy = () => { socket.destroyed = true; socket.emit('close'); };
    t.mock.method(net, 'createConnection', () => socket);
    t.mock.method(nodemailer, 'createTransport', options => ({
        sendMail: () => new Promise((resolve, reject) => {
            if (options.getSocket) options.getSocket(options, error => { if (error) reject(error); });
        }), close() {}
    }));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const rejection = assert.rejects(transport.sendEmail('recipient@example.invalid'), { code: 'SMTP_TRANSIENT' });
    t.mock.timers.tick(30001);
    await rejection;
    assert.equal(socket.destroyed, true);
});
test('FCM limita espera por ADC sem revelar erro de credencial', async (t) => {
    Object.assign(process.env, { NOTIFICATION_PUSH_ENABLED: 'true', FCM_PROJECT_ID: 'rf-project-test' });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(GoogleAuth.prototype, 'getAccessToken', () => new Promise(() => {}));
    const promise = transport.sendPush('device-test');
    const rejected = assert.rejects(promise, { code: 'FCM_TRANSIENT' });
    t.mock.timers.tick(30001);
    await rejected;
});
test('FCM usa ADC, URL fixa e payload privado; UNREGISTERED é terminal sem vazamento', async (t) => {
    Object.assign(process.env, { NOTIFICATION_PUSH_ENABLED: 'true', FCM_PROJECT_ID: 'rf-project-test' });
    t.mock.method(GoogleAuth.prototype, 'getAccessToken', async () => 'oauth-test');
    let requested;
    t.mock.method(axios, 'post', async (url, data, config) => { requested = { url, data, config }; return { status: 200 }; });
    await transport.sendPush('device-test');
    assert.equal(requested.url, 'https://fcm.googleapis.com/v1/projects/rf-project-test/messages:send');
    assert.deepEqual(requested.data, { message: { token: 'device-test', notification: { title: 'Reaproveita Franca', body: transport.GENERIC_TEXT } } });
    assert.equal(requested.config.maxRedirects, 0); assert.equal(requested.config.timeout, 10000);
    axios.post.mock.mockImplementation(async () => { throw { message: 'secret token', response: { status: 404, data: { error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } } } }; });
    await assert.rejects(transport.sendPush('device-test'), error => error.code === 'FCM_UNREGISTERED' && error.invalidToken && error.terminal && !error.message.includes('secret'));
});
test('FCM payload inválido não desativa dispositivo e 429 é transitório', async (t) => {
    Object.assign(process.env, { NOTIFICATION_PUSH_ENABLED: 'true', FCM_PROJECT_ID: 'rf-project-test' });
    t.mock.method(GoogleAuth.prototype, 'getAccessToken', async () => 'oauth-test');
    t.mock.method(axios, 'post', async () => { throw { response: { status: 400, data: { error: { status: 'INVALID_ARGUMENT' } } } }; });
    await assert.rejects(transport.sendPush('device-test'), error => error.terminal && !error.invalidToken);
    axios.post.mock.mockImplementation(async () => { throw { response: { status: 429 } }; });
    await assert.rejects(transport.sendPush('device-test'), error => !error.terminal && error.code === 'FCM_TRANSIENT');
});
test('enqueue desativado não consulta banco e limite retry é validado antes do banco', async () => {
    delete process.env.NOTIFICATION_EMAIL_ENABLED; delete process.env.NOTIFICATION_PUSH_ENABLED;
    assert.equal(await channels.enqueueDeliveries({ query() { throw Error('I/O proibido'); } }, {}), 0);
    await assert.rejects(channels.retryDeliveries({ limit: 0 }), RangeError);
});
test('enqueue fotografa apenas canais opt-in e dispositivos atuais sem copiar conteúdo', async () => {
    Object.assign(process.env, { NOTIFICATION_EMAIL_ENABLED: 'true', NOTIFICATION_PUSH_ENABLED: 'true' });
    const statements = [];
    const conn = { query: async (sql, params) => {
        statements.push({ sql, params });
        if (sql.includes('FROM `user`')) return [[{ email: 1, push: 1 }]];
        if (sql.includes('FROM notification_device')) return [[{ id: '0193a521-01a1-7000-8000-000000000003', token_hash: 'a'.repeat(64) }]];
        return [{ affectedRows: 1 }];
    } };
    const notification = { id: '0193a521-01a1-7000-8000-000000000001', id_user: '0193a521-01a1-7000-8000-000000000002', title: 'privado', content: 'segredo' };
    assert.equal(await channels.enqueueDeliveries(conn, notification), 2);
    const inserts = statements.filter(item => item.sql.includes('INSERT'));
    assert.equal(inserts.length, 2);
    assert.ok(inserts.every(item => !JSON.stringify(item.params).includes('segredo')));
});

test('retry revalida elegibilidade e faz bookkeeping com lease sem gravar erro livre', async (t) => {
    const pool = require('../src/db/connect');
    process.env.NOTIFICATION_EMAIL_ENABLED = 'true';
    const id = '0193a521-01a1-7000-8000-000000000001';
    const scenarios = [
        { target: { status: 'inactive', notification_exists: 1, email_enabled: 1 }, state: 'skipped', expectedCalls: 0 },
        { target: { status: 'active', notification_exists: 0, email_enabled: 1 }, state: 'skipped', expectedCalls: 0 },
        { target: { status: 'active', notification_exists: 1, email_enabled: 0 }, state: 'skipped', expectedCalls: 0 },
        { target: { status: 'active', notification_exists: 1, email_enabled: 1 }, state: 'sent', expectedCalls: 1 },
        { target: { status: 'active', notification_exists: 1, email_enabled: 1 }, state: 'pending', expectedCalls: 1, error: { code: 'TOKEN_SECRET', message: 'segredo' } },
        { target: { status: 'active', notification_exists: 1, email_enabled: 1 }, state: 'failed', expectedCalls: 1, attempts: 4, error: { code: 'SMTP_TRANSIENT' } },
        { target: null, state: null, expectedCalls: 0 }
    ];
    let current, selected, writes, sent;
    const fake = {
        async query(sql, params) {
            if (sql.includes('SELECT BIN_TO_UUID(id) AS id, attempts')) {
                if (selected) return [[]]; selected = true;
                return [[{ id, attempts: current.attempts || 0 }]];
            }
            if (sql.includes('SELECT d.channel')) return [current.target ? [{ channel: 'email', address: 'registered@example.invalid',
                target_key: `email:${crypto.createHash('sha256').update('registered@example.invalid').digest('hex')}`, ...current.target }] : []];
            if (sql.includes('SET state = ?')) writes.push({ sql, params });
            return [{ affectedRows: 1 }];
        },
        async getConnection() { return this; }, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}
    };
    t.mock.method(pool, 'promise', () => fake);
    t.mock.method(transport, 'sendEmail', async () => { sent++; if (current.error) throw current.error; });
    for (current of scenarios) {
        selected = false; writes = []; sent = 0;
        const result = await channels.retryDeliveries({ limit: 1 });
        assert.equal(result.processed, 1);
        assert.equal(sent, current.expectedCalls);
        if (current.state) {
            assert.equal(writes[0].params[0], current.state);
            assert.match(writes[0].sql, /lease_token = \?/);
            assert.ok(Buffer.isBuffer(writes[0].params.at(-1)));
            assert.ok(!JSON.stringify(writes[0].params).includes('segredo'));
            assert.ok(!JSON.stringify(writes[0].params).includes('TOKEN_SECRET'));
        } else assert.equal(writes.length, 0);
    }
});
