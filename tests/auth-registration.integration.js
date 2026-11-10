// Opt-in: creates and drops its own database; SMTP and Google are test doubles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

async function run(extra) {
    if (process.env.RF_AUTH_TEST_ALLOW_DB !== '1') throw new Error('Defina RF_AUTH_TEST_ALLOW_DB=1 para usar um banco temporário.');
    const root = path.resolve(__dirname, '..');
    const local = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
    const database = `rf_auth_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    assert.match(database, /^rf_auth_test_\d+_[a-f0-9]{8}$/);
    assert.notEqual(database.toLowerCase(), String(local.DB_NAME).toLowerCase());
    const admin = await mysql.createConnection({ host: local.DB_HOST, port: Number(local.DB_PORT || 3306), user: local.DB_USER, password: local.DB_PASSWORD, multipleStatements: true });
    let created = false, server, pool;
    const google = require('google-auth-library').OAuth2Client;
    const originalGoogle = google.prototype.verifyIdToken;
    const mailPath = require.resolve('../src/utils/sendEmailOtp');
    const originalMail = require.cache[mailPath];
    const identities = new Map();
    try {
        const [exists] = await admin.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
        assert.equal(exists.length, 0);
        await admin.query(`CREATE DATABASE \`${database}\``); created = true;
        const schema = fs.readFileSync(path.join(root, 'src/mysql-init/RFScript.sql'), 'utf8').split('-- Admin padrão do sistema')[0].replace(/^DROP DATABASE[^\r\n]*;\r?$/m, '').replace(/Reaproveita_Franca/g, database);
        assert(!/DROP DATABASE|Reaproveita_Franca|INSERT INTO `user`/i.test(schema));
        await admin.query(schema);
        Object.assign(process.env, local, { DB_NAME: database, NODE_ENV: 'test', SECRET: crypto.randomBytes(32).toString('hex'), DOCUMENT_ENC_KEY: crypto.randomBytes(32).toString('hex'), DOCUMENT_HMAC_KEY: crypto.randomBytes(32).toString('hex'), GOOGLE_CLIENT_ID: 'auth-test-client.apps.googleusercontent.com' });
        require.cache[mailPath] = { id: mailPath, filename: mailPath, loaded: true, exports: async () => {} };
        google.prototype.verifyIdToken = async function ({ idToken, audience }) {
            assert.equal(audience, process.env.GOOGLE_CLIENT_ID);
            if (!identities.has(idToken)) throw new Error('Invalid test identity');
            return { getPayload: () => identities.get(idToken) };
        };
        const express = require('express');
        const app = express(); app.set('trust proxy', 'loopback'); app.use(express.json());
        app.use('/api/reaproveitafranca/user', require('../src/routes/modules/userRoutes'));
        app.use('/api/reaproveitafranca/otp', require('../src/routes/modules/otpRoutes'));
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        pool = require('../src/db/connect');
        const api = `http://127.0.0.1:${server.address().port}/api/reaproveitafranca`;
        let requestNumber = 1;
        const post = async (route, body, ip) => {
            const response = await fetch(api + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || `192.0.2.${requestNumber++}` }, body: JSON.stringify(body) });
            return { status: response.status, data: await response.json() };
        };
        const digits = length => Array.from({ length }, () => crypto.randomInt(10)).join('');
        const company = () => ({ name: 'Empresa sintética', email: `${crypto.randomUUID()}@example.invalid`, password: crypto.randomBytes(12).toString('hex'), cpf: digits(11), cnpj: digits(14), cellphone: digits(11), zip_code: '00000000', street: 'Via sintética', neighborhood: 'Bairro sintético', number: '0', city: 'Cidade sintética', state: 'SP' });
        const identity = (verified = true) => { const idToken = crypto.randomBytes(24).toString('hex'); const payload = { sub: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.invalid`, email_verified: verified }; identities.set(idToken, payload); return { idToken, payload }; };
        const normal = company();
        const signup = await post('/user/create/empresa', normal); assert.equal(signup.status, 201);
        const pendingId = signup.data.id;
        const denied = await post('/user/login', { email: normal.email, password: 'incorrect-test-password' }); assert.equal(denied.status, 401); assert.equal(denied.data.verification, undefined);
        const pending = await post('/user/login', { email: normal.email, password: normal.password }); assert.equal(pending.status, 403); assert.equal(pending.data.code, 'EMAIL_VERIFICATION_REQUIRED'); assert.equal(pending.data.verification.id, pendingId); assert.equal(pending.data.token, undefined);
        assert.equal((await post('/otp/enviar', { id: pendingId })).status, 200);
        assert.equal((await post('/otp/enviar', { id: pendingId })).status, 429);
        const [[otp]] = await admin.execute('SELECT code FROM otp WHERE user_id=UUID_TO_BIN(?) AND used=0', [pendingId]);
        assert.equal((await post('/otp/verificar', { id: pendingId, code: 'invalid' })).status, 400);
        assert.equal((await post('/otp/verificar', { id: pendingId, code: otp.code === '000000' ? '111111' : '000000' })).status, 401);
        await admin.execute('UPDATE otp SET expires_at=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id=UUID_TO_BIN(?)', [pendingId]);
        assert.equal((await post('/otp/verificar', { id: pendingId, code: otp.code })).status, 401);
        await admin.execute('UPDATE otp SET expires_at=DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE user_id=UUID_TO_BIN(?)', [pendingId]);
        assert.equal((await post('/otp/verificar', { id: pendingId, code: otp.code })).status, 200);
        assert.equal((await post('/otp/verificar', { id: pendingId, code: otp.code })).status, 403);
        assert.equal((await post('/otp/enviar', { id: pendingId })).status, 403);
        assert.equal((await post('/user/login', { email: normal.email, password: normal.password })).status, 200);
        await admin.execute("UPDATE `user` SET status='inactive' WHERE id=UUID_TO_BIN(?)", [pendingId]);
        const inactive = await post('/user/login', { email: normal.email, password: normal.password }); assert.equal(inactive.status, 403); assert.equal(inactive.data.verification, undefined);
        assert.equal((await post('/otp/verificar', { id: pendingId, code: otp.code })).status, 403);
        console.log('PASS: pending login, password check, resend cooldown, invalid code, activation, replay and inactive account.');

        const first = identity(); const googleCompany = { ...company(), idToken: first.idToken, role: 'admin' }; delete googleCompany.password;
        const googleSignup = await post('/user/create/empresa/google', googleCompany); assert.equal(googleSignup.status, 201); assert.equal(googleSignup.data.user.role, 'company'); assert.equal(googleSignup.data.user.email, first.payload.email);
        const claims = require('jsonwebtoken').verify(googleSignup.data.token, process.env.SECRET); assert.equal(claims.role, 'company');
        const [[saved]] = await admin.execute('SELECT password,status,google_id FROM `user` WHERE id=UUID_TO_BIN(?)', [claims.id]); assert.equal(saved.password, null); assert.equal(saved.status, 'active'); assert.equal(saved.google_id, first.payload.sub);
        const [[docs]] = await admin.execute('SELECT COUNT(*) AS n FROM document WHERE id_user=UUID_TO_BIN(?)', [claims.id]); assert.equal(docs.n, 2);
        const [[address]] = await admin.execute('SELECT COUNT(*) AS n FROM localization WHERE id_user=UUID_TO_BIN(?)', [claims.id]); assert.equal(address.n, 1);
        assert.equal((await post('/user/login/google', { idToken: first.idToken, accountType: 'company' })).data.user.id, claims.id);
        assert.equal((await post('/user/create/empresa/google', googleCompany)).status, 409);
        assert.equal((await post('/user/create/empresa/google', { ...company(), idToken: 'invalid-test-token' })).status, 401);
        assert.equal((await post('/user/create/empresa/google', { ...company(), idToken: identity(false).idToken })).status, 403);
        assert.equal((await post('/user/create/empresa/google', { ...company(), cpf: '', idToken: identity().idToken })).status, 400);
        const collision = identity();
        const duplicate = await post('/user/create/empresa/google', { ...company(), cpf: googleCompany.cpf, idToken: collision.idToken }); assert.equal(duplicate.status, 409);
        const [[rolledBack]] = await admin.execute('SELECT COUNT(*) AS n FROM `user` WHERE google_id=?', [collision.payload.sub]); assert.equal(rolledBack.n, 0);
        const secondDocument = identity();
        assert.equal((await post('/user/create/empresa/google', { ...company(), cnpj: googleCompany.cnpj, idToken: secondDocument.idToken })).status, 409);
        const [[secondRollback]] = await admin.execute('SELECT COUNT(*) AS n FROM `user` WHERE google_id=?', [secondDocument.payload.sub]); assert.equal(secondRollback.n, 0);
        const noPassword = company(); delete noPassword.password;
        assert.equal((await post('/user/create/empresa', { ...noPassword, idToken: identity().idToken, googleIdentity: { sub: 'forged' } })).status, 400);
        const missing = identity(); assert.equal((await post('/user/login/google', { idToken: missing.idToken, accountType: 'company' })).status, 404);
        const buyer = await post('/user/login/google', { idToken: missing.idToken }); assert.equal(buyer.data.user.role, 'user');
        assert.equal((await post('/user/create/empresa/google', { ...company(), idToken: missing.idToken })).status, 409);
        assert.equal((await post('/user/login/google', { idToken: missing.idToken, accountType: 'company' })).status, 403);
        console.log('PASS: Google company creation, verified email, forced company role, documents/address, login, duplicates, rollback and personal account preserved.');
        const rateBody = { id: crypto.randomUUID(), code: '123456' };
        for (let n = 0; n < 10; n++) assert.equal((await post('/otp/verificar', rateBody, '198.51.100.1')).status, 403);
        assert.equal((await post('/otp/verificar', rateBody, '198.51.100.1')).status, 429);
        console.log('PASS: OTP attempt limit.');
        if (extra) await extra({ api, db: admin, post, company, identity, normal, pendingId });
    } finally {
        google.prototype.verifyIdToken = originalGoogle;
        if (originalMail) require.cache[mailPath] = originalMail; else delete require.cache[mailPath];
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.promise().end();
        if (created) await admin.query(`DROP DATABASE \`${database}\``);
        await admin.end();
    }
}

module.exports = { run };
if (require.main === module) run().catch(() => { console.error('FAIL: isolated authentication integration test.'); process.exitCode = 1; });
