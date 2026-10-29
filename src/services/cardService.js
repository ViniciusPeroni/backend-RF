const connect = require('../db/connect');
const { toBin } = require('../utils/uuid');

// payment_token nunca é selecionado: o token do gateway é gravado, mas não
// deve ser exposto pela API (RNF06).
const CARD_FIELDS = `
    BIN_TO_UUID(id) AS id,
    holder_name,
    brand,
    last_digits,
    type,
    expiration_month,
    expiration_year,
    BIN_TO_UUID(id_user) AS id_user
`;

const UPDATABLE_FIELDS = [
    'holder_name',
    'brand',
    'last_digits',
    'type',
    'expiration_month',
    'expiration_year',
    'payment_token'
];

const cardService = {

    async createCard(card) {
        await connect.promise().query(
            `INSERT INTO card (
                id,
                holder_name,
                brand,
                last_digits,
                type,
                expiration_month,
                expiration_year,
                payment_token,
                id_user
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                toBin(card.id),
                card.holder_name,
                card.brand,
                card.last_digits,
                card.type,
                card.expiration_month,
                card.expiration_year,
                card.payment_token,
                toBin(card.id_user)
            ]
        );

        return cardService.getCardById(card.id, card.id_user);
    },


    async getCardsByUser(id_user) {
        const [rows] = await connect.promise().query(
            `SELECT ${CARD_FIELDS}
             FROM card
             WHERE id_user = ?
             ORDER BY holder_name ASC, last_digits ASC`,
            [toBin(id_user)]
        );

        return rows;
    },


    // A consulta é sempre limitada ao dono: um cartão de outro usuário se
    // comporta como inexistente.
    async getCardById(id, id_user) {
        const [rows] = await connect.promise().query(
            `SELECT ${CARD_FIELDS}
             FROM card
             WHERE id = ? AND id_user = ?`,
            [toBin(id), toBin(id_user)]
        );

        return rows.length === 0 ? null : rows[0];
    },


    async updateCard(id, id_user, changes) {
        const columns = UPDATABLE_FIELDS.filter((field) => changes[field] !== undefined);

        if (columns.length === 0) {
            return cardService.getCardById(id, id_user);
        }

        const assignments = columns.map((field) => `${field} = ?`).join(', ');
        const params = columns.map((field) => changes[field]);

        await connect.promise().query(
            `UPDATE card
             SET ${assignments}
             WHERE id = ? AND id_user = ?`,
            [...params, toBin(id), toBin(id_user)]
        );

        return cardService.getCardById(id, id_user);
    },


    async deleteCard(id, id_user) {
        const [result] = await connect.promise().query(
            'DELETE FROM card WHERE id = ? AND id_user = ?',
            [toBin(id), toBin(id_user)]
        );

        return result.affectedRows > 0;
    }

};

module.exports = cardService;
