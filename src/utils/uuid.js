const {
    v7: uuidv7,
    parse: uuidParse,
    stringify: uuidStringify,
    validate: uuidValidate
} = require("uuid");

/**
 * Gera um UUID v7.
 *
 * @returns {string}
 */
function generateId() {
    return uuidv7();
}

/**
 * Valida um UUID.
 *
 * @param {string} id
 * @returns {boolean}
 */
function isValid(id) {
    return typeof id === "string" && uuidValidate(id);
}

/**
 * Converte UUID em string para Buffer de 16 bytes.
 * Compatível com MySQL BINARY(16).
 *
 * @param {string} id
 * @returns {Buffer}
 */
function toBin(id) {
    if (!isValid(id)) {
        throw new Error("UUID inválido");
    }

    return Buffer.from(uuidParse(id));
}

/**
 * Converte Buffer de 16 bytes para UUID em string.
 *
 * @param {Buffer} buffer
 * @returns {string}
 */
function fromBin(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length !== 16) {
        throw new Error("Buffer de UUID inválido");
    }

    return uuidStringify(buffer);
}

/**
 * Ordena dois UUIDs de maneira determinística.
 *
 * Útil para manter pares de usuários sempre na mesma ordem,
 * evitando conversas duplicadas entre A/B e B/A.
 *
 * @param {string} idX
 * @param {string} idY
 * @returns {[string, string]}
 */
function ordenatePair(idX, idY) {
    const binX = toBin(idX);
    const binY = toBin(idY);

    return Buffer.compare(binX, binY) < 0
        ? [idX, idY]
        : [idY, idX];
}

module.exports = {
    generateId,
    isValid,
    toBin,
    fromBin,
    ordenatePair
};