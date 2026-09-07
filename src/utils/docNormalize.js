/**
 * Remove tudo que não é dígito (pontos, traço, barra).
 * Garante que '123.456.789-00' e '12345678900' gerem o mesmo hmac/criptografia.
 * @param {string} doc
 * @returns {string}
 */
function normalizeDoc(doc) {
  return doc.replace(/\D/g, '');
}

module.exports = { normalizeDoc };