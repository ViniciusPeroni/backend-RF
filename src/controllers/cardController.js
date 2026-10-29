const cardService = require('../services/cardService');
const { generateId, isValid } = require('../utils/uuid');

const CARD_TYPES = ['credit', 'debit'];

const MAX_HOLDER_NAME = 100;
const MAX_BRAND = 50;
const MAX_PAYMENT_TOKEN = 255;
const MIN_EXPIRATION_YEAR = 1;
const MAX_EXPIRATION_YEAR = 9999;

function trimText(value) {
    return typeof value === 'string' ? value.trim() : value;
}

// Aceita número ou string numérica ("5"/"05"); qualquer outra coisa segue
// para a validação, que rejeita com mensagem clara.
function parseIntegerField(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
    return value;
}

// Somente os campos da tabela `card` são aceitos. `id` e `id_user` nunca vêm
// do corpo: o dono é sempre o usuário autenticado.
function normalizeCardInput(body = {}) {
    const input = {};

    if (body.holder_name !== undefined) input.holder_name = trimText(body.holder_name);
    if (body.brand !== undefined) input.brand = trimText(body.brand);
    if (body.last_digits !== undefined) input.last_digits = trimText(String(body.last_digits));
    if (body.type !== undefined) {
        input.type = typeof body.type === 'string' ? body.type.trim().toLowerCase() : body.type;
    }
    if (body.expiration_month !== undefined) input.expiration_month = parseIntegerField(body.expiration_month);
    if (body.expiration_year !== undefined) input.expiration_year = parseIntegerField(body.expiration_year);
    if (body.payment_token !== undefined) input.payment_token = trimText(body.payment_token);

    return input;
}

function validateCard(card, { requirePaymentToken = true } = {}) {
    if (typeof card.holder_name !== 'string' || card.holder_name.length === 0) {
        return 'holder_name é obrigatório.';
    }

    if (card.holder_name.length > MAX_HOLDER_NAME) {
        return `holder_name deve ter no máximo ${MAX_HOLDER_NAME} caracteres.`;
    }

    if (typeof card.brand !== 'string' || card.brand.length === 0) {
        return 'brand é obrigatório.';
    }

    if (card.brand.length > MAX_BRAND) {
        return `brand deve ter no máximo ${MAX_BRAND} caracteres.`;
    }

    if (typeof card.last_digits !== 'string' || !/^\d{4}$/.test(card.last_digits)) {
        return 'last_digits deve conter exatamente 4 dígitos.';
    }

    if (!CARD_TYPES.includes(card.type)) {
        return `type inválido. Valores permitidos: ${CARD_TYPES.join(', ')}.`;
    }

    if (!Number.isInteger(card.expiration_month) || card.expiration_month < 1 || card.expiration_month > 12) {
        return 'expiration_month deve ser um número inteiro entre 1 e 12.';
    }

    if (!Number.isInteger(card.expiration_year)) {
        return 'expiration_year deve ser um número inteiro.';
    }

    if (card.expiration_year < MIN_EXPIRATION_YEAR || card.expiration_year > MAX_EXPIRATION_YEAR) {
        return `expiration_year deve estar entre ${MIN_EXPIRATION_YEAR} e ${MAX_EXPIRATION_YEAR}.`;
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (
        card.expiration_year < currentYear ||
        (card.expiration_year === currentYear && card.expiration_month < currentMonth)
    ) {
        return 'O cartão está vencido.';
    }

    // O token só existe no cadastro; nas atualizações ele é opcional e, quando
    // enviado, substitui o token anterior. Como ele nunca é lido do banco,
    // não há como validá-lo em uma edição sem que o cliente o envie de novo.
    if (requirePaymentToken || card.payment_token !== undefined) {
        if (typeof card.payment_token !== 'string' || card.payment_token.length === 0) {
            return 'payment_token é obrigatório.';
        }

        if (card.payment_token.length > MAX_PAYMENT_TOKEN) {
            return `payment_token deve ter no máximo ${MAX_PAYMENT_TOKEN} caracteres.`;
        }
    }

    return null;
}

const createCard = async (req, res) => {
    const input = normalizeCardInput(req.body);

    const validationError = validateCard(input);

    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    try {
        const id = generateId();

        const card = await cardService.createCard({
            id,
            ...input,
            id_user: req.userId
        });

        return res.status(201).json({
            message: 'Cartão cadastrado com sucesso.',
            card
        });

    } catch (err) {
        // JWT válido de um usuário que já foi excluído: a FK de id_user barra o
        // INSERT. A sessão deixou de valer, então responde como autenticação.
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(401).json({
                auth: false,
                message: 'Usuário não encontrado. Faça login novamente.'
            });
        }

        console.error('Erro em createCard:', err);

        return res.status(500).json({
            error: 'Erro ao cadastrar cartão.'
        });
    }
};


const getCards = async (req, res) => {
    try {
        const cards = await cardService.getCardsByUser(req.userId);

        return res.status(200).json(cards);

    } catch (err) {
        console.error('Erro em getCards:', err);

        return res.status(500).json({
            error: 'Erro ao buscar cartões.'
        });
    }
};


const getCardById = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({
            error: 'ID do cartão inválido.'
        });
    }

    try {
        const card = await cardService.getCardById(id, req.userId);

        // Cartão de outro usuário responde como inexistente para não revelar
        // a existência do registro.
        if (!card) {
            return res.status(404).json({
                error: 'Cartão não encontrado.'
            });
        }

        return res.status(200).json(card);

    } catch (err) {
        console.error('Erro em getCardById:', err);

        return res.status(500).json({
            error: 'Erro ao buscar cartão.'
        });
    }
};


const updateCard = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({
            error: 'ID do cartão inválido.'
        });
    }

    const changes = normalizeCardInput(req.body);

    if (Object.keys(changes).length === 0) {
        return res.status(400).json({
            error: 'Nenhum campo válido para atualizar. Campos aceitos: holder_name, brand, last_digits, type, expiration_month, expiration_year, payment_token.'
        });
    }

    try {
        const existing = await cardService.getCardById(id, req.userId);

        if (!existing) {
            return res.status(404).json({
                error: 'Cartão não encontrado.'
            });
        }

        // A validação usa o estado final do cartão: enviar apenas o mês ou
        // apenas o ano continua sendo checado contra a validade atual.
        const validationError = validateCard({ ...existing, ...changes }, { requirePaymentToken: false });

        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        const card = await cardService.updateCard(id, req.userId, changes);

        if (!card) {
            return res.status(404).json({
                error: 'Cartão não encontrado.'
            });
        }

        return res.status(200).json({
            message: 'Cartão atualizado com sucesso.',
            card
        });

    } catch (err) {
        console.error('Erro em updateCard:', err);

        return res.status(500).json({
            error: 'Erro ao atualizar cartão.'
        });
    }
};


const deleteCard = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({
            error: 'ID do cartão inválido.'
        });
    }

    try {
        const deleted = await cardService.deleteCard(id, req.userId);

        if (!deleted) {
            return res.status(404).json({
                error: 'Cartão não encontrado.'
            });
        }

        return res.status(200).json({
            message: 'Cartão excluído com sucesso.'
        });

    } catch (err) {
        console.error('Erro em deleteCard:', err);

        return res.status(500).json({
            error: 'Erro ao excluir cartão.'
        });
    }
};


module.exports = {
    createCard,
    getCards,
    getCardById,
    updateCard,
    deleteCard
};
