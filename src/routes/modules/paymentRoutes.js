const router = require("express").Router();

const paymentController = require("../../controllers/paymentController");
const verifyJWT = require("../../middlewares/verifyJWT");

// Público para o provedor; autenticado pela assinatura HMAC, não pelo JWT.
router.post("/webhook/mercado-pago", paymentController.webhook);

router.use(verifyJWT);

router.post("/create", paymentController.createPayment);
router.get("/:id/checkout", paymentController.getCheckout);
router.post("/:id/sync", paymentController.sync);
router.post("/:id/cancel", paymentController.cancel);
router.post("/:id/refund", paymentController.refund);
router.post("/:id/simulate", paymentController.simulate);
router.get(
    "/shopping/:shoppingId",
    paymentController.getPaymentsByShoppingId
);

router.get(
    "/:id",
    paymentController.getPaymentById
);

module.exports = router;
