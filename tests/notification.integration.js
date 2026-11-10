'use strict';

/**
 * Teste de integração da funcionalidade de notificações.
 *
 * Requer MySQL de desenvolvimento e a variável RF_TEST_ALLOW_DB=1.
 * O script cria usuários/produtos/notificações sintéticos e remove tudo no final.
 *
 * Uso (PowerShell):
 *   $env:RF_TEST_ALLOW_DB="1"; npm run test:notification
 */

const path = require('path');
const http = require('http');
const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { connectNotificationSocket } = require('./helpers/notificationSocketClient');

const ROOT = path.resolve(__dirname, '..');

require(path.join(ROOT, 'node_modules', 'dotenv')).config({
    path: path.join(ROOT, '.env'),
    quiet: true
});

const connect = require('../src/db/connect');
const uuid = require('../src/utils/uuid');
const notificationRoutes = require('../src/routes/modules/notificationRoutes');
const otpRoutes = require('../src/routes/modules/otpRoutes');
const shoppingRoutes = require('../src/routes/modules/shoppingRoutes');
const reviewRoutes = require('../src/routes/modules/reviewRoutes');
const disputeRoutes = require('../src/routes/modules/disputeRoutes');
const { runReviewDisputeNotificationTests } = require('./helpers/reviewDisputeNotifications');
const shoppingService = require('../src/services/shoppingService');
const notificationService = require('../src/services/notificationService');
const {
    notificationSocket,
    userRoom,
    emitToUser
} = require('../src/sockets/notificationSocket');
const chatSocket = require('../src/sockets/chatSocket');
const startSockets = require('../src/sockets');

const results = [];
let failed = 0;

function pass(name) {
    results.push(`PASS  ${name}`);
}

function fail(name, error) {
    failed += 1;
    results.push(`FAIL  ${name} :: ${error && (error.message || error)}`);
}

function skip(name, reason) {
    results.push(`SKIP  ${name} :: ${reason}`);
}

function check(name, fn) {
    try {
        fn();
        pass(name);
    } catch (error) {
        fail(name, error);
    }
}

async function checkAsync(name, fn) {
    try {
        await fn();
        pass(name);
    } catch (error) {
        fail(name, error);
    }
}

function assertStatus(response, expected, label) {
    assert.strictEqual(
        response.status,
        expected,
        `${label}: esperado ${expected}, recebido ${response.status} — ${JSON.stringify(response.body)}`
    );
}

