const { verifyGoogleIdentity } = require('../services/googleIdentityService');

module.exports = async (req, res, next) => {
    try {
        req.googleIdentity = await verifyGoogleIdentity(req.body?.idToken);
        req.body.email = req.googleIdentity.email.trim().toLowerCase();
        delete req.body.password;
        delete req.body.role;
        next();
    } catch (error) {
        res.status([400, 401, 403, 503].includes(error.status) ? error.status : 500).json({ error: error.status ? error.message : 'Não foi possível validar o Google.' });
    }
};
