const router = require("express").Router();
const otpController = require("../../controllers/otpController");
const { rateLimit } = require('express-rate-limit');

router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde alguns minutos.' } }));

router.post("/enviar", otpController.sendCode);
router.post("/verificar", otpController.verifyCode);

module.exports = router;
