const router = require("express").Router();
const paymentController = require("../../controllers/paymentController");
const verifyJWT = require("../../middlewares/verifyJWT");
const { globalLimiter } = require("../../middlewares/rateLimit");

router.use(globalLimiter);
router.post("/webhook", paymentController.handleWebhook);
router.use(verifyJWT);

router.post("/checkout", paymentController.createCheckout);
router.get("/:paymentId", paymentController.getPaymentStatus);

module.exports = router;
