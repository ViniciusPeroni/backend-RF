const crypto = require('crypto');
const { normalizeDoc } = require('./docNormalize');
const { ENC_KEY } = require('./docKeys');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits -> recomendado para GCM

/**
 * Criptografa o CPF/CNPJ de forma reversível (AES-256-GCM).
 * @param {string} doc
 * @returns {{ doc_enc: string, doc_iv: string, doc_tag: string }}
 */
function encryptDoc(doc) {
  const normalized = normalizeDoc(doc);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    doc_enc: encrypted.toString('hex'),
    doc_iv: iv.toString('hex'),   // 24 caracteres hex -> bate com doc_iv CHAR(24)
    doc_tag: tag.toString('hex'), // 32 caracteres hex -> bate com doc_tag CHAR(32)
  };
}

module.exports = { encryptDoc };