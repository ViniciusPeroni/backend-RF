'use strict';

/**
 * Teste de integracao da funcionalidade de cartoes.
 *
 * Requer MySQL de desenvolvimento e a variavel RF_TEST_ALLOW_DB=1.
 * O script cria usuarios sinteticos, exercita as rotas de /card e remove tudo no final.
 *
 * Uso (PowerShell):
 *   $env:RF_TEST_ALLOW_DB="1"; npm run test:card
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
const cardRoutes = require('../src/routes/modules/cardRoutes');

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

function assertNoToken(card) {
    assert.ok(card, 'cartao ausente na resposta');
    assert.strictEqual(card.payment_token, undefined, 'payment_token exposto na resposta');
}

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
    const ownerId = uuid.generateId();
    const strangerId = uuid.generateId();
    const adminId = uuid.generateId();
    const shoppingId = uuid.generateId();
    const paymentId = uuid.generateId();
    const createdUserIds = [ownerId, strangerId, adminId];

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api/reaproveitafranca/card', cardRoutes);

    const httpServer = http.createServer(app);
    await new Promise((resolve) => httpServer.listen(0, resolve));

    const base = `http://127.0.0.1:${httpServer.address().port}/api/reaproveitafranca/card`;

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

    try {
        await connect.promise().query(
            `INSERT INTO \`user\` (id, role, name, email, status)
             VALUES (?, 'user', 'Teste Cartao Dono', ?, 'active'),
                    (?, 'user', 'Teste Cartao Estranho', ?, 'active'),
                    (?, 'admin', 'Teste Cartao Admin', ?, 'active')`,
            [
                uuid.toBin(ownerId), `card-owner-${suffix}@example.test`,
                uuid.toBin(strangerId), `card-stranger-${suffix}@example.test`,
                uuid.toBin(adminId), `card-admin-${suffix}@example.test`
            ]
        );

        const token = jwt.sign({ id: ownerId, role: 'user', name: 'Teste Cartao Dono' }, process.env.SECRET, { expiresIn: '1h' });
        const strangerToken = jwt.sign({ id: strangerId, role: 'user', name: 'Teste Cartao Estranho' }, process.env.SECRET, { expiresIn: '1h' });
        const adminToken = jwt.sign({ id: adminId, role: 'admin', name: 'Teste Cartao Admin' }, process.env.SECRET, { expiresIn: '1h' });

        const futureYear = new Date().getFullYear() + 3;
        const currentYear = new Date().getFullYear();
        const validCard = {
            holder_name: 'TITULAR DE TESTE',
            brand: 'visa',
            last_digits: '1234',
            type: 'credit',
            expiration_month: 5,
            expiration_year: futureYear,
            payment_token: `tok_teste_${suffix}`
        };

        const createCard = (overrides = {}, auth = token) => call('POST', '/create', {
            token: auth,
            body: { ...validCard, ...overrides }
        });

        let cardId = null;

        // ---------- autenticacao e validacao ----------

        await check('POST /create sem token responde 401', async () => {
            const response = await call('POST', '/create', { body: validCard });
            assertStatus(response, 401, 'sem token');
        });

        await check('GET / sem token responde 401', async () => {
            const response = await call('GET', '/');
            assertStatus(response, 401, 'sem token');
        });

        await check('POST /create com JWT de usuario excluido responde 401', async () => {
            const ghostId = uuid.generateId();
            const ghostToken = jwt.sign({ id: ghostId, role: 'user', name: 'Usuario Removido' }, process.env.SECRET, { expiresIn: '1h' });

            const response = await call('POST', '/create', { token: ghostToken, body: validCard });
            assertStatus(response, 401, 'usuario inexistente');
            assert.strictEqual(response.body.auth, false);

            const [rows] = await connect.promise().query(
                'SELECT COUNT(*) AS total FROM card WHERE id_user = ?',
                [uuid.toBin(ghostId)]
            );
            assert.strictEqual(Number(rows[0].total), 0, 'cartao criado para usuario inexistente');
        });

        await check('POST /create sem payment_token responde 400', async () => {
            const response = await createCard({ payment_token: undefined });
            assertStatus(response, 400, 'sem token do gateway');
        });

        await check('POST /create com last_digits invalido responde 400', async () => {
            const response = await createCard({ last_digits: '12' });
            assertStatus(response, 400, 'last_digits');
        });

        await check('POST /create com type invalido responde 400', async () => {
            const response = await createCard({ type: 'vale' });
            assertStatus(response, 400, 'type');
        });

        await check('POST /create com type numerico responde 400', async () => {
            const response = await createCard({ type: 1 });
            assertStatus(response, 400, 'type numerico');
        });

        await check('POST /create com cartao vencido responde 400', async () => {
            const response = await createCard({ expiration_year: 2020 });
            assertStatus(response, 400, 'vencido');
        });

        await check('POST /create com mes invalido responde 400', async () => {
            const response = await createCard({ expiration_month: 13 });
            assertStatus(response, 400, 'mes');
        });

        await check('POST /create com mes 0 responde 400', async () => {
            const response = await createCard({ expiration_month: 0 });
            assertStatus(response, 400, 'mes zero');
        });

        await check('POST /create com mes fracionado responde 400', async () => {
            const response = await createCard({ expiration_month: 5.5 });
            assertStatus(response, 400, 'mes fracionado');
        });

        await check('POST /create com mes booleano responde 400', async () => {
            const response = await createCard({ expiration_month: true });
            assertStatus(response, 400, 'mes booleano');
        });

        await check('POST /create com ano acima de 9999 responde 400', async () => {
            const response = await createCard({ expiration_year: 10000 });
            assertStatus(response, 400, 'ano fora da faixa');
        });

        await check('POST /create com holder_name acima de 100 caracteres responde 400', async () => {
            const response = await createCard({ holder_name: 'A'.repeat(101) });
            assertStatus(response, 400, 'holder_name longo');
        });

        await check('POST /create com brand acima de 50 caracteres responde 400', async () => {
            const response = await createCard({ brand: 'B'.repeat(51) });
            assertStatus(response, 400, 'brand longa');
        });

        await check('POST /create com payment_token acima de 255 caracteres responde 400', async () => {
            const response = await createCard({ payment_token: 't'.repeat(256) });
            assertStatus(response, 400, 'token longo');
        });

        await check('POST /create com body vazio responde 400', async () => {
            const response = await call('POST', '/create', { token, body: {} });
            assertStatus(response, 400, 'body vazio');
        });

        // ---------- criacao ----------

        await check('GET / antes de cadastrar retorna lista vazia', async () => {
            const response = await call('GET', '/', { token });
            assertStatus(response, 200, 'lista vazia');
            assert.ok(Array.isArray(response.body) && response.body.length === 0);
        });

        await check('POST /create valido responde 201 sem expor payment_token', async () => {
            const response = await createCard();
            assertStatus(response, 201, 'criacao');
            assertNoToken(response.body.card);
            assert.strictEqual(response.body.card.last_digits, '1234');
            assert.strictEqual(response.body.card.type, 'credit');
            assert.strictEqual(response.body.card.expiration_month, 5);
            assert.strictEqual(response.body.card.expiration_year, futureYear);
            assert.ok(uuid.isValid(response.body.card.id), 'id invalido');
            cardId = response.body.card.id;
        });

        await check('token do gateway foi gravado no banco', async () => {
            const [rows] = await connect.promise().query(
                'SELECT payment_token FROM card WHERE id = ?',
                [uuid.toBin(cardId)]
            );
            assert.strictEqual(rows.length, 1, 'cartao nao encontrado no banco');
            assert.strictEqual(rows[0].payment_token, validCard.payment_token);
        });

        await check('id_user enviado no corpo e ignorado', async () => {
            const response = await createCard({ last_digits: '2222', id_user: strangerId });
            assertStatus(response, 201, 'spoof de id_user');
            assert.strictEqual(response.body.card.id_user, ownerId);
        });

        await check('id enviado no corpo e ignorado', async () => {
            const forgedId = uuid.generateId();
            const response = await createCard({ last_digits: '3333', id: forgedId });
            assertStatus(response, 201, 'spoof de id');
            assert.notStrictEqual(response.body.card.id, forgedId);
        });

        await check('last_digits numerico e aceito e normalizado para texto', async () => {
            const response = await createCard({ last_digits: 4444 });
            assertStatus(response, 201, 'last_digits numerico');
            assert.strictEqual(response.body.card.last_digits, '4444');
        });

        await check('mes e ano como string numerica sao aceitos', async () => {
            const response = await createCard({ last_digits: '5555', expiration_month: '06', expiration_year: String(futureYear) });
            assertStatus(response, 201, 'mes/ano string');
            assert.strictEqual(response.body.card.expiration_month, 6);
            assert.strictEqual(response.body.card.expiration_year, futureYear);
        });

        // ---------- leitura ----------

        await check('GET / lista somente cartoes do usuario logado', async () => {
            const response = await call('GET', '/', { token });
            assertStatus(response, 200, 'listagem');
            assert.ok(Array.isArray(response.body));
            assert.strictEqual(response.body.length, 5);
            assert.ok(response.body.every((card) => card.id_user === ownerId));
            assert.ok(response.body.every((card) => card.payment_token === undefined));
        });

        await check('GET / do outro usuario vem vazio', async () => {
            const response = await call('GET', '/', { token: strangerToken });
            assertStatus(response, 200, 'listagem do estranho');
            assert.ok(Array.isArray(response.body) && response.body.length === 0);
        });

        await check('GET / de admin tambem e restrito ao proprio usuario', async () => {
            const response = await call('GET', '/', { token: adminToken });
            assertStatus(response, 200, 'listagem do admin');
            assert.ok(Array.isArray(response.body) && response.body.length === 0);
        });

        await check('GET /:id retorna o cartao sem token', async () => {
            const response = await call('GET', `/${cardId}`, { token });
            assertStatus(response, 200, 'detalhe');
            assert.strictEqual(response.body.id, cardId);
            assertNoToken(response.body);
        });

        await check('GET /:id de outro usuario responde 404', async () => {
            const response = await call('GET', `/${cardId}`, { token: strangerToken });
            assertStatus(response, 404, 'detalhe do estranho');
        });

        await check('GET /:id de admin para cartao alheio responde 404', async () => {
            const response = await call('GET', `/${cardId}`, { token: adminToken });
            assertStatus(response, 404, 'detalhe do admin');
        });

        await check('GET /:id invalido responde 400', async () => {
            const response = await call('GET', '/nao-e-uuid', { token });
            assertStatus(response, 400, 'uuid invalido');
        });

        await check('GET /:id inexistente responde 404', async () => {
            const response = await call('GET', `/${uuid.generateId()}`, { token });
            assertStatus(response, 404, 'inexistente');
        });

        // ---------- atualizacao ----------

        await check('PUT /:id sem campos responde 400', async () => {
            const response = await call('PUT', `/${cardId}`, { token, body: {} });
            assertStatus(response, 400, 'sem campos');
        });

        await check('PUT /:id com uuid invalido responde 400', async () => {
            const response = await call('PUT', '/nao-e-uuid', { token, body: { brand: 'elo' } });
            assertStatus(response, 400, 'uuid invalido');
        });

        await check('PUT /:id inexistente responde 404', async () => {
            const response = await call('PUT', `/${uuid.generateId()}`, { token, body: { brand: 'elo' } });
            assertStatus(response, 404, 'inexistente');
        });

        await check('PUT /:id valido atualiza o cartao', async () => {
            const response = await call('PUT', `/${cardId}`, {
                token,
                body: { brand: 'Mastercard', expiration_month: 12 }
            });
            assertStatus(response, 200, 'atualizacao');
            assert.strictEqual(response.body.card.brand, 'Mastercard');
            assert.strictEqual(response.body.card.expiration_month, 12);
            assertNoToken(response.body.card);
        });

        await check('PUT /:id somente com o mes usa a validade ja gravada', async () => {
            const response = await call('PUT', `/${cardId}`, { token, body: { expiration_month: 1 } });
            assertStatus(response, 200, 'somente mes');
            assert.strictEqual(response.body.card.expiration_month, 1);
            assert.strictEqual(response.body.card.expiration_year, futureYear);
        });

        await check('PUT /:id com validade vencida responde 400', async () => {
            const response = await call('PUT', `/${cardId}`, { token, body: { expiration_year: 2020 } });
            assertStatus(response, 400, 'vencimento');
        });

        await check('PUT /:id troca o payment_token sem expor o novo valor', async () => {
            const newToken = `tok_novo_${suffix}`;
            const response = await call('PUT', `/${cardId}`, { token, body: { payment_token: newToken } });
            assertStatus(response, 200, 'troca de token');
            assertNoToken(response.body.card);

            const [rows] = await connect.promise().query(
                'SELECT payment_token FROM card WHERE id = ?',
                [uuid.toBin(cardId)]
            );
            assert.strictEqual(rows[0].payment_token, newToken);
        });

        await check('PUT /:id ignora id_user enviado no corpo', async () => {
            const response = await call('PUT', `/${cardId}`, { token, body: { brand: 'Visa', id_user: strangerId } });
            assertStatus(response, 200, 'spoof de id_user no update');
            assert.strictEqual(response.body.card.id_user, ownerId);
        });

        await check('PUT /:id so com campo nao editavel responde 400', async () => {
            const response = await call('PUT', `/${cardId}`, { token, body: { id_user: strangerId } });
            assertStatus(response, 400, 'somente campo nao editavel');
        });

        await check('PUT /:id de outro usuario responde 404', async () => {
            const response = await call('PUT', `/${cardId}`, {
                token: strangerToken,
                body: { brand: 'elo' }
            });
            assertStatus(response, 404, 'atualizacao do estranho');
        });

        // ---------- exclusao ----------

        await check('DELETE /:id de outro usuario responde 404', async () => {
            const response = await call('DELETE', `/${cardId}`, { token: strangerToken });
            assertStatus(response, 404, 'exclusao do estranho');
        });

        await check('DELETE /:id com uuid invalido responde 400', async () => {
            const response = await call('DELETE', '/nao-e-uuid', { token });
            assertStatus(response, 400, 'uuid invalido');
        });

        await check('DELETE /:id inexistente responde 404', async () => {
            const response = await call('DELETE', `/${uuid.generateId()}`, { token });
            assertStatus(response, 404, 'inexistente');
        });

        await check('preparacao: pagamento vinculado ao cartao', async () => {
            await connect.promise().query(
                'INSERT INTO shopping (id, value, status, id_user) VALUES (?, 10.00, ?, ?)',
                [uuid.toBin(shoppingId), 'pending', uuid.toBin(ownerId)]
            );
            await connect.promise().query(
                `INSERT INTO payment (id, value, method, status, id_shopping, id_card)
                 VALUES (?, 10.00, ?, ?, ?, ?)`,
                [uuid.toBin(paymentId), 'credit_card', 'pending', uuid.toBin(shoppingId), uuid.toBin(cardId)]
            );
        });

        await check('DELETE /:id exclui o cartao', async () => {
            const response = await call('DELETE', `/${cardId}`, { token });
            assertStatus(response, 200, 'exclusao');
        });

        await check('DELETE /:id preserva o pagamento com id_card NULL', async () => {
            const [rows] = await connect.promise().query(
                'SELECT id_card FROM payment WHERE id = ?',
                [uuid.toBin(paymentId)]
            );
            assert.strictEqual(rows.length, 1, 'pagamento removido junto com o cartao');
            assert.strictEqual(rows[0].id_card, null);
        });

        await check('DELETE /:id repetido responde 404', async () => {
            const response = await call('DELETE', `/${cardId}`, { token });
            assertStatus(response, 404, 'exclusao repetida');
        });

        await check('GET /:id apos exclusao responde 404', async () => {
            const response = await call('GET', `/${cardId}`, { token });
            assertStatus(response, 404, 'apos exclusao');
        });

        await check('GET / apos exclusao mantem os demais cartoes', async () => {
            const response = await call('GET', '/', { token });
            assertStatus(response, 200, 'lista apos exclusao');
            assert.strictEqual(response.body.length, 4);
        });

        // ---------- dados sinteticos ----------

        await check('nenhum cartao aponta para usuario inexistente', async () => {
            const [rows] = await connect.promise().query(
                `SELECT COUNT(*) AS total
                 FROM card c
                 LEFT JOIN \`user\` u ON c.id_user = u.id
                 WHERE u.id IS NULL`
            );
            assert.strictEqual(Number(rows[0].total), 0);
        });
    } catch (error) {
        fail('execucao da suite', error.stack || error.message);
    } finally {
        try {
            await connect.promise().query(
                'DELETE FROM payment WHERE id_shopping = ?',
                [uuid.toBin(shoppingId)]
            );
            await connect.promise().query(
                'DELETE FROM shopping WHERE id = ?',
                [uuid.toBin(shoppingId)]
            );
        } catch (error) {
            results.push(`WARN  limpeza de pagamento: ${error.code || error.message}`);
        }

        try {
            await connect.promise().query(
                `DELETE FROM \`user\` WHERE id IN (${createdUserIds.map(() => '?').join(', ')})`,
                createdUserIds.map((id) => uuid.toBin(id))
            );
        } catch (error) {
            results.push(`WARN  limpeza de usuarios: ${error.code || error.message}`);
        }

        try {
            const [left] = await connect.promise().query(
                `SELECT COUNT(*) AS total FROM card WHERE id_user IN (${createdUserIds.map(() => '?').join(', ')})`,
                createdUserIds.map((id) => uuid.toBin(id))
            );
            results.push(`INFO  cartoes sinteticos restantes: ${left[0].total}`);
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
