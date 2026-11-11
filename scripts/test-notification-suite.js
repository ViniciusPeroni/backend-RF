// Executa a suíte de notificações em um banco temporário vazio.
// Não copia nem altera o banco configurado no .env.
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const mysql = require("mysql2/promise");
const path = require("node:path");

async function main() {
    if (process.env.RF_TEST_ALLOW_DB !== "1" || process.env.NODE_ENV === "production") {
        throw new Error("Defina RF_TEST_ALLOW_DB=1 somente em MySQL de desenvolvimento.");
    }

    const database = `rf_notification_test_${crypto.randomBytes(8).toString("hex")}`;
    assert.match(database, /^rf_notification_test_[0-9a-f]{16}$/);
    assert.notEqual(database.toLowerCase(), String(process.env.DB_NAME).toLowerCase());

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
    });
    let created = false;

    try {
        await connection.query("CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", [database]);
        created = true;
        await connection.query("USE ??", [database]);

        const source = fs.readFileSync(path.join(__dirname, "../src/mysql-init/RFScript.sql"), "utf8")
            .replace(/^\s*--.*$/gm, "");
        const statements = source.split(";")
            .map((sql) => sql.trim())
            .filter((sql) => /^(CREATE TABLE|ALTER TABLE)\s/i.test(sql));

        assert.ok(statements.length >= 20, "schema incompleto para o banco temporário");
        assert.ok(statements.every((sql) => !/\bReaproveita_Franca\b/i.test(sql)), "schema não pode recriar o banco local");

        await connection.query("SET FOREIGN_KEY_CHECKS=0");
        for (const sql of statements) await connection.query(sql);
        await connection.query("SET FOREIGN_KEY_CHECKS=1");

        // Exercita a migração sobre o formato anterior da fila, só neste DB.
        await connection.query('ALTER TABLE notification_retry DROP COLUMN failed_in, DROP COLUMN lease_id');
        const migration = fs.readFileSync(path.join(__dirname, '../src/mysql-init/migration_notification_outbox.sql'), 'utf8')
            .replace(/^\s*--.*$/gm, '');
        for (const sql of migration.split(';').map(s => s.trim()).filter(Boolean)) await connection.query(sql);
        // Exercita também a migração aditiva de canais, inclusive semântica IF NOT EXISTS.
        for (const table of ['notification_delivery', 'notification_device', 'notification_preferences']) {
            await connection.query('DROP TABLE ??', [table]);
        }
        const channels = fs.readFileSync(path.join(__dirname, '../src/mysql-init/migration_notification_channels.sql'), 'utf8')
            .replace(/^\s*--.*$/gm, '');
        for (const sql of channels.split(';').map(s => s.trim()).filter(Boolean)) await connection.query(sql);

        const env = {
            ...process.env,
            DB_NAME: database,
            RF_TEST_ALLOW_DB: "1",
            NODE_ENV: "test",
            SECRET: crypto.randomBytes(32).toString("hex"),
            DOCUMENT_ENC_KEY: crypto.randomBytes(32).toString("hex"),
            DOCUMENT_HMAC_KEY: crypto.randomBytes(32).toString("hex"),
            NOTIFICATION_TOKEN_KEY: crypto.randomBytes(32).toString('hex'),
            NOTIFICATION_EMAIL_ENABLED: 'false', NOTIFICATION_PUSH_ENABLED: 'false',
            MERCADO_PAGO_ACCESS_TOKEN: 'TOKEN_FICTICIO_SEM_ACESSO_EXTERNO',
            split_payment: 'false', RUN_PAYMENT_DB_TESTS: '1'
        };

        const files = ['tests/notification.integration.js'];
        if (process.env.RF_NOTIFICATION_REGRESSION === '1') {
            files.push('tests/card.integration.js', 'scripts/test-payment-integration.js', 'tests/localization.integration.js');
        }
        for (const file of files) {
            console.log(`Executando ${file}`);
            const result = childProcess.spawnSync(process.execPath, [file], {
                cwd: path.join(__dirname, ".."),
                env,
                encoding: "utf8",
                timeout: 120000,
                maxBuffer: 8388608
            });

            process.stdout.write(result.stdout || "");
            if (result.stderr) process.stderr.write(result.stderr);
            if (result.error) throw result.error;
            if (result.status !== 0) throw new Error(`Falha na suíte ${file}.`);
        }
    } finally {
        if (created) {
            assert.match(database, /^rf_notification_test_[0-9a-f]{16}$/);
            await connection.query("DROP DATABASE ??", [database]);
            console.log("Banco temporário removido. Banco local preservado.");
        }
        await connection.end();
    }
}

main().catch((error) => {
    console.error("Suíte de notificações:", error.code || error.message);
    process.exitCode = 1;
});
