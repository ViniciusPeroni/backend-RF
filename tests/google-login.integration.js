'use strict';
// Isolated MySQL/HTTP tests. Google token verification is mocked ONLY in this process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { OAuth2Client } = require('google-auth-library');
const env = dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env')));
const dbName = 'rf_google_verify_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
const clientId = 'verification-only.apps.googleusercontent.com';
Object.assign(process.env, env, { DB_NAME: dbName, GOOGLE_CLIENT_ID: clientId });
const claims = new Map();
OAuth2Client.prototype.verifyIdToken = async function ({ idToken, audience }) {
    assert.equal(audience, clientId);
    if (!claims.has(idToken)) throw new Error('Invalid token in isolated verification');
    return { getPayload: () => claims.get(idToken) };
};
let db, server, pool, created = false;
const uuid = require('../src/utils/uuid');
function payload(overrides = {}) {
    return { sub: crypto.randomUUID(), email: crypto.randomUUID() + '@example.invalid', name: 'Conta sintética', email_verified: true, ...overrides };
}
let base;
async function login(value, extra = {}) {
    const response = await fetch(base + '/user/login/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: value, ...extra }) });
    return { status: response.status, body: await response.json() };
}
async function accepted(value, extra = {}) {
    const credential = crypto.randomBytes(16).toString('hex'); claims.set(credential, value);
    return login(credential, extra);
}
async function seed(value, status = 'active', role = 'user', google = null) {
    const id = uuid.generateId();
    await db.execute('INSERT INTO `user` (id,role,name,email,status,google_id) VALUES (UUID_TO_BIN(?),?,?,?,?,?)', [id, role, 'Conta sintética existente', value.email, status, google]);
    return id;
}
(async () => {
    assert(/^rf_google_verify_\d+_[a-f0-9]{6}$/.test(dbName)); assert.notEqual(dbName.toLowerCase(), String(env.DB_NAME).toLowerCase());
    db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, multipleStatements: true });
    const [existing] = await db.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [dbName]); assert.equal(existing.length, 0);
    await db.query('CREATE DATABASE `' + dbName + '`'); created = true;
    const schema = fs.readFileSync(path.join(__dirname, '../src/mysql-init/RFScript.sql'), 'utf8').replace(/^DROP DATABASE[^\r\n]*;\r?$/m, '').replace(/Reaproveita_Franca/g, dbName);
    assert(!/Reaproveita_Franca/i.test(schema)); assert(!/DROP DATABASE/i.test(schema));
    await db.query(schema);
    const limiterPath = require.resolve('../src/middlewares/rateLimit');
    const next = (req, res, next) => next();
    require.cache[limiterPath] = { id: limiterPath, filename: limiterPath, loaded: true, exports: { authLimiter: next, globalLimiter: next } };
    const app = require('../src/index'); pool = require('../src/db/connect');
    server = await new Promise(resolve => { const http = app.listen(0, '127.0.0.1', () => resolve(http)); });
    base = 'http://127.0.0.1:' + server.address().port + '/api/reaproveitafranca';
    assert.equal((await login(undefined)).status, 400); assert.equal((await login({ credential: 'invalid' })).status, 400);
    assert.equal((await login('invalid-verification')).status, 401);
    delete process.env.GOOGLE_CLIENT_ID; assert.equal((await login('invalid-verification')).status, 503); process.env.GOOGLE_CLIENT_ID = clientId;
    assert.equal((await accepted(payload({ email_verified: false }))).status, 403);
    assert.equal((await accepted(payload({ email_verified: 'true' }))).status, 403);
    console.log('PASS: malformed/invalid/unverified credentials and missing configuration; configured audience passed to Google verifier');
    const fresh = payload(); const first = await accepted(fresh, { role: 'admin' }); assert.equal(first.status, 200); assert.equal(first.body.user.role, 'user'); assert(first.body.token); assert.equal(first.body.mustChangePassword, false);
    const again = await accepted(fresh); assert.equal(again.status, 200); assert.equal(again.body.user.id.toLowerCase(), first.body.user.id.toLowerCase());
    const [stored] = await db.execute('SELECT password,cellphone,google_id FROM `user` WHERE id=UUID_TO_BIN(?)', [first.body.user.id]); assert.equal(stored[0].password, null); assert.equal(stored[0].cellphone, null); assert.equal(stored[0].google_id, fresh.sub);
    const local = payload({ hd: 'example.invalid' }); const localId = await seed(local); const linked = await accepted(local); assert.equal(linked.status, 200); assert.equal(linked.body.user.id.toLowerCase(), localId.toLowerCase());
    const company = payload({ hd: 'example.invalid' }); await seed(company, 'active', 'company'); assert.equal((await accepted(company)).body.user.role, 'company');
    const firstLogin = payload({ hd: 'example.invalid' }); await seed(firstLogin, 'firstLogin'); assert.equal((await accepted(firstLogin)).body.mustChangePassword, true);
    console.log('PASS: real account creation, returning identity, verified local-account linking, preserved company role and mandatory first access');
    const inactive = payload({ hd: 'example.invalid' }); await seed(inactive, 'inactive'); assert.equal((await accepted(inactive)).status, 403);
    const pending = payload({ hd: 'example.invalid' }); await seed(pending, 'awaitingForEmail'); assert.equal((await accepted(pending)).body.user.status, 'active');
    const conflict = payload({ hd: 'example.invalid' }); await seed(conflict, 'active', 'user', crypto.randomUUID()); assert.equal((await accepted(conflict)).status, 409);
    const thirdParty = payload(); await seed(thirdParty); assert.equal((await accepted(thirdParty)).status, 403);
    console.log('PASS: inactive accounts stay blocked; confirmed pending account activates; different provider binding and unproven third-party email linking rejected');
    const concurrent = payload(); const both = await Promise.all([accepted(concurrent), accepted(concurrent)]); assert(both.every(result => result.status === 200)); assert.equal(both[0].body.user.id.toLowerCase(), both[1].body.user.id.toLowerCase());
    const [count] = await db.execute('SELECT COUNT(*) AS total FROM `user` WHERE google_id=?', [concurrent.sub]); assert.equal(count[0].total, 1);
    console.log('PASS: concurrent sign-ins create one account. Google verifier mocked; no live OAuth claimed.');
})().catch(error => { console.error('FAIL: ' + error.name + ': ' + (error.code || 'assertion/integration check') + ' ' + String(error.stack).split('\n').filter(line => line.includes('google-login.integration.js:')).join(' ')); process.exitCode = 1; }).finally(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.promise().end();
    if (created && db && /^rf_google_verify_\d+_[a-f0-9]{6}$/.test(dbName) && dbName.toLowerCase() !== String(env.DB_NAME).toLowerCase()) { await db.query('DROP DATABASE `' + dbName + '`'); console.log('CLEANUP: isolated database removed; project database preserved'); }
    if (db) await db.end();
});
