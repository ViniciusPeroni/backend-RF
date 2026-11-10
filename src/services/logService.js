const connect = require('../db/connect');
const { generateId, toBin } = require('../utils/uuid');

// Campos devolvidos pela API. `id_user` pode ser NULL quando a operação não
// tem usuário autenticado (ex.: criação de conta, login, webhook).
const SELECT_FIELDS = `
    BIN_TO_UUID(id) AS id,
    BIN_TO_UUID(reference_id) AS reference_id,
    BIN_TO_UUID(id_user) AS id_user,
    status,
    operation,
    \`table\`,
    description,
    ip,
    user_agent,
    datetime
`;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const UPDATABLE_FIELDS = ['status', 'operation', 'table', 'description'];

function parsePositiveInteger(value, fallback) {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 0) return fallback;

    return parsed;
}

function normalizeLimit(limit) {
    const parsed = parsePositiveInteger(limit, DEFAULT_LIMIT);

    if (parsed < 1) return DEFAULT_LIMIT;

    return Math.min(parsed, MAX_LIMIT);
}

function normalizeOffset(offset) {
    return parsePositiveInteger(offset, 0);
}

// `reference_id` e `id_user` são opcionais: nem toda operação auditada aponta
// para um registro existente (exclusões) ou tem usuário autenticado.
async function createLog({
    reference_id,
    id_user,
    status,
    operation,
    table,
    description,
    ip,
    user_agent
}, executor) {
    const id = generateId();
    const target = executor || connect.promise();

    await target.query(
        `INSERT INTO log (
            id,
            reference_id,
            id_user,
            status,
            operation,
            \`table\`,
            description,
            ip,
            user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            toBin(id),
            reference_id ? toBin(reference_id) : null,
            id_user ? toBin(id_user) : null,
            status,
            operation,
            table,
            description || null,
            ip || null,
            user_agent || null
        ]
    );

    return id;
}

async function listLogs({
    reference_id,
    id_user,
    status,
    operation,
    table,
    from,
    to,
    limit,
    offset
} = {}) {
    const conditions = [];
    const params = [];

    if (reference_id) {
        conditions.push('reference_id = ?');
        params.push(toBin(reference_id));
    }

    if (id_user) {
        conditions.push('id_user = ?');
        params.push(toBin(id_user));
    }

    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }

    if (operation) {
        conditions.push('operation = ?');
        params.push(operation);
    }

    if (table) {
        conditions.push('`table` = ?');
        params.push(table);
    }

    if (from) {
        conditions.push('datetime >= ?');
        params.push(from);
    }

    if (to) {
        conditions.push('datetime <= ?');
        params.push(to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeLimit = normalizeLimit(limit);
    const safeOffset = normalizeOffset(offset);

    const [countRows] = await connect.promise().query(
        `SELECT COUNT(*) AS total FROM log ${where}`,
        params
    );

    const [rows] = await connect.promise().query(
        `SELECT ${SELECT_FIELDS}
         FROM log
         ${where}
         ORDER BY datetime DESC, id DESC
         LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        params
    );

    return {
        total: Number(countRows[0].total),
        limit: safeLimit,
        offset: safeOffset,
        logs: rows
    };
}

async function getLogById(id) {
    const [rows] = await connect.promise().query(
        `SELECT ${SELECT_FIELDS} FROM log WHERE id = ?`,
        [toBin(id)]
    );

    if (rows.length === 0) return null;

    return rows[0];
}

async function updateLog(id, changes = {}) {
    const columns = UPDATABLE_FIELDS.filter((field) => changes[field] !== undefined);

    if (columns.length === 0) return undefined;

    const assignments = columns.map((field) => `${field === 'table' ? '`table`' : field} = ?`).join(', ');
    const params = columns.map((field) => changes[field]);

    await connect.promise().query(
        `UPDATE log SET ${assignments} WHERE id = ?`,
        [...params, toBin(id)]
    );

    // `affectedRows` é 0 tanto para ID inexistente quanto para UPDATE que não
    // mudou valores; a leitura final diferencia 404 de "sem mudança".
    return getLogById(id);
}

async function deleteLog(id) {
    const [result] = await connect.promise().query(
        'DELETE FROM log WHERE id = ?',
        [toBin(id)]
    );

    return result.affectedRows > 0;
}

module.exports = {
    DEFAULT_LIMIT,
    MAX_LIMIT,
    createLog,
    listLogs,
    getLogById,
    updateLog,
    deleteLog
};
