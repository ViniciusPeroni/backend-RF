const logService = require('../services/logService');
const { isValid } = require('../utils/uuid');

const createLog = async (req, res) => {
    const { reference_id, status, operation, table } = req.body;

    if (!reference_id || !status || !operation || !table) {
        return res.status(400).json({ error: 'reference_id, status, operation e table são obrigatórios.' });
    }

    if (!isValid(reference_id)) {
        return res.status(400).json({ error: 'reference_id inválido.' });
    }

    try {
        const id = await logService.createLog({ reference_id, status, operation, table });

        return res.status(201).json({ message: 'Log registrado com sucesso.', id });
    } catch (err) {
        return res.status(500).json({ error: 'Erro ao registrar o log.' });
    }
};

const listLogs = async (req, res) => {
    const { reference_id, status, operation, table } = req.query;

    if (reference_id && !isValid(reference_id)) {
        return res.status(400).json({ error: 'reference_id inválido.' });
    }

    try {
        const logs = await logService.listLogs({ reference_id, status, operation, table });

        return res.status(200).json(logs);
    } catch (err) {
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
        return res.status(500).json({ error: 'Erro ao buscar o log.' });
    }
};

const updateLog = async (req, res) => {
    const { id } = req.params;
    const { status, operation, table } = req.body;

    if (!isValid(id)) {
        return res.status(400).json({ error: 'ID do log inválido.' });
    }

    if (status === undefined && operation === undefined && table === undefined) {
        return res.status(400).json({ error: 'Informe ao menos um campo para atualizar: status, operation ou table.' });
    }

    try {
        const log = await logService.updateLog(id, { status, operation, table });

        if (!log) return res.status(404).json({ error: 'Log não encontrado.' });

        return res.status(200).json({ message: 'Log atualizado com sucesso.', log });
    } catch (err) {
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
        return res.status(500).json({ error: 'Erro ao excluir o log.' });
    }
};

module.exports = { createLog, listLogs, getLogById, updateLog, deleteLog };
