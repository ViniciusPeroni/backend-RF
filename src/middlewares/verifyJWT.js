const jwt = require("jsonwebtoken");

function verifyJWT( req, res, next){
    const header = req.headers["authorization"];

    if(!header){
        return res
        .status(401)
        .json({auth: false, message: "Token não fornecido"});
    }

    const token = header.startsWith("Bearer ") ? header.slice(7) : header;

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
        req.role = decoded.role;
        req.userName = decoded.name;
        next();

    });
}
module.exports = verifyJWT;
