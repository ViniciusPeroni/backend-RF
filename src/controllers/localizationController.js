const loc = require('../services/localizationService');
const { isValid } = require('../utils/uuid');

// Somente campos editáveis da tabela `localization`. `userId`/`id_user` nunca
// vêm do corpo: o dono é sempre o usuário autenticado (contrato do POST,
// que aceita userId, fica como está — ver rotas).
function trimText(value) {
    return typeof value === 'string' ? value.trim() : value;
}

// Aceita número ou string numérica ("-21.12"); qualquer outra coisa segue
// para a validação, que rejeita com mensagem clara.
function parseCoordinateInput(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value.trim()))) {
        return Number(value.trim());
    }
    return value;
}

function normalizeLocalizationInput(body = {}) {
    const input = {};

    if (body.zipCode !== undefined) input.zipCode = trimText(body.zipCode);
    else if (body.zip_code !== undefined) input.zipCode = trimText(body.zip_code);

    if (body.street !== undefined) input.street = trimText(body.street);
    if (body.neighborhood !== undefined) input.neighborhood = trimText(body.neighborhood);
    // null precisa chegar cru na validação (viraria a string "null" via
    // String()) e ser rejeitado como campo obrigatório não preenchido.
    if (body.number !== undefined) input.number = body.number === null ? null : trimText(String(body.number));
    if (body.city !== undefined) input.city = trimText(body.city);
    if (body.state !== undefined) input.state = trimText(body.state);
    if (body.latitude !== undefined) input.latitude = parseCoordinateInput(body.latitude);
    if (body.longitude !== undefined) input.longitude = parseCoordinateInput(body.longitude);

    return input;
}

const createLocalization = async (req, res) => {
    // Rota autenticada: a localização criada é sempre do próprio usuário.
    // userId divergente do token (inclusive de outro usuário) é recusado.
    if (req.body.userId !== req.userId) {
        return res.status(403).json({
            error: 'Você só pode criar localizações para o próprio usuário.'
        });
    }

    try {
        const id = await loc.createLocalization(req.body);

        return res.status(201).json({
            message: 'Localização criada com sucesso.',
            id
        });
    } catch (err) {
        console.error('Erro em createLocalization:', err);
        if (err.status) return res.status(err.status).json({ error: err.message });
        return res.status(500).json({ error: 'Erro interno ao criar localização.' });
    }
};


const getLocalizations = async (req, res) => {
    try {
        const localizations = await loc.getLocalizationsByUser(req.userId);

        return res.status(200).json(localizations);

    } catch (err) {
        console.error('Erro em getLocalizations:', err);

        return res.status(500).json({
            error: 'Erro ao buscar localizações.'
        });
    }
};


const getLocalization = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({
            error: 'ID da localização inválido.'
        });
    }

    try {
        // Localização de outro usuário responde como inexistente para não
        // revelar a existência do registro.
        const localization = await loc.getLocalizationById(id, req.userId);

        if (!localization) {
            return res.status(404).json({
                error: 'Localização não encontrada.'
            });
        }

        return res.status(200).json(localization);

    } catch (err) {
        console.error('Erro em getLocalization:', err);

        return res.status(500).json({
            error: 'Erro ao buscar localização.'
        });
    }
};


const updateLocalization = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({
            error: 'ID da localização inválido.'
        });
    }

    const changes = normalizeLocalizationInput(req.body);

    if (Object.keys(changes).length === 0) {
        return res.status(400).json({
            error: 'Nenhum campo válido para atualizar. Campos aceitos: zipCode, street, neighborhood, number, city, state, latitude, longitude.'
        });
    }

    try {
        const existing = await loc.getLocalizationById(id, req.userId);

        if (!existing) {
            return res.status(404).json({
                error: 'Localização não encontrada.'
            });
        }

        // A validação usa o estado final da localização: atualizar apenas um
        // campo continua sendo checado contra o registro completo.
        const validationError = loc.validateLocalization({
            userId: req.userId,
            zipCode: existing.zip_code,
            street: existing.street,
            neighborhood: existing.neighborhood,
            number: existing.number,
            city: existing.city,
            state: existing.state,
            latitude: existing.latitude,
            longitude: existing.longitude,
            ...changes
        });

        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        const localization = await loc.updateLocalization(id, req.userId, changes);

        if (!localization) {
            return res.status(404).json({
                error: 'Localização não encontrada.'
            });
        }

        return res.status(200).json({
            message: 'Localização atualizada com sucesso.',
            localization
        });

    } catch (err) {
        console.error('Erro em updateLocalization:', err);
        if (err.status) return res.status(err.status).json({ error: err.message });

        return res.status(500).json({
            error: 'Erro ao atualizar localização.'
        });
    }
};


const deleteLocalization = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({
            error: 'ID da localização inválido.'
        });
    }

    try {
        const deleted = await loc.deleteLocalization(id, req.userId);

        if (!deleted) {
            return res.status(404).json({
                error: 'Localização não encontrada.'
            });
        }

        return res.status(200).json({
            message: 'Localização excluída com sucesso.'
        });

    } catch (err) {
        // 409 (FK com anúncio vinculado) chega com status/message prontos.
        if (err.status) return res.status(err.status).json({ error: err.message });

        console.error('Erro em deleteLocalization:', err);

        return res.status(500).json({
            error: 'Erro ao excluir localização.'
        });
    }
};


// Visão pública do anúncio (RN10/RF14): rota com token opcional — o service
// decide o que liberar conforme quem pergunta (dono, comprador aceito, anônimo).
const getProductLocation = async (req, res) => {
    const { productId } = req.params;

    if (!isValid(productId)) {
        return res.status(400).json({
            error: 'ID do anúncio inválido.'
        });
    }

    try {
        const location = await loc.getLocationByProduct(productId, req.userId);

        if (!location) {
            return res.status(404).json({
                error: 'Localização do anúncio não encontrada.'
            });
        }

        return res.status(200).json(location);

    } catch (err) {
        console.error('Erro em getProductLocation:', err);

        return res.status(500).json({
            error: 'Erro ao buscar localização do anúncio.'
        });
    }
};


module.exports = {
    createLocalization,
    getLocalizations,
    getLocalization,
    updateLocalization,
    deleteLocalization,
    getProductLocation
};
