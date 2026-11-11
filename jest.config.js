/**
 * Suíte unitária das controllers (Jest).
 *
 * Não substitui as suítes de integração existentes (`test/`, `tests/` e
 * `scripts/`), que continuam rodando com `node --test` e MySQL real.
 */
module.exports = {
    testEnvironment: "node",
    roots: ["<rootDir>/__tests__"],
    testMatch: ["<rootDir>/__tests__/**/*.test.js"],
    setupFiles: ["<rootDir>/__tests__/helpers/env.js"],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15000,
    verbose: true
};
