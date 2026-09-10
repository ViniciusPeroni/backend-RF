const router = require("express").Router();

const productController = require("../../controllers/productController");

const verifyJWT = require("../../middlewares/verifyJWT");

// ======================================================
// -------- ROTAS PÚBLICAS
// ======================================================

router.get("/", productController.getProducts);

router.get("/:id", productController.getProductById);


// ======================================================
// -------- ROTAS COM JWT
// ======================================================

router.post(
    "/create",
    verifyJWT,
    productController.createProduct
);

router.put(
    "/:id",
    verifyJWT,
    productController.updateProduct
);

router.delete(
    "/:id",
    verifyJWT,
    productController.deleteProduct
);

module.exports = router;