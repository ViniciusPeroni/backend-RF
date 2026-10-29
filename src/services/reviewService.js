
const connect = require("../db/connect");
const uuid = require("../utils/uuid");

const reviewService = {

    // =========================================================
    // CRIAR AVALIAÇÃO
    // Verifica se a compra está concluída e se o avaliador
    // participou dela como comprador OU como vendedor.
    // A UNIQUE KEY (id_shopping, id_reviewer) do banco impede
    // duplicatas — o controller trata ER_DUP_ENTRY.
    // =========================================================
    async createReview(data) {

        // 1. Verifica se a compra existe
        const [shoppingRows] = await connect.promise().query(
            `SELECT id, status FROM shopping WHERE id = ? LIMIT 1`,
            [uuid.toBin(data.id_shopping)]
        );

        if (shoppingRows.length === 0) {
            const error = new Error("Compra não encontrada.");
            error.code = "SHOPPING_NOT_FOUND";
            throw error;
        }

        if (shoppingRows[0].status !== "completed") {
            const error = new Error("Somente compras com status 'completed' podem ser avaliadas.");
            error.code = "REVIEW_NOT_ALLOWED";
            throw error;
        }

        // 2. Verifica se o usuário avaliado realmente existe
        const [userRows] = await connect.promise().query(
            `SELECT id FROM \`user\` WHERE id = ? LIMIT 1`,
            [uuid.toBin(data.id_reviewed)]
        );

        if (userRows.length === 0) {
            const error = new Error("Usuário avaliado não encontrado.");
            error.code = "USER_NOT_FOUND";
            throw error;
        }

        // 3. Verifica se o avaliador e o avaliado participaram da compra como comprador e vendedor
        const [partnership] = await connect.promise().query(
            `SELECT 1
             FROM shopping s
             JOIN shopping_product sp ON sp.id_shopping = s.id
             JOIN product p ON p.id = sp.id_product
             WHERE s.id = ?
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

        if (partnership.length === 0) {
            const error = new Error(
                "Usuários não possuem vínculo de compra e venda nesta transação."
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


    // =========================================================
    // LISTAR AVALIAÇÕES
    // Pública — sem filtro de usuário.
    // =========================================================
    async getReviews() {

        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(id)          AS id,
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


    // =========================================================
    // BUSCAR AVALIAÇÃO POR ID
    // =========================================================
    async getReviewById(id) {

        const [rows] = await connect.promise().query(
            `SELECT
                BIN_TO_UUID(id)          AS id,
                rating,
                comment,
                created_in,
                BIN_TO_UUID(id_shopping) AS id_shopping,
                BIN_TO_UUID(id_reviewer) AS id_reviewer,
                BIN_TO_UUID(id_reviewed) AS id_reviewed
             FROM review
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        return rows[0] || null;
    },


    // =========================================================
    // ATUALIZAR AVALIAÇÃO
    // Verifica existência primeiro, depois valida proprietário.
    // Retorna códigos distintos para "não encontrada" vs
    // "sem permissão", permitindo respostas HTTP corretas.
    // =========================================================
    async updateReview(id, reviewerId, data, role) {

        // Busca a avaliação independente do dono
        const [existing] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id_reviewer) AS id_reviewer
             FROM review
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        if (existing.length === 0) {
            const error = new Error("Avaliação não encontrada.");
            error.code = "NOT_FOUND";
            throw error;
        }

        // Admin pode editar qualquer avaliação; usuário comum só a própria
        if (role !== "admin" && existing[0].id_reviewer !== reviewerId) {
            const error = new Error("Você não tem permissão para editar esta avaliação.");
            error.code = "FORBIDDEN";
            throw error;
        }

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

        // Nenhum campo enviado — o controller já bloqueou antes de chegar aqui,
        // mas adicionamos a guarda defensiva por completude.
        if (fields.length === 0) {
            const error = new Error("Nenhum campo válido para atualizar.");
            error.code = "NO_FIELDS";
            throw error;
        }

        params.push(id);

        await connect.promise().query(
            `UPDATE review SET ${fields.join(", ")} WHERE id = ?`,
            params
        );

        return reviewService.getReviewById(id);
    },


    // =========================================================
    // EXCLUIR AVALIAÇÃO
    // Admin pode excluir qualquer avaliação.
    // Usuário comum só exclui a própria.
    // Retorna códigos distintos para "não encontrada" vs
    // "sem permissão".
    // =========================================================
    async deleteReview(id, reviewerId, role) {

        // Busca independente do dono para diferenciar 404 de 403
        const [existing] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id_reviewer) AS id_reviewer
             FROM review
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        if (existing.length === 0) {
            const error = new Error("Avaliação não encontrada.");
            error.code = "NOT_FOUND";
            throw error;
        }

        if (role !== "admin" && existing[0].id_reviewer !== reviewerId) {
            const error = new Error("Você não tem permissão para excluir esta avaliação.");
            error.code = "FORBIDDEN";
            throw error;
        }

        await connect.promise().query(
            `DELETE FROM review WHERE id = ?`,
            [id]
        );

        return true;
    }

};

module.exports = reviewService;
