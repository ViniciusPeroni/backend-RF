const service = require('../services/notificationPreferencesService');

function handle(callback) {
    return async (req, res) => {
        try { await callback(req, res); }
        catch (error) {
            const known = [400, 403, 404, 409, 503].includes(error.status);
            res.status(known ? error.status : 500).json({ error: known ? error.code : 'NOTIFICATION_SETTINGS_ERROR' });
        }
    };
}

module.exports = {
    getPreferences: handle(async (req, res) => res.json(await service.getPreferences(req.userId))),
    putPreferences: handle(async (req, res) => res.json(await service.updatePreferences(req.userId, req.body))),
    putDevice: handle(async (req, res) => res.json(await service.putDevice(req.userId, req.params.id, req.body))),
    deleteDevice: handle(async (req, res) => {
        if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
            return res.status(400).json({ error: 'INVALID_NOTIFICATION_INPUT' });
        }
        await service.deleteDevice(req.userId, req.params.id);
        return res.status(204).end();
    })
};
