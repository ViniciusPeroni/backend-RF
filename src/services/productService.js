
const connect = require("../db/connect");
const uuid = require("../utils/uuid");

const productService = {

    // CADASTRAR PRODUTO
    async createProduct(data) {

        await connect.promise().query(
            `INSERT INTO product (
                id,
                name,
                description,
                price,
                priority,
                quantity,
                status,
                category,
                type_negotiation,
                weight,
                conservation_state,
                id_user,
                id_localization
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                uuid.toBin(data.id),
                data.name,
                data.description || null,
                data.price ?? null,
                data.priority ?? 0,
                data.quantity ?? 1,
                data.status || "available",
                data.category,
                data.type_negotiation,
                data.weight,
                data.conservation_state,
                uuid.toBin(data.id_user),
                uuid.toBin(data.id_localization)
            ]
        );

        return data.id;
    },

    // LISTAR PRODUTOS
    async getProducts() {

        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(id) AS id,
                name,
                description,
                price,
                priority,
                quantity,
                status,
                category,
                type_negotiation,
                weight,
                conservation_state,
                BIN_TO_UUID(id_user) AS id_user,
                BIN_TO_UUID(id_localization) AS id_localization
            FROM product
            ORDER BY priority DESC, name ASC`
        );

        return rows;
    },

    // BUSCAR PRODUTO POR ID
    async getProductById(id) {

        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(id) AS id,
                name,
                description,
                price,
                priority,
                quantity,
                status,
                category,
                type_negotiation,
                weight,
                conservation_state,
                BIN_TO_UUID(id_user) AS id_user,
                BIN_TO_UUID(id_localization) AS id_localization
            FROM product
            WHERE id = ?`,
            [id]
        );

        if (rows.length === 0) {
            return null;
        }

        return rows[0];
    },

    // ATUALIZAR PRODUTO
    async updateProduct(id, data, userId) {

        const [result] = await connect.promise().query(
            `UPDATE product
            SET
                name = ?,
                description = ?,
                price = ?,
                priority = ?,
                quantity = ?,
                status = ?,
                category = ?,
                type_negotiation = ?,
                weight = ?,
                conservation_state = ?,
                id_localization = ?
            WHERE id = ? AND id_user = ?`,
            [
                data.name,
                data.description || null,
                data.price ?? null,
                data.priority ?? 0,
                data.quantity ?? 1,
                data.status || "available",
                data.category,
                data.type_negotiation,
                data.weight,
                data.conservation_state,
                uuid.toBin(data.id_localization),
                id,
                uuid.toBin(userId)
            ]
        );

        // Nenhum produto pertencente ao usuário foi encontrado
        if (result.affectedRows === 0) {
            return null;
        }

        return await productService.getProductById(id);
    },

    // EXCLUIR PRODUTO
    async deleteProduct(id, userId) {

        const [result] = await connect.promise().query(
            `DELETE FROM product
             WHERE id = ? AND id_user = ?`,
            [
                id,
                uuid.toBin(userId)
            ]
        );

        return result.affectedRows > 0;
    }

};

module.exports = productService;
