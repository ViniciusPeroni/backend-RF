const crypto = require('crypto');
const { ENC_KEY } = require('./docKeys');

const ALGORITHM = 'aes-256-gcm';

/**
 * Reverte a criptografia e retorna o CPF/CNPJ original.
 * Lança erro automaticamente se doc_tag não bater (dado corrompido/adulterado)
 * -- essa é a vantagem do GCM sobre um AES comum.
 * @param {{ doc_enc: string, doc_iv: string, doc_tag: string }} fields
 * @returns {string}
 */
function decryptDoc({ doc_enc, doc_iv, doc_tag }) {
  const decipher = crypto.createDecipheriv(ALGORITHM, ENC_KEY, Buffer.from(doc_iv, 'hex'));
  decipher.setAuthTag(Buffer.from(doc_tag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(doc_enc, 'hex')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

module.exports = { decryptDoc };