const router = require("express").Router();
const documentController = require("../../controllers/documentController");
const verifyJWT = require("../../middlewares/verifyJWT");
const roleMiddleware = require("../../middlewares/auth");
const { globalLimiter } = require("../../middlewares/rateLimit");

router.use(globalLimiter);

// Rotas autenticadas
router.use(verifyJWT);
router.post("/", documentController.createDoc);
router.get("/user/:userId", documentController.getDocsByUser);
router.get("/:id/decrypt", roleMiddleware(['admin']), documentController.getDecryptedDoc);
router.get("/:id", documentController.getDocById);
router.delete("/:id", roleMiddleware(['admin']), documentController.deleteDoc);

module.exports = router;
