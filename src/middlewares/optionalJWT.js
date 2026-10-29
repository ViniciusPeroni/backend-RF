const jwt = require("jsonwebtoken");

/**
 * Versao opcional do verifyJWT: header ausente, token invalido ou expirado
 * seguem anonimos (nunca 401); token valido identifica a pessoa em
 * req.userId/req.role/req.userName.
 *
 * Usado na visao publica de localizacao, em que o mascaramento RN10 depende
 * de quem pergunta, mas a rota nao exige login.
 */
function optionalJWT(req, res, next) {
    const header = req.headers["authorization"];

    if (!header) {
        return next();
    }

    const token = header.startsWith("Bearer ") ? header.slice(7) : header;

    jwt.verify(token, process.env.SECRET, (err, decoded) => {
        if (!err) {
            req.userId = decoded.id;
            req.role = decoded.role;
            req.userName = decoded.name;
        }

        next();
    });
}

module.exports = optionalJWT;
