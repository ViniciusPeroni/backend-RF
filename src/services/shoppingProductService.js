const connect = require("../db/connect");
const uuid = require("../utils/uuid");

const shoppingProductService = {
    async getItems(filters = {}, actor) {
        if (!actor || !uuid.isValid(actor.id)) {
            const error = new Error('Autenticação necessária.'); error.status = 401; throw error;
        }
        let query = `SELECT BIN_TO_UUID(sp.id) AS id, sp.value, sp.quantity,
            BIN_TO_UUID(sp.id_product) AS id_product, BIN_TO_UUID(sp.id_shopping) AS id_shopping,
            p.name AS product_name, p.category AS product_category, p.price AS product_price,
            p.type_negotiation, s.status AS shopping_status, s.datetime AS shopping_datetime
            FROM shopping_product sp
            INNER JOIN product p ON sp.id_product = p.id
            INNER JOIN shopping s ON sp.id_shopping = s.id WHERE 1=1`;
        const params = [];
        // Match shopping detail access: buyer owns the purchase; admins may inspect all.
        if (actor.role !== 'admin') { query += ' AND s.id_user = ?'; params.push(uuid.toBin(actor.id)); }
        for (const [key, column] of [['id', 'sp.id'], ['id_shopping', 'sp.id_shopping'], ['id_product', 'sp.id_product']]) {
            if (filters[key] !== undefined) {
                if (!uuid.isValid(filters[key])) { const error = new Error('Filtro de identificação inválido.'); error.status = 400; throw error; }
                query += ` AND ${column} = ?`; params.push(uuid.toBin(filters[key]));
            }
        }
        query += ' ORDER BY s.datetime DESC';
        const [rows] = await connect.promise().query(query, params);
        return rows;
    },
    async getItemById(id, actor) { return (await this.getItems({ id }, actor))[0] || null; },
    async getItemsByShoppingId(shoppingId, actor) { return this.getItems({ id_shopping: shoppingId }, actor); }
};
module.exports = shoppingProductService;
