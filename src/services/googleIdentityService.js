const { OAuth2Client } = require('google-auth-library');

function failure(status, message) { const error = new Error(message); error.status = status; return error; }

async function verifyGoogleIdentity(idToken) {
    if (typeof idToken !== 'string' || !idToken.trim() || idToken.length > 10000) throw failure(400, 'idToken é obrigatório e deve ser textual.');
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId || !process.env.SECRET) throw failure(503, 'Login Google não configurado.');
    let payload;
    try {
        const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken, audience: clientId });
        payload = ticket.getPayload();
    } catch (error) {
        const unavailable = ['ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET'].includes(error.code) || error.response?.status >= 500;
        throw failure(unavailable ? 503 : 401, unavailable ? 'Google temporariamente indisponível.' : 'Token Google inválido ou expirado.');
    }
    if (!payload || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 || typeof payload.email !== 'string' || payload.email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) throw failure(401, 'Token Google inválido.');
    if (payload.email_verified !== true) throw failure(403, 'E-mail do Google não verificado.');
    return payload;
}

module.exports = { verifyGoogleIdentity };
