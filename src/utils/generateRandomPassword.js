const crypto = require('crypto');

module.exports = function generatePassword(length = 6) {
    const library = ['A','B','C','D','E','F','G','H','a','b','c','d','e','f','g','h','@','-','_','?','#'];
    let pass = "";
    for (let i = 0; i < length; i++) {
        pass += library[crypto.randomInt(0, library.length)];
    }
    return pass;
}