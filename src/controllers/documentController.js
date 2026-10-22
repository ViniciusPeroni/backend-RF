const docService = require('../services/docService');
const { isValid } = require('../utils/uuid');

const createDoc = async (req, res) => {
  const { userId, docType, doc } = req.body;
  try {
    const id = await docService.createDoc({ userId, docType, doc });
    return res.status(201).json({ message: 'Documento registrado com sucesso.', id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.message === 'Documento já registrado') return res.status(409).json({ error: err.message });
    return res.status(500).json({ error: 'Erro ao registrar documento.' });
  }
};

const getDocById = async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await docService.getDocById(id);
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
    return res.status(200).json(doc);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Erro ao buscar documento.' });
  }
};

const getDocsByUser = async (req, res) => {
  const { userId } = req.params;
  try {
    const docs = await docService.listDocsByUser(userId);
    return res.status(200).json(docs);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Erro ao listar documentos do usuário.' });
  }
};

const getDecryptedDoc = async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await docService.getDecryptedDoc(id);
    if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
    return res.status(200).json({ document: doc });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Erro ao descriptografar documento.' });
  }
};

const deleteDoc = async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await docService.deleteDoc(id);
    if (!deleted) return res.status(404).json({ error: 'Documento não encontrado.' });
    return res.status(200).json({ message: 'Documento excluído com sucesso.' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Erro ao excluir documento.' });
  }
};

module.exports = { createDoc, getDocById, getDocsByUser, getDecryptedDoc, deleteDoc };
