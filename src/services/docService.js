const pool = require('../db/connect');
const { generateId, toBin, fromBin } = require('../utils/uuid');
const { generateHmacDoc } = require('../utils/docGenerateHmac');
const { encryptDoc } = require('../utils/docEncrypt');
const { decryptDoc } = require('../utils/docDecrypt');

/**
 * Registers a new document (CPF/CNPJ) for a user.
 * Checks for duplicates via the HMAC before encrypting and inserting,
 * so the plaintext value is never stored or compared directly.
 * @param {{ userId: string, docType: 'CPF'|'CNPJ', doc: string }} params
 * @returns {Promise<string>} the new document's id
 */
async function createDoc({ userId, docType, doc }, dbConn) {
  const db = dbConn || pool.promise();
  const hmac = generateHmacDoc(doc);

  const [existing] = await db.query(
    'SELECT id FROM document WHERE doc_hmac = ?',
    [hmac]
  );
  if (existing.length) {
    throw new Error('Documento já registrado');
  }

  const { doc_enc, doc_iv, doc_tag } = encryptDoc(doc);
  const id = generateId();

  await db.query(
    `INSERT INTO document (id, id_user, doc_type, doc_hmac, doc_enc, doc_iv, doc_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [toBin(id), toBin(userId), docType, hmac, doc_enc, doc_iv, doc_tag]
  );

  return id;
}

/**
 * Fetches a document by id and returns it decrypted.
 * @param {string} documentId
 * @returns {Promise<string|null>}
 */
async function getDecryptedDoc(documentId) {
  const [rows] = await pool.promise().query(
    'SELECT doc_enc, doc_iv, doc_tag FROM document WHERE id = ?',
    [toBin(documentId)]
  );
  if (!rows.length) return null;
  return decryptDoc(rows[0]);
}

module.exports = { createDoc, getDecryptedDoc };