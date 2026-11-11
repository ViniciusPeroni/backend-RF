
const reviewService = require("../services/reviewService");
const uuid = require("../utils/uuid");


// =========================================================
// CRIAR AVALIAÇÃO
// POST /review/create
// =========================================================
const createReview = async (req, res) => {
    try {
        // 1. Autenticação primeiro — antes de qualquer outra validação
        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Usuário não autenticado."
            });
        }

        const { rating, comment, id_shopping, id_reviewed } = req.body;

        // 2. Campos obrigatórios
        if (rating == null || !id_shopping || !id_reviewed) {
            return res.status(400).json({
                error: "Nota, compra e usuário avaliado são obrigatórios."
            });
        }

        // 3. Validação da nota
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({
                error: "A nota deve ser um número inteiro entre 1 e 5."
            });
        }

        // 4. Validação dos UUIDs do body
        if (!uuid.isValid(id_shopping) || !uuid.isValid(id_reviewed)) {
            return res.status(400).json({
                error: "ID da compra ou do usuário inválido."
            });
        }

        // 5. Impede auto-avaliação
        if (req.userId === id_reviewed) {
            return res.status(400).json({
                error: "Você não pode avaliar a si mesmo."
            });
        }

        // 6. Validação opcional do comentário
        if (comment !== undefined && comment !== null &&
            typeof comment === "string" && comment.length > 1000) {
            return res.status(400).json({
                error: "O comentário não pode ultrapassar 1000 caracteres."
            });
        }

        const id = await reviewService.createReview({
            rating,
            comment,
            id_shopping,
            id_reviewer: req.userId,
            id_reviewed
        });

        return res.status(201).json({
            message: "Avaliação cadastrada com sucesso.",
            id
        });

    } catch (error) {
        console.error("Erro em createReview:", error);

        // Compra não encontrada
        if (error.code === "SHOPPING_NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }

        // Duplicata detectada pela UNIQUE KEY do banco
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "Você já avaliou essa compra."
            });
        }

        // Compra não concluída ou usuários sem vínculo
        if (error.code === "REVIEW_NOT_ALLOWED") {
            return res.status(403).json({ error: error.message });
        }

        // Usuário avaliado não existe
        if (error.code === "USER_NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao cadastrar avaliação." });
    }
};


// =========================================================
// LISTAR AVALIAÇÕES
// GET /review
// Público — não exige JWT.
// =========================================================
const getReviews = async (req, res) => {
    try {
        const reviews = await reviewService.getReviews();

        return res.status(200).json(reviews);

    } catch (error) {
        console.error("Erro em getReviews:", error);

        return res.status(500).json({ error: "Erro ao buscar avaliações." });
    }
};


// =========================================================
// BUSCAR AVALIAÇÃO POR ID
// GET /review/:id
// Público — não exige JWT.
// =========================================================
const getReviewById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: "ID da avaliação inválido." });
        }

        const review = await reviewService.getReviewById(uuid.toBin(id));

        if (!review) {
            return res.status(404).json({ error: "Avaliação não encontrada." });
        }

        return res.status(200).json(review);

    } catch (error) {
        console.error("Erro em getReviewById:", error);

        return res.status(500).json({ error: "Erro ao buscar avaliação." });
    }
};


// =========================================================
// ATUALIZAR AVALIAÇÃO
// PUT /review/:id
// Somente o autor ou um admin podem alterar.
// =========================================================
const updateReview = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Autenticação
        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        // 2. UUID do parâmetro
        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: "ID da avaliação inválido." });
        }

        const { rating, comment } = req.body;

        // 3. Ao menos um campo deve ser enviado
        if (rating === undefined && comment === undefined) {
            return res.status(400).json({
                error: "Informe a nota ou o comentário para atualizar."
            });
        }

        // 4. Validação da nota, se enviada
        if (rating !== undefined &&
            (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
            return res.status(400).json({
                error: "A nota deve ser um número inteiro entre 1 e 5."
            });
        }

        // 5. Validação do comentário, se enviado
        if (comment !== undefined && comment !== null &&
            typeof comment === "string" && comment.length > 1000) {
            return res.status(400).json({
                error: "O comentário não pode ultrapassar 1000 caracteres."
            });
        }

        const review = await reviewService.updateReview(
            uuid.toBin(id),
            req.userId,
            { rating, comment },
            req.role
        );

        return res.status(200).json({
            message: "Avaliação atualizada com sucesso.",
            review
        });

    } catch (error) {
        console.error("Erro em updateReview:", error);

        if (error.code === "NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }
        if (error.code === "FORBIDDEN") {
            return res.status(403).json({ error: error.message });
        }
        if (error.code === "NO_FIELDS") {
            return res.status(400).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao atualizar avaliação." });
    }
};


// =========================================================
// EXCLUIR AVALIAÇÃO
// DELETE /review/:id
// Somente o autor ou um admin podem excluir.
// =========================================================
const deleteReview = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Autenticação
        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        // 2. UUID do parâmetro
        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: "ID da avaliação inválido." });
        }

        await reviewService.deleteReview(
            uuid.toBin(id),
            req.userId,
            req.role
        );

        return res.status(200).json({ message: "Avaliação excluída com sucesso." });

    } catch (error) {
        console.error("Erro em deleteReview:", error);

        if (error.code === "NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }
        if (error.code === "FORBIDDEN") {
            return res.status(403).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao excluir avaliação." });
    }
};


module.exports = {
    createReview,
    getReviews,
    getReviewById,
    updateReview,
    deleteReview
};
