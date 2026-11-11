const connect = require('../db/connect');
const { generateId, toBin } = require('../utils/uuid');
const { emitToUser } = require('../sockets/notificationSocket');

const NOTIFICATION_TYPES = [
    'reserva_solicitada',
    'reserva_aceita',
    'reserva_recusada',
    'pagamento_confirmado',
    'nova_mensagem',
    'nova_review',
    'disputa_aberta',
    'disputa_resolvida',
    'sistema'
];

const SELECT_FIELDS = `
    BIN_TO_UUID(id) AS id,
    type,
    title,
    content,
    reference_table,
    BIN_TO_UUID(reference_id) AS reference_id,
    \`read\`,
    created_in,
    read_in,
    BIN_TO_UUID(id_user) AS id_user
`;

const RETRY_DEFAULT_LIMIT = 20;
const RETRY_DEFAULT_MAX_ATTEMPTS = 5;
const RETRY_MAX_BACKOFF_SECONDS = 300;

async function createNotification(data, id = generateId(), { requireOutbox = false, leaseId = null } = {}) {
    const {
        id_user,
        type,
        title,
        content,
        reference_table,
        reference_id
    } = data;

    const conn = await connect.promise().getConnection();
    let duplicate = false;
    try {
        await conn.beginTransaction();
        if (requireOutbox) {
            // Mesma ordem de locks do DELETE. Um snapshot de worker/flush não
            // autoriza recriar um aviso cujo evento já foi removido/cancelado.
            const [pending] = await conn.query(
                'SELECT lease_id FROM notification_retry WHERE id = ? AND id_user = ? FOR UPDATE',
                [toBin(id), toBin(id_user)]
            );
            if (!pending.length) {
                const [existing] = await conn.query('SELECT id FROM notification WHERE id = ? AND id_user = ? FOR UPDATE',
                    [toBin(id), toBin(id_user)]);
                await conn.commit();
                return existing.length ? id : null;
            }
            if (leaseId && (!pending[0].lease_id || !pending[0].lease_id.equals(toBin(leaseId)))) {
                await conn.commit();
                return null;
            }
        }
        // INSERT e fila de canais confirmam juntos. Uma duplicata usa o mesmo
        // UUID da outbox, sem criar novos avisos nem reativar canais antigos.
        await conn.query(
        `INSERT INTO notification (
            id,
            type,
            title,
            content,
            reference_table,
            reference_id,
            id_user
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            toBin(id),
            type,
            title,
            content || null,
            reference_table || null,
            reference_id ? toBin(reference_id) : null,
            toBin(id_user)
        ]
        );
        const [rows] = await conn.query(`SELECT ${SELECT_FIELDS} FROM notification WHERE id = ?`, [toBin(id)]);
        await require('./notificationChannelService').enqueueDeliveries(conn, rows[0]);
        await conn.query('UPDATE notification_retry SET persisted = 1 WHERE id = ?', [toBin(id)]);
        await conn.commit();
        return id;
    } catch (error) {
        await conn.rollback();
        if (error.code === 'ER_DUP_ENTRY') duplicate = true;
        else throw error;
    } finally {
        conn.release();
    }
    if (duplicate && await getNotificationById(id, id_user)) return id;
    throw new Error('Notificação duplicada com vínculo divergente.');
}

function retryBackoffSeconds(attempts) {
    return Math.min(2 ** Math.max(attempts, 1), RETRY_MAX_BACKOFF_SECONDS);
}

function retryErrorLabel(error) {
    // Só o código/nome: mensagens de driver podem conter valores de colunas.
    return String((error && (error.code || error.name)) || 'ERRO_DESCONHECIDO').slice(0, 255);
}

function paginationLimit(limit, max = 100) {
    const value = Number(limit);

    if (!Number.isInteger(value) || value < 1 || value > max) {
        throw new RangeError(`limit deve ser um inteiro entre 1 e ${max}.`);
    }

    return value;
}

function paginationOffset(offset) {
    const value = Number(offset);

    if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
        throw new RangeError('offset deve ser um inteiro entre 0 e 2147483647.');
    }

    return value;
}

async function enqueueRetry(data, { id, persisted, error }) {
    try {
        await connect.promise().query(
            `INSERT INTO notification_retry (
                id,
                id_user,
                type,
                title,
                content,
                reference_table,
                reference_id,
                persisted,
                attempts,
                next_attempt_at,
                last_error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW(), ?)
            ON DUPLICATE KEY UPDATE
                last_error = VALUES(last_error),
                updated_in = NOW()`,
            [
                toBin(id),
                toBin(data.id_user),
                data.type,
                data.title,
                data.content || null,
                data.reference_table || null,
                data.reference_id ? toBin(data.reference_id) : null,
                persisted ? 1 : 0,
                error ? retryErrorLabel(error) : null
            ]
        );

        return true;
    } catch (enqueueError) {
        console.error('Falha ao enfileirar notificação para retry:', enqueueError.code || enqueueError.name);
        return false;
    }
}

async function notifyUser(data) {
    const id = data.id || generateId();
    let persisted = false;

    try {
        const persistedId = await createNotification(data, id, { requireOutbox: !!data.id });
        if (!persistedId) return null;
        persisted = true;

        const notification = await getNotificationById(id, data.id_user);
        emitToUser(data.id_user, 'notification', notification);
        await connect.promise().query('DELETE FROM notification_retry WHERE id = ?', [toBin(id)]);

        return notification;
    } catch (error) {
        // A falha continua visível para o chamador; a fila é só uma segunda
        // chance de entrega, nunca uma desculpa para esconder o erro.
        let queued;
        if (data.id) {
            // Envelope já durável: um DELETE concorrente pode tê-lo cancelado.
            // Não recriar a fila no catch de uma tentativa atrasada.
            try {
                const [updated] = await connect.promise().query(
                    'UPDATE notification_retry SET last_error = ? WHERE id = ? AND id_user = ?',
                    [retryErrorLabel(error), toBin(id), toBin(data.id_user)]
                );
                queued = updated.affectedRows > 0;
            } catch (queueError) {
                console.error('Falha ao atualizar evento pendente:', retryErrorLabel(queueError));
            }
        } else {
            queued = await enqueueRetry(data, { id, persisted, error });
        }
        if (queued) error.retryQueued = true;
        throw error;
    }
}

async function listNotifications(id_user, {
    read,
    type,
    reference_table,
    reference_id,
    limit = 50,
    offset = 0
} = {}) {
    const conditions = ['id_user = ?'];
    const params = [toBin(id_user)];

    if (read) {
        conditions.push('`read` = ?');
        params.push(read);
    }

    if (type) {
        conditions.push('type = ?');
        params.push(type);
    }

    if (reference_table) {
        conditions.push('reference_table = ?');
        params.push(reference_table);
    }

    if (reference_id) {
        conditions.push('reference_id = ?');
        params.push(toBin(reference_id));
    }

    const [rows] = await connect.promise().query(
        `SELECT ${SELECT_FIELDS}
         FROM notification
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_in DESC, id DESC
         LIMIT ? OFFSET ?`,
        [...params, paginationLimit(limit), paginationOffset(offset)]
    );

    return rows;
}

async function getNotificationById(id, id_user) {
    const [rows] = await connect.promise().query(
        `SELECT ${SELECT_FIELDS}
         FROM notification
         WHERE id = ? AND id_user = ?`,
        [toBin(id), toBin(id_user)]
    );

    if (rows.length === 0) return null;

    return rows[0];
}

async function countUnread(id_user) {
    const [rows] = await connect.promise().query(
        "SELECT COUNT(*) AS total FROM notification WHERE id_user = ? AND `read` = 'nao'",
        [toBin(id_user)]
    );

    return Number(rows[0].total);
}

async function markAsRead(id, id_user) {
    const notification = await getNotificationById(id, id_user);

    if (!notification) return null;

    if (notification.read !== 'sim') {
        await connect.promise().query(
            "UPDATE notification SET `read` = 'sim', read_in = NOW() WHERE id = ? AND id_user = ?",
            [toBin(id), toBin(id_user)]
        );
    }

    return getNotificationById(id, id_user);
}

async function markAllAsRead(id_user) {
    const [result] = await connect.promise().query(
        "UPDATE notification SET `read` = 'sim', read_in = NOW() WHERE id_user = ? AND `read` = 'nao'",
        [toBin(id_user)]
    );

    return result.affectedRows;
}

async function deleteNotification(id, id_user) {
    const conn = await connect.promise().getConnection();
    try {
        await conn.beginTransaction();
        // A exclusão também cancela a recuperação: não ressuscitar aviso.
        await conn.query('DELETE FROM notification_retry WHERE id = ? AND id_user = ?', [toBin(id), toBin(id_user)]);
        const [result] = await conn.query('DELETE FROM notification WHERE id = ? AND id_user = ?', [toBin(id), toBin(id_user)]);
        await conn.commit();
        return result.affectedRows > 0;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally { conn.release(); }
}

function mapRetryRow(row) {
    return {
        id: row.id,
        id_user: row.id_user,
        type: row.type,
        title: row.title,
        content: row.content,
        reference_table: row.reference_table,
        reference_id: row.reference_id,
        persisted: Boolean(row.persisted),
        attempts: Number(row.attempts)
    };
}

async function claimRetryRows(limit, maxAttempts) {
    const conn = await connect.promise().getConnection();
    let rows = [];

    try {
        await conn.beginTransaction();
        // Se o processo caiu durante a última tentativa, não enviar para sempre.
        await conn.query(`UPDATE notification_retry SET failed_in = NOW(), last_error = 'RETRY_LEASE_EXHAUSTED'
            WHERE failed_in IS NULL AND attempts >= ? AND next_attempt_at <= NOW()`, [maxAttempts]);
        const [selected] = await conn.query(
            `SELECT BIN_TO_UUID(id) AS id,
                    BIN_TO_UUID(id_user) AS id_user,
                    type,
                    title,
                    content,
                    reference_table,
                    BIN_TO_UUID(reference_id) AS reference_id,
                    persisted,
                    attempts
             FROM notification_retry
             WHERE next_attempt_at <= NOW() AND failed_in IS NULL AND attempts < ?
             ORDER BY next_attempt_at ASC
             LIMIT ?
             FOR UPDATE SKIP LOCKED`,
            [maxAttempts, limit]
        );

        rows = selected.map(mapRetryRow);

        if (rows.length > 0) {
            const leaseId = generateId();
            // Reserva a linha até o fim do processamento para outro worker
            // não pegá-la em paralelo, mesmo que este processo caia. O
            // incremento aqui também limita uma linha que derruba o processo.
            await conn.query(
                `UPDATE notification_retry
                 SET next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
                     attempts = attempts + 1, lease_id = ?
                 WHERE id IN (${rows.map(() => '?').join(', ')})`,
                [RETRY_MAX_BACKOFF_SECONDS, toBin(leaseId), ...rows.map((row) => toBin(row.id))]
            );

            for (const row of rows) { row.attempts += 1; row.lease_id = leaseId; }
        }

        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }

    return rows;
}

async function deliverRetryRow(row) {
    if (!row.persisted) {
        const persistedId = await createNotification(row, row.id, { requireOutbox: true, leaseId: row.lease_id });
        if (!persistedId) return false;
    }

    const notification = await getNotificationById(row.id, row.id_user);

    if (!notification) {
        return false; // Excluída pelo titular depois do claim.
    }

    emitToUser(row.id_user, 'notification', notification);
    return true;
}

async function retryPending({ limit = RETRY_DEFAULT_LIMIT, maxAttempts = RETRY_DEFAULT_MAX_ATTEMPTS } = {}) {
    maxAttempts = paginationLimit(maxAttempts, 100);
    const rows = await claimRetryRows(paginationLimit(limit, 1000), maxAttempts);
    const result = { processed: 0, delivered: 0, rescheduled: 0, discarded: 0, skipped: 0 };

    for (const row of rows) {
        result.processed += 1;

        try {
            const delivered = await deliverRetryRow(row);
            await connect.promise().query('DELETE FROM notification_retry WHERE id = ? AND lease_id = ?',
                [toBin(row.id), toBin(row.lease_id)]);
            if (delivered) result.delivered += 1;
            else result.skipped += 1;
        } catch (error) {
            try {
                if (row.attempts >= maxAttempts) {
                    await connect.promise().query('UPDATE notification_retry SET failed_in = NOW(), last_error = ? WHERE id = ? AND lease_id = ?',
                        [retryErrorLabel(error), toBin(row.id), toBin(row.lease_id)]);
                    console.error(`Notificação retida para revisão após ${row.attempts} tentativas:`,
                        retryErrorLabel(error));
                    result.discarded += 1;
                } else {
                    await connect.promise().query(
                        `UPDATE notification_retry
                         SET last_error = ?,
                             next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
                         WHERE id = ? AND lease_id = ?`,
                        [retryErrorLabel(error), retryBackoffSeconds(row.attempts), toBin(row.id), toBin(row.lease_id)]
                    );
                    result.rescheduled += 1;
                }
            } catch (bookkeepingError) {
                // Uma falha ao atualizar a fila não pode impedir as outras linhas.
                console.error('Falha ao atualizar a fila de notificações:',
                    retryErrorLabel(bookkeepingError));
            }
        }
    }

    return result;
}

let retryWorkerTimer = null;

function startNotificationRetryWorker({
    intervalMs = 30000,
    limit = RETRY_DEFAULT_LIMIT,
    maxAttempts = RETRY_DEFAULT_MAX_ATTEMPTS
} = {}) {
    if (retryWorkerTimer) return retryWorkerTimer;

    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;

        try {
            const result = await retryPending({ limit, maxAttempts });
            await require('./notificationChannelService').retryDeliveries({ limit });
            if (result.processed > 0) {
                console.log('Retry de notificações:', result);
            }
        } catch (error) {
            // Banco indisponível não pode derrubar o processo.
            console.error('Falha no worker de notificações:', error.code || error.message);
        } finally {
            running = false;
        }
    };

    retryWorkerTimer = setInterval(tick, intervalMs);
    if (typeof retryWorkerTimer.unref === 'function') retryWorkerTimer.unref();
    tick();

    return retryWorkerTimer;
}

function stopNotificationRetryWorker() {
    if (!retryWorkerTimer) return;
    clearInterval(retryWorkerTimer);
    retryWorkerTimer = null;
}

module.exports = {
    NOTIFICATION_TYPES,
    createNotification,
    notifyUser,
    listNotifications,
    getNotificationById,
    countUnread,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    retryPending,
    startNotificationRetryWorker,
    stopNotificationRetryWorker
};
