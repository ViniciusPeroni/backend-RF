const crypto = require('crypto');
const { normalizeDoc } = require('./docNormalize');
const { HMAC_KEY } = require('./docKeys');

/**
 * Gera um HMAC-SHA256 determinístico do CPF/CNPJ.
 * Mesmo documento sempre gera o mesmo hmac -> serve para checar
 * duplicidade (WHERE doc_hmac = ?) sem guardar ou comparar o valor em claro.
 * @param {string} doc
 * @returns {string} 64 caracteres hex -> bate com doc_hmac CHAR(64)
 */
function generateHmacDoc(doc) {
  const normalized = normalizeDoc(doc);
  return crypto.createHmac('sha256', HMAC_KEY).update(normalized).digest('hex');
}

module.exports = { generateHmacDoc };