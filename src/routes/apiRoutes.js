const router = require("express").Router();

router.use("/user", require("./modules/userRoutes"));
router.use("/localization", require("./modules/localizationRoutes"));
router.use("/document", require("./modules/documentRoutes"));
router.use("/otp", require("./modules/otpRoutes"));
router.use("/product", require("./modules/productRoutes"));
router.use("/review", require("./modules/reviewRoutes"));
router.use("/dispute", require("./modules/disputeRoutes"));
router.use("/environmental-impact", require("./modules/environmentalImpactRoutes"));
router.use("/log", require("./modules/logRoutes")); 

module.exports = router;
