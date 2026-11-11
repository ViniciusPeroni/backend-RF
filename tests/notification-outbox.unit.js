'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const outbox = require('../src/services/notificationOutboxService');
const notifications = require('../src/services/notificationService');
const uuid = require('../src/utils/uuid');

test('enqueue usa a conexão da transação e preserva o UUID', async () => {
    const calls = [];
    const conn = { query: async (...args) => { calls.push(args); return [{ affectedRows: 1 }]; } };
    const data = { id_user: uuid.generateId(), type: 'sistema', title: 'Aviso', reference_id: uuid.generateId() };
    const entry = await outbox.enqueue(conn, data);
    assert.ok(uuid.isValid(entry.id));
    assert.equal(entry.title, data.title);
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /INSERT INTO notification_retry/);
    assert.deepEqual(calls[0][1][0], uuid.toBin(entry.id));
});

test('falha de gravação da outbox propaga para permitir rollback do domínio', async () => {
    const failure = Object.assign(new Error('indisponível'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
    await assert.rejects(outbox.enqueue({ query: async () => { throw failure; } }, {
        id_user: uuid.generateId(), type: 'sistema', title: 'Aviso'
    }), (error) => error === failure);
});

test('flush usa notifyUser com o envelope e isola falhas individuais', async () => {
    const original = notifications.notifyUser;
    const log = console.error;
    const calls = [];
    notifications.notifyUser = async (entry) => {
        calls.push(entry);
        if (calls.length === 1) throw new Error('segredo não deve aparecer no log');
    };
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    const entries = [{ id: uuid.generateId() }, { id: uuid.generateId() }];
    try {
        await outbox.flush(entries);
        assert.deepEqual(calls, entries);
        assert.equal(logs.length, 1);
        assert.ok(!logs[0].includes('segredo'));
    } finally {
        notifications.notifyUser = original;
        console.error = log;
    }
});
