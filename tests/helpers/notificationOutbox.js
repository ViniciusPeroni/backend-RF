const assert = require('node:assert/strict');
const outbox = require('../../src/services/notificationOutboxService');
const notifications = require('../../src/services/notificationService');
const uuid = require('../../src/utils/uuid');

async function runNotificationOutboxTests({ db, buyerId, checkAsync }) {
    const data = { id_user: buyerId, type: 'sistema', title: 'Outbox transacional', reference_table: 'outbox_test' };
    await checkAsync('outbox: rollback não deixa evento recuperável', async () => {
        const conn = await db.getConnection();
        let entry;
        try {
            await conn.beginTransaction();
            entry = await outbox.enqueue(conn, data);
            await conn.rollback();
        } finally { conn.release(); }
        const [rows] = await db.query('SELECT id FROM notification_retry WHERE id = ?', [uuid.toBin(entry.id)]);
        assert.equal(rows.length, 0);
    });

    await checkAsync('outbox: commit sem controller é recuperado pelo worker usando o mesmo UUID', async () => {
        const conn = await db.getConnection();
        let entry;
        try {
            await conn.beginTransaction();
            entry = await outbox.enqueue(conn, data);
            await conn.commit();
        } finally { conn.release(); }
        await notifications.retryPending({ limit: 1000 });
        const notification = await notifications.getNotificationById(entry.id, buyerId);
        assert.equal(notification.id, entry.id);
    });

    await checkAsync('outbox: flush imediato reutiliza UUID e remove fila sem duplicar ao repetir', async () => {
        const conn = await db.getConnection();
        let entry;
        try {
            await conn.beginTransaction();
            entry = await outbox.enqueue(conn, data);
            await conn.commit();
        } finally { conn.release(); }
        await outbox.flush([entry]);
        await outbox.flush([entry]);
        const [rows] = await db.query(
            'SELECT id FROM notification WHERE id = ? AND id_user = ?', [uuid.toBin(entry.id), uuid.toBin(buyerId)]);
        assert.equal(rows.length, 1);
        const [pending] = await db.query('SELECT id FROM notification_retry WHERE id = ?', [uuid.toBin(entry.id)]);
        assert.equal(pending.length, 0);
    });

    await checkAsync('outbox: repetição de envelope antigo não ressuscita notificação excluída', async () => {
        const conn = await db.getConnection();
        let entry;
        try {
            await conn.beginTransaction();
            entry = await outbox.enqueue(conn, data);
            await conn.commit();
        } finally { conn.release(); }
        await outbox.flush([entry]);
        assert.equal(await notifications.deleteNotification(entry.id, buyerId), true);
        await outbox.flush([entry]);
        assert.equal(await notifications.getNotificationById(entry.id, buyerId), null);
    });

    async function withPausedWorker(action) {
        const conn = await db.getConnection();
        let entry;
        try {
            await conn.beginTransaction(); entry = await outbox.enqueue(conn, data); await conn.commit();
        } finally { conn.release(); }
        const pool = require('../../src/db/connect');
        const original = pool.promise;
        let reach, resume, count = 0;
        const reached = new Promise(resolve => { reach = resolve; });
        const resumed = new Promise(resolve => { resume = resolve; });
        pool.promise = () => ({
            query: db.query.bind(db),
            getConnection: async () => {
                if (++count === 2) { reach(); await resumed; }
                return db.getConnection();
            }
        });
        const worker = notifications.retryPending({ limit: 1000 });
        let timeout;
        try {
            await Promise.race([reached, new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Worker não alcançou a barreira após claim.')), 5000);
            })]);
            pool.promise = original;
            await action(entry);
        } finally {
            clearTimeout(timeout); pool.promise = original; resume(); await worker;
        }
        return entry;
    }

    await checkAsync('outbox: worker pausado após claim não ressuscita aviso excluído por outra sessão', async () => {
        const entry = await withPausedWorker(async (envelope) => {
            await outbox.flush([envelope]);
            assert.equal(await notifications.deleteNotification(envelope.id, buyerId), true);
        });
        assert.equal(await notifications.getNotificationById(entry.id, buyerId), null);
        const [deliveries] = await db.query('SELECT id FROM notification_delivery WHERE id_notification = ?', [uuid.toBin(entry.id)]);
        assert.equal(deliveries.length, 0);
    });

    await checkAsync('outbox: worker antigo não persiste nem apaga evento com lease de outro consumidor', async () => {
        const entry = await withPausedWorker(async (envelope) => {
            await db.query('UPDATE notification_retry SET lease_id = ? WHERE id = ?', [uuid.toBin(uuid.generateId()), uuid.toBin(envelope.id)]);
        });
        assert.equal(await notifications.getNotificationById(entry.id, buyerId), null);
        const [pending] = await db.query('SELECT id FROM notification_retry WHERE id = ?', [uuid.toBin(entry.id)]);
        assert.equal(pending.length, 1);
        await db.query('UPDATE notification_retry SET next_attempt_at = NOW() WHERE id = ?', [uuid.toBin(entry.id)]);
        await notifications.retryPending();
        assert.equal((await notifications.getNotificationById(entry.id, buyerId)).id, entry.id);
    });

    await checkAsync('outbox: lease esgotada na última tentativa permanece para revisão sem envio infinito', async () => {
        const conn = await db.getConnection();
        let entry;
        try {
            await conn.beginTransaction(); entry = await outbox.enqueue(conn, data); await conn.commit();
        } finally { conn.release(); }
        await db.query('UPDATE notification_retry SET attempts = 5, next_attempt_at = NOW() WHERE id = ?', [uuid.toBin(entry.id)]);
        await notifications.retryPending();
        assert.equal(await notifications.getNotificationById(entry.id, buyerId), null);
        const [failed] = await db.query('SELECT failed_in FROM notification_retry WHERE id = ?', [uuid.toBin(entry.id)]);
        assert.ok(failed[0].failed_in);
    });

    await checkAsync('outbox: falha na leitura de duplicata após DELETE não recria evento de recuperação', async () => {
        const conn = await db.getConnection();
        let entry;
        try {
            await conn.beginTransaction(); entry = await outbox.enqueue(conn, data); await conn.commit();
        } finally { conn.release(); }
        await notifications.createNotification(entry, entry.id);
        const pool = require('../../src/db/connect');
        const original = pool.promise;
        const log = console.error;
        let reach, resume;
        const reached = new Promise(resolve => { reach = resolve; });
        const resumed = new Promise(resolve => { resume = resolve; });
        pool.promise = () => ({
            getConnection: db.getConnection.bind(db),
            query: async (sql, params) => {
                if (/FROM notification\s+WHERE id = \? AND id_user = \?/.test(sql)) { reach(); await resumed; }
                return db.query(sql, params);
            }
        });
        console.error = () => {};
        const flushing = outbox.flush([entry]);
        let timeout;
        try {
            await Promise.race([reached, new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Duplicata não alcançou barreira de leitura.')), 5000);
            })]);
            pool.promise = original;
            await notifications.deleteNotification(entry.id, buyerId);
        } finally {
            clearTimeout(timeout); pool.promise = original; resume(); await flushing; console.error = log;
        }
        const [pending] = await db.query('SELECT id FROM notification_retry WHERE id = ?', [uuid.toBin(entry.id)]);
        assert.equal(pending.length, 0);
        assert.equal(await notifications.getNotificationById(entry.id, buyerId), null);
    });
}

module.exports = { runNotificationOutboxTests };
