const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

// Nenhuma conexão real: apenas as fronteiras de banco/outbox/UUID são substituídas.
function loadService(name, { failEnqueue = false, failRecipients = false, failCommit = false, status = 'pending', productName = 'Madeira' } = {}) {
    const events = [];
    const entries = [];
    let disputeStatus = 'aberta';
    const conn = {
        async beginTransaction() { events.push('begin'); },
        async commit() {
            events.push('commit');
            if (failCommit) throw new Error('commit failed');
        },
        async rollback() { events.push('rollback'); },
        release() { events.push('release'); },
        async query(sql, params) {
            events.push('query');
            if (sql.includes('UNION') || sql.includes('SELECT BIN_TO_UUID(id_user) AS id_user')) {
                if (failRecipients) throw new Error('recipients failed');
                const recipients = [{ id_user: 'buyer' }, { id_user: 'seller' }, { id_user: 'SELLER' }];
                if (!sql.includes('UNION') || sql.includes("role = 'admin'")) recipients.push({ id_user: 'admin' });
                return [recipients];
            }
            if (sql.includes('FROM product') && sql.includes('FOR UPDATE')) {
                return [[{ id: 'product', name: productName, price: 10, quantity: 8, status: 'available', type_negotiation: 'sale', id_user: 'seller' }]];
            }
            if (sql.includes('AS buyer_id')) return [[{ buyer_id: 'buyer' }]];
            if (sql.includes('status NOT IN')) return [[]];
            if (sql.includes('SELECT status FROM dispute')) return [[{ status: 'aberta' }]];
            if (sql.includes('UPDATE dispute')) disputeStatus = params[0];
            if (sql.includes('FROM dispute d')) return [[{ id: 'dispute', id_shopping: 'shopping', id_opened_by: 'buyer', status: disputeStatus }]];
            if (sql.includes('FROM shopping s') && sql.includes('u.name')) return [[{ id: 'shopping', id_user: 'buyer', status, user_name: 'Comprador' }]];
            if (sql.includes('sp.value AS subtotal')) return [[{ seller_id: 'seller' }, { seller_id: 'SELLER' }]];
            if (sql.includes('SELECT id_product, quantity')) return [[]];
            if (sql.includes('FROM shopping') && sql.includes('FOR UPDATE')) return [[{ id: 'shopping', status }]];
            if (sql.includes('SELECT id, status FROM shopping')) return [[{ id: 'shopping', status: 'completed' }]];
            if (sql.trim().startsWith('SELECT')) return [[{ id: 'fixture' }]];
            return [{ affectedRows: 1 }];
        }
    };
    const pool = {
        async getConnection() { events.push('connection'); return conn; },
        async query() { throw new Error('pool query outside transaction'); }
    };
    const outbox = {
        async enqueue(connection, data) {
            assert.equal(connection, conn);
            assert.ok(events.includes('begin'));
            assert.ok(!events.includes('commit'));
            events.push('enqueue');
            if (failEnqueue) throw new Error('enqueue failed');
            const entry = { ...data, id: `event-${entries.length}` };
            entries.push(entry);
            return entry;
        },
        async flush(envelopes) {
            assert.equal(events.at(-1), 'release', 'flush somente depois de liberar conexão');
            assert.ok(events.includes('commit'));
            assert.deepEqual(envelopes, entries);
            events.push('flush');
        }
    };
    const filename = require.resolve(`../src/services/${name}`);
    delete require.cache[filename];
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === '../db/connect') return { promise: () => pool };
        if (request === './notificationOutboxService') return outbox;
        if (request === '../utils/uuid') return { generateId: () => 'generated', toBin: (id) => id, isValid: () => true };
        return originalLoad.call(this, request, parent, isMain);
    };
    let service;
    try { service = require(filename); } finally { Module._load = originalLoad; }
    return { service, events, entries };
}

const scenarios = [
    ['shoppingService', 'criação de compra', (s) => s.createShopping('buyer', [{ id_product: 'product', quantity: 2 }], 'Ana'), ['seller']],
    ['shoppingService', 'aceite', (s) => s.updateStatus('shopping', 'accepted', { notificationActorName: 'Vendedor' }), ['buyer']],
    ['shoppingService', 'recusa', (s) => s.updateStatus('shopping', 'refused', { notificationActorName: 'Vendedor' }), ['buyer']],
    ['shoppingService', 'cancelamento', (s) => s.updateStatus('shopping', 'cancelled', { notificationActorName: 'O administrador' }), ['seller']],
    ['reviewService', 'review', (s) => s.createReview({ id_shopping: 'shopping', id_reviewer: 'buyer', id_reviewed: 'seller', rating: 5, comment: 'não deve ir para aviso' }), ['seller']],
    ['disputeService', 'abertura de disputa', (s) => s.createDispute({ id_shopping: 'shopping', id_opened_by: 'buyer', type: 'outro', description: 'privado' }), ['seller', 'admin']],
    ['disputeService', 'resolução de disputa', (s) => s.resolveDispute('dispute', 'privado', 'admin'), ['buyer', 'seller']],
    ['disputeService', 'rejeição de disputa', (s) => s.rejectDispute('dispute', 'privado', 'admin'), ['buyer', 'seller']],
    ['messageService', 'mensagem', (s) => s.createMessage({ conversationId: 'conversation', id_user: 'buyer', type: 'texto', content: ' Olá ', senderName: 'Ana' }), ['seller', 'admin']]
];

