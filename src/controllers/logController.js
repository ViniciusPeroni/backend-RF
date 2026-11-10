const logService = require('../services/logService');
const { isValid } = require('../utils/uuid');

const MAX_STATUS = 50;
const MAX_OPERATION = 20;
const MAX_TABLE = 20;
const MAX_DESCRIPTION = 255;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;

function trimText(value) {
    return typeof value === 'string' ? value.trim() : value;
}

// Somente os campos da tabela `log` são aceitos no corpo. `id`, `datetime`,
// `ip` e `user_agent` nunca vêm do cliente.
function normalizeLogInput(body = {}) {
    const input = {};

    if (body.reference_id !== undefined) input.reference_id = trimText(body.reference_id);
    if (body.id_user !== undefined) input.id_user = trimText(body.id_user);
    if (body.status !== undefined) input.status = trimText(body.status);
    if (body.operation !== undefined) input.operation = trimText(body.operation);
    if (body.table !== undefined) input.table = trimText(body.table);
    if (body.description !== undefined) input.description = trimText(body.description);

    return input;
}

function validateTextField(value, field, maxLength) {
    if (typeof value !== 'string' || value.length === 0) {
        return `${field} é obrigatório.`;
    }

    if (value.length > maxLength) {
        return `${field} deve ter no máximo ${maxLength} caracteres.`;
    }

    return null;
}

function validateDescription(value) {
    if (value === undefined || value === null) return null;

    if (typeof value !== 'string') {
        return 'description deve ser um texto.';
    }

    if (value.length > MAX_DESCRIPTION) {
        return `description deve ter no máximo ${MAX_DESCRIPTION} caracteres.`;
    }

    return null;
}

function validateCreateLog(log) {
    if (log.reference_id !== undefined && log.reference_id !== null && !isValid(log.reference_id)) {
        return 'reference_id inválido.';
    }

    if (log.id_user !== undefined && log.id_user !== null && !isValid(log.id_user)) {
        return 'id_user inválido.';
    }

    return (
        validateTextField(log.status, 'status', MAX_STATUS) ||
        validateTextField(log.operation, 'operation', MAX_OPERATION) ||
        validateTextField(log.table, 'table', MAX_TABLE) ||
        validateDescription(log.description)
    );
}

function validateUpdateLog(changes) {
    if (Object.keys(changes).length === 0) {
        return 'Informe ao menos um campo para atualizar: status, operation, table ou description.';
    }

    if (changes.status !== undefined) {
        const error = validateTextField(changes.status, 'status', MAX_STATUS);
        if (error) return error;
    }

    if (changes.operation !== undefined) {
        const error = validateTextField(changes.operation, 'operation', MAX_OPERATION);
        if (error) return error;
    }

    if (changes.table !== undefined) {
        const error = validateTextField(changes.table, 'table', MAX_TABLE);
        if (error) return error;
    }

    return validateDescription(changes.description);
}

// Converte `from`/`to` em DATETIME aceito pelo MySQL. Datas sem hora usam
// início do dia em `from` e fim do dia em `to`, para o filtro ser inclusivo.
function normalizeDateFilter(value, boundary) {
    if (value === undefined || value === null || value === '') return { value: null };

    if (typeof value !== 'string') {
        return { error: 'from e to devem ser textos no formato YYYY-MM-DD ou YYYY-MM-DD HH:MM:SS.' };
    }

    const trimmed = value.trim();
    let normalized;

    if (DATE_ONLY.test(trimmed)) {
        normalized = `${trimmed} ${boundary === 'end' ? '23:59:59' : '00:00:00'}`;
    } else if (DATE_TIME.test(trimmed)) {
        normalized = trimmed.replace('T', ' ');
    } else {
        return { error: 'from e to devem ser textos no formato YYYY-MM-DD ou YYYY-MM-DD HH:MM:SS.' };
    }

    const parsed = new Date(normalized.replace(' ', 'T'));

    if (Number.isNaN(parsed.getTime())) {
        return { error: 'from ou to contém uma data inválida.' };
    }

    return { value: normalized };
}

function parseInteger(value) {
    if (value === undefined || value === null || value === '') return undefined;

    if (typeof value === 'number' && Number.isInteger(value)) return value;

    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        return Number(value.trim());
    }

    return NaN;
}

function validatePagination(limit, offset) {
    if (limit !== undefined) {
        if (!Number.isInteger(limit) || limit < 1 || limit > logService.MAX_LIMIT) {
            return `limit deve ser um inteiro entre 1 e ${logService.MAX_LIMIT}.`;
        }
    }

    if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
        return 'offset deve ser um inteiro maior ou igual a 0.';
    }

    return null;
}

