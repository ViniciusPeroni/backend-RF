const router = require("express").Router();

router.use("/user", require("./modules/userRoutes"));
router.use("/localization", require("./modules/localizationRoutes"));
router.use("/otp", require("./modules/otpRoutes"));
router.use("/log", require("./modules/logRoutes")); 

module.exports = router;
