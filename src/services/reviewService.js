
const connect = require("../db/connect");
const uuid = require("../utils/uuid");

const reviewService = {

    async createReview(data) {

        const [purchases] = await connect.promise().query(
            `SELECT s.id
             FROM shopping s
             JOIN shopping_product sp ON sp.id_shopping = s.id
             JOIN product p ON p.id = sp.id_product
             WHERE s.id = ?
               AND s.status = 'completed'
               AND (
                   (s.id_user = ? AND p.id_user = ?)
                   OR (p.id_user = ? AND s.id_user = ?)
               )
             LIMIT 1`,
            [
                uuid.toBin(data.id_shopping),
                uuid.toBin(data.id_reviewer),
                uuid.toBin(data.id_reviewed),
                uuid.toBin(data.id_reviewer),
                uuid.toBin(data.id_reviewed)
            ]
        );

        if (purchases.length === 0) {
            const error = new Error(
                "Compra não concluída ou usuários não participantes."
            );
            error.code = "REVIEW_NOT_ALLOWED";
            throw error;
        }

        const id = uuid.generateId();

        await connect.promise().query(
            `INSERT INTO review (
                id,
                rating,
                comment,
                id_shopping,
                id_reviewer,
                id_reviewed
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                uuid.toBin(id),
                data.rating,
                data.comment ?? null,
                uuid.toBin(data.id_shopping),
                uuid.toBin(data.id_reviewer),
                uuid.toBin(data.id_reviewed)
            ]
        );

        return id;
    },


    async getReviews() {

        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(id) AS id,
                rating,
                comment,
                created_in,
                BIN_TO_UUID(id_shopping) AS id_shopping,
                BIN_TO_UUID(id_reviewer) AS id_reviewer,
                BIN_TO_UUID(id_reviewed) AS id_reviewed
             FROM review
             ORDER BY created_in DESC`
        );

        return rows;
    },


    async getReviewById(id) {

        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(id) AS id,
                rating,
                comment,
                created_in,
                BIN_TO_UUID(id_shopping) AS id_shopping,
                BIN_TO_UUID(id_reviewer) AS id_reviewer,
                BIN_TO_UUID(id_reviewed) AS id_reviewed
             FROM review
             WHERE id = ?`,
            [id]
        );

        return rows[0] || null;
    },


    async updateReview(id, reviewerId, data) {

        const fields = [];
        const params = [];

        if (data.rating !== undefined) {
            fields.push("rating = ?");
            params.push(data.rating);
        }

        if (data.comment !== undefined) {
            fields.push("comment = ?");
            params.push(data.comment);
        }

        if (fields.length === 0) {
            return null;
        }

        params.push(id, uuid.toBin(reviewerId));

        const [result] = await connect.promise().query(
            `UPDATE review
             SET ${fields.join(", ")}
             WHERE id = ? AND id_reviewer = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return null;
        }

        return reviewService.getReviewById(id);
    },


    async deleteReview(id, reviewerId) {

        const [result] = await connect.promise().query(
            `DELETE FROM review
             WHERE id = ? AND id_reviewer = ?`,
            [id, uuid.toBin(reviewerId)]
        );

        return result.affectedRows > 0;
    }

};

module.exports = reviewService;
