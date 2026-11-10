'use strict';

/**
 * Teste de integracao do modulo de logs e da auditoria automatica.
 *
 * Requer MySQL de desenvolvimento e a variavel RF_TEST_ALLOW_DB=1.
 * Cria usuario sintetico, exercita /log, /card e /product e remove tudo no final.
 *
 * Uso (PowerShell):
 *   $env:RF_TEST_ALLOW_DB="1"; npm run test:log:db
 */

const path = require('path');
const http = require('http');
const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');

const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'node_modules', 'dotenv')).config({
    path: path.join(ROOT, '.env'),
    quiet: true
});

const connect = require('../src/db/connect');
const uuid = require('../src/utils/uuid');
const auditLog = require('../src/middlewares/auditLog');
const logRoutes = require('../src/routes/modules/logRoutes');
const cardRoutes = require('../src/routes/modules/cardRoutes');
const productRoutes = require('../src/routes/modules/productRoutes');

const results = [];
let failed = 0;

function pass(name) {
    results.push(`PASS  ${name}`);
}

function fail(name, detail) {
    failed += 1;
    results.push(`FAIL  ${name} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}

async function check(name, fn) {
    try {
        await fn();
        pass(name);
    } catch (error) {
        fail(name, error.message || error);
    }
}

function assertStatus(response, expected, label) {
    assert.strictEqual(
        response.status,
        expected,
        `${label}: esperado ${expected}, recebido ${response.status} - ${JSON.stringify(response.body)}`
    );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    if (process.env.RF_TEST_ALLOW_DB !== '1') {
        console.error(
            'Recusando executar: defina RF_TEST_ALLOW_DB=1 para confirmar que o banco e de teste/desenvolvimento.'
        );
        process.exit(1);
    }

    if (!process.env.SECRET) {
        console.error('Recusando executar: SECRET ausente no ambiente/.env.');
        process.exit(1);
    }

    try {
        await connect.promise().query('SELECT 1');
    } catch (error) {
        console.error('Recusando executar: MySQL indisponivel -', error.code || error.message);
        process.exit(1);
    }

    const suffix = Date.now();
    const adminId = uuid.generateId();
    const userId = uuid.generateId();

    const [[{ startedAt }]] = await connect.promise().query('SELECT NOW() AS startedAt');

    const router = express.Router();
    router.use(auditLog);
    router.use('/log', logRoutes);
    router.use('/card', cardRoutes);
    router.use('/product', productRoutes);

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api/reaproveitafranca', router);

    const httpServer = http.createServer(app);
    await new Promise((resolve) => httpServer.listen(0, resolve));

    const base = `http://127.0.0.1:${httpServer.address().port}/api/reaproveitafranca`;

    async function call(method, routePath, { body, token } = {}) {
        const headers = {};

        if (body !== undefined) headers['content-type'] = 'application/json';
        if (token) headers.authorization = token;

        const response = await fetch(`${base}${routePath}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        const text = await response.text();
        let parsed = null;

        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {
            parsed = text;
        }

        return { status: response.status, body: parsed };
    }

    let cardId = null;

    try {
        await connect.promise().query(
            `INSERT INTO \`user\` (id, role, name, email, status)
             VALUES (?, 'admin', 'Teste Log Admin', ?, 'active'),
                    (?, 'user', 'Teste Log Usuario', ?, 'active')`,
            [
                uuid.toBin(adminId), `log-admin-${suffix}@example.test`,
                uuid.toBin(userId), `log-user-${suffix}@example.test`
            ]
        );

        const adminToken = jwt.sign({ id: adminId, role: 'admin', name: 'Teste Log Admin' }, process.env.SECRET, { expiresIn: '1h' });
        const userToken = jwt.sign({ id: userId, role: 'user', name: 'Teste Log Usuario' }, process.env.SECRET, { expiresIn: '1h' });

        await check('GET /log sem token responde 401', async () => {
            const response = await call('GET', '/log');
            assertStatus(response, 401, 'sem token');
        });

        await check('GET /log com usuario comum responde 403', async () => {
            const response = await call('GET', '/log', { token: userToken });
            assertStatus(response, 403, 'usuario comum');
        });

        await check('GET /log com admin retorna paginacao', async () => {
            const response = await call('GET', '/log?limit=5', { token: adminToken });
            assertStatus(response, 200, 'admin');
            assert.ok(Array.isArray(response.body.logs), 'logs ausente');
            assert.strictEqual(response.body.limit, 5);
        });

        let logId = null;

        await check('POST /log cria entrada manual', async () => {
            const response = await call('POST', '/log', {
                token: adminToken,
                body: { status: 'sucesso', operation: 'create', table: 'verificacao', description: 'integracao' }
            });
            assertStatus(response, 201, 'criacao');
            assert.ok(response.body.id, 'id ausente');
            logId = response.body.id;
        });

        await check('POST /log sem campos obrigatorios responde 400', async () => {
            const response = await call('POST', '/log', { token: adminToken, body: {} });
            assertStatus(response, 400, 'validacao');
        });

        await check('PUT /log/:id atualiza descricao', async () => {
            const response = await call('PUT', `/log/${logId}`, {
                token: adminToken,
                body: { description: 'integracao atualizada' }
            });
            assertStatus(response, 200, 'atualizacao');
            assert.strictEqual(response.body.log.description, 'integracao atualizada');
        });

        await check('GET /log/:id retorna detalhe', async () => {
            const response = await call('GET', `/log/${logId}`, { token: adminToken });
            assertStatus(response, 200, 'detalhe');
            assert.strictEqual(response.body.id, logId);
        });

        await check('POST /product/create invalido responde 400', async () => {
            const response = await call('POST', '/product/create', { token: adminToken, body: {} });
            assertStatus(response, 400, 'produto invalido');
        });

        const futureYear = new Date().getFullYear() + 3;

        await check('POST /card/create cria cartao sintetico', async () => {
            const response = await call('POST', '/card/create', {
                token: adminToken,
                body: {
                    holder_name: 'LOG TESTE',
                    brand: 'visa',
                    last_digits: '4242',
                    type: 'credit',
                    expiration_month: 12,
                    expiration_year: futureYear,
                    payment_token: `tok_log_${suffix}`
                }
            });
            assertStatus(response, 201, 'cartao');
            cardId = response.body.card.id;
        });

        await check('DELETE /card/:id remove cartao sintetico', async () => {
            const response = await call('DELETE', `/card/${cardId}`, { token: adminToken });
            assertStatus(response, 200, 'exclusao cartao');
        });

        await check('DELETE /log/:id remove entrada manual', async () => {
            const response = await call('DELETE', `/log/${logId}`, { token: adminToken });
            assertStatus(response, 200, 'exclusao log');
        });

        // Leitura auditavel (AUDIT_LOG_READS) — restaurado em finally.
        process.env.AUDIT_LOG_READS = '1';

        await check('GET /log gera auditoria de leitura quando habilitado', async () => {
            const response = await call('GET', '/log?limit=1', { token: adminToken });
            assertStatus(response, 200, 'leitura auditada');
        });

        delete process.env.AUDIT_LOG_READS;

        await sleep(800);

        const [rows] = await connect.promise().query(
            `SELECT BIN_TO_UUID(reference_id) AS reference_id,
                    BIN_TO_UUID(id_user) AS id_user,
                    status, operation, \`table\`, description, ip, user_agent
             FROM log WHERE datetime >= ? ORDER BY datetime ASC`,
            [startedAt]
        );

        const find = (predicate) => rows.find(predicate);

        await check('auditoria registra criacao manual de log', async () => {
            assert.ok(find((r) => r.table === 'log' && r.operation === 'create' && r.status === 'sucesso' && r.id_user === adminId));
        });

        await check('auditoria registra atualizacao de log', async () => {
            assert.ok(find((r) => r.table === 'log' && r.operation === 'update' && r.status === 'sucesso'));
        });

        await check('auditoria registra falha de validacao em produto', async () => {
            assert.ok(find((r) => r.table === 'product' && r.operation === 'create' && r.status === 'falha' && / -> 400$/.test(r.description)));
        });

        await check('auditoria registra criacao de cartao com reference_id', async () => {
            assert.ok(find((r) => r.table === 'card' && r.operation === 'create' && r.reference_id === cardId));
        });

        await check('auditoria registra exclusao de cartao com reference_id', async () => {
            assert.ok(find((r) => r.table === 'card' && r.operation === 'delete' && r.reference_id === cardId));
        });

        await check('auditoria registra exclusao de log', async () => {
            assert.ok(find((r) => r.table === 'log' && r.operation === 'delete' && r.status === 'sucesso'));
        });

        await check('auditoria registra leitura quando habilitada', async () => {
            assert.ok(find((r) => r.operation === 'read' && /^GET /.test(r.description)));
        });

        await check('auditoria registra IP e user-agent', async () => {
            assert.ok(find((r) => typeof r.ip === 'string' && r.ip.length > 0));
            assert.ok(find((r) => typeof r.user_agent === 'string' && r.user_agent.length > 0));
        });

        await check('nenhuma auditoria criada para GET quando desabilitado', async () => {
            const readsBefore = rows.filter((r) => r.operation === 'read').length;
            const response = await call('GET', '/log?limit=1', { token: adminToken });
            assertStatus(response, 200, 'leitura nao auditada');
            await sleep(300);
            const [after] = await connect.promise().query(
                'SELECT COUNT(*) AS total FROM log WHERE operation = ? AND datetime >= ?',
                ['read', startedAt]
            );
            assert.strictEqual(Number(after[0].total), readsBefore);
        });
    } catch (error) {
        fail('execucao da suite', error.stack || error.message);
    } finally {
        delete process.env.AUDIT_LOG_READS;

        try {
            await connect.promise().query(
                'DELETE FROM log WHERE datetime >= ? AND id_user IN (?, ?)',
                [startedAt, uuid.toBin(adminId), uuid.toBin(userId)]
            );
        } catch (error) {
            results.push(`WARN  limpeza de logs: ${error.code || error.message}`);
        }

        try {
            if (cardId) {
                await connect.promise().query('DELETE FROM card WHERE id = ?', [uuid.toBin(cardId)]);
            }
        } catch (error) {
            results.push(`WARN  limpeza de cartao: ${error.code || error.message}`);
        }

        try {
            await connect.promise().query(
                `DELETE FROM \`user\` WHERE id IN (?, ?)`,
                [uuid.toBin(adminId), uuid.toBin(userId)]
            );
        } catch (error) {
            results.push(`WARN  limpeza de usuarios: ${error.code || error.message}`);
        }

        try {
            const [left] = await connect.promise().query(
                'SELECT COUNT(*) AS total FROM log WHERE datetime >= ? AND id_user IN (?, ?)',
                [startedAt, uuid.toBin(adminId), uuid.toBin(userId)]
            );
            results.push(`INFO  logs sinteticos restantes: ${left[0].total}`);
        } catch (error) {
            results.push(`WARN  verificacao final: ${error.code || error.message}`);
        }

        await new Promise((resolve) => httpServer.close(resolve));
        await connect.promise().end();
    }

    console.log(results.join('\n'));
    const passed = results.filter((line) => line.startsWith('PASS')).length;
    console.log(`\nRESUMO: ${passed} PASS, ${failed} FAIL`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main();
