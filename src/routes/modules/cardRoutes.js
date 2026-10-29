const router = require("express").Router();
const cardController = require("../../controllers/cardController");
const verifyJWT = require("../../middlewares/verifyJWT");

router.use(verifyJWT);

router.post("/create", cardController.createCard);
router.get("/", cardController.getCards);
router.get("/:id", cardController.getCardById);
router.put("/:id", cardController.updateCard);
router.delete("/:id", cardController.deleteCard);

module.exports = router;
