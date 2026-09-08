const router = require("express").Router();
const otpController = require("../../controllers/otpController");

router.post("/enviar", otpController.sendCode);
router.post("/verificar", otpController.verifyCode);

module.exports = router;