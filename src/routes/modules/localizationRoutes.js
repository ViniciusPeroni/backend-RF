const router = require("express").Router();
const localizationController = require("../../controllers/localizationController");
const validateLocalization = require("../../middlewares/validateLocalization");
const verifyJWT = require("../../middlewares/verifyJWT");
const optionalJWT = require("../../middlewares/optionalJWT");

// Visão pública do anúncio (RN10): token opcional identifica dono/comprador
// aceito; anônimo recebe só cidade/bairro com coordenadas aproximadas.
// É a única rota que funciona sem JWT.
router.get("/product/:productId", optionalJWT, localizationController.getProductLocation);

router.use(verifyJWT);

// POST exige JWT e o controller recusa userId divergente de req.userId (403).
router.post("/", validateLocalization, localizationController.createLocalization);
router.get("/", localizationController.getLocalizations);
router.get("/:id", localizationController.getLocalization);
router.put("/:id", localizationController.updateLocalization);
router.delete("/:id", localizationController.deleteLocalization);

module.exports = router;
