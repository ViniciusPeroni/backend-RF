const multer = require("multer")
const storage = multer.memoryStorage() // Função que salva no Bufer
const upload = multer({storage});

module.exports = upload;