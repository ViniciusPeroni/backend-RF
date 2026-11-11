const router = require("express").Router();
const logController = require("../../controllers/logController");
const verifyJWT = require("../../middlewares/verifyJWT");
const roleMiddleware = require("../../middlewares/auth");

// Auditoria é dado sensível: leitura, criação, edição e exclusão de logs são
// restritas ao administrador autenticado.
router.use(verifyJWT);
router.use(roleMiddleware(['admin']));

router.post("/", logController.createLog);
router.get("/", logController.listLogs);
router.get("/:id", logController.getLogById);
router.put("/:id", logController.updateLog);
router.delete("/:id", logController.deleteLog);

module.exports = router;
