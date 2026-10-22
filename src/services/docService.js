const pool = require('../db/connect');
const { generateId, toBin, fromBin, isValid } = require('../utils/uuid');
const { generateHmacDoc } = require('../utils/docGenerateHmac');
const { encryptDoc } = require('../utils/docEncrypt');
const { decryptDoc } = require('../utils/docDecrypt');

async function createDoc({ userId, docType, doc }, dbConn) {
  const db = dbConn || pool.promise();
  if (!userId || !docType || !doc) {
    const err = new Error('userId, docType e doc são obrigatórios.');
    err.status = 400;
    throw err;
  }
  if (!isValid(userId)) {
    const err = new Error('userId inválido.');
    err.status = 400;
    throw err;
  }
  if (!['CPF', 'CNPJ'].includes(docType)) {
    const err = new Error('docType inválido. Use CPF ou CNPJ.');
    err.status = 400;
    throw err;
  }
  const hmac = generateHmacDoc(doc);
  const [existing] = await db.query('SELECT id FROM document WHERE doc_hmac = ?', [hmac]);
  if (existing.length) {
    const err = new Error('Documento já registrado');
    err.status = 409;
    throw err;
  }
  const { doc_enc, doc_iv, doc_tag } = encryptDoc(doc);
  const id = generateId();
  await db.query(
    `INSERT INTO document (id, id_user, doc_type, doc_hmac, doc_enc, doc_iv, doc_tag) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [toBin(id), toBin(userId), docType, hmac, doc_enc, doc_iv, doc_tag]
  );
  return id;
}

async function getDecryptedDoc(documentId) {
  if (!documentId || !isValid(documentId)) throw new Error('documentId inválido');
  const [rows] = await pool.promise().query(
    'SELECT doc_enc, doc_iv, doc_tag FROM document WHERE id = ?',
    [toBin(documentId)]
  );
  if (!rows.length) return null;
  return decryptDoc(rows[0]);
}

async function getDocById(documentId) {
  if (!documentId || !isValid(documentId)) {
    const err = new Error('ID do documento inválido.');
    err.status = 400;
    throw err;
  }
  const [rows] = await pool.promise().query(
    `SELECT BIN_TO_UUID(id) AS id, BIN_TO_UUID(id_user) AS idUser, doc_type AS docType FROM document WHERE id = ?`,
    [toBin(documentId)]
  );
  if (!rows.length) return null;
  return rows[0];
}

async function listDocsByUser(userId) {
  if (!userId || !isValid(userId)) {
    const err = new Error('ID do usuário inválido.');
    err.status = 400;
    throw err;
  }
  const [rows] = await pool.promise().query(
    `SELECT BIN_TO_UUID(id) AS id, BIN_TO_UUID(id_user) AS idUser, doc_type AS docType FROM document WHERE id_user = ? ORDER BY id ASC`,
    [toBin(userId)]
  );
  return rows;
}

async function deleteDoc(documentId) {
  if (!documentId || !isValid(documentId)) {
    const err = new Error('ID do documento inválido.');
    err.status = 400;
    throw err;
  }
  const [rows] = await pool.promise().query(
    'DELETE FROM document WHERE id = ?',
    [toBin(documentId)]
  );
  return rows.affectedRows > 0;
}

module.exports = { createDoc, getDecryptedDoc, getDocById, listDocsByUser, deleteDoc };
