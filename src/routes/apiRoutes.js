const router = require("express").Router();

//router.use("/usuario", require("./modules/usuarioRoutes"));
router.use("/otp", require("./modules/otpRoutes"));
router.use("/log", require("./modules/logRoutes"));

module.exports = router;
