const { rateLimit } = require("express-rate-limit");

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: "Muitas requisições. Aguarde alguns minutos." },
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: "Muitas tentativas. Aguarde alguns minutos." },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { globalLimiter, authLimiter };
