const connect = require("../db/connect");
const uuid = require("../utils/uuid");

const shoppingService = {

    async createShopping(userId, items) {
        let conn;
        try {
            conn = await connect.promise().getConnection();
            await conn.beginTransaction();

            let totalValue = 0;
            const processedItems = [];

            for (const item of items) {
                const productBinId = uuid.toBin(item.id_product);

                const [products] = await conn.query(
                    `SELECT
                        BIN_TO_UUID(id) AS id,
                        name,
                        price,
                        quantity,
                        status,
                        type_negotiation,
                        BIN_TO_UUID(id_user) AS id_user
                     FROM product
                     WHERE id = ? FOR UPDATE`,
                    [productBinId]
                );

                if (products.length === 0) {
                    const err = new Error(`Produto não encontrado (ID: ${item.id_product}).`);
                    err.status = 404;
                    throw err;
                }

                const product = products[0];

                if (String(product.id_user).toLowerCase() === String(userId).toLowerCase()) {
                    const err = new Error(`Você não pode comprar seu próprio produto (${product.name}).`);
                    err.status = 400;
                    throw err;
                }

                if (product.status !== "available") {
                    const err = new Error(`O produto "${product.name}" não está disponível para compra.`);
                    err.status = 400;
                    throw err;
                }

                if (product.quantity < item.quantity) {
                    const err = new Error(
                        `Estoque insuficiente para "${product.name}". Solicitado: ${item.quantity}, disponível: ${product.quantity}.`
                    );
                    err.status = 400;
                    throw err;
                }

                const unitPrice = product.type_negotiation === "donation" ? 0 : Number(product.price || 0);
                const itemTotal = Number((unitPrice * item.quantity).toFixed(2));
                totalValue += itemTotal;

                processedItems.push({
                    id_product: item.id_product,
                    product_name: product.name,
                    quantity: item.quantity,
                    unit_price: unitPrice,
                    subtotal: itemTotal,
                    current_stock: product.quantity
                });
            }

            totalValue = Number(totalValue.toFixed(2));
            const shoppingId = uuid.generateId();
            const shoppingBinId = uuid.toBin(shoppingId);
            const userBinId = uuid.toBin(userId);

            // 1) Insere a compra na tabela shopping com valor calculado automaticamente
            await conn.query(
                `INSERT INTO shopping (id, value, status, id_user)
                 VALUES (?, ?, 'pending', ?)`,
                [shoppingBinId, totalValue, userBinId]
            );

            // 2) Insere os itens em shopping_product e atualiza estoque de cada produto
            for (const item of processedItems) {
                const itemId = uuid.generateId();
                const itemBinId = uuid.toBin(itemId);
                const productBinId = uuid.toBin(item.id_product);

                await conn.query(
                    `INSERT INTO shopping_product (id, value, quantity, id_product, id_shopping)
                     VALUES (?, ?, ?, ?, ?)`,
                    [itemBinId, item.subtotal, item.quantity, productBinId, shoppingBinId]
                );

                const newQuantity = item.current_stock - item.quantity;
                const newStatus = newQuantity === 0 ? "reserved" : "available";

                await conn.query(
                    `UPDATE product
                     SET quantity = ?, status = ?
                     WHERE id = ?`,
                    [newQuantity, newStatus, productBinId]
                );

                item.id = itemId;
            }

            await conn.commit();

            return {
                id: shoppingId,
                value: totalValue,
                status: "pending",
                items: processedItems.map(({ current_stock, ...rest }) => rest)
            };

        } catch (error) {
            if (conn) {
                try {
                    await conn.rollback();
                } catch (rbError) {
                    console.error("Falha no rollback de createShopping:", rbError);
                }
            }
            throw error;
        } finally {
            if (conn) conn.release();
        }
    },


    async getShoppings(userId, role) {
        const isAdmin = role === "admin";
        const query = `
            SELECT
                BIN_TO_UUID(s.id) AS id,
                s.datetime,
                s.value,
                s.status,
                BIN_TO_UUID(s.id_user) AS id_user,
                u.name AS user_name,
                COUNT(sp.id) AS total_items
            FROM shopping s
            INNER JOIN \`user\` u ON s.id_user = u.id
            LEFT JOIN shopping_product sp ON s.id = sp.id_shopping
            ${isAdmin ? "" : "WHERE s.id_user = ?"}
            GROUP BY s.id, s.datetime, s.value, s.status, s.id_user, u.name
            ORDER BY s.datetime DESC
        `;

        const params = isAdmin ? [] : [uuid.toBin(userId)];
        const [rows] = await connect.promise().query(query, params);

        return rows;
    },


    async getShoppingById(id) {
        const [shoppingRows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(s.id) AS id,
                s.datetime,
                s.value,
                s.status,
                BIN_TO_UUID(s.id_user) AS id_user,
                u.name AS user_name,
                u.email AS user_email,
                u.cellphone AS user_cellphone
             FROM shopping s
             INNER JOIN \`user\` u ON s.id_user = u.id
             WHERE s.id = ?`,
            [uuid.toBin(id)]
        );

        if (shoppingRows.length === 0) {
            return null;
        }

        const shopping = shoppingRows[0];

        const [itemRows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(sp.id) AS id,
                sp.value AS subtotal,
                sp.quantity,
                BIN_TO_UUID(sp.id_product) AS id_product,
                p.name AS product_name,
                p.category AS product_category,
                p.type_negotiation,
                p.price AS unit_price,
                BIN_TO_UUID(p.id_user) AS seller_id
             FROM shopping_product sp
             INNER JOIN product p ON sp.id_product = p.id
             WHERE sp.id_shopping = ?`,
            [uuid.toBin(id)]
        );

        shopping.items = itemRows;
        return shopping;
    },


    async updateStatus(id, newStatus) {
        let conn;
        try {
            conn = await connect.promise().getConnection();
            await conn.beginTransaction();

            const [shoppingRows] = await conn.query(
                `SELECT
                    BIN_TO_UUID(id) AS id,
                    status
                 FROM shopping
                 WHERE id = ? FOR UPDATE`,
                [uuid.toBin(id)]
            );

            if (shoppingRows.length === 0) {
                await conn.rollback();
                return null;
            }

            const currentStatus = shoppingRows[0].status;

            if (["cancelled", "refused", "completed"].includes(currentStatus)) {
                const err = new Error(`Esta compra já foi finalizada com status "${currentStatus}" e não pode ser alterada.`);
                err.status = 400;
                throw err;
            }

            // Se a compra está sendo cancelada ou recusada, devolvemos o estoque dos produtos
            if (["cancelled", "refused"].includes(newStatus) && !["cancelled", "refused"].includes(currentStatus)) {
                const [items] = await conn.query(
                    `SELECT id_product, quantity
                     FROM shopping_product
                     WHERE id_shopping = ?`,
                    [uuid.toBin(id)]
                );

                for (const item of items) {
                    await conn.query(
                        `UPDATE product
                         SET quantity = quantity + ?,
                             status = 'available'
                         WHERE id = ?`,
                        [item.quantity, item.id_product]
                    );
                }
            }

            await conn.query(
                `UPDATE shopping
                 SET status = ?
                 WHERE id = ?`,
                [newStatus, uuid.toBin(id)]
            );

            await conn.commit();

            return await shoppingService.getShoppingById(id);

        } catch (error) {
            if (conn) {
                try {
                    await conn.rollback();
                } catch (rbError) {
                    console.error("Falha no rollback de updateStatus:", rbError);
                }
            }
            throw error;
        } finally {
            if (conn) conn.release();
        }
    }

};

module.exports = shoppingService;
