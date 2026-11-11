'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');
const connect = require('../../src/db/connect');
const uuid = require('../../src/utils/uuid');
const notificationService = require('../../src/services/notificationService');
const disputeService = require('../../src/services/disputeService');

async function runReviewDisputeNotificationTests({
    req, checkAsync, shoppingIds, extraUserIds, openClient, io, users, tokens, products
}) {
    const { buyerId, sellerBId, sellerCId, adminId, outsiderId } = users;
    const secondAdminId = uuid.generateId();
    const inactiveAdminId = uuid.generateId();
    // A abertura avisa todos os admins ativos: nunca executar com admins reais.
    const [existingAdmins] = await connect.promise().query(
        "SELECT COUNT(*) AS total FROM `user` WHERE role = 'admin' AND status = 'active'"
    );
    assert.strictEqual(Number(existingAdmins[0].total), 0,
        'Use banco descartável sem admins ativos: o teste não pode avisar pessoas reais.');
    extraUserIds.push(adminId, secondAdminId, inactiveAdminId);
    for (const [id, status] of [[adminId, 'active'], [secondAdminId, 'active'], [inactiveAdminId, 'inactive']]) {
        await connect.promise().query(
            "INSERT INTO `user` (id, role, name, email, status) VALUES (?, 'admin', 'Admin sintético', ?, ?)",
            [uuid.toBin(id), `notif-admin-${id}@example.test`, status]
        );
    }
    const outsiderToken = jwt.sign({ id: outsiderId, role: 'user' }, process.env.SECRET, { expiresIn: '1h' });
    const statusIs = (response, expected) => assert.strictEqual(response.status, expected, JSON.stringify(response.body));
    const makeShopping = async (status = 'completed', multiSeller = false) => {
        const id = uuid.generateId();
        shoppingIds.push(id);
        await connect.promise().query(
            'INSERT INTO shopping (id, value, status, id_user) VALUES (?, 3, ?, ?)',
            [uuid.toBin(id), status, uuid.toBin(buyerId)]
        );
        for (const productId of [products.productB1Id, products.productB2Id, ...(multiSeller ? [products.productC1Id] : [])]) {
            await connect.promise().query(
                'INSERT INTO shopping_product (id, value, quantity, id_product, id_shopping) VALUES (?, 1, 1, ?, ?)',
                [uuid.toBin(uuid.generateId()), uuid.toBin(productId), uuid.toBin(id)]
            );
        }
        return id;
    };
    const notices = async (table, id) => {
        const [rows] = await connect.promise().query(
            'SELECT BIN_TO_UUID(id_user) AS id_user, type, title, content FROM notification WHERE reference_table = ? AND reference_id = ?',
            [table, uuid.toBin(id)]
        );
        return rows;
    };
    const recipientsAre = (rows, expected, type) => {
        assert.deepStrictEqual(rows.map((row) => row.id_user).sort(), [...expected].sort());
        assert.ok(rows.every((row) => row.type === type));
    };
    const buyerSocket = await openClient({ token: tokens.buyer });
    const sellerSocket = await openClient({ token: tokens.sellerB });
    const adminSocket = await openClient({ token: tokens.admin });
    const reviewPayload = (idShopping, reviewed) => ({
        id_shopping: idShopping, id_reviewed: reviewed, rating: 5, comment: 'TEXTO_LIVRE_REVIEW_NAO_NOTIFICAR'
    });

    const reviewedShopping = await makeShopping();
    const review = await req('POST', '/api/reaproveitafranca/review/create', tokens.buyer, reviewPayload(reviewedShopping, sellerBId));
    statusIs(review, 201);
    await checkAsync('review do comprador avisa só o avaliado, sem comentário livre, com socket real', async () => {
        const rows = await notices('review', review.body.id);
        recipientsAre(rows, [sellerBId], 'nova_review');
        assert.strictEqual(rows[0].content, 'Você recebeu uma avaliação de 5 estrela(s).');
        const event = await sellerSocket.waitForEvent('notification', (n) => n.reference_id === review.body.id);
        assert.strictEqual(event.id_user, sellerBId);
        assert.ok(!event.content.includes('TEXTO_LIVRE'));
    });
    await checkAsync('review é bilateral: vendedor avisa comprador', async () => {
        const response = await req('POST', '/api/reaproveitafranca/review/', tokens.sellerB, reviewPayload(reviewedShopping, buyerId));
        statusIs(response, 201);
        recipientsAre(await notices('review', response.body.id), [buyerId], 'nova_review');
        await buyerSocket.waitForEvent('notification', (n) => n.reference_id === response.body.id);
    });
    await checkAsync('repetir ou editar review não gera outro aviso', async () => {
        statusIs(await req('POST', '/api/reaproveitafranca/review/create', tokens.buyer, reviewPayload(reviewedShopping, sellerBId)), 409);
        statusIs(await req('PUT', `/api/reaproveitafranca/review/${review.body.id}`, tokens.buyer, { rating: 4 }), 200);
        recipientsAre(await notices('review', review.body.id), [sellerBId], 'nova_review');
    });
    await checkAsync('reviews concorrentes geram uma avaliação e um aviso', async () => {
        const shopping = await makeShopping();
        const responses = await Promise.all([1, 2].map(() => req('POST', '/api/reaproveitafranca/review/create', tokens.buyer, reviewPayload(shopping, sellerBId))));
        assert.deepStrictEqual(responses.map((r) => r.status).sort(), [201, 409]);
        recipientsAre(await notices('review', responses.find((r) => r.status === 201).body.id), [sellerBId], 'nova_review');
    });
    await checkAsync('review inválida/não autorizada não gera aviso', async () => {
        const shopping = await makeShopping('pending');
        statusIs(await req('POST', '/api/reaproveitafranca/review/create', tokens.buyer, reviewPayload(shopping, sellerBId)), 403);
        const completed = await makeShopping();
        statusIs(await req('POST', '/api/reaproveitafranca/review/create', outsiderToken, reviewPayload(completed, sellerBId)), 403);
        statusIs(await req('POST', '/api/reaproveitafranca/review/create', tokens.buyer, reviewPayload(completed, sellerCId)), 403);
        statusIs(await req('POST', '/api/reaproveitafranca/review/create', null, reviewPayload(completed, sellerBId)), 401);
        const [rows] = await connect.promise().query('SELECT id FROM review WHERE id_shopping IN (?, ?)', [uuid.toBin(shopping), uuid.toBin(completed)]);
        assert.strictEqual(rows.length, 0);
    });
    await checkAsync('falha de notificação não desfaz review salva', async () => {
        const shopping = await makeShopping();
        const original = notificationService.notifyUser;
        notificationService.notifyUser = async () => { throw new Error('Falha sintética de aviso'); };
        try {
            const response = await req('POST', '/api/reaproveitafranca/review/create', tokens.buyer, reviewPayload(shopping, sellerBId));
            statusIs(response, 201);
            const [rows] = await connect.promise().query('SELECT id FROM review WHERE id = ?', [uuid.toBin(response.body.id)]);
            assert.strictEqual(rows.length, 1);
        } finally { notificationService.notifyUser = original; }
    });

    const disputePayload = (shopping) => ({ type: 'outro', description: 'TEXTO_LIVRE_DISPUTA_NAO_NOTIFICAR', id_shopping: shopping });
    const openDispute = async (multiSeller = true, token = tokens.buyer) => {
        const shopping = await makeShopping('completed', multiSeller);
        const response = await req('POST', '/api/reaproveitafranca/dispute/create', token, disputePayload(shopping));
        statusIs(response, 201);
        return { id: response.body.id, shopping };
    };
    const opened = await openDispute();
    await checkAsync('disputa aberta avisa vendedores únicos e admins ativos, não autor/estranho/inativo', async () => {
        const rows = await notices('dispute', opened.id);
        recipientsAre(rows, [sellerBId, sellerCId, adminId, secondAdminId], 'disputa_aberta');
        assert.ok(rows.every((n) => !n.content.includes('TEXTO_LIVRE')));
        await sellerSocket.waitForEvent('notification', (n) => n.reference_id === opened.id && n.type === 'disputa_aberta');
        await adminSocket.waitForEvent('notification', (n) => n.reference_id === opened.id && n.type === 'disputa_aberta');
        io.emit('domain_test_barrier', { id: opened.id });
        await buyerSocket.waitForEvent('domain_test_barrier', (n) => n.id === opened.id);
        assert.ok(!buyerSocket.events.some((e) => e.event === 'notification' && e.payload.reference_id === opened.id));
    });
    await checkAsync('abertura por vendedor avisa comprador e outro vendedor, não o próprio autor', async () => {
        const dispute = await openDispute(true, tokens.sellerB);
        recipientsAre(await notices('dispute', dispute.id), [buyerId, sellerCId, adminId, secondAdminId], 'disputa_aberta');
    });
    await checkAsync('admin que também é vendedor não recebe disputa_aberta duplicada', async () => {
        await connect.promise().query("UPDATE `user` SET role = 'admin' WHERE id = ?", [uuid.toBin(sellerBId)]);
        try {
            const dispute = await openDispute();
            recipientsAre(await notices('dispute', dispute.id), [sellerBId, sellerCId, adminId, secondAdminId], 'disputa_aberta');
        } finally {
            await connect.promise().query("UPDATE `user` SET role = 'user' WHERE id = ?", [uuid.toBin(sellerBId)]);
        }
    });
    await checkAsync('repetição de abertura ativa retorna 409 sem novos avisos', async () => {
        statusIs(await req('POST', '/api/reaproveitafranca/dispute/', tokens.buyer, disputePayload(opened.shopping)), 409);
        assert.strictEqual((await notices('dispute', opened.id)).length, 4);
    });
    await checkAsync('abertura ativa concorrente gera uma disputa e um conjunto de avisos', async () => {
        const shopping = await makeShopping();
        const responses = await Promise.all([1, 2].map(() => req('POST', '/api/reaproveitafranca/dispute/create', tokens.buyer, disputePayload(shopping))));
        assert.deepStrictEqual(responses.map((r) => r.status).sort(), [201, 409]);
        const [rows] = await connect.promise().query('SELECT BIN_TO_UUID(id) AS id FROM dispute WHERE id_shopping = ?', [uuid.toBin(shopping)]);
        assert.strictEqual(rows.length, 1);
        recipientsAre(await notices('dispute', rows[0].id), [sellerBId, adminId, secondAdminId], 'disputa_aberta');
    });
    await checkAsync('edição e em_analise não geram novo aviso', async () => {
        statusIs(await req('PUT', `/api/reaproveitafranca/dispute/${opened.id}`, tokens.buyer, { description: 'Descrição editada' }), 200);
        statusIs(await req('PUT', `/api/reaproveitafranca/dispute/${opened.id}`, tokens.admin, { status: 'em_analise' }), 200);
        assert.strictEqual((await notices('dispute', opened.id)).length, 4);
    });
    await checkAsync('estranho não abre disputa e vendedor não finaliza nem envia avisos', async () => {
        statusIs(await req('POST', '/api/reaproveitafranca/dispute/create', outsiderToken, disputePayload(opened.shopping)), 403);
        statusIs(await req('PATCH', `/api/reaproveitafranca/dispute/${opened.id}/resolve`, tokens.sellerB, { resolution: 'Sem permissão' }), 403);
        assert.strictEqual((await notices('dispute', opened.id)).length, 4);
    });
    const finish = (id, action = 'resolve') => req('PATCH', `/api/reaproveitafranca/dispute/${id}/${action}`, tokens.admin, { resolution: 'TEXTO_LIVRE_RESOLUCAO_NAO_NOTIFICAR' });
    await checkAsync('resolução avisa todas as partes, inclusive autor, sem dados livres nem admins externos', async () => {
        const response = await finish(opened.id);
        statusIs(response, 200);
        assert.strictEqual(response.body.dispute.status, 'resolvida');
        const rows = (await notices('dispute', opened.id)).filter((n) => n.type === 'disputa_resolvida');
        recipientsAre(rows, [buyerId, sellerBId, sellerCId], 'disputa_resolvida');
        assert.ok(rows.every((n) => !n.content.includes('TEXTO_LIVRE')));
        await buyerSocket.waitForEvent('notification', (n) => n.reference_id === opened.id && n.type === 'disputa_resolvida');
    });
    await checkAsync('repetir finalização retorna 409 sem duplicar avisos', async () => {
        statusIs(await finish(opened.id), 409);
        statusIs(await finish(opened.id, 'reject'), 409);
        assert.strictEqual((await notices('dispute', opened.id)).filter((n) => n.type === 'disputa_resolvida').length, 3);
    });
    await checkAsync('rejeição direta de aberta avisa partes com título correspondente', async () => {
        const dispute = await openDispute(false);
        const response = await finish(dispute.id, 'reject');
        statusIs(response, 200);
        assert.strictEqual(response.body.dispute.status, 'rejeitada');
        const rows = (await notices('dispute', dispute.id)).filter((n) => n.type === 'disputa_resolvida');
        recipientsAre(rows, [buyerId, sellerBId], 'disputa_resolvida');
        assert.ok(rows.every((n) => n.title === 'Disputa rejeitada'));
    });
    await checkAsync('resolver e rejeitar em paralelo finalizam uma vez e avisam uma vez por parte', async () => {
        const dispute = await openDispute(false);
        const responses = await Promise.all([finish(dispute.id), finish(dispute.id, 'reject')]);
        assert.deepStrictEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const rows = (await notices('dispute', dispute.id)).filter((n) => n.type === 'disputa_resolvida');
        recipientsAre(rows, [buyerId, sellerBId], 'disputa_resolvida');
    });

    // Mantém as queries reais e intercala outra rota após a leitura inicial da
    // edição, reproduzindo uma leitura obsoleta de forma determinística.
    const editAfterIntervention = async (dispute, token, body, intervene) => {
        const originalPromise = connect.promise;
        const pool = originalPromise.call(connect);
        let intervened = false;
        connect.promise = () => {
            const wrapper = Object.create(pool);
            wrapper.query = async (sql, params) => {
                const result = await pool.query(sql, params);
                if (!intervened && sql.includes('BIN_TO_UUID(id_opened_by) AS id_opened_by') &&
                    /FROM dispute/.test(sql) && Buffer.isBuffer(params[0]) && params[0].equals(uuid.toBin(dispute.id))) {
                    intervened = true;
                    await intervene();
                }
                return result;
            };
            return wrapper;
        };
        try {
            const response = await req('PUT', `/api/reaproveitafranca/dispute/${dispute.id}`, token, body);
            assert.ok(intervened, 'deve intercalar operação após leitura inicial');
            return response;
        } finally { connect.promise = originalPromise; }
    };
    await checkAsync('edição administrativa obsoleta não reabre disputa finalizada nem permite novos avisos', async () => {
        const dispute = await openDispute(false);
        const response = await editAfterIntervention(dispute, tokens.admin, { status: 'aberta' }, async () => {
            statusIs(await finish(dispute.id), 200);
        });
        statusIs(response, 409);
        const [rows] = await connect.promise().query('SELECT status FROM dispute WHERE id = ?', [uuid.toBin(dispute.id)]);
        assert.strictEqual(rows[0].status, 'resolvida');
        statusIs(await finish(dispute.id), 409);
        recipientsAre((await notices('dispute', dispute.id)).filter((n) => n.type === 'disputa_resolvida'), [buyerId, sellerBId], 'disputa_resolvida');
    });
    await checkAsync('edição do autor obsoleta não modifica disputa que entrou em análise', async () => {
        const dispute = await openDispute(false);
        const response = await editAfterIntervention(dispute, tokens.buyer, { description: 'Edição obsoleta' }, async () => {
            statusIs(await req('PUT', `/api/reaproveitafranca/dispute/${dispute.id}`, tokens.admin, { status: 'em_analise' }), 200);
        });
        statusIs(response, 409);
        const [rows] = await connect.promise().query('SELECT status, description FROM dispute WHERE id = ?', [uuid.toBin(dispute.id)]);
        assert.strictEqual(rows[0].status, 'em_analise');
        assert.strictEqual(rows[0].description, 'TEXTO_LIVRE_DISPUTA_NAO_NOTIFICAR');
    });
    await checkAsync('falha no primeiro aviso não desfaz abertura e não impede avisos seguintes', async () => {
        const original = notificationService.notifyUser;
        const attempts = [];
        notificationService.notifyUser = async (data) => {
            attempts.push(data.id_user.toLowerCase());
            if (attempts.length === 1) throw new Error('Falha sintética de aviso');
            return original(data);
        };
        try {
            const dispute = await openDispute();
            const expected = [sellerBId, sellerCId, adminId, secondAdminId];
            const failedId = attempts[0];
            assert.deepStrictEqual([...attempts].sort(), [...expected].sort());
            recipientsAre(await notices('dispute', dispute.id), expected.filter((id) => id !== failedId), 'disputa_aberta');
        } finally { notificationService.notifyUser = original; }
    });
    await checkAsync('falha de aviso de finalização não desfaz estado e não interrompe outras partes', async () => {
        const dispute = await openDispute();
        const original = notificationService.notifyUser;
        const attempts = [];
        notificationService.notifyUser = async (data) => {
            attempts.push(data.id_user.toLowerCase());
            if (attempts.length === 1) throw new Error('Falha sintética de aviso');
            return original(data);
        };
        try {
            statusIs(await finish(dispute.id), 200);
            const expected = [buyerId, sellerBId, sellerCId];
            const failedId = attempts[0];
            assert.deepStrictEqual([...attempts].sort(), [...expected].sort());
            recipientsAre((await notices('dispute', dispute.id)).filter((n) => n.type === 'disputa_resolvida'), expected.filter((id) => id !== failedId), 'disputa_resolvida');
            const [rows] = await connect.promise().query('SELECT status FROM dispute WHERE id = ?', [uuid.toBin(dispute.id)]);
            assert.strictEqual(rows[0].status, 'resolvida');
        } finally { notificationService.notifyUser = original; }
    });
    await checkAsync('falha transacional ao consultar destinatários impede commit de disputa sem aviso durável', async () => {
        const shoppingId = await makeShopping('pending', true);
        const original = disputeService.getNotificationRecipients;
        disputeService.getNotificationRecipients = async () => { throw new Error('Falha sintética na consulta de destinatários'); };
        try {
            const response = await req('POST', '/api/reaproveitafranca/dispute/', tokens.buyer, {
                type: 'outro', description: 'Fixture de rollback', id_shopping: shoppingId
            });
            statusIs(response, 500);
            const [rows] = await connect.promise().query('SELECT id FROM dispute WHERE id_shopping = ?', [uuid.toBin(shoppingId)]);
            assert.strictEqual(rows.length, 0);
        } finally { disputeService.getNotificationRecipients = original; }
    });
}

module.exports = { runReviewDisputeNotificationTests };
