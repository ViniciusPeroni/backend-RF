const router = require("express").Router();

router.use("/user", require("./modules/userRoutes"));
router.use("/localization", require("./modules/localizationRoutes"));
router.use("/otp", require("./modules/otpRoutes"));
router.use("/product", require("./modules/productRoutes"));
router.use("/log", require("./modules/logRoutes")); 

module.exports = router;
