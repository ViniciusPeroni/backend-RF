const { test } = require('node:test');
const assert = require('node:assert/strict');
// Chaves efêmeras: este teste não carrega o .env nem consulta dados reais.
process.env.DOCUMENT_ENC_KEY = require('node:crypto').randomBytes(32).toString('hex');
process.env.DOCUMENT_HMAC_KEY = require('node:crypto').randomBytes(32).toString('hex');
const db = require('../src/db/connect');
const otp = require('../src/services/otpService');
const outbox = require('../src/services/notificationOutboxService');
const controller = require('../src/controllers/otpController');
const uuid = require('../src/utils/uuid');
const accounts = require('../src/controllers/userController');
const doc = require('../src/services/docService');
const loc = require('../src/services/localizationService');

test('ativação confirma status e outbox na mesma transação antes de enviar', async () => {
    const before = { promise: db.promise, verify: otp.verifyOtp, enqueue: outbox.enqueue, flush: outbox.flush };
    const actions = [];
    const conn = {
        beginTransaction: async () => actions.push('begin'),
        query: async () => { actions.push('status'); return [{ affectedRows: 1 }]; },
        commit: async () => actions.push('commit'), rollback: async () => actions.push('rollback'),
        release: () => actions.push('release')
    };
    db.promise = () => ({ getConnection: async () => conn, query: async () => actions.push('fora-transacao') });
    otp.verifyOtp = async () => ({ valid: true });
    outbox.enqueue = async (connection, data) => {
        assert.equal(connection, conn);
        actions.push('enqueue');
        return { ...data, id: uuid.generateId() };
    };
    outbox.flush = async () => actions.push('flush');
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    try {
        await controller.verifyCode({ body: { id: uuid.generateId(), code: '123456' } }, res);
        assert.equal(res.code, 200);
        assert.deepEqual(actions, ['begin', 'status', 'enqueue', 'commit', 'release', 'flush']);
    } finally {
        db.promise = before.promise; otp.verifyOtp = before.verify;
        outbox.enqueue = before.enqueue; outbox.flush = before.flush;
    }
});

test('cadastro enfileira boas-vindas antes do commit sem depender de SMTP', async () => {
    const original = { promise: db.promise, sendOtp: otp.sendOtp, doc: doc.createDoc,
        loc: loc.createLocalization, enqueue: outbox.enqueue, flush: outbox.flush };
    const actions = [];
    const conn = {
        beginTransaction: async () => {},
        query: async (sql) => /SELECT/.test(sql) ? [[]] : [{ affectedRows: 1 }],
        commit: async () => actions.push('commit'), rollback: async () => {}, release: () => actions.push('release')
    };
    db.promise = () => ({ getConnection: async () => conn });
    otp.sendOtp = async () => actions.push('otp');
    doc.createDoc = async () => {};
    loc.createLocalization = async () => {};
    outbox.enqueue = async (connection, data) => {
        assert.equal(connection, conn);
        actions.push('enqueue');
        return { ...data, id: uuid.generateId() };
    };
    outbox.flush = async () => actions.push('flush');
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    try {
        await accounts.createUser({ body: {
            cpf: '00000000000', name: 'Fixture', email: 'fixture@example.invalid', password: 'fixture-password',
            cellphone: '11999999999', birthday: '1990-01-01', zip_code: '14400000', street: 'Fixture',
            neighborhood: 'Fixture', number: '1', city: 'Franca', state: 'SP'
        } }, res);
        assert.equal(res.code, 201);
        assert.deepEqual(actions, ['enqueue', 'commit', 'release', 'otp', 'flush']);
    } finally {
        db.promise = original.promise; otp.sendOtp = original.sendOtp; doc.createDoc = original.doc;
        loc.createLocalization = original.loc; outbox.enqueue = original.enqueue; outbox.flush = original.flush;
    }
});

test('cadastro Google confirma envelope junto com usuário e não o expõe no perfil', async () => {
    const service = require('../src/services/googleLoginService');
    const original = { promise: db.promise, enqueue: outbox.enqueue };
    const actions = [];
    const conn = {
        beginTransaction: async () => {},
        query: async (sql) => /SELECT/.test(sql) ? [[]] : [{ affectedRows: 1 }],
        commit: async () => actions.push('commit'), rollback: async () => {}, release: () => actions.push('release')
    };
    db.promise = () => ({ getConnection: async () => conn });
    outbox.enqueue = async (connection, data) => {
        assert.equal(connection, conn); actions.push('enqueue');
        return { ...data, id: uuid.generateId() };
    };
    try {
        const result = await service.findOrCreateGoogleUser({ sub: 'fixture', email: 'fixture@example.invalid', name: 'Fixture' });
        assert.deepEqual(actions, ['enqueue', 'commit', 'release']);
        assert.equal(result.notifications.length, 1);
        assert.equal(result.user.notifications, undefined);
    } finally { db.promise = original.promise; outbox.enqueue = original.enqueue; }
});
