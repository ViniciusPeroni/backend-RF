
const reviewService = require("../services/reviewService");
const uuid = require("../utils/uuid");

const createReview = async (req, res) => {
    try {
        const { rating, comment, id_shopping, id_reviewed } = req.body;

        if (rating == null || !id_shopping || !id_reviewed) {
            return res.status(400).json({
                error: "Nota, compra e usuário avaliado são obrigatórios."
            });
        }

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({
                error: "A nota deve ser um número inteiro entre 1 e 5."
            });
        }

        if (!uuid.isValid(id_shopping) || !uuid.isValid(id_reviewed)) {
            return res.status(400).json({
                error: "ID da compra ou do usuário inválido."
            });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Usuário não autenticado."
            });
        }

        if (req.userId === id_reviewed) {
            return res.status(400).json({
                error: "Você não pode avaliar a si mesmo."
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

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                error: "Você já avaliou essa compra."
            });
        }

        return res.status(500).json({
            error: "Erro ao cadastrar avaliação."
        });
    }
};


const getReviews = async (req, res) => {
    try {
        const reviews = await reviewService.getReviews();

        return res.status(200).json(reviews);

    } catch (error) {
        console.error("Erro em getReviews:", error);

        return res.status(500).json({
            error: "Erro ao buscar avaliações."
        });
    }
};


const getReviewById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID da avaliação inválido."
            });
        }

        const review = await reviewService.getReviewById(
            uuid.toBin(id)
        );

        if (!review) {
            return res.status(404).json({
                error: "Avaliação não encontrada."
            });
        }

        return res.status(200).json(review);

    } catch (error) {
        console.error("Erro em getReviewById:", error);

        return res.status(500).json({
            error: "Erro ao buscar avaliação."
        });
    }
};


const updateReview = async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, comment } = req.body;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID da avaliação inválido."
            });
        }

        if (rating === undefined && comment === undefined) {
            return res.status(400).json({
                error: "Informe a nota ou comentário para atualizar."
            });
        }

        if (rating !== undefined &&
            (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
            return res.status(400).json({
                error: "A nota deve ser um número inteiro entre 1 e 5."
            });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Usuário não autenticado."
            });
        }

        const review = await reviewService.updateReview(
            uuid.toBin(id),
            req.userId,
            { rating, comment }
        );

        if (!review) {
            return res.status(404).json({
                error: "Avaliação não encontrada ou sem permissão."
            });
        }

        return res.status(200).json({
            message: "Avaliação atualizada com sucesso.",
            review
        });

    } catch (error) {
        console.error("Erro em updateReview:", error);

        return res.status(500).json({
            error: "Erro ao atualizar avaliação."
        });
    }
};


const deleteReview = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID da avaliação inválido."
            });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Usuário não autenticado."
            });
        }

        const deleted = await reviewService.deleteReview(
            uuid.toBin(id),
            req.userId
        );

        if (!deleted) {
            return res.status(404).json({
                error: "Avaliação não encontrada ou sem permissão."
            });
        }

        return res.status(200).json({
            message: "Avaliação excluída com sucesso."
        });

    } catch (error) {
        console.error("Erro em deleteReview:", error);

        return res.status(500).json({
            error: "Erro ao excluir avaliação."
        });
    }
};


module.exports = {
    createReview,
    getReviews,
    getReviewById,
    updateReview,
    deleteReview
};
