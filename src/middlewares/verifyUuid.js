const { isValid } = require("../utils/uuid");

function validarUuid(paramName = "id") {
    return (req, res, next) => {
        const value = req.params[paramName];

        if (!isValid(value)) {
            return res.status(400).json({
                erro: `${paramName} inválido`
            });
        }
        next();
    };
}

module.exports = validarUuid;