const loc = require('../services/localizationService');

const createLocalization = async (req, res) => {
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

module.exports = { createLocalization };
