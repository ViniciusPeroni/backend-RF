
const router = require("express").Router();

const environmentalImpactController = require("../../controllers/environmentalImpactController");
const verifyJWT = require("../../middlewares/verifyJWT");
const roleMiddleware = require("../../middlewares/auth");

// =====================================================================
// ORDEM DAS ROTAS
// As rotas estáticas e específicas (/create, /shopping/:idShopping)
// devem ser declaradas ANTES de /:id para não serem capturadas pelo
// parâmetro dinâmico da rota de busca por ID.
// =====================================================================

// -------- REGISTRAR IMPACTO AMBIENTAL (JWT obrigatório)
// Disponibiliza tanto a rota padrão REST (POST /) quanto a convenção interna (POST /create)
router.post(
    "/create",
    verifyJWT,
    environmentalImpactController.createImpact
);

router.post(
    "/",
    verifyJWT,
    environmentalImpactController.createImpact
);

// -------- BUSCA POR COMPRA (JWT obrigatório)
router.get(
    "/shopping/:idShopping",
    verifyJWT,
    environmentalImpactController.getImpactByShopping
);

// -------- LISTAR IMPACTOS (JWT obrigatório, filtragem por papel de usuário)
router.get(
    "/",
    verifyJWT,
    environmentalImpactController.getImpacts
);

// -------- BUSCAR POR ID (JWT obrigatório, autorização verificada no serviço)
router.get(
    "/:id",
    verifyJWT,
    environmentalImpactController.getImpactById
);

// -------- ATUALIZAR IMPACTO (Exclusivo para administradores)
router.put(
    "/:id",
    verifyJWT,
    roleMiddleware(["admin"]),
    environmentalImpactController.updateImpact
);

// Observação de arquitetura (Item 5.6 do requisito):
// Não é disponibilizada rota DELETE para environmental_impact a fim de
// preservar a rastreabilidade histórica dos indicadores de sustentabilidade.
// Exclusões de compras são propagadas via ON DELETE CASCADE no MySQL.

module.exports = router;
