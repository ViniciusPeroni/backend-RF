const connect = require('../db/connect');
const { generateId, isValid, toBin } = require('../utils/uuid');

function parseCoordinate(value, label, min, max) {
    const coordinate = typeof value === 'number'
        ? value
        : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);

    if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
        return `${label} inválida. Deve estar entre ${min} e ${max}`;
    }

    return null;
}

function isAbsent(value) {
    return value === undefined || value === null || value === '';
}

function validateLocalization({
    userId,
    zipCode,
    street,
    neighborhood,
    number,
    city,
    state,
    latitude,
    longitude,
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

    // latitude/longitude são opcionais (cadastro e edição); quando enviadas,
    // precisam ser coordenadas válidas.
    if (!isAbsent(latitude)) {
        const error = parseCoordinate(latitude, 'latitude', -90, 90);
        if (error) return error;
    }

    if (!isAbsent(longitude)) {
        const error = parseCoordinate(longitude, 'longitude', -180, 180);
        if (error) return error;
    }

    return null;
}

async function createLocalization({ userId, zipCode, street, neighborhood, number, city, state, latitude, longitude }, dbConn) {
    const db = dbConn || connect.promise();
    const error = validateLocalization({ userId, zipCode, street, neighborhood, number, city, state, latitude, longitude });
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
        `INSERT INTO localization (id, zip_code, street, neighborhood, number, city, state, latitude, longitude, id_user)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            toBin(id), String(zipCode), street, neighborhood, String(number), city, String(state).toUpperCase(),
            isAbsent(latitude) ? null : Number(latitude),
            isAbsent(longitude) ? null : Number(longitude),
            userIdBin
        ]
    );

    return id;
}

const LOCALIZATION_COLUMNS = {
    zipCode: 'zip_code',
    zip_code: 'zip_code',
    street: 'street',
    neighborhood: 'neighborhood',
    number: 'number',
    city: 'city',
    state: 'state',
    latitude: 'latitude',
    longitude: 'longitude'
};

const SELECT_LOCALIZATION = `
    SELECT BIN_TO_UUID(id) AS id,
           zip_code, street, neighborhood, number, city, state,
           latitude, longitude,
           BIN_TO_UUID(id_user) AS id_user
    FROM localization`;

async function getLocalizationsByUser(userId) {
    const db = connect.promise();
    const userIdBin = Buffer.isBuffer(userId) ? userId : toBin(userId);

    const [rows] = await db.query(
        `${SELECT_LOCALIZATION} WHERE id_user = ?`,
        [userIdBin]
    );

    return rows;
}

async function getLocalizationById(id, userId) {
    const db = connect.promise();
    const userIdBin = Buffer.isBuffer(userId) ? userId : toBin(userId);

    const [rows] = await db.query(
        `${SELECT_LOCALIZATION} WHERE id = ? AND id_user = ?`,
        [toBin(id), userIdBin]
    );

    return rows[0] || null;
}

async function updateLocalization(id, userId, changes) {
    const db = connect.promise();
    const sets = [];
    const params = [];

    for (const [key, value] of Object.entries(changes)) {
        const column = LOCALIZATION_COLUMNS[key];
        if (!column || value === undefined) continue;

        let stored = value;
        if (column === 'state') stored = String(value).toUpperCase();
        else if (column === 'zip_code' || column === 'number') stored = String(value);
        // Ausente (null/'' ) limpa a coordenada, igual ao POST; Number(null)
        // seria 0 e gravaria um ponto no Golfo da Guiné silenciosamente.
        else if (column === 'latitude' || column === 'longitude') stored = isAbsent(value) ? null : Number(value);

        sets.push(`\`${column}\` = ?`);
        params.push(stored);
    }

    if (sets.length === 0) return null;

    params.push(toBin(id), Buffer.isBuffer(userId) ? userId : toBin(userId));

    const [result] = await db.query(
        `UPDATE localization SET ${sets.join(', ')} WHERE id = ? AND id_user = ?`,
        params
    );

    if (result.affectedRows === 0) return null;

    return getLocalizationById(id, userId);
}

async function deleteLocalization(id, userId) {
    // Seleciona escopado antes do DELETE: localização de outro usuário
    // responde como inexistente em vez de vazar existência (ou 409 de FK).
    const existing = await getLocalizationById(id, userId);
    if (!existing) return null;

    const db = connect.promise();

    try {
        await db.query(
            'DELETE FROM localization WHERE id = ? AND id_user = ?',
            [toBin(id), Buffer.isBuffer(userId) ? userId : toBin(userId)]
        );
    } catch (err) {
        // FK fk_product_localization é ON DELETE RESTRICT: anúncio em uso
        // segura a exclusão. Converte o erro cru do MySQL em 409 legível.
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            const conflict = new Error('Não é possível excluir: esta localização está vinculada a um ou mais anúncios.');
            conflict.status = 409;
            throw conflict;
        }
        throw err;
    }

    return true;
}

function round2(value) {
    if (value === null || value === undefined) return null;
    return Math.round(Number(value) * 100) / 100;
}

function exactCoordinate(value) {
    if (value === null || value === undefined) return null;
    return Number(value);
}

/**
 * Localização pública de um anúncio (RN10 / RF14).
 *
 * Sem reserva aceita devolve apenas cidade e bairro, com coordenadas
 * arredondadas para 2 casas (~1 km). Endereço completo e coordenadas exatas
 * só para o dono do anúncio, o dono da localização ou o comprador com
 * shopping `accepted`/`completed` daquele produto.
 *
 * Retorna null quando o produto não existe.
 */
async function getLocationByProduct(productId, viewerId) {
    const db = connect.promise();
    const viewerBin = viewerId && isValid(viewerId) ? toBin(viewerId) : null;

    const [productRows] = await db.query(
        `SELECT BIN_TO_UUID(p.id) AS productId,
                BIN_TO_UUID(p.id_user) AS productOwnerUserId,
                l.zip_code, l.street, l.neighborhood, l.number, l.city, l.state,
                l.latitude, l.longitude,
                BIN_TO_UUID(l.id_user) AS localizationOwnerUserId
         FROM product p
         JOIN localization l ON l.id = p.id_localization
         WHERE p.id = ?`,
        [toBin(productId)]
    );

    if (productRows.length === 0) return null;

    const row = productRows[0];

    let addressFull = false;

    if (viewerBin) {
        addressFull = row.productOwnerUserId === viewerId || row.localizationOwnerUserId === viewerId;

        if (!addressFull) {
            const [acceptedRows] = await db.query(
                `SELECT 1 AS allowed
                 FROM shopping_product sp
                 JOIN shopping s ON s.id = sp.id_shopping
                 WHERE sp.id_product = ?
                   AND s.id_user = ?
                   AND s.status IN ('accepted', 'completed')
                 LIMIT 1`,
                [toBin(productId), viewerBin]
            );

            addressFull = acceptedRows.length > 0;
        }
    }

    const location = {
        productId: row.productId,
        city: row.city,
        neighborhood: row.neighborhood,
        latitude: addressFull ? exactCoordinate(row.latitude) : round2(row.latitude),
        longitude: addressFull ? exactCoordinate(row.longitude) : round2(row.longitude),
        addressFull
    };

    if (!addressFull) return location;

    return {
        ...location,
        street: row.street,
        number: row.number,
        zipCode: row.zip_code,
        state: row.state
    };
}

module.exports = {
    validateLocalization,
    createLocalization,
    getLocalizationsByUser,
    getLocalizationById,
    updateLocalization,
    deleteLocalization,
    getLocationByProduct
};
