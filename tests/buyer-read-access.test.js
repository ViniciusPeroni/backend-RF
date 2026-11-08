const { test } = require('node:test');
const assert = require('node:assert/strict');
const uuid = require('../src/utils/uuid');
const imageType = require('../src/utils/imageType');
const queries = [];
// Unit tests must never open the developer's database.
const dbPath = require.resolve('../src/db/connect');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    promise: () => ({ query: async (sql, params) => { queries.push({ sql, params }); return [[]]; } })
} };
const service = require('../src/services/shoppingProductService');
const buyer = uuid.generateId();

test('consultas de itens exigem identidade autenticada e válida', async () => {
    await assert.rejects(service.getItems({}), error => error.status === 401);
    await assert.rejects(service.getItems({}, { id: 'invalid', role: 'admin' }), error => error.status === 401);
});

test('comprador tem escopo próprio inclusive nas consultas por item e compra', async () => {
    for (const operation of [() => service.getItems({}, { id: buyer, role: 'user' }), () => service.getItemById(uuid.generateId(), { id: buyer, role: 'user' }), () => service.getItemsByShoppingId(uuid.generateId(), { id: buyer, role: 'user' })]) {
        await operation(); const query = queries.at(-1);
        assert.match(query.sql, /s\.id_user = \?/);
        assert.deepEqual(query.params[0], uuid.toBin(buyer));
    }
});

test('administrador pode consultar sem restringir ao seu usuário', async () => {
    await service.getItems({}, { id: buyer, role: 'admin' });
    assert.doesNotMatch(queries.at(-1).sql, /s\.id_user = \?/);
});

test('filtros inválidos não viram listagem geral', async () => {
    for (const filters of [{ id: 'invalid' }, { id_shopping: '' }, { id_product: ['invalid'] }]) {
        await assert.rejects(service.getItems(filters, { id: buyer, role: 'user' }), error => error.status === 400);
    }
});

test('foto rejeita conteúdo ativo e reconhece formatos raster por assinatura', () => {
    assert.equal(imageType(Buffer.from('<svg/>')), null);
    assert.equal(imageType(Buffer.from('<html>')), null);
    assert.equal(imageType(Buffer.alloc(0)), null);
    assert.equal(imageType(Buffer.from([255, 216, 255, 0])), 'image/jpeg');
    assert.equal(imageType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png');
    assert.equal(imageType(Buffer.from('GIF89a')), 'image/gif');
    assert.equal(imageType(Buffer.from('RIFF0000WEBP')), 'image/webp');
});