const createLog = async (req, res) => {
    const input = normalizeLogInput(req.body);

    const validationError = validateCreateLog(input);

    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    try {
        const id = await logService.createLog({
            reference_id: input.reference_id || null,
            id_user: input.id_user || req.userId,
            status: input.status,
            operation: input.operation,
            table: input.table,
            description: input.description
        });

        return res.status(201).json({ message: 'Log registrado com sucesso.', id });
    } catch (err) {
        console.error('Erro em createLog:', err);
        return res.status(500).json({ error: 'Erro ao registrar o log.' });
    }
};

const listLogs = async (req, res) => {
    const { reference_id, id_user, status, operation, table, from, to } = req.query;

    if (reference_id && !isValid(reference_id)) {
        return res.status(400).json({ error: 'reference_id inválido.' });
    }

    if (id_user && !isValid(id_user)) {
        return res.status(400).json({ error: 'id_user inválido.' });
    }

    if (status !== undefined && (typeof status !== 'string' || status.length > MAX_STATUS)) {
        return res.status(400).json({ error: `status deve ter no máximo ${MAX_STATUS} caracteres.` });
    }

    if (operation !== undefined && (typeof operation !== 'string' || operation.length > MAX_OPERATION)) {
        return res.status(400).json({ error: `operation deve ter no máximo ${MAX_OPERATION} caracteres.` });
    }

    if (table !== undefined && (typeof table !== 'string' || table.length > MAX_TABLE)) {
        return res.status(400).json({ error: `table deve ter no máximo ${MAX_TABLE} caracteres.` });
    }

    const fromFilter = normalizeDateFilter(from, 'start');
    const toFilter = normalizeDateFilter(to, 'end');

    if (fromFilter.error || toFilter.error) {
        return res.status(400).json({ error: fromFilter.error || toFilter.error });
    }

    const limit = parseInteger(req.query.limit);
    const offset = parseInteger(req.query.offset);

    if (Number.isNaN(limit) || Number.isNaN(offset)) {
        return res.status(400).json({ error: 'limit e offset devem ser números inteiros.' });
    }

    const paginationError = validatePagination(limit, offset);

    if (paginationError) {
        return res.status(400).json({ error: paginationError });
    }

    try {
        const result = await logService.listLogs({
            reference_id: reference_id || null,
            id_user: id_user || null,
            status: status || null,
            operation: operation || null,
            table: table || null,
            from: fromFilter.value,
            to: toFilter.value,
            limit,
            offset
        });

        return res.status(200).json(result);
    } catch (err) {
        console.error('Erro em listLogs:', err);
        return res.status(500).json({ error: 'Erro ao buscar os logs.' });
    }
};

const getLogById = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({ error: 'ID do log inválido.' });
    }

    try {
        const log = await logService.getLogById(id);

        if (!log) return res.status(404).json({ error: 'Log não encontrado.' });

        return res.status(200).json(log);
    } catch (err) {
        console.error('Erro em getLogById:', err);
        return res.status(500).json({ error: 'Erro ao buscar o log.' });
    }
};

const updateLog = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({ error: 'ID do log inválido.' });
    }

    const changes = normalizeLogInput(req.body);

    delete changes.reference_id;
    delete changes.id_user;

    const validationError = validateUpdateLog(changes);

    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    try {
        const log = await logService.updateLog(id, changes);

        if (!log) return res.status(404).json({ error: 'Log não encontrado.' });

        return res.status(200).json({ message: 'Log atualizado com sucesso.', log });
    } catch (err) {
        console.error('Erro em updateLog:', err);
        return res.status(500).json({ error: 'Erro ao atualizar o log.' });
    }
};

const deleteLog = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({ error: 'ID do log inválido.' });
    }

    try {
        const deleted = await logService.deleteLog(id);

        if (!deleted) return res.status(404).json({ error: 'Log não encontrado.' });

        return res.status(200).json({ message: 'Log excluído com sucesso.' });
    } catch (err) {
        console.error('Erro em deleteLog:', err);
        return res.status(500).json({ error: 'Erro ao excluir o log.' });
    }
};

module.exports = {
    MAX_STATUS,
    MAX_OPERATION,
    MAX_TABLE,
    MAX_DESCRIPTION,
    createLog,
    listLogs,
    getLogById,
    updateLog,
    deleteLog
};
