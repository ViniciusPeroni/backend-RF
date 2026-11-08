const router = require("express").Router();

const paymentController = require("../../controllers/paymentController");
const accountController = require("../../controllers/paymentAccountController");
const verifyJWT = require("../../middlewares/verifyJWT");
const { rateLimit } = require("express-rate-limit");
const oauthLimiter = rateLimit({ windowMs: 60000, limit: 10, keyGenerator: req => req.userId || "invalid",
    message: { error: "Muitas solicitações de vinculação. Aguarde um minuto." } });

// Público para o provedor; autenticado pela assinatura HMAC, não pelo JWT.
router.post("/webhook/mercado-pago", paymentController.webhook);
router.get("/mercado-pago/oauth/callback", accountController.callback);

router.use(verifyJWT);
router.get("/configuration", accountController.configuration);
router.post("/mercado-pago/connect", oauthLimiter, accountController.start);
router.get("/mercado-pago/account", accountController.status);
router.delete("/mercado-pago/account", accountController.disconnect);

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
