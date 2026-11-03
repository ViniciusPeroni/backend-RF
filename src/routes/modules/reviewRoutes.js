
const router = require("express").Router();

const reviewController = require("../../controllers/reviewController");
const verifyJWT = require("../../middlewares/verifyJWT");

// ======================================================
// -------- ROTAS PÚBLICAS (sem JWT)
// ======================================================

// Listar todas as avaliações
router.get("/", reviewController.getReviews);

// Buscar avaliação por ID
router.get("/:id", reviewController.getReviewById);

// ======================================================
// -------- ROTAS PROTEGIDAS (JWT obrigatório)
// ======================================================

// Criar avaliação (suporta / e /create)
router.post("/create", verifyJWT, reviewController.createReview);
router.post("/", verifyJWT, reviewController.createReview);

// Atualizar avaliação (autor ou admin)
router.put("/:id", verifyJWT, reviewController.updateReview);

// Excluir avaliação (autor ou admin)
router.delete("/:id", verifyJWT, reviewController.deleteReview);

module.exports = router;
