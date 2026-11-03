const router = require("express").Router();
const commissionController = require("../../controllers/commissionController");
const roleMiddleware = require("../../middlewares/auth");
const verifyJWT = require("../../middlewares/verifyJWT");
const { globalLimiter } = require("../../middlewares/rateLimit");

router.use(globalLimiter);
router.use(verifyJWT);
router.use(roleMiddleware(["admin"]));

router.post("/payment/:paymentId", commissionController.generateCommission);

module.exports = router;