async function main() {
    if (process.env.RF_TEST_ALLOW_DB !== '1') {
        console.error(
            'Recusando executar: defina RF_TEST_ALLOW_DB=1 para confirmar que o banco é de teste/desenvolvimento.'
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
        console.error('Recusando executar: MySQL indisponível —', error.code || error.message);
        process.exit(1);
    }

    const suffix = Date.now();
    const buyerId = uuid.generateId();
    const sellerBId = uuid.generateId();
    const sellerCId = uuid.generateId();
    const adminId = uuid.generateId();
    const conversationId = uuid.generateId();
    const locBId = uuid.generateId();
    const locCId = uuid.generateId();
    const productB1Id = uuid.generateId();
    const productB2Id = uuid.generateId();
    const productC1Id = uuid.generateId();

    const shoppingIds = [];
    const extraUserIds = [];
    let signupUserId = null;
    const otpUserId = uuid.generateId();
    let httpServer;
    let realIo;
    const realClients = [];
    let userRoutes = null;
    let signupSkipReason = null;

    try {
        const [existing] = await connect.promise().query(
            'SELECT COUNT(*) AS total FROM `user`'
        );
        results.push(`INFO  usuários antes do teste: ${existing[0].total}`);

        // A rota de cadastro depende de google-auth-library. Se a dependência
        // não estiver instalada, o restante da suíte continua e o caso é SKIP.
        try {
            userRoutes = require('../src/routes/modules/userRoutes');
        } catch (error) {
            if (error.code === 'MODULE_NOT_FOUND' && /google-auth-library/.test(error.message)) {
                signupSkipReason = 'google-auth-library ausente; execute npm install para testar o cadastro';
            } else {
                throw error;
            }
        }

        await connect.promise().query(
            `INSERT INTO \`user\` (id, role, name, email, status)
             VALUES (?, 'user', 'Teste Comprador', ?, 'active'),
                    (?, 'user', 'Teste Vendedor B', ?, 'active'),
                    (?, 'user', 'Teste Vendedor C', ?, 'active'),
                    (?, 'user', 'Teste OTP', ?, 'awaitingForEmail')`,
            [
                uuid.toBin(buyerId), `notif-buyer-${suffix}@example.test`,
                uuid.toBin(sellerBId), `notif-seller-b-${suffix}@example.test`,
                uuid.toBin(sellerCId), `notif-seller-c-${suffix}@example.test`,
                uuid.toBin(otpUserId), `notif-otp-${suffix}@example.test`
            ]
        );

        const insertLocalization = async (id, userId, zip, street) => {
            await connect.promise().query(
                `INSERT INTO localization
                    (id, zip_code, street, neighborhood, number, city, state, id_user)
                 VALUES (?, ?, ?, 'Centro', '123', 'Franca', 'SP', ?)`,
                [uuid.toBin(id), zip, street, uuid.toBin(userId)]
            );
        };

        const insertProduct = async ({ id, sellerId, localizationId, name, price }) => {
            await connect.promise().query(
                `INSERT INTO product
                    (id, name, description, price, quantity, status, category,
                     type_negotiation, weight, conservation_state, id_user, id_localization)
                 VALUES (?, ?, 'Produto sintético de teste', ?, 10, 'available', 'madeira',
                         'sale', 1.00, 'good', ?, ?)`,
                [
                    uuid.toBin(id),
                    name,
                    price,
                    uuid.toBin(sellerId),
                    uuid.toBin(localizationId)
                ]
            );
        };

        await insertLocalization(locBId, sellerBId, '14400000', 'Rua B');
        await insertLocalization(locCId, sellerCId, '14400001', 'Rua C');

        await insertProduct({
            id: productB1Id,
            sellerId: sellerBId,
            localizationId: locBId,
            name: 'Madeira Teste',
            price: 10.00
        });
        await insertProduct({
            id: productB2Id,
            sellerId: sellerBId,
            localizationId: locBId,
            name: 'Metal Teste',
            price: 5.00
        });
        await insertProduct({
            id: productC1Id,
            sellerId: sellerCId,
            localizationId: locCId,
            name: 'Vidro Teste',
            price: 7.00
        });

        const app = express();
        app.use(express.json());
        app.use('/api/reaproveitafranca/notification', notificationRoutes);
        app.use('/api/reaproveitafranca/otp', otpRoutes);
        app.use('/api/reaproveitafranca/shopping', shoppingRoutes);
        app.use('/api/reaproveitafranca/review', reviewRoutes);
        app.use('/api/reaproveitafranca/dispute', disputeRoutes);
        if (userRoutes) {
            app.use('/api/reaproveitafranca/user', userRoutes);
        }

        httpServer = http.createServer(app);
        await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
        results.push(`INFO  servidor HTTP de teste na porta ${httpServer.address().port}`);

        const req = async (method, requestPath, token, body) => {
            const headers = {};
            if (token) headers.authorization = `Bearer ${token}`;

            let payload;
            if (body !== undefined) {
                headers['content-type'] = 'application/json';
                payload = JSON.stringify(body);
            }

            const response = await fetch(
                `http://127.0.0.1:${httpServer.address().port}${requestPath}`,
                { method, headers, body: payload }
            );

            const text = await response.text();
            let json = null;
            if (text) {
                try { json = JSON.parse(text); } catch { json = text; }
            }

            return { status: response.status, body: json };
        };

        const tokenA = jwt.sign(
            { id: buyerId, role: 'user', name: 'Teste Comprador' },
            process.env.SECRET,
            { expiresIn: '1h' }
        );
        const tokenB = jwt.sign(
            { id: sellerBId, role: 'user', name: 'Teste Vendedor B' },
            process.env.SECRET,
            { expiresIn: '1h' }
        );
        const tokenC = jwt.sign(
            { id: sellerCId, role: 'user', name: 'Teste Vendedor C' },
            process.env.SECRET,
            { expiresIn: '1h' }
        );
        const adminToken = jwt.sign(
            { id: adminId, role: 'admin', name: 'Admin Teste' },
            process.env.SECRET,
            { expiresIn: '1h' }
        );

        const listNotifications = async (userId, type) => {
            const params = [uuid.toBin(userId)];
            let filter = '';
            if (type) {
                filter = ' AND type = ?';
                params.push(type);
            }

            const [rows] = await connect.promise().query(
                `SELECT BIN_TO_UUID(id) AS id, type, title, content, reference_table,
                        BIN_TO_UUID(reference_id) AS reference_id
                 FROM notification
                 WHERE id_user = ?${filter}`,
                params
            );
            return rows;
        };

        // =================================================================
        // Socket de notificação: JWT -> sala individual e emissão
        // =================================================================
        let notificationConnection;
        const socketEmissions = [];
        const fakeNotificationIo = {
            on(event, handler) {
                if (event === 'connection') notificationConnection = handler;
            },
            to(room) {
                return {
                    emit(event, payload) {
                        socketEmissions.push({ room, event, payload });
                    }
                };
            }
        };
        notificationSocket(fakeNotificationIo);

        // =================================================================
        // CRUD HTTP de notificações
        // =================================================================
        let r = await req('GET', '/api/reaproveitafranca/notification/');
        check('GET /notification sem token retorna 401', () => assertStatus(r, 401, 'sem token'));

        r = await req('GET', '/api/reaproveitafranca/notification/', 'token-invalido');
        check('GET /notification com token inválido retorna 401', () => assertStatus(r, 401, 'token inválido'));

        r = await req('GET', '/api/reaproveitafranca/notification/', tokenA);
        check('GET /notification autenticado retorna lista vazia', () => {
            assertStatus(r, 200, 'lista inicial');
            assert.deepStrictEqual(r.body, []);
        });

        r = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
            type: 'sistema',
            title: 'Teste manual',
            content: 'Conteúdo do teste',
            reference_table: 'user',
            reference_id: sellerBId
        });
        check('POST /notification válido retorna 201 e UUID', () => {
            assertStatus(r, 201, 'criação válida');
            assert.ok(uuid.isValid(r.body.id), 'id deve ser UUID');
        });
        const notificationId = r.body && r.body.id;

        check('criação de notificação emite evento Socket.IO para o dono', () => {
            const event = socketEmissions.find(
                (item) => item.event === 'notification' && item.payload.id === notificationId
            );
            assert.ok(event, JSON.stringify(socketEmissions));
            assert.strictEqual(event.room, userRoom(buyerId));
        });

        r = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
            type: 'tipo_invalido',
            title: 'Teste'
        });
        check('POST /notification com type inválido retorna 400', () => assertStatus(r, 400, 'type inválido'));

        r = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
            type: 'sistema'
        });
        check('POST /notification sem title retorna 400', () => assertStatus(r, 400, 'sem title'));

        r = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
            type: 'sistema',
            title: 'X'.repeat(101)
        });
        check('POST /notification com title > 100 retorna 400', () => assertStatus(r, 400, 'title longo'));

        r = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
            type: 'sistema',
            title: 'Ref inválida',
            reference_id: 'nao-e-uuid'
        });
        check('POST /notification com reference_id inválido retorna 400', () => assertStatus(r, 400, 'reference_id inválido'));

        r = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
            type: 'sistema',
            title: 'Ref table longa',
            reference_table: 'X'.repeat(31)
        });
        check('POST /notification com reference_table > 30 retorna 400', () => assertStatus(r, 400, 'reference_table longa'));

        const invalidNotifications = [
            ['title numérico', { title: 123 }],
            ['title objeto', { title: { text: 'Título' } }],
            ['title array', { title: ['Título'] }],
            ['title em branco', { title: '   ' }],
            ['content objeto', { content: { text: 'Conteúdo' } }],
            ['content array', { content: ['Conteúdo'] }],
            ['content booleano', { content: false }],
            ['content numérico', { content: 123 }],
            ['content excede TEXT em UTF-8', { content: 'á'.repeat(32768) }],
            ['reference_table objeto', { reference_table: { table: 'user' } }],
            ['reference_table array', { reference_table: ['user'] }],
            ['reference_table numérico', { reference_table: 123 }],
            ['reference_table em branco', { reference_table: '  ' }],
            ['reference_id vazio', { reference_id: '' }],
            ['reference_id numérico', { reference_id: 0 }]
        ];
        for (const [label, fields] of invalidNotifications) {
            const before = await listNotifications(buyerId);
            const response = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
                type: 'sistema', title: 'Payload inválido', ...fields
            });
            const after = await listNotifications(buyerId);
            check(`POST /notification rejeita ${label}`, () => {
                assertStatus(response, 400, label);
                assert.strictEqual(after.length, before.length, 'payload inválido não deve inserir notificação');
            });
            // Evita que uma regressão na validação contamine os próximos cenários.
            if (response.status === 201) {
                await req('DELETE', `/api/reaproveitafranca/notification/${response.body.id}`, tokenA);
            }
        }

        for (const query of ['read[valor]=sim', 'type[valor]=sistema', 'read=sim&read=nao', 'type=sistema&type=nova_review']) {
            const response = await req('GET', `/api/reaproveitafranca/notification/?${query}`, tokenA);
            check(`filtro composto rejeitado: ${query}`, () => assertStatus(response, 400, 'filtro composto'));
        }

        const nullable = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
            type: 'sistema', title: 'Campos opcionais', content: null, reference_table: null, reference_id: null
        });
        check('campos opcionais nulos continuam válidos', () => assertStatus(nullable, 201, 'opcionais nulos'));
        if (nullable.status === 201) {
            await req('DELETE', `/api/reaproveitafranca/notification/${nullable.body.id}`, tokenA);
        }

        for (const body of [[], undefined]) {
            const response = await req('POST', '/api/reaproveitafranca/notification/', tokenA, body);
            check(`POST /notification rejeita corpo ${body ? 'array' : 'ausente'}`, () => assertStatus(response, 400, 'corpo inválido'));
        }

        const boundary = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
            type: 'sistema', title: 'X'.repeat(100), reference_table: 'x'.repeat(30), content: 'x'.repeat(65535)
        });
        await checkAsync('limites válidos de title, reference_table e TEXT são aceitos sem truncar', async () => {
            assertStatus(boundary, 201, 'limites válidos');
            const saved = await req('GET', `/api/reaproveitafranca/notification/${boundary.body.id}`, tokenA);
            assertStatus(saved, 200, 'leitura dos limites');
            assert.strictEqual(saved.body.title.length, 100);
            assert.strictEqual(saved.body.reference_table.length, 30);
            assert.strictEqual(Buffer.byteLength(saved.body.content, 'utf8'), 65535);
        });
        if (boundary.status === 201) await req('DELETE', `/api/reaproveitafranca/notification/${boundary.body.id}`, tokenA);

        r = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
            type: 'sistema',
            title: 'Ignora id_user do body',
            id_user: sellerBId
        });
        const forgedId = r.body && r.body.id;
        check('POST /notification ignora id_user do body e usa o token', () => {
            assertStatus(r, 201, 'id_user forjado');
            assert.ok(forgedId);
        });

        r = await req('GET', '/api/reaproveitafranca/notification/', tokenB);
        check('usuário B não recebe notificação criada para A', () => {
            assertStatus(r, 200, 'lista de B');
            assert.deepStrictEqual(r.body, []);
        });

        r = await req('GET', '/api/reaproveitafranca/notification/unread/count', tokenA);
        check('GET /notification/unread/count conta 2 não lidas', () => {
            assertStatus(r, 200, 'contagem');
            assert.strictEqual(r.body.total, 2);
        });

        r = await req('GET', `/api/reaproveitafranca/notification/${notificationId}`, tokenA);
        check('GET /notification/:id do dono retorna a notificação', () => {
            assertStatus(r, 200, 'dono');
            assert.strictEqual(r.body.id, notificationId);
            assert.strictEqual(r.body.read, 'nao');
            assert.strictEqual(r.body.id_user, buyerId);
        });

        r = await req('GET', `/api/reaproveitafranca/notification/${notificationId}`, tokenB);
        check('GET /notification/:id de outro usuário retorna 404', () => assertStatus(r, 404, 'outro usuário'));

        r = await req('GET', '/api/reaproveitafranca/notification/id-invalido', tokenA);
        check('GET /notification/:id inválido retorna 400', () => assertStatus(r, 400, 'UUID inválido'));

        r = await req('PATCH', `/api/reaproveitafranca/notification/${notificationId}/read`, tokenB);
        check('PATCH /notification/:id/read de outro usuário retorna 404', () => assertStatus(r, 404, 'outro usuário'));

        r = await req('PATCH', `/api/reaproveitafranca/notification/${notificationId}/read`, tokenA);
        check('PATCH /notification/:id/read do dono marca como lida', () => {
            assertStatus(r, 200, 'dono');
            assert.strictEqual(r.body.notification.read, 'sim');
            assert.ok(r.body.notification.read_in);
        });

        r = await req('GET', '/api/reaproveitafranca/notification/?read=sim', tokenA);
        check('filtro read=sim retorna somente lidas', () => {
            assertStatus(r, 200, 'filtro sim');
            assert.ok(r.body.some((n) => n.id === notificationId));
            assert.ok(r.body.every((n) => n.read === 'sim'));
        });

        r = await req('GET', '/api/reaproveitafranca/notification/?read=nao', tokenA);
        check('filtro read=nao retorna somente não lidas', () => {
            assertStatus(r, 200, 'filtro não');
            assert.ok(r.body.every((n) => n.read === 'nao'));
            assert.ok(!r.body.some((n) => n.id === notificationId));
        });

        r = await req('GET', '/api/reaproveitafranca/notification/?read=talvez', tokenA);
        check('filtro read inválido retorna 400', () => assertStatus(r, 400, 'read inválido'));

        r = await req('GET', '/api/reaproveitafranca/notification/?type=tipo_invalido', tokenA);
        check('filtro type inválido retorna 400', () => assertStatus(r, 400, 'type inválido'));

        r = await req('PATCH', '/api/reaproveitafranca/notification/read-all', tokenA);
        check('PATCH /notification/read-all marca todas', () => {
            assertStatus(r, 200, 'read-all');
            assert.strictEqual(r.body.updated, 1);
        });

        r = await req('GET', '/api/reaproveitafranca/notification/unread/count', tokenA);
        check('contagem zera após read-all', () => {
            assertStatus(r, 200, 'contagem zerada');
            assert.strictEqual(r.body.total, 0);
        });

        r = await req('DELETE', `/api/reaproveitafranca/notification/${notificationId}`, tokenB);
        check('DELETE de outro usuário retorna 404', () => assertStatus(r, 404, 'outro usuário'));

        r = await req('DELETE', `/api/reaproveitafranca/notification/${notificationId}`, tokenA);
        check('DELETE do dono retorna 200', () => assertStatus(r, 200, 'dono'));

        r = await req('GET', `/api/reaproveitafranca/notification/${notificationId}`, tokenA);
        check('notificação excluída não é encontrada', () => assertStatus(r, 404, 'excluída'));

        // =================================================================
        // Listagem paginada e filtros por referência
        // =================================================================
        const paginationIds = [];
        for (const [index, title] of ['Paginação 1', 'Paginação 2', 'Paginação 3', 'Paginação 4'].entries()) {
            const created = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
                type: 'sistema',
                title,
                content: `Conteúdo ${index}`,
                reference_table: 'pagination',
                reference_id: index === 0 ? sellerBId : sellerCId
            });
            assertStatus(created, 201, `fixture de paginação ${index}`);
            paginationIds.push(created.body.id);
        }

        r = await req('GET', '/api/reaproveitafranca/notification/?limit=2&offset=0', tokenA);
        const page1 = r.body;
        check('GET /notification limita a primeira página', () => {
            assertStatus(r, 200, 'primeira página');
            assert.ok(Array.isArray(page1));
            assert.strictEqual(page1.length, 2);
        });

        r = await req('GET', '/api/reaproveitafranca/notification/?limit=2&offset=2', tokenA);
        const page2 = r.body;
        check('GET /notification pagina sem repetir itens', () => {
            assertStatus(r, 200, 'segunda página');
            assert.strictEqual(page2.length, 2);
            const ids = new Set(page1.map((item) => item.id));
            assert.ok(page2.every((item) => !ids.has(item.id)), 'páginas se sobrepõem');
        });

        r = await req('GET', '/api/reaproveitafranca/notification/?reference_table=pagination&limit=10', tokenA);
        check('GET /notification filtra por reference_table', () => {
            assertStatus(r, 200, 'filtro por tabela');
            assert.strictEqual(r.body.length, 4);
            assert.ok(r.body.every((item) => item.reference_table === 'pagination'));
        });

        r = await req('GET', `/api/reaproveitafranca/notification/?reference_table=pagination&reference_id=${sellerBId}`, tokenA);
        check('GET /notification filtra por reference_id', () => {
            assertStatus(r, 200, 'filtro por referência');
            assert.strictEqual(r.body.length, 1);
            assert.strictEqual(r.body[0].reference_id, sellerBId);
        });

        r = await req('GET', '/api/reaproveitafranca/notification/?reference_table=%20pagination%20&limit=10', tokenA);
        check('GET /notification normaliza reference_table com espaços', () => {
            assertStatus(r, 200, 'referência com espaços');
            assert.strictEqual(r.body.length, 4);
        });

        r = await req('GET', '/api/reaproveitafranca/notification/', tokenA);
        check('GET /notification sem paginação mantém o formato de array', () => {
            assertStatus(r, 200, 'sem parâmetros');
            assert.ok(Array.isArray(r.body));
            assert.ok(r.body.length >= 4);
        });

        for (const [label, query] of [
            ['limit zero', 'limit=0'],
            ['limit acima de 100', 'limit=101'],
            ['limit não inteiro', 'limit=1.5'],
            ['limit não numérico', 'limit=abc'],
            ['offset negativo', 'offset=-1'],
            ['offset não inteiro', 'offset=2.5'],
            ['offset acima do máximo', 'offset=2147483648'],
            ['reference_id inválido', 'reference_id=nao-e-uuid'],
            ['reference_table longa', `reference_table=${'t'.repeat(31)}`]
        ]) {
            r = await req('GET', `/api/reaproveitafranca/notification/?${query}`, tokenA);
            check(`GET /notification com ${label} retorna 400`, () => assertStatus(r, 400, label));
        }

        await connect.promise().query(
            `DELETE FROM notification WHERE id IN (${paginationIds.map(() => '?').join(', ')})`,
            paginationIds.map((id) => uuid.toBin(id))
        );

        // =================================================================
        // Fila de retry persistida
        // =================================================================
        const failNotificationInsert = () => {
            const originalQuery = connect.query;
            connect.query = function (sql) {
                if (typeof sql === 'string' && /INSERT\s+INTO\s+notification\s*\(/i.test(sql)) {
                    const error = new Error('falha sintética de persistência');
                    error.code = 'ER_LOCK_WAIT_TIMEOUT';
                    throw error;
                }
                return originalQuery.apply(this, arguments);
            };
            return () => { connect.query = originalQuery; };
        };

        await checkAsync('falha de persistência enfileira retry e o worker entrega com o mesmo id', async () => {
            const title = `Retry ${suffix}`;
            const restore = failNotificationInsert();
            let caught = null;
            try {
                await notificationService.notifyUser({
                    id_user: buyerId,
                    type: 'sistema',
                    title,
                    content: 'Falha antes de persistir',
                    reference_table: 'pagination'
                });
            } catch (error) {
                caught = error;
            } finally {
                restore();
            }

            assert.ok(caught, 'a falha deve continuar visível para o chamador');
            assert.strictEqual(caught.retryQueued, true);

            const [queued] = await connect.promise().query(
                `SELECT BIN_TO_UUID(id) AS id, persisted, attempts
                 FROM notification_retry
                 WHERE title = ? AND id_user = ?`,
                [title, uuid.toBin(buyerId)]
            );
            assert.strictEqual(queued.length, 1, JSON.stringify(queued));
            assert.strictEqual(Number(queued[0].persisted), 0);
            assert.strictEqual(Number(queued[0].attempts), 0);

            const result = await notificationService.retryPending({ limit: 50 });
            assert.ok(result.delivered >= 1, JSON.stringify(result));

            const [delivered] = await connect.promise().query(
                'SELECT BIN_TO_UUID(id) AS id FROM notification WHERE title = ? AND id_user = ?',
                [title, uuid.toBin(buyerId)]
            );
            assert.strictEqual(delivered.length, 1);
            assert.strictEqual(delivered[0].id, queued[0].id);

            const [remaining] = await connect.promise().query(
                'SELECT COUNT(*) AS total FROM notification_retry WHERE title = ? AND id_user = ?',
                [title, uuid.toBin(buyerId)]
            );
            assert.strictEqual(Number(remaining[0].total), 0);

            await notificationService.retryPending({ limit: 50 });
            const [afterSecondRun] = await connect.promise().query(
                'SELECT COUNT(*) AS total FROM notification WHERE title = ? AND id_user = ?',
                [title, uuid.toBin(buyerId)]
            );
            assert.strictEqual(Number(afterSecondRun[0].total), 1, 'retry duplicou a notificação');
        });

        await checkAsync('retry de linha já persistida apenas reemite sem duplicar', async () => {
            const title = `Retry persistido ${suffix}`;
            const notification = await notificationService.notifyUser({
                id_user: buyerId,
                type: 'sistema',
                title,
                content: 'Já estava no banco'
            });
            const emissionsBefore = socketEmissions
                .filter((item) => item.event === 'notification' && item.payload.id === notification.id).length;

            await connect.promise().query(
                `INSERT INTO notification_retry (id, id_user, type, title, content, persisted)
                 VALUES (?, ?, 'sistema', ?, 'Já estava no banco', 1)`,
                [uuid.toBin(notification.id), uuid.toBin(buyerId), title]
            );

            await notificationService.retryPending({ limit: 50 });

            const [rows] = await connect.promise().query(
                'SELECT COUNT(*) AS total FROM notification WHERE id = ?',
                [uuid.toBin(notification.id)]
            );
            assert.strictEqual(Number(rows[0].total), 1);
            const [retryRows] = await connect.promise().query(
                'SELECT COUNT(*) AS total FROM notification_retry WHERE id = ?',
                [uuid.toBin(notification.id)]
            );
            assert.strictEqual(Number(retryRows[0].total), 0);
            const emissionsAfter = socketEmissions
                .filter((item) => item.event === 'notification' && item.payload.id === notification.id).length;
            assert.strictEqual(emissionsAfter, emissionsBefore + 1, 'retry não reemitiu');
        });

        await checkAsync('retry descarta a linha após o máximo de tentativas', async () => {
            const title = `Retry descarte ${suffix}`;
            const retryId = uuid.generateId();
            await connect.promise().query(
                `INSERT INTO notification_retry (id, id_user, type, title, attempts)
                 VALUES (?, ?, 'sistema', ?, 4)`,
                [uuid.toBin(retryId), uuid.toBin(buyerId), title]
            );

            const restore = failNotificationInsert();
            const originalConsoleError = console.error;
            console.error = () => {};
            try {
                await notificationService.retryPending({ limit: 50, maxAttempts: 5 });
            } finally {
                console.error = originalConsoleError;
                restore();
            }

            const [retryRows] = await connect.promise().query(
                'SELECT COUNT(*) AS total FROM notification_retry WHERE id = ?',
                [uuid.toBin(retryId)]
            );
            assert.strictEqual(Number(retryRows[0].total), 0, 'linha descartada deveria sumir');
            const [notifications] = await connect.promise().query(
                'SELECT COUNT(*) AS total FROM notification WHERE id = ?',
                [uuid.toBin(retryId)]
            );
            assert.strictEqual(Number(notifications[0].total), 0);
        });

        await checkAsync('worker de retry entrega, não duplica instância e para', async () => {
            const title = `Retry worker ${suffix}`;
            const retryId = uuid.generateId();
            await connect.promise().query(
                `INSERT INTO notification_retry (id, id_user, type, title)
                 VALUES (?, ?, 'sistema', ?)`,
                [uuid.toBin(retryId), uuid.toBin(buyerId), title]
            );

            const timer = notificationService.startNotificationRetryWorker({ intervalMs: 20, limit: 10 });
            assert.strictEqual(
                notificationService.startNotificationRetryWorker({ intervalMs: 20 }),
                timer,
                'worker duplicado'
            );

            try {
                const deadline = Date.now() + 3000;
                let delivered = 0;
                while (Date.now() < deadline) {
                    const [rows] = await connect.promise().query(
                        'SELECT COUNT(*) AS total FROM notification WHERE id = ?',
                        [uuid.toBin(retryId)]
                    );
                    delivered = Number(rows[0].total);
                    if (delivered === 1) break;
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
                assert.strictEqual(delivered, 1, 'worker não entregou a notificação');
            } finally {
                notificationService.stopNotificationRetryWorker();
            }
        });

        // =================================================================
        // Ativação por OTP -> notificação automática
        // =================================================================
        await connect.promise().query(
            `INSERT INTO otp (id, user_id, code, expires_at)
             VALUES (?, ?, '123456', DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
            [uuid.toBin(uuid.generateId()), uuid.toBin(otpUserId)]
        );

        r = await req('POST', '/api/reaproveitafranca/otp/verificar', null, {
            id: otpUserId,
            code: '000000'
        });
        check('OTP com código errado retorna 401', () => assertStatus(r, 401, 'código errado'));

        const [beforeOtp] = await connect.promise().query(
            'SELECT COUNT(*) AS total FROM notification WHERE id_user = ?',
            [uuid.toBin(otpUserId)]
        );
        check('OTP inválido não cria notificação', () => {
            assert.strictEqual(Number(beforeOtp[0].total), 0);
        });

        r = await req('POST', '/api/reaproveitafranca/otp/verificar', null, {
            id: otpUserId,
            code: '123456'
        });
        check('OTP válido ativa a conta', () => assertStatus(r, 200, 'código correto'));

        const [activatedUsers] = await connect.promise().query(
            'SELECT status FROM `user` WHERE id = ?',
            [uuid.toBin(otpUserId)]
        );
        check('usuário fica com status active', () => {
            assert.strictEqual(activatedUsers[0].status, 'active');
        });

        const [otpNotifications] = await connect.promise().query(
            'SELECT type, title FROM notification WHERE id_user = ?',
            [uuid.toBin(otpUserId)]
        );
        check('OTP válido gera notificação sistema de conta ativada', () => {
            assert.strictEqual(otpNotifications.length, 1);
            assert.strictEqual(otpNotifications[0].type, 'sistema');
            assert.strictEqual(otpNotifications[0].title, 'Conta ativada');
        });

        // =================================================================
        // Cadastro -> notificação de boas-vindas (se google-auth-library existir)
        // =================================================================
        if (!userRoutes) {
            skip('cadastro gera notificação de boas-vindas', signupSkipReason);
        } else if (!process.env.DOCUMENT_ENC_KEY || !process.env.DOCUMENT_HMAC_KEY) {
            skip('cadastro gera notificação de boas-vindas', 'chaves de documento ausentes no ambiente');
        } else {
            const otpService = require('../src/services/otpService');
            const originalSendOtp = otpService.sendOtp;
            otpService.sendOtp = async () => {};

            try {
                const signupEmail = `notif-new-${suffix}@example.test`;
                r = await req('POST', '/api/reaproveitafranca/user/create', null, {
                    cpf: '12345678901',
                    name: 'Teste Cadastro Notif',
                    email: signupEmail,
                    password: 'senha123',
                    cellphone: '11999999999',
                    birthday: '1990-01-01',
                    zip_code: '14400000',
                    street: 'Rua Teste',
                    neighborhood: 'Centro',
                    number: '123',
                    city: 'Franca',
                    state: 'SP'
                });
                signupUserId = r.body && r.body.id;

                check('cadastro de usuário retorna 201', () => {
                    assertStatus(r, 201, 'cadastro');
                    assert.ok(uuid.isValid(signupUserId));
                });

                if (uuid.isValid(signupUserId)) {
                    const [welcomeNotifications] = await connect.promise().query(
                        'SELECT type, title, content FROM notification WHERE id_user = ?',
                        [uuid.toBin(signupUserId)]
                    );
                    check('cadastro gera notificação sistema de boas-vindas', () => {
                        assert.strictEqual(welcomeNotifications.length, 1);
                        assert.strictEqual(welcomeNotifications[0].type, 'sistema');
                        assert.strictEqual(
                            welcomeNotifications[0].title,
                            'Bem-vindo(a) ao Reaproveita Franca'
                        );
                        assert.ok(/conta/i.test(welcomeNotifications[0].content));
                    });
                }
            } finally {
                otpService.sendOtp = originalSendOtp;
            }
        }

        // =================================================================
        // Chat -> nova_mensagem
        // =================================================================
        const chatConnectionHandlers = [];
        const chatEmissions = [];
        const makeChatOperator = (rooms) => ({
            to(room) {
                return makeChatOperator([...rooms, room]);
            },
            emit(event, payload) {
                chatEmissions.push({ rooms: [...rooms], event, payload });
            }
        });
        const fakeChatIo = {
            on(event, handler) {
                if (event === 'connection') chatConnectionHandlers.push(handler);
            },
            to(room) {
                return makeChatOperator([room]);
            }
        };
        notificationSocket(fakeChatIo);
        chatSocket(fakeChatIo);

        await connect.promise().query(
            'INSERT INTO conversation (id) VALUES (?)',
            [uuid.toBin(conversationId)]
        );
        await connect.promise().query(
            `INSERT INTO conversation_participant (id_conversation, id_user)
             VALUES (?, ?), (?, ?)`,
            [
                uuid.toBin(conversationId), uuid.toBin(buyerId),
                uuid.toBin(conversationId), uuid.toBin(sellerBId)
            ]
        );

        let sendHandler;
        const joinedChatRooms = [];
        const fakeChatSocket = {
            id: 'fake-socket-a',
            userName: 'Teste Comprador',
            handshake: {
                auth: { token: tokenA },
                query: {},
                headers: {}
            },
            on(event, handler) {
                if (event === 'send_message') sendHandler = handler;
            },
            once() {},
            join(room) { joinedChatRooms.push(room); }
        };
        for (const handler of chatConnectionHandlers) handler(fakeChatSocket);

        let callbackResult;
        await new Promise((resolve) => {
            sendHandler(
                { conversationId, type: 'texto', content: 'Mensagem de teste' },
                (result) => {
                    callbackResult = result;
                    resolve();
                }
            );
        });

        check('send_message autenticado retorna sucesso', () => {
            assert.ok(callbackResult);
            assert.ok(callbackResult.id, JSON.stringify(callbackResult));
            assert.strictEqual(callbackResult.message, 'Mensagem enviada com sucesso.');
        });

        const chatMessageEmits = chatEmissions.filter((item) => item.event === 'new_message');
        check('send_message emite new_message uma única vez', () => {
            assert.strictEqual(chatMessageEmits.length, 1, JSON.stringify(chatMessageEmits));
        });

        check('new_message cobre sala da conversa e sala individual do destinatário', () => {
            const rooms = chatMessageEmits[0].rooms;
            assert.ok(rooms.includes(conversationId), JSON.stringify(rooms));
            assert.ok(rooms.includes(userRoom(sellerBId)), JSON.stringify(rooms));
        });

        const [chatNotifications] = await connect.promise().query(
            `SELECT type, title, content, reference_table,
                    BIN_TO_UUID(reference_id) AS reference_id
             FROM notification
             WHERE id_user = ? AND type = 'nova_mensagem'`,
            [uuid.toBin(sellerBId)]
        );
        check('nova mensagem cria notificação para o destinatário', () => {
            assert.strictEqual(chatNotifications.length, 1);
            assert.strictEqual(chatNotifications[0].type, 'nova_mensagem');
            assert.strictEqual(chatNotifications[0].title, 'Nova mensagem de Teste Comprador');
            assert.strictEqual(chatNotifications[0].content, 'Mensagem de teste');
            assert.strictEqual(chatNotifications[0].reference_table, 'conversation');
            assert.strictEqual(chatNotifications[0].reference_id, conversationId);
        });

        const [senderNotifications] = await connect.promise().query(
            "SELECT COUNT(*) AS total FROM notification WHERE id_user = ? AND type = 'nova_mensagem'",
            [uuid.toBin(buyerId)]
        );
        check('remetente não recebe notificação da própria mensagem', () => {
            assert.strictEqual(Number(senderNotifications[0].total), 0);
        });

        check('socket do remetente entrou na sala individual', () => {
            assert.ok(joinedChatRooms.includes(userRoom(buyerId)));
        });

        // Restaura o io de notificação para os testes de emissão.
        notificationSocket(fakeNotificationIo);

        // =================================================================
        // Socket de notificação: conexão e emissão
        // =================================================================
        const joinedRooms = [];
        notificationConnection({
            handshake: { auth: { token: tokenA }, query: {}, headers: {} },
            join(room) { joinedRooms.push(room); },
            once() {}
        });
        check('socket com JWT entra na sala user:<id>', () => {
            assert.deepStrictEqual(joinedRooms, [userRoom(buyerId)]);
        });

        const anonymousRooms = [];
        notificationConnection({
            handshake: { auth: {}, query: {}, headers: {} },
            join(room) { anonymousRooms.push(room); },
            once() {}
        });
        check('socket sem JWT não entra em sala de usuário', () => {
            assert.deepStrictEqual(anonymousRooms, []);
        });

        emitToUser(sellerBId, 'notification', { marca: 'teste' });
        check('emitToUser envia evento para sala individual', () => {
            const event = socketEmissions.find(
                (item) => item.event === 'notification' && item.payload.marca === 'teste'
            );
            assert.ok(event, JSON.stringify(socketEmissions));
            assert.strictEqual(event.room, userRoom(sellerBId));
        });

        // =================================================================
        // Compras: reserva_solicitada, aceite, recusa e cancelamento
        // =================================================================
        r = await req('POST', '/api/reaproveitafranca/shopping/create', tokenA, {
            items: [{ id_product: productB1Id, quantity: 2 }]
        });
        check('POST /shopping/create retorna 201', () => assertStatus(r, 201, 'compra 1'));
        const shopping1 = r.body && r.body.shopping;
        if (shopping1 && shopping1.id) shoppingIds.push(shopping1.id);

        check('resposta de /shopping/create não expõe dados internos de vendedores', () => {
            assert.ok(shopping1);
            assert.ok(!Object.prototype.hasOwnProperty.call(shopping1, 'sellers'));
            assert.ok(!Object.prototype.hasOwnProperty.call(shopping1, 'sellerIds'));
        });

        await checkAsync('compra de um item gera reserva_solicitada para o vendedor', async () => {
            const notifications = await listNotifications(sellerBId, 'reserva_solicitada');
            const target = notifications.find((n) => n.reference_id === shopping1.id);
            assert.ok(target, JSON.stringify(notifications));
            assert.strictEqual(target.reference_table, 'shopping');
            assert.strictEqual(target.title, 'Nova solicitação de reserva');
            assert.ok(target.content.includes('Teste Comprador'), target.content);
            assert.ok(target.content.includes('Madeira Teste'), target.content);
            assert.ok(target.content.includes('2'), target.content);
        });

        await checkAsync('comprador não recebe reserva_solicitada da própria compra', async () => {
            const notifications = await listNotifications(buyerId, 'reserva_solicitada');
            assert.strictEqual(notifications.length, 0);
        });

        r = await req('POST', '/api/reaproveitafranca/shopping/create', tokenA, {
            items: [
                { id_product: productB1Id, quantity: 1 },
                { id_product: productB2Id, quantity: 3 }
            ]
        });
        const shopping2 = r.body && r.body.shopping;
        if (shopping2 && shopping2.id) shoppingIds.push(shopping2.id);
        check('compra com dois itens do mesmo vendedor retorna 201', () => assertStatus(r, 201, 'compra 2'));

        await checkAsync('dois itens do mesmo vendedor geram apenas uma notificação', async () => {
            const notifications = await listNotifications(sellerBId, 'reserva_solicitada');
            const target = notifications.filter((n) => n.reference_id === shopping2.id);
            assert.strictEqual(target.length, 1, JSON.stringify(target));
            assert.ok(target[0].content.includes('2 itens'), target[0].content);
            assert.ok(target[0].content.includes('Madeira Teste'), target[0].content);
            assert.ok(target[0].content.includes('Metal Teste'), target[0].content);
        });

        r = await req('POST', '/api/reaproveitafranca/shopping/create', tokenA, {
            items: [
                { id_product: productB1Id, quantity: 1 },
                { id_product: productC1Id, quantity: 1 }
            ]
        });
        const shopping3 = r.body && r.body.shopping;
        if (shopping3 && shopping3.id) shoppingIds.push(shopping3.id);
        check('compra com itens de vendedores diferentes retorna 201', () => assertStatus(r, 201, 'compra 3'));

        await checkAsync('cada vendedor recebe uma notificação da compra', async () => {
            const notificationsB = (await listNotifications(sellerBId, 'reserva_solicitada'))
                .filter((n) => n.reference_id === shopping3.id);
            const notificationsC = (await listNotifications(sellerCId, 'reserva_solicitada'))
                .filter((n) => n.reference_id === shopping3.id);

            assert.strictEqual(notificationsB.length, 1, JSON.stringify(notificationsB));
            assert.strictEqual(notificationsC.length, 1, JSON.stringify(notificationsC));
        });

        await checkAsync('vendedor B não vê o produto do vendedor C na notificação', async () => {
            const notificationsB = (await listNotifications(sellerBId, 'reserva_solicitada'))
                .filter((n) => n.reference_id === shopping3.id);
            assert.ok(notificationsB[0].content.includes('Madeira Teste'), notificationsB[0].content);
            assert.ok(!notificationsB[0].content.includes('Vidro Teste'), notificationsB[0].content);
        });

        await checkAsync('vendedor C não vê o produto do vendedor B na notificação', async () => {
            const notificationsC = (await listNotifications(sellerCId, 'reserva_solicitada'))
                .filter((n) => n.reference_id === shopping3.id);
            assert.ok(notificationsC[0].content.includes('Vidro Teste'), notificationsC[0].content);
            assert.ok(!notificationsC[0].content.includes('Madeira Teste'), notificationsC[0].content);
        });

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping2.id}/status`,
            tokenB,
            { status: 'accepted' }
        );
        check('vendedor único aceita a própria reserva', () => {
            assertStatus(r, 200, 'aceite');
            assert.strictEqual(r.body.shopping.status, 'accepted');
        });

        await checkAsync('aceite gera reserva_aceita para o comprador', async () => {
            const notifications = (await listNotifications(buyerId, 'reserva_aceita'))
                .filter((n) => n.reference_id === shopping2.id);
            assert.strictEqual(notifications.length, 1, JSON.stringify(notifications));
            assert.strictEqual(notifications[0].reference_table, 'shopping');
            assert.ok(notifications[0].content.includes('Teste Vendedor B'), notifications[0].content);
            assert.ok(notifications[0].content.includes('aceitou'), notifications[0].content);
        });

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping2.id}/status`,
            tokenB,
            { status: 'accepted' }
        );
        await checkAsync('repetir o mesmo aceite não duplica a notificação', async () => {
            assertStatus(r, 200, 'repetição');
            const notifications = (await listNotifications(buyerId, 'reserva_aceita'))
                .filter((n) => n.reference_id === shopping2.id);
            assert.strictEqual(notifications.length, 1, JSON.stringify(notifications));
        });

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping2.id}/status`,
            tokenC,
            { status: 'refused' }
        );
        check('vendedor sem itens na compra não altera o status', () => assertStatus(r, 403, 'vendedor estranho'));

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping2.id}/status`,
            tokenA,
            { status: 'accepted' }
        );
        check('comprador não altera o status da compra', () => assertStatus(r, 403, 'comprador'));

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping2.id}/status`,
            tokenB,
            { status: 'completed' }
        );
        check('vendedor não pode definir status fora de accepted/refused', () => assertStatus(r, 403, 'status proibido'));

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping3.id}/status`,
            tokenB,
            { status: 'accepted' }
        );
        check('vendedor não aceita compra com itens de outro vendedor', () => assertStatus(r, 403, 'multi-vendedor'));

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping3.id}/status`,
            adminToken,
            { status: 'accepted' }
        );
        check('admin aceita compra com vários vendedores', () => {
            assertStatus(r, 200, 'admin aceite');
            assert.strictEqual(r.body.shopping.status, 'accepted');
        });

        await checkAsync('aceite por admin identifica administrador na notificação', async () => {
            const notifications = (await listNotifications(buyerId, 'reserva_aceita'))
                .filter((n) => n.reference_id === shopping3.id);
            assert.strictEqual(notifications.length, 1, JSON.stringify(notifications));
            assert.ok(notifications[0].content.includes('administrador'), notifications[0].content);
        });

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping1.id}/status`,
            tokenB,
            { status: 'refused' }
        );
        check('vendedor único recusa a própria reserva', () => {
            assertStatus(r, 200, 'recusa');
            assert.strictEqual(r.body.shopping.status, 'refused');
        });

        await checkAsync('recusa gera reserva_recusada para o comprador', async () => {
            const notifications = (await listNotifications(buyerId, 'reserva_recusada'))
                .filter((n) => n.reference_id === shopping1.id);
            assert.strictEqual(notifications.length, 1, JSON.stringify(notifications));
            assert.ok(notifications[0].content.includes('Teste Vendedor B'), notifications[0].content);
            assert.ok(notifications[0].content.includes('recusou'), notifications[0].content);
        });

        r = await req('POST', '/api/reaproveitafranca/shopping/create', tokenA, {
            items: [
                { id_product: productB1Id, quantity: 1 },
                { id_product: productC1Id, quantity: 1 }
            ]
        });
        const shopping4 = r.body && r.body.shopping;
        if (shopping4 && shopping4.id) shoppingIds.push(shopping4.id);
        check('compra para cancelamento retorna 201', () => assertStatus(r, 201, 'compra 4'));

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping4.id}/cancel`,
            tokenA
        );
        check('comprador cancela compra pendente', () => {
            assertStatus(r, 200, 'cancelamento');
            assert.strictEqual(r.body.shopping.status, 'cancelled');
        });

        await checkAsync('cancelamento notifica cada vendedor com tipo sistema', async () => {
            const notificationsB = (await listNotifications(sellerBId, 'sistema'))
                .filter((n) => n.reference_id === shopping4.id);
            const notificationsC = (await listNotifications(sellerCId, 'sistema'))
                .filter((n) => n.reference_id === shopping4.id);

            assert.strictEqual(notificationsB.length, 1, JSON.stringify(notificationsB));
            assert.strictEqual(notificationsC.length, 1, JSON.stringify(notificationsC));
            assert.strictEqual(notificationsB[0].title, 'Reserva cancelada');
            assert.ok(notificationsB[0].content.includes('Teste Comprador'), notificationsB[0].content);
            assert.strictEqual(notificationsB[0].reference_table, 'shopping');
        });

        r = await req('POST', '/api/reaproveitafranca/shopping/create', tokenA, {
            items: [{ id_product: productB2Id, quantity: 1 }]
        });
        const shopping5 = r.body && r.body.shopping;
        if (shopping5 && shopping5.id) shoppingIds.push(shopping5.id);
        check('compra para cancelamento por admin retorna 201', () => assertStatus(r, 201, 'compra 5'));

        r = await req(
            'PATCH',
            `/api/reaproveitafranca/shopping/${shopping5.id}/status`,
            adminToken,
            { status: 'cancelled' }
        );
        check('admin cancela compra pendente', () => {
            assertStatus(r, 200, 'admin cancelamento');
            assert.strictEqual(r.body.shopping.status, 'cancelled');
        });

        await checkAsync('cancelamento por admin identifica administrador', async () => {
            const notifications = (await listNotifications(sellerBId, 'sistema'))
                .filter((n) => n.reference_id === shopping5.id);
            assert.strictEqual(notifications.length, 1, JSON.stringify(notifications));
            assert.strictEqual(notifications[0].title, 'Reserva cancelada');
            assert.ok(notifications[0].content.includes('administrador'), notifications[0].content);
        });

        // Força duas leituras de pending antes das atualizações, sem simular o banco.
        const runConcurrentStatus = async (status, route = 'status') => {
            const created = await req('POST', '/api/reaproveitafranca/shopping/create', tokenA, {
                items: [{ id_product: productB2Id, quantity: 1 }]
            });
            assertStatus(created, 201, 'fixture concorrente');
            const id = created.body.shopping.id;
            shoppingIds.push(id);
            const [before] = await connect.promise().query('SELECT quantity FROM product WHERE id = ?', [uuid.toBin(productB2Id)]);
            const originalGet = shoppingService.getShoppingById;
            let reads = 0;
            let barrierTimedOut = false;
            let release;
            const bothRead = new Promise((resolve) => { release = resolve; });
            const timeout = setTimeout(() => { barrierTimedOut = true; release(); }, 5000);
            shoppingService.getShoppingById = async (...args) => {
                const shopping = await originalGet(...args);
                if (args[0] === id && !args[1] && ++reads <= 2) {
                    if (reads === 2) release();
                    await bothRead;
                }
                return shopping;
            };
            try {
                const responses = await Promise.all([1, 2].map(() => req(
                    'PATCH', `/api/reaproveitafranca/shopping/${id}/${route}`,
                    route === 'cancel' ? tokenA : tokenB,
                    route === 'cancel' ? undefined : { status }
                )));
                assert.ok(reads >= 2, 'ambas as leituras devem ter ocorrido');
                assert.ok(!barrierTimedOut, 'a barreira concorrente não pode depender do timeout');
                const notifications = (await listNotifications(route === 'cancel' ? sellerBId : buyerId,
                    route === 'cancel' ? 'sistema' : status === 'accepted' ? 'reserva_aceita' : 'reserva_recusada'))
                    .filter((n) => n.reference_id === id);
                assert.strictEqual(notifications.length, 1, 'uma transição deve gerar apenas um aviso');
                assert.deepStrictEqual(responses.map((response) => response.status).sort(), status === 'accepted' ? [200, 200] : [200, 400]);
                const [after] = await connect.promise().query('SELECT quantity FROM product WHERE id = ?', [uuid.toBin(productB2Id)]);
                assert.strictEqual(after[0].quantity, before[0].quantity + (status === 'accepted' ? 0 : 1), 'estoque deve ser restaurado uma única vez');
            } finally {
                clearTimeout(timeout);
                shoppingService.getShoppingById = originalGet;
            }
        };

        await checkAsync('aceites simultâneos geram apenas uma reserva_aceita', () => runConcurrentStatus('accepted'));
        await checkAsync('recusas simultâneas notificam e restauram estoque uma vez', () => runConcurrentStatus('refused'));
        await checkAsync('cancelamentos simultâneos notificam e restauram estoque uma vez', () => runConcurrentStatus('cancelled', 'cancel'));

        await checkAsync('cancelamento revalida pending depois de uma alteração concorrente', async () => {
            const created = await req('POST', '/api/reaproveitafranca/shopping/create', tokenA, {
                items: [{ id_product: productB2Id, quantity: 1 }]
            });
            assertStatus(created, 201, 'fixture de cancelamento');
            const id = created.body.shopping.id;
            shoppingIds.push(id);
            const originalGet = shoppingService.getShoppingById;
            let intervened = false;
            shoppingService.getShoppingById = async (...args) => {
                const shopping = await originalGet(...args);
                if (args[0] === id && !intervened) {
                    intervened = true;
                    await shoppingService.updateStatus(id, 'accepted');
                }
                return shopping;
            };
            try {
                const response = await req('PATCH', `/api/reaproveitafranca/shopping/${id}/cancel`, tokenA);
                assertStatus(response, 400, 'cancelamento após aceite');
                const shopping = await originalGet(id);
                assert.strictEqual(shopping.status, 'accepted');
                const notifications = (await listNotifications(sellerBId, 'sistema')).filter((n) => n.reference_id === id);
                assert.strictEqual(notifications.length, 0);
            } finally {
                shoppingService.getShoppingById = originalGet;
            }
        });

        await checkAsync('falha ao notificar aceite não desfaz a transição da compra', async () => {
            const originalNotify = notificationService.notifyUser;
            notificationService.notifyUser = async () => { throw new Error('Falha sintética de notificação'); };
            try {
                const response = await req('PATCH', `/api/reaproveitafranca/shopping/${shopping2.id}/status`, adminToken, { status: 'pending' });
                assertStatus(response, 200, 'retorno para pending');
                const accepted = await req('PATCH', `/api/reaproveitafranca/shopping/${shopping2.id}/status`, tokenB, { status: 'accepted' });
                assertStatus(accepted, 200, 'aceite mesmo sem notificação');
                assert.strictEqual((await shoppingService.getShoppingById(shopping2.id)).status, 'accepted');
            } finally {
                notificationService.notifyUser = originalNotify;
            }
        });

        // Transporte real: as rotas e os módulos de socket são os de produção.
        realIo = new Server(httpServer);
        startSockets(realIo);
        const socketUrl = `http://127.0.0.1:${httpServer.address().port}`;
        const openClient = async (auth) => {
            const client = connectNotificationSocket(socketUrl, auth);
            realClients.push(client);
            await client.ready;
            return client;
        };
        const owner = await openClient({ token: tokenA });
        const ownerSecondSession = await openClient({ token: tokenA });
        const otherUser = await openClient({ token: tokenB });
        const anonymous = await openClient({});
        const invalidToken = await openClient({ token: 'token-invalido' });
        const expiredToken = await openClient({ token: jwt.sign({ id: buyerId }, process.env.SECRET, { expiresIn: -1 }) });
        const owners = [owner, ownerSecondSession];
        const outsiders = [otherUser, anonymous, invalidToken, expiredToken];

        let liveId;
        await checkAsync('Socket.IO real entrega notification nas duas sessões do dono', async () => {
            const response = await req('POST', '/api/reaproveitafranca/notification/', tokenA, {
                type: 'sistema', title: 'Transporte real', content: 'Aviso sintético'
            });
            assertStatus(response, 201, 'criação com socket real');
            liveId = response.body.id;
            for (const client of owners) {
                const notification = await client.waitForEvent('notification', (payload) => payload.id === liveId);
                assert.strictEqual(notification.id_user, buyerId);
                assert.strictEqual(notification.content, 'Aviso sintético');
            }
        });

        await checkAsync('Socket.IO real sincroniza notification_read nas duas sessões', async () => {
            const response = await req('PATCH', `/api/reaproveitafranca/notification/${liveId}/read`, tokenA);
            assertStatus(response, 200, 'leitura com socket real');
            for (const client of owners) await client.waitForEvent('notification_read', (payload) => payload.id === liveId);
        });

        await checkAsync('Socket.IO real sincroniza notifications_read_all nas duas sessões', async () => {
            const response = await req('PATCH', '/api/reaproveitafranca/notification/read-all', tokenA);
            assertStatus(response, 200, 'leitura em lote com socket real');
            for (const client of owners) {
                const payload = await client.waitForEvent('notifications_read_all');
                assert.strictEqual(payload.updated, response.body.updated);
            }
        });

        await checkAsync('Socket.IO real sincroniza notification_deleted nas duas sessões', async () => {
            const response = await req('DELETE', `/api/reaproveitafranca/notification/${liveId}`, tokenA);
            assertStatus(response, 200, 'exclusão com socket real');
            for (const client of owners) await client.waitForEvent('notification_deleted', (payload) => payload.id === liveId);
        });

        // Barreira ordenada no mesmo transporte: não depende de um sleep para
        // concluir que um socket não recebeu os eventos anteriores.
        realIo.emit('notification_test_barrier', { phase: 'isolation' });
        for (const client of [...owners, ...outsiders]) await client.waitForEvent('notification_test_barrier');
        check('Socket.IO real não duplica eventos em sessões do dono', () => {
            for (const client of owners) {
                for (const event of ['notification', 'notification_read', 'notifications_read_all', 'notification_deleted']) {
                    assert.strictEqual(client.events.filter((item) => item.event === event).length, 1, event);
                }
            }
        });
        for (const [index, label] of ['outro usuário', 'anônimo', 'JWT inválido', 'JWT expirado'].entries()) {
            check(`Socket.IO real isola notificações de ${label}`, () => {
                assert.strictEqual(outsiders[index].events.filter((item) => [
                    'notification', 'notification_read', 'notifications_read_all', 'notification_deleted'
                ].includes(item.event)).length, 0);
            });
        }

        await checkAsync('Socket.IO real desconecta a sessão no vencimento do JWT', async () => {
            const expiringToken = jwt.sign(
                { id: buyerId, name: 'Expira' },
                process.env.SECRET,
                { expiresIn: '5s' }
            );
            const expiring = await openClient({ token: expiringToken });
            await expiring.waitForClose(15000);
        });

        await Promise.all(owners.map((client) => client.close()));
        const offline = await req('POST', '/api/reaproveitafranca/notification/', tokenA, { type: 'sistema', title: 'Aviso offline' });
        await checkAsync('reconexão recupera pelo HTTP notificação persistida enquanto offline', async () => {
            assertStatus(offline, 201, 'persistência offline');
            const reconnected = await openClient({ token: tokenA });
            const response = await req('GET', '/api/reaproveitafranca/notification/?read=nao', tokenA);
            assertStatus(response, 200, 'recuperação offline');
            assert.ok(response.body.some((item) => item.id === offline.body.id));
            const online = await req('POST', '/api/reaproveitafranca/notification/', tokenA, { type: 'sistema', title: 'Aviso após reconectar' });
            assertStatus(online, 201, 'criação após reconectar');
            await reconnected.waitForEvent('notification', (payload) => payload.id === online.body.id);
        });

        await runReviewDisputeNotificationTests({
            req, checkAsync, shoppingIds, extraUserIds, openClient, io: realIo,
            users: { buyerId, sellerBId, sellerCId, adminId, outsiderId: otpUserId },
            tokens: { buyer: tokenA, sellerB: tokenB, sellerC: tokenC, admin: adminToken },
            products: { productB1Id, productB2Id, productC1Id }
        });

    } catch (error) {
        fail('erro inesperado no teste', error);
    } finally {
        const cleanupErrors = [];
        const tryCleanup = async (label, fn) => {
            try {
                await fn();
            } catch (error) {
                cleanupErrors.push(`${label}: ${error.code || error.message}`);
            }
        };

        await tryCleanup('clientes Socket.IO', () => Promise.all(realClients.map((client) => client.close())));
        if (realIo) {
            await tryCleanup('servidor Socket.IO', () => new Promise((resolve) => realIo.close(resolve)));
        }

        if (shoppingIds.length > 0) {
            for (const table of ['review', 'dispute']) {
                await tryCleanup(table, () => connect.promise().query(
                    `DELETE FROM ${table} WHERE id_shopping IN (${shoppingIds.map(() => '?').join(', ')})`,
                    shoppingIds.map((id) => uuid.toBin(id))
                ));
            }
            await tryCleanup('shopping', () => connect.promise().query(
                `DELETE FROM shopping WHERE id IN (${shoppingIds.map(() => '?').join(', ')})`,
                shoppingIds.map((id) => uuid.toBin(id))
            ));
        }

        await tryCleanup('product', () => connect.promise().query(
            'DELETE FROM product WHERE id IN (?, ?, ?)',
            [uuid.toBin(productB1Id), uuid.toBin(productB2Id), uuid.toBin(productC1Id)]
        ));

        await tryCleanup('localization', () => connect.promise().query(
            'DELETE FROM localization WHERE id IN (?, ?)',
            [uuid.toBin(locBId), uuid.toBin(locCId)]
        ));

        if (signupUserId) {
            await tryCleanup('document (cadastro)', () => connect.promise().query(
                'DELETE FROM document WHERE id_user = ?',
                [uuid.toBin(signupUserId)]
            ));
            await tryCleanup('localization (cadastro)', () => connect.promise().query(
                'DELETE FROM localization WHERE id_user = ?',
                [uuid.toBin(signupUserId)]
            ));
        }

        const syntheticUsers = [buyerId, sellerBId, sellerCId, otpUserId, ...extraUserIds];
        if (signupUserId) syntheticUsers.push(signupUserId);

        await tryCleanup('notification_retry', () => connect.promise().query(
            `DELETE FROM notification_retry WHERE id_user IN (${syntheticUsers.map(() => '?').join(', ')})`,
            syntheticUsers.map((id) => uuid.toBin(id))
        ));

        await tryCleanup('notification', () => connect.promise().query(
            `DELETE FROM notification WHERE id_user IN (${syntheticUsers.map(() => '?').join(', ')})`,
            syntheticUsers.map((id) => uuid.toBin(id))
        ));

        await tryCleanup('otp', () => connect.promise().query(
            'DELETE FROM otp WHERE user_id IN (?, ?)',
            [uuid.toBin(otpUserId), uuid.toBin(sellerCId)]
        ));

        await tryCleanup('conversation', () => connect.promise().query(
            'DELETE FROM conversation WHERE id = ?',
            [uuid.toBin(conversationId)]
        ));

        await tryCleanup('user', () => connect.promise().query(
            `DELETE FROM \`user\` WHERE id IN (${syntheticUsers.map(() => '?').join(', ')})`,
            syntheticUsers.map((id) => uuid.toBin(id))
        ));

        if (cleanupErrors.length > 0) {
            results.push(`WARN  limpeza: ${cleanupErrors.join(' | ')}`);
        }

        try {
            const [left] = await connect.promise().query(
                `SELECT COUNT(*) AS total FROM \`user\`
                 WHERE id IN (${syntheticUsers.map(() => '?').join(', ')})`,
                syntheticUsers.map((id) => uuid.toBin(id))
            );
            results.push(`INFO  usuários sintéticos restantes: ${left[0].total}`);
        } catch (error) {
            results.push(`WARN  verificação final: ${error.code || error.message}`);
        }

        if (httpServer) {
            await new Promise((resolve) => httpServer.close(resolve));
        }

        await connect.promise().end();
    }

    console.log(results.join('\n'));
    const passed = results.filter((line) => line.startsWith('PASS')).length;
    const skipped = results.filter((line) => line.startsWith('SKIP')).length;
    console.log(`\nRESUMO: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main();
