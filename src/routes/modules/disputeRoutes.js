
const router = require("express").Router();

const disputeController = require("../../controllers/disputeController");
const verifyJWT = require("../../middlewares/verifyJWT");
const roleMiddleware = require("../../middlewares/auth");

// ======================================================
// -------- ROTAS PROTEGIDAS (JWT obrigatório)
// ======================================================

// Criar disputa — qualquer usuário autenticado (suporta / e /create)
router.post(
    "/create",
    verifyJWT,
    disputeController.createDispute
);

router.post(
    "/",
    verifyJWT,
    disputeController.createDispute
);

// Listar disputas — filtragem aplicada no service conforme papel
router.get(
    "/",
    verifyJWT,
    disputeController.getDisputes
);

// Buscar disputa por ID — acesso restrito ao dono/vendedor da compra ou admin
router.get(
    "/:id",
    verifyJWT,
    disputeController.getDisputeById
);

// Atualizar disputa — dono da disputa (enquanto 'aberta') ou admin
router.put(
    "/:id",
    verifyJWT,
    disputeController.updateDispute
);

// Resolver disputa — exclusivo para admins
router.patch(
    "/:id/resolve",
    verifyJWT,
    roleMiddleware(["admin"]),
    disputeController.resolveDispute
);

// Rejeitar disputa — exclusivo para admins
router.patch(
    "/:id/reject",
    verifyJWT,
    roleMiddleware(["admin"]),
    disputeController.rejectDispute
);

module.exports = router;
