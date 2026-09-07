// Chaves usadas para proteger CPF/CNPJ na tabela `document`.
// Devem vir do .env — nunca fixar no código.
// Gerar cada uma com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

const ENC_KEY = Buffer.from(process.env.DOCUMENT_ENC_KEY, 'hex');   // 32 bytes -> AES-256
const HMAC_KEY = Buffer.from(process.env.DOCUMENT_HMAC_KEY, 'hex'); // 32 bytes -> HMAC-SHA256

module.exports = { ENC_KEY, HMAC_KEY };