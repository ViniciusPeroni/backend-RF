const router = require("express").Router();

//router.use("/usuario", require("./modules/usuarioRoutes"));
router.use("/otp", require("./modules/otpRoutes"));

module.exports = router;
