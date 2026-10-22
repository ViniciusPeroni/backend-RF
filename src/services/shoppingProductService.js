const connect = require("../db/connect");
const uuid = require("../utils/uuid");

const shoppingProductService = {

    async getItems(filters = {}) {
        let query = `
            SELECT
                BIN_TO_UUID(sp.id) AS id,
                sp.value,
                sp.quantity,
                BIN_TO_UUID(sp.id_product) AS id_product,
                BIN_TO_UUID(sp.id_shopping) AS id_shopping,
                p.name AS product_name,
                p.category AS product_category,
                p.price AS product_price,
                p.type_negotiation,
                s.status AS shopping_status,
                s.datetime AS shopping_datetime
            FROM shopping_product sp
            INNER JOIN product p ON sp.id_product = p.id
            INNER JOIN shopping s ON sp.id_shopping = s.id
            WHERE 1=1
        `;

        const params = [];

        if (filters.id_shopping && uuid.isValid(filters.id_shopping)) {
            query += " AND sp.id_shopping = ?";
            params.push(uuid.toBin(filters.id_shopping));
        }

        if (filters.id_product && uuid.isValid(filters.id_product)) {
            query += " AND sp.id_product = ?";
            params.push(uuid.toBin(filters.id_product));
        }

        query += " ORDER BY s.datetime DESC";

        const [rows] = await connect.promise().query(query, params);
        return rows;
    },


    async getItemById(id) {
        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(sp.id) AS id,
                sp.value,
                sp.quantity,
                BIN_TO_UUID(sp.id_product) AS id_product,
                BIN_TO_UUID(sp.id_shopping) AS id_shopping,
                p.name AS product_name,
                p.category AS product_category,
                p.price AS product_price,
                p.type_negotiation,
                s.status AS shopping_status,
                s.datetime AS shopping_datetime
             FROM shopping_product sp
             INNER JOIN product p ON sp.id_product = p.id
             INNER JOIN shopping s ON sp.id_shopping = s.id
             WHERE sp.id = ?`,
            [uuid.toBin(id)]
        );

        if (rows.length === 0) {
            return null;
        }

        return rows[0];
    },


    async getItemsByShoppingId(shoppingId) {
        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(sp.id) AS id,
                sp.value,
                sp.quantity,
                BIN_TO_UUID(sp.id_product) AS id_product,
                BIN_TO_UUID(sp.id_shopping) AS id_shopping,
                p.name AS product_name,
                p.category AS product_category,
                p.price AS product_price,
                p.type_negotiation
             FROM shopping_product sp
             INNER JOIN product p ON sp.id_product = p.id
             WHERE sp.id_shopping = ?`,
            [uuid.toBin(shoppingId)]
        );

        return rows;
    }

};

module.exports = shoppingProductService;
