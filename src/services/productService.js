const connect = require("../db/connect");
const uuid = require("../utils/uuid");

const productService = {

    async createProduct(data, photos = []) {
        let conn;
        try {
            conn = await connect.promise().getConnection();
            await conn.beginTransaction();

            await conn.query(
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

            if (photos && Array.isArray(photos) && photos.length > 0) {
                for (const photoBuffer of photos) {
                    const photoId = uuid.generateId();
                    await conn.query(
                        `INSERT INTO product_photo (id, photo, id_product)
                         VALUES (?, ?, ?)`,
                        [uuid.toBin(photoId), photoBuffer, uuid.toBin(data.id)]
                    );
                }
            }

            await conn.commit();
            return data.id;
        } catch (error) {
            if (conn) {
                try {
                    await conn.rollback();
                } catch (rbError) {
                    console.error("Falha no rollback de createProduct:", rbError);
                }
            }
            throw error;
        } finally {
            if (conn) conn.release();
        }
    },


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

        if (rows.length === 0) {
            return [];
        }

        const [photoRows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(id) AS id,
                BIN_TO_UUID(id_product) AS id_product,
                photo
             FROM product_photo`
        );

        const photosByProduct = {};
        for (const p of photoRows) {
            if (!photosByProduct[p.id_product]) {
                photosByProduct[p.id_product] = [];
            }
            photosByProduct[p.id_product].push({
                id: p.id,
                photo: p.photo ? p.photo.toString("base64") : null
            });
        }

        return rows.map((product) => ({
            ...product,
            photos: photosByProduct[product.id] || []
        }));
    },


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

        const product = rows[0];

        const [photoRows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(id) AS id,
                photo
             FROM product_photo
             WHERE id_product = ?`,
            [id]
        );

        product.photos = photoRows.map((p) => ({
            id: p.id,
            photo: p.photo ? p.photo.toString("base64") : null
        }));

        return product;
    },


    async updateProduct(id, data, userId, photos) {
        let conn;
        try {
            conn = await connect.promise().getConnection();
            await conn.beginTransaction();

            const [result] = await conn.query(
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

            if (result.affectedRows === 0) {
                await conn.rollback();
                return null;
            }

            if (photos !== undefined && photos !== null && Array.isArray(photos)) {
                await conn.query(
                    `DELETE FROM product_photo WHERE id_product = ?`,
                    [id]
                );

                for (const photoBuffer of photos) {
                    const photoId = uuid.generateId();
                    await conn.query(
                        `INSERT INTO product_photo (id, photo, id_product)
                         VALUES (?, ?, ?)`,
                        [uuid.toBin(photoId), photoBuffer, id]
                    );
                }
            }

            await conn.commit();
            return await productService.getProductById(id);
        } catch (error) {
            if (conn) {
                try {
                    await conn.rollback();
                } catch (rbError) {
                    console.error("Falha no rollback de updateProduct:", rbError);
                }
            }
            throw error;
        } finally {
            if (conn) conn.release();
        }
    },


    async deleteProduct(id, userId) {
        const [result] = await connect.promise().query(
            `DELETE FROM product
             WHERE id = ? AND id_user = ?`,
            [id, uuid.toBin(userId)]
        );

        return result.affectedRows > 0;
    },


    async addPhotos(productId, photos) {
        const [products] = await connect.promise().query(
            `SELECT id FROM product WHERE id = ?`,
            [productId]
        );

        if (products.length === 0) {
            return null;
        }

        const insertedPhotos = [];
        for (const photoBuffer of photos) {
            const photoId = uuid.generateId();
            await connect.promise().query(
                `INSERT INTO product_photo (id, photo, id_product)
                 VALUES (?, ?, ?)`,
                [uuid.toBin(photoId), photoBuffer, productId]
            );

            insertedPhotos.push({
                id: photoId,
                photo: photoBuffer.toString("base64")
            });
        }

        return insertedPhotos;
    },


    async updatePhoto(photoId, photoBuffer) {
        const [result] = await connect.promise().query(
            `UPDATE product_photo
             SET photo = ?
             WHERE id = ?`,
            [photoBuffer, photoId]
        );

        if (result.affectedRows === 0) {
            return null;
        }

        const [rows] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id) AS id, BIN_TO_UUID(id_product) AS id_product, photo
             FROM product_photo
             WHERE id = ?`,
            [photoId]
        );

        if (rows.length === 0) {
            return null;
        }

        return {
            id: rows[0].id,
            id_product: rows[0].id_product,
            photo: rows[0].photo ? rows[0].photo.toString("base64") : null
        };
    },


    async deletePhoto(photoId) {
        const [result] = await connect.promise().query(
            `DELETE FROM product_photo
             WHERE id = ?`,
            [photoId]
        );

        return result.affectedRows > 0;
    }

};

module.exports = productService;
