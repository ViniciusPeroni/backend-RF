const router = require("express").Router();

const productController = require("../../controllers/productController");

const verifyJWT = require("../../middlewares/verifyJWT");
const upload = require("../../middlewares/upload");

// ======================================================
// -------- ROTAS PÚBLICAS
// ======================================================

router.get("/", productController.getProducts);

router.get("/:id", productController.getProductById);


// ======================================================
// -------- ROTAS COM JWT
// ======================================================

// Rotas exclusivas para fotos
router.post(
    "/:id/photos",
    verifyJWT,
    upload.array("photos"),
    productController.addPhotos
);

router.put(
    "/photos/:photoId",
    verifyJWT,
    upload.single("photo"),
    productController.updatePhoto
);

router.delete(
    "/photos/:photoId",
    verifyJWT,
    productController.deletePhoto
);

// Rotas de produto
router.post(
    "/create",
    verifyJWT,
    upload.array("photos"),
    productController.createProduct
);

router.put(
    "/:id",
    verifyJWT,
    upload.array("photos"),
    productController.updateProduct
);

router.delete(
    "/:id",
    verifyJWT,
    productController.deleteProduct
);

module.exports = router;