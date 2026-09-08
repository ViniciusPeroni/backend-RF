const connect = require('../db/connect');
const { generateId, toBin, fromBin } = require('../utils/uuid');

const SELECT_FIELDS = 'id, reference_id, status, operation, `table`, datetime';

function formatLog(row) {
    return {
        id: fromBin(row.id),
        reference_id: fromBin(row.reference_id),
        status: row.status,
        operation: row.operation,
        table: row.table,
        datetime: row.datetime
    };
}

async function createLog({ reference_id, status, operation, table }) {
    const id = generateId();

    await connect.promise().query(
        'INSERT INTO log (id, reference_id, status, operation, `table`) VALUES (?, ?, ?, ?, ?)',
        [toBin(id), toBin(reference_id), status, operation, table]
    );

    return id;
}

async function listLogs({ reference_id, status, operation, table } = {}) {
    const conditions = [];
    const params = [];

    if (reference_id) {
        conditions.push('reference_id = ?');
        params.push(toBin(reference_id));
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

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await connect.promise().query(
        `SELECT ${SELECT_FIELDS} FROM log ${where} ORDER BY datetime DESC`,
        params
    );

    return rows.map(formatLog);
}

async function getLogById(id) {
    const [rows] = await connect.promise().query(
        `SELECT ${SELECT_FIELDS} FROM log WHERE id = ?`,
        [toBin(id)]
    );

    if (rows.length === 0) return null;

    return formatLog(rows[0]);
}

async function updateLog(id, { status, operation, table }) {
    const fields = [];
    const params = [];

    if (status !== undefined) {
        fields.push('status = ?');
        params.push(status);
    }

    if (operation !== undefined) {
        fields.push('operation = ?');
        params.push(operation);
    }

    if (table !== undefined) {
        fields.push('`table` = ?');
        params.push(table);
    }

    if (fields.length === 0) return undefined;

    params.push(toBin(id));

    const [result] = await connect.promise().query(
        `UPDATE log SET ${fields.join(', ')} WHERE id = ?`,
        params
    );

    if (result.affectedRows === 0) return null;

    return getLogById(id);
}

async function deleteLog(id) {
    const [result] = await connect.promise().query(
        'DELETE FROM log WHERE id = ?',
        [toBin(id)]
    );

    return result.affectedRows > 0;
}

module.exports = { createLog, listLogs, getLogById, updateLog, deleteLog };
