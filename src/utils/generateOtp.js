const crypto = require('crypto');

module.exports = function generateOtp() {
    // Gera número entre 100000 e 999999
    return crypto.randomInt(100000, 999999).toString();
}