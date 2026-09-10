const { validateLocalization: validateLocalizationBody } = require('../services/localizationService');

function validateLocalization(req, res, next) {
    const error = validateLocalizationBody(req.body);
    if (error) return res.status(400).json({ error });
    next();
}

module.exports = validateLocalization;
