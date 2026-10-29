const router = require("express").Router();
const shoppingController = require("../../controllers/shoppingController");
const verifyJWT = require("../../middlewares/verifyJWT");

router.use(verifyJWT);

router.post("/create", shoppingController.createShopping);
router.get("/", shoppingController.getShoppings);
router.get("/:id", shoppingController.getShoppingById);
router.patch("/:id/cancel", shoppingController.cancelShopping);
router.patch("/:id/status", shoppingController.updateStatus);

module.exports = router;