test('resumo de reserva com muitos itens multibyte é limitado sem impedir compra válida', async () => {
    const fixture = loadService('shoppingService', { productName: '🌱'.repeat(250) });
    const result = await fixture.service.createShopping('buyer', Array.from({ length: 100 }, (_, n) => ({ id_product: `product-${n}`, quantity: 1 })), 'Fixture');
    assert.ok(result.shopping.id);
    const content = fixture.entries[0].content;
    assert.ok(Buffer.byteLength(content, 'utf8') <= 4096);
    assert.ok(content.endsWith('Consulte os itens da reserva.'));
    assert.ok(!content.includes('\ufffd'));
});

for (const [name, description, invoke, recipients] of scenarios) {
    test(`${description}: enqueue transacional, commit, release e flush`, async () => {
        const fixture = loadService(name);
        const result = await invoke(fixture.service);
        assert.deepEqual(fixture.entries.map((entry) => entry.id_user), recipients);
        assert.equal(fixture.events.at(-1), 'flush');
        assert.ok(result);
        for (const entry of fixture.entries) {
            assert.ok(!entry.content.includes('privado'));
            assert.ok(!entry.content.includes('não deve ir para aviso'));
        }
        if (description === 'criação de compra') assert.equal(fixture.entries[0].content, 'Ana solicitou 2 unidade(s) de "Madeira".');
        if (description === 'aceite') assert.equal(fixture.entries[0].content, 'Vendedor aceitou a sua solicitação de reserva.');
        if (description === 'recusa') assert.equal(fixture.entries[0].content, 'Vendedor recusou a sua solicitação de reserva.');
        if (description === 'cancelamento') assert.equal(fixture.entries[0].content, 'O administrador cancelou a solicitação de reserva.');
        if (description === 'abertura de disputa') {
            assert.equal(result, 'generated');
            assert.equal(fixture.entries[0].title, 'Disputa aberta');
        }
        if (description === 'resolução de disputa') assert.equal(fixture.entries[0].title, 'Disputa resolvida');
        if (description === 'rejeição de disputa') assert.equal(fixture.entries[0].title, 'Disputa rejeitada');
        if (description === 'review') {
            assert.equal(result, 'generated');
            assert.equal(fixture.entries[0].content, 'Você recebeu uma avaliação de 5 estrela(s).');
        }
        if (description === 'mensagem') {
            assert.equal(result.id, 'generated');
            assert.deepEqual(result.recipients, recipients);
            assert.equal(fixture.entries[0].title, 'Nova mensagem de Ana');
            assert.equal(fixture.entries[0].content, 'Olá');
        }
    });

    for (const failure of ['failEnqueue', 'failCommit']) {
        test(`${description}: ${failure} impede flush e faz rollback`, async () => {
            const fixture = loadService(name, { [failure]: true });
            await assert.rejects(invoke(fixture.service), /failed/);
            assert.ok(fixture.events.includes('rollback'));
            assert.equal(fixture.events.at(-1), 'release');
            assert.ok(!fixture.events.includes('flush'));
            if (failure === 'failEnqueue') assert.ok(!fixture.events.includes('commit'));
        });
    }
}

test('aceite repetido mantém changed=false sem enfileirar', async () => {
    const fixture = loadService('shoppingService', { status: 'accepted' });
    const result = await fixture.service.updateStatus('shopping', 'accepted');
    assert.equal(result.changed, false);
    assert.deepEqual(fixture.entries, []);
});

test('reserva com vários itens mantém template e avisa vendedor uma única vez', async () => {
    const fixture = loadService('shoppingService');
    const result = await fixture.service.createShopping('buyer', [
        { id_product: 'product-a', quantity: 2 },
        { id_product: 'product-b', quantity: 3 }
    ]);
    assert.equal(result.sellers.length, 1);
    assert.equal(fixture.entries.length, 1);
    assert.equal(fixture.entries[0].content, 'Um usuário solicitou 2 itens: "Madeira" (2), "Madeira" (3).');
});

test('mensagem não textual mantém preview genérico e nome padrão', async () => {
    const fixture = loadService('messageService');
    await fixture.service.createMessage({ conversationId: 'conversation', id_user: 'buyer', type: 'imagem', content: 'conteúdo não enviado ao aviso' });
    assert.equal(fixture.entries[0].title, 'Nova mensagem de Usuário');
    assert.equal(fixture.entries[0].content, 'Enviou uma mensagem do tipo imagem.');
});

test('mensagem limita título e preview aos tamanhos atuais', async () => {
    const fixture = loadService('messageService');
    await fixture.service.createMessage({ conversationId: 'conversation', id_user: 'buyer', type: 'texto', content: 'x'.repeat(200), senderName: 'N'.repeat(200) });
    assert.equal(fixture.entries[0].title.length, 100);
    assert.equal(fixture.entries[0].content.length, 120);
});

test('finalização de disputa reverte se consulta transacional dos destinatários falhar', async () => {
    const fixture = loadService('disputeService', { failRecipients: true });
    await assert.rejects(fixture.service.resolveDispute('dispute', 'privado', 'admin'), /recipients failed/);
    assert.ok(fixture.events.includes('rollback'));
    assert.ok(!fixture.events.includes('commit'));
    assert.ok(!fixture.events.includes('flush'));
});

for (const status of ['pending', 'completed']) {
    test(`status ${status} não enfileira aviso`, async () => {
        const fixture = loadService('shoppingService');
        await fixture.service.updateStatus('shopping', status);
        assert.deepEqual(fixture.entries, []);
    });
}

for (const name of ['disputeService', 'messageService']) {
    test(`${name}: erro ao consultar destinatários exige rollback antes do commit`, async () => {
        const fixture = loadService(name, { failRecipients: true });
        const invoke = scenarios.find(([service]) => service === name)[2];
        await assert.rejects(invoke(fixture.service), /recipients failed/);
        assert.ok(fixture.events.includes('rollback'));
        assert.ok(!fixture.events.includes('commit'));
        assert.ok(!fixture.events.includes('flush'));
    });
}
