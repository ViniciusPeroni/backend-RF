const connect = require('../db/connect');
const { generateId, isValid, toBin } = require('../utils/uuid');

function validateLocalization({
    userId,
    zipCode,
    street,
    neighborhood,
    number,
    city,
    state,
}) {
    if (!userId || !zipCode || !street || !neighborhood || !number || !city || !state) {
        return 'Todos os campos devem ser preenchidos: userId, zipCode, street, neighborhood, number, city, state';
    }

    if (!isValid(userId)) {
        return 'userId inválido. Deve ser um UUID válido';
    }

    if (!/^\d{8}$/.test(String(zipCode))) {
        return 'CEP inválido. Deve conter 8 dígitos numéricos (sem hífen)';
    }

    if (String(street).length > 150) {
        return 'Rua deve ter no máximo 150 caracteres';
    }

    if (String(neighborhood).length > 80) {
        return 'Bairro deve ter no máximo 80 caracteres';
    }

    if (String(number).length > 6) {
        return 'Número deve ter no máximo 6 caracteres';
    }

    if (String(city).length > 100) {
        return 'Cidade deve ter no máximo 100 caracteres';
    }

    if (!/^[A-Za-z]{2}$/.test(String(state))) {
        return 'Estado inválido. Informe a sigla com 2 letras (ex: SP)';
    }

    return null;
}

async function createLocalization({ userId, zipCode, street, neighborhood, number, city, state }, dbConn) {
    const db = dbConn || connect.promise();
    const error = validateLocalization({ userId, zipCode, street, neighborhood, number, city, state });
    if (error) {
        const err = new Error(error);
        err.status = 400;
        throw err;
    }

    const userIdBin = Buffer.isBuffer(userId) ? userId : toBin(userId);

    const [userRows] = await db.query(
        `SELECT id FROM \`user\` WHERE id = ?`,
        [userIdBin]
    );

    if (userRows.length === 0) {
        const err = new Error('Usuário não encontrado');
        err.status = 404;
        throw err;
    }

    const id = generateId();

    await db.query(
        `INSERT INTO localization (id, zip_code, street, neighborhood, number, city, state, id_user)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [toBin(id), String(zipCode), street, neighborhood, String(number), city, String(state).toUpperCase(), userIdBin]
    );

    return id;
}

module.exports = { validateLocalization, createLocalization };
