const jwt = require("jsonwebtoken");

function verifyJWT( req, res, next){
    const token = req.headers["authorization"];

    if(!token){
        return res
        .status(401)
        .json({auth: false, message: "Token não fornecido"});
    }

    jwt.verify(token, process.env.SECRET, (err, decoded) => {
        if (err) {

            if(err.name === "TokenExpiredError"){
                return res.status(401).json({auth:false, message: "Token expirado, faça autenticação novamente"})
            }
            return res
            .status(401)
            .json({ auth: false, message: "Falha na autenticação do token"})
        }

        req.userId = decoded.id;
        next();

    });
}
module.exports = verifyJWT;
