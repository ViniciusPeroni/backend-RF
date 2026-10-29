'use strict';

/**
 * Teste de integracao da funcionalidade de localizacao.
 *
 * Requer MySQL de desenvolvimento e a variavel RF_TEST_ALLOW_DB=1.
 * O script cria usuarios sinteticos, exercita as rotas de /localization e
 * remove tudo no final.
 *
 * Uso (PowerShell):
 *   $env:RF_TEST_ALLOW_DB="1"; npm run test:localization
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
const localizationRoutes = require('../src/routes/modules/localizationRoutes');

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

function assertUuid(value, label) {
    assert.ok(
        typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
        `${label}: esperado UUID, recebido ${JSON.stringify(value)}`
    );
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
    const buyerId = uuid.generateId();
    const createdUserIds = [ownerId, strangerId, adminId, buyerId];

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api/reaproveitafranca/localization', localizationRoutes);

    const httpServer = http.createServer(app);
    await new Promise((resolve) => httpServer.listen(0, resolve));

    const base = `http://127.0.0.1:${httpServer.address().port}/api/reaproveitafranca/localization`;

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
             VALUES (?, 'user', 'Teste Loc Dono', ?, 'active'),
                    (?, 'user', 'Teste Loc Estranho', ?, 'active'),
                    (?, 'admin', 'Teste Loc Admin', ?, 'active'),
                    (?, 'user', 'Teste Loc Comprador', ?, 'active')`,
            [
                uuid.toBin(ownerId), `loc-owner-${suffix}@example.test`,
                uuid.toBin(strangerId), `loc-stranger-${suffix}@example.test`,
                uuid.toBin(adminId), `loc-admin-${suffix}@example.test`,
                uuid.toBin(buyerId), `loc-buyer-${suffix}@example.test`
            ]
        );

        const token = jwt.sign({ id: ownerId, role: 'user', name: 'Teste Loc Dono' }, process.env.SECRET, { expiresIn: '1h' });
        const strangerToken = jwt.sign({ id: strangerId, role: 'user', name: 'Teste Loc Estranho' }, process.env.SECRET, { expiresIn: '1h' });
        const buyerToken = jwt.sign({ id: buyerId, role: 'user', name: 'Teste Loc Comprador' }, process.env.SECRET, { expiresIn: '1h' });
        const adminToken = jwt.sign({ id: adminId, role: 'admin', name: 'Teste Loc Admin' }, process.env.SECRET, { expiresIn: '1h' });

        const validLocalization = {
            userId: ownerId,
            zipCode: '14400000',
            street: 'Rua X',
            neighborhood: 'Centro',
            number: '100',
            city: 'Franca',
            state: 'SP'
        };

        let ownerLocId = null;

        await check('POST / sem token responde 401', async () => {
            const response = await call('POST', '/', { body: validLocalization });
            assertStatus(response, 401, 'criacao sem token');
        });

        await check('POST / com token cria localizacao para o proprio usuario', async () => {
            const response = await call('POST', '/', { token, body: validLocalization });
            assertStatus(response, 201, 'criacao autenticada');
            assert.ok(response.body.message, 'message ausente na resposta');
            assertUuid(response.body.id, 'id da localizacao');
            ownerLocId = response.body.id;
            assert.strictEqual(response.body.latitude, undefined, 'latitude exposta sem ser enviada');
            assert.strictEqual(response.body.longitude, undefined, 'longitude exposta sem ser enviada');
        });

        await check('POST / com token e userId de outro usuario responde 403', async () => {
            const response = await call('POST', '/', {
                token,
                body: { ...validLocalization, userId: strangerId }
            });
            assertStatus(response, 403, 'criacao para usuario alheio');
            assert.ok(response.body.error, 'error ausente na resposta');
        });

        await check('POST / com CEP invalido responde 400', async () => {
            const response = await call('POST', '/', {
                token,
                body: { ...validLocalization, zipCode: '123' }
            });
            assertStatus(response, 400, 'CEP invalido');
            assert.ok(response.body.error, 'error ausente na resposta');
        });

        await check('GET / sem token responde 401', async () => {
            const response = await call('GET', '/');
            assertStatus(response, 401, 'sem token');
        });

        await check('GET / lista apenas localizacoes do dono', async () => {
            // Localizacao de outro usuario servida pelo mesmo POST autenticado:
            // ela nao pode aparecer na lista do dono.
            const strangerLoc = await call('POST', '/', {
                token: strangerToken,
                body: { ...validLocalization, userId: strangerId, zipCode: '14400222' }
            });
            assertStatus(strangerLoc, 201, 'criacao da localizacao do estranho');

            const response = await call('GET', '/', { token });
            assertStatus(response, 200, 'lista');
            assert.ok(Array.isArray(response.body), 'resposta nao e lista');
            const created = response.body.find((item) => item.id === ownerLocId);
            assert.ok(created, 'localizacao criada ausente da lista');
            assertUuid(created.id, 'id listado');
            assert.strictEqual(created.latitude, null, 'latitude deveria ser null');
            assert.strictEqual(created.longitude, null, 'longitude deveria ser null');
            assert.strictEqual(created.zip_code, '14400000', 'zip_code listado');

            const leaked = response.body.find((item) => item.id === strangerLoc.body.id);
            assert.strictEqual(leaked, undefined, 'localizacao de outro usuario vazou na listagem');
        });

        await check('GET /:id de estranho responde 404', async () => {
            const response = await call('GET', `/${ownerLocId}`, { token: strangerToken });
            assertStatus(response, 404, 'leitura de estranho');
        });

        await check('PUT /:id do dono altera rua e CEP', async () => {
            const response = await call('PUT', `/${ownerLocId}`, {
                token,
                body: { street: 'Av. Brasil', zipCode: '14400111' }
            });
            assertStatus(response, 200, 'atualizacao');
            assert.strictEqual(response.body.localization.street, 'Av. Brasil', 'street nao atualizada');
            assert.strictEqual(String(response.body.localization.zip_code), '14400111', 'zip_code nao atualizado');
        });

        await check('PUT /:id sem campos responde 400', async () => {
            const response = await call('PUT', `/${ownerLocId}`, { token, body: {} });
            assertStatus(response, 400, 'corpo vazio');
        });

        await check('PUT /:id com latitude fora de faixa responde 400', async () => {
            const response = await call('PUT', `/${ownerLocId}`, {
                token,
                body: { latitude: -91 }
            });
            assertStatus(response, 400, 'latitude invalida');
        });

        await check('PUT /:id com number null responde 400', async () => {
            const response = await call('PUT', `/${ownerLocId}`, {
                token,
                body: { number: null }
            });
            assertStatus(response, 400, 'number null');
            assert.ok(response.body.error, 'error ausente na resposta');
            assert.ok(
                !JSON.stringify(response.body).includes('null"'),
                'null serializado no corpo do erro'
            );
        });

        await check('PUT /:id de estranho responde 404', async () => {
            const response = await call('PUT', `/${ownerLocId}`, {
                token: strangerToken,
                body: { street: 'Rua Invasao' }
            });
            assertStatus(response, 404, 'edicao de estranho');
        });

        await check('PUT /:id com latitude/longitude validos persiste', async () => {
            const response = await call('PUT', `/${ownerLocId}`, {
                token,
                body: { latitude: -21.12345678, longitude: -47.98765432 }
            });
            assertStatus(response, 200, 'atualizacao de coordenadas');
            assert.ok(
                Math.abs(Number(response.body.localization.latitude) - (-21.12345678)) < 1e-6,
                `latitude divergente: ${response.body.localization.latitude}`
            );
            assert.ok(
                Math.abs(Number(response.body.localization.longitude) - (-47.98765432)) < 1e-6,
                `longitude divergente: ${response.body.localization.longitude}`
            );
        });

        // A localizacao principal e usada pelos testes da visao publica (RN10),
        // entao o DELETE usa uma localizacao separada, livre de vinculos.
        await check('DELETE de localizacao livre; GET e DELETE repetido respondem 404', async () => {
            const created = await call('POST', '/', {
                token,
                body: { ...validLocalization, zipCode: '14400999' }
            });
            assertStatus(created, 201, 'criacao para exclusao');
            const locId = created.body.id;

            const deleted = await call('DELETE', `/${locId}`, { token });
            assertStatus(deleted, 200, 'exclusao');

            const afterGet = await call('GET', `/${locId}`, { token });
            assertStatus(afterGet, 404, 'leitura apos exclusao');

            const afterDelete = await call('DELETE', `/${locId}`, { token });
            assertStatus(afterDelete, 404, 'exclusao repetida');
        });

        await check('DELETE de estranho responde 404', async () => {
            const response = await call('DELETE', `/${ownerLocId}`, { token: strangerToken });
            assertStatus(response, 404, 'exclusao de estranho');
        });

        // ---------- visao publica do anuncio (RN10 / RF14) ----------
        // Produto do dono apontando para a localizacao principal (que tem
        // coordenadas ja persistidas) + reserva pendente do comprador.

        const productId = uuid.generateId();
        const shoppingId = uuid.generateId();
        const shoppingLinkId = uuid.generateId();

        await connect.promise().query(
            `INSERT INTO product (id, name, price, category, type_negotiation, weight, conservation_state, id_user, id_localization)
             VALUES (?, ?, 50.00, 'madeira', 'sale', 10.00, 'good', ?, ?)`,
            [
                uuid.toBin(productId), `Anuncio Loc ${suffix}`,
                uuid.toBin(ownerId), uuid.toBin(ownerLocId)
            ]
        );

        await connect.promise().query(
            `INSERT INTO shopping (id, value, status, id_user) VALUES (?, 50.00, 'pending', ?)`,
            [uuid.toBin(shoppingId), uuid.toBin(buyerId)]
        );

        await connect.promise().query(
            `INSERT INTO shopping_product (id, value, quantity, id_product, id_shopping)
             VALUES (?, 50.00, 1, ?, ?)`,
            [uuid.toBin(shoppingLinkId), uuid.toBin(productId), uuid.toBin(shoppingId)]
        );

        let anonBody = null;

        await check('visao publica anonima e mascarada (RN10)', async () => {
            const response = await call('GET', `/product/${productId}`);
            assertStatus(response, 200, 'visao anonima');

            const publicLocation = response.body;
            assert.strictEqual(publicLocation.addressFull, false, 'addressFull deveria ser false');
            assert.strictEqual(publicLocation.city, 'Franca', 'city ausente');
            assert.strictEqual(publicLocation.neighborhood, 'Centro', 'neighborhood ausente');
            assert.strictEqual(publicLocation.street, undefined, 'street vazada');
            assert.strictEqual(publicLocation.number, undefined, 'number vazado');
            assert.strictEqual(publicLocation.zipCode, undefined, 'zipCode vazado');
            assert.strictEqual(publicLocation.state, undefined, 'state vazado');
            assert.ok(
                Math.abs(Number(publicLocation.latitude) - (-21.12)) < 1e-9,
                `latitude nao arredondada: ${publicLocation.latitude}`
            );
            assert.ok(
                Math.abs(Number(publicLocation.longitude) - (-47.99)) < 1e-9,
                `longitude nao arredondada: ${publicLocation.longitude}`
            );

            anonBody = publicLocation;
        });

        await check('token invalido na visao publica responde mascarado e 200', async () => {
            const response = await call('GET', `/product/${productId}`, { token: 'token-invalido' });
            assertStatus(response, 200, 'token invalido');
            assert.deepStrictEqual(response.body, anonBody, 'corpo difere do anonimo');
        });

        await check('token expirado na visao publica responde mascarado e 200', async () => {
            const expiredToken = jwt.sign(
                { id: ownerId, role: 'user', name: 'Teste Loc Dono' },
                process.env.SECRET,
                { expiresIn: '-1s' }
            );

            const response = await call('GET', `/product/${productId}`, { token: expiredToken });
            assertStatus(response, 200, 'token expirado');
            assert.deepStrictEqual(response.body, anonBody, 'corpo difere do anonimo');
        });

        await check('comprador com shopping pending e mascarado', async () => {
            const response = await call('GET', `/product/${productId}`, { token: buyerToken });
            assertStatus(response, 200, 'comprador pending');
            assert.strictEqual(response.body.addressFull, false, 'addressFull deveria ser false');
            assert.strictEqual(response.body.street, undefined, 'street vazada para pending');
        });

        await check('comprador apos aceite ve endereco completo', async () => {
            await connect.promise().query(
                'UPDATE shopping SET status = ? WHERE id = ?',
                ['accepted', uuid.toBin(shoppingId)]
            );

            const response = await call('GET', `/product/${productId}`, { token: buyerToken });
            assertStatus(response, 200, 'comprador accepted');
            assert.strictEqual(response.body.addressFull, true, 'addressFull deveria ser true');
            assert.strictEqual(response.body.street, 'Av. Brasil', 'street ausente');
            assert.strictEqual(String(response.body.zipCode), '14400111', 'zipCode ausente');
            assert.strictEqual(response.body.number, '100', 'number ausente');
            assert.strictEqual(response.body.state, 'SP', 'state ausente');
            assert.ok(
                Math.abs(Number(response.body.latitude) - (-21.12345678)) < 1e-6,
                `latitude divergente: ${response.body.latitude}`
            );
            assert.ok(
                Math.abs(Number(response.body.longitude) - (-47.98765432)) < 1e-6,
                `longitude divergente: ${response.body.longitude}`
            );
        });

        await check('dono ve endereco completo', async () => {
            const response = await call('GET', `/product/${productId}`, { token });
            assertStatus(response, 200, 'dono');
            assert.strictEqual(response.body.addressFull, true, 'addressFull deveria ser true');
            assert.strictEqual(response.body.street, 'Av. Brasil', 'street ausente');
        });

        await check('admin fora da negociacao permanece mascarado', async () => {
            const response = await call('GET', `/product/${productId}`, { token: adminToken });
            assertStatus(response, 200, 'admin');
            assert.strictEqual(response.body.addressFull, false, 'admin nao deveria ver endereco completo');
            assert.strictEqual(response.body.street, undefined, 'street vazada para admin');
        });

        await check('produto inexistente responde 404', async () => {
            const response = await call('GET', `/product/${uuid.generateId()}`);
            assertStatus(response, 404, 'produto inexistente');
        });

        await check('productId invalido responde 400', async () => {
            const response = await call('GET', '/product/nao-e-uuid');
            assertStatus(response, 400, 'productId invalido');
        });

        await check('DELETE de localizacao vinculada a anuncio responde 409', async () => {
            const response = await call('DELETE', `/${ownerLocId}`, { token });
            assertStatus(response, 409, 'exclusao bloqueada');
            assert.ok(response.body.error, 'error ausente na resposta');
            assert.ok(
                String(response.body.error).includes('vinculada'),
                `mensagem fora do contrato: ${response.body.error}`
            );
            assert.ok(
                !JSON.stringify(response.body).includes('ER_ROW_IS_REFERENCED'),
                'erro cru do MySQL vazado na resposta'
            );
        });

        await check('PUT /:id com latitude/longitude null limpa as coordenadas', async () => {
            const response = await call('PUT', `/${ownerLocId}`, {
                token,
                body: { latitude: null, longitude: null }
            });
            assertStatus(response, 200, 'limpeza de coordenadas');
            assert.strictEqual(response.body.localization.latitude, null, 'latitude deveria ter sido limpa');
            assert.strictEqual(response.body.localization.longitude, null, 'longitude deveria ter sido limpa');
        });
    } catch (error) {
        fail('execucao da suite', error.stack || error.message);
    } finally {
        try {
            await connect.promise().query(
                'DELETE FROM shopping_product WHERE id_product IN (SELECT id FROM product WHERE id_user IN (?))',
                [createdUserIds.map((id) => uuid.toBin(id))]
            );
        } catch (error) {
            results.push(`WARN  limpeza de shopping_product: ${error.code || error.message}`);
        }

        try {
            await connect.promise().query(
                'DELETE FROM shopping WHERE id_user IN (?)',
                [createdUserIds.map((id) => uuid.toBin(id))]
            );
        } catch (error) {
            results.push(`WARN  limpeza de shopping: ${error.code || error.message}`);
        }

        try {
            await connect.promise().query(
                'DELETE FROM product WHERE id_user IN (?)',
                [createdUserIds.map((id) => uuid.toBin(id))]
            );
        } catch (error) {
            results.push(`WARN  limpeza de product: ${error.code || error.message}`);
        }

        try {
            await connect.promise().query(
                'DELETE FROM localization WHERE id_user IN (?)',
                [createdUserIds.map((id) => uuid.toBin(id))]
            );
        } catch (error) {
            results.push(`WARN  limpeza de localization: ${error.code || error.message}`);
        }

        try {
            await connect.promise().query(
                `DELETE FROM \`user\` WHERE id IN (${createdUserIds.map(() => '?').join(', ')})`,
                createdUserIds.map((id) => uuid.toBin(id))
            );
        } catch (error) {
            results.push(`WARN  limpeza de usuarios: ${error.code || error.message}`);
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
