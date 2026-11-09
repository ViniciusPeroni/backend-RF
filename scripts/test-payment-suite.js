// Suítes em banco temporário vazio. Não copia nem altera o banco configurado no .env.
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const mysql = require("mysql2/promise");
const path = require("node:path");

async function main() {
    if (process.env.RUN_PAYMENT_DB_TESTS !== "1" || process.env.NODE_ENV === "production") {
        throw new Error("Defina RUN_PAYMENT_DB_TESTS=1 somente em MySQL de desenvolvimento.");
    }
    const database = `rf_payment_test_${crypto.randomBytes(8).toString("hex")}`;
    assert.match(database, /^rf_payment_test_[0-9a-f]{16}$/);
    assert.notEqual(database.toLowerCase(), String(process.env.DB_NAME).toLowerCase());
    const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    let created = false;
    try {
        await connection.query("CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", [database]);
        created = true;
        await connection.query("USE ??", [database]);
        const source = fs.readFileSync(path.join(__dirname, "../src/mysql-init/RFScript.sql"), "utf8").replace(/^\s*--.*$/gm, "");
        const statements = source.split(";").map(sql => sql.trim()).filter(sql => /^(CREATE TABLE|ALTER TABLE)\s/i.test(sql));
        assert.ok(statements.length >= 20);
        assert.ok(statements.every(sql => !/\bReaproveita_Franca\b/i.test(sql)));
        await connection.query("SET FOREIGN_KEY_CHECKS=0");
        for (const sql of statements) await connection.query(sql);
        await connection.query("SET FOREIGN_KEY_CHECKS=1");
        const env = { ...process.env, DB_NAME: database, RUN_PAYMENT_DB_TESTS: "1", RF_TEST_ALLOW_DB: "1", NODE_ENV: "test",
            SECRET: crypto.randomBytes(32).toString("hex"), DOCUMENT_ENC_KEY: crypto.randomBytes(32).toString("hex"),
            DOCUMENT_HMAC_KEY: crypto.randomBytes(32).toString("hex"), MERCADO_PAGO_ACCESS_TOKEN: "TOKEN_FICTICIO_SEM_ACESSO_EXTERNO", split_payment: "false" };
        for (const file of ["scripts/test-payment-integration.js", "tests/card.integration.js", "tests/localization.integration.js", "tests/notification.integration.js"]) {
            console.log(`Executando ${file}`);
            const result = childProcess.spawnSync(process.execPath, [file], { cwd: path.join(__dirname, ".."), env, encoding: "utf8", timeout: 60000, maxBuffer: 4194304 });
            process.stdout.write(result.stdout || "");
            // Os testes usam dados sintéticos; nunca imprime opções de conexão ou erros Axios brutos.
            if (result.stderr) process.stderr.write(result.stderr);
            if (result.status !== 0) throw new Error(`Falha na suíte ${file}.`);
        }
    } finally {
        if (created) {
            assert.match(database, /^rf_payment_test_[0-9a-f]{16}$/);
            await connection.query("DROP DATABASE ??", [database]);
            console.log("Banco temporário removido. Banco local preservado.");
        }
        await connection.end();
    }
}

main().catch(error => { console.error("Suíte de pagamentos:", error.code || error.message); process.exitCode = 1; });
