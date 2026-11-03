const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const schemaPath = path.join(__dirname, "../src/mysql-init/RFScript.sql");
const migrationPath = path.join(__dirname, "../src/mysql-init/migration_mercado_pago.sql");
const paymentIdMigrationPath = path.join(__dirname, "../src/mysql-init/migration_mercado_pago_payment_id.sql");

test("fresh payment schema stores Mercado Pago preferences and account balance", () => {
    const schema = fs.readFileSync(schemaPath, "utf8");
    const paymentTable = schema.match(/CREATE TABLE payment \(([\s\S]*?)\n\);/i)?.[1];

    assert.ok(paymentTable, "payment table definition should exist");
    assert.match(paymentTable, /ENUM\('pix','debit_card','credit_card','account_money'\)/);
    assert.match(paymentTable, /mp_preference_id\s+VARCHAR\(100\)\s+NULL/i);
    assert.match(paymentTable, /UNIQUE KEY `idx_payment_mp_preference`/i);
    assert.match(paymentTable, /mp_payment_id\s+VARCHAR\(100\)\s+NULL/i);
    assert.match(paymentTable, /UNIQUE KEY `idx_payment_mp_payment`/i);
});

test("existing databases can add an idempotency key for provider payments", () => {
    const migration = fs.readFileSync(paymentIdMigrationPath, "utf8");

    assert.match(migration, /ALTER TABLE payment/i);
    assert.match(migration, /ADD COLUMN mp_payment_id\s+VARCHAR\(100\)\s+NULL/i);
    assert.match(migration, /UNIQUE KEY `idx_payment_mp_payment`/i);
});

test("existing databases can add the same Mercado Pago payment fields", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");

    assert.match(migration, /ALTER TABLE payment/i);
    assert.match(migration, /account_money/);
    assert.match(migration, /ADD COLUMN mp_preference_id\s+VARCHAR\(100\)\s+NULL/i);
    assert.match(migration, /UNIQUE KEY `idx_payment_mp_preference`/i);
});
