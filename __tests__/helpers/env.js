/**
 * Variáveis de ambiente mínimas para carregar os módulos da API em memória.
 *
 * Nenhuma credencial real: são valores sintéticos, usados apenas para que
 * `verifyJWT`, `docKeys` e os providers não recebam `undefined`.
 */
process.env.NODE_ENV = process.env.NODE_ENV === "production" ? "test" : (process.env.NODE_ENV || "test");
process.env.SECRET = "jest-controller-suite-secret";
process.env.DOCUMENT_ENC_KEY = "a".repeat(64);
process.env.DOCUMENT_HMAC_KEY = "b".repeat(64);
