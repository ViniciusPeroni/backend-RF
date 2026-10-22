const router = require("express").Router();
const shoppingProductController = require("../../controllers/shoppingProductController");
const verifyJWT = require("../../middlewares/verifyJWT");

router.use(verifyJWT);

router.get("/", shoppingProductController.getItems);
router.get("/:id", shoppingProductController.getItemById);
router.get("/shopping/:shoppingId", shoppingProductController.getItemsByShoppingId);

module.exports = router;
