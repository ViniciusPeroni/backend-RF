const { isEnabled, isReadAuditEnabled, recordAudit } = require('../services/auditService');
const { isValid } = require('../utils/uuid');

// Operações de escrita são sempre auditadas. Leituras (GET) só entram quando
// `AUDIT_LOG_READS=1|true`, para não inundar a tabela em listagens públicas.
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const API_PREFIX = '/api/reaproveitafranca';
const MAX_DESCRIPTION = 255;
const MAX_USER_AGENT = 255;
const MAX_IP = 45;

function shouldAudit(req) {
    if (WRITE_METHODS.has(req.method)) return true;

    return req.method === 'GET' && isReadAuditEnabled();
}

function pathWithoutQuery(req) {
    return (req.originalUrl || req.url || '').split('?')[0];
}

function tableFor(req) {
    let path = pathWithoutQuery(req);

    if (path.startsWith(API_PREFIX)) {
        path = path.slice(API_PREFIX.length);
    }

    const segment = path.split('/').filter(Boolean)[0] || 'unknown';

    return segment.slice(0, 20);
}

function operationFor(req) {
    const path = pathWithoutQuery(req).toLowerCase();

    if (path.includes('/login')) return 'login';
    if (path.includes('/webhook') || path.includes('/callback')) return 'callback';

    switch (req.method) {
        case 'GET':
            return 'read';
        case 'POST':
            return 'create';
        case 'PUT':
        case 'PATCH':
            return 'update';
        case 'DELETE':
            return 'delete';
        default:
            return 'other';
    }
}

// Procura um UUID em params, body ou resposta para preencher `reference_id`.
// Nunca lê o corpo bruto da requisição, apenas campos já parseados.
function findUuid(value, depth = 0) {
    if (value === null || value === undefined || depth > 3) return null;

    if (typeof value === 'string') {
        return isValid(value) ? value : null;
    }

    if (Array.isArray(value)) {
        for (const item of value.slice(0, 3)) {
            const found = findUuid(item, depth + 1);
            if (found) return found;
        }
        return null;
    }

    if (typeof value !== 'object') return null;

    if (isValid(value.id)) return value.id;
    if (typeof value.reference_id === 'string' && isValid(value.reference_id)) {
        return value.reference_id;
    }

    // Limita a varredura para não percorrer buffers/fotos ou corpos grandes.
    const entries = Object.entries(value).slice(0, 40);

    for (const [key, item] of entries) {
        if (key === 'photo' || key === 'data' || key === 'password') continue;

        const found = findUuid(item, depth + 1);
        if (found) return found;
    }

    return null;
}

function referenceIdFor(req, res) {
    for (const param of Object.values(req.params || {})) {
        if (isValid(param)) return param;
    }

    const body = req.body && typeof req.body === 'object' ? req.body : null;

    if (body) {
        if (typeof body.reference_id === 'string' && isValid(body.reference_id)) {
            return body.reference_id;
        }
        if (isValid(body.id)) return body.id;
    }

    return findUuid(res.locals.auditResponseBody);
}

function clientIp(req) {
    const ip = typeof req.ip === 'string' ? req.ip : '';
    const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

    return normalized.slice(0, MAX_IP) || null;
}

function userAgent(req) {
    const header = req.headers && req.headers['user-agent'];

    if (typeof header !== 'string' || !header) return null;

    return header.slice(0, MAX_USER_AGENT);
}

function describe(req, res) {
    return `${req.method} ${pathWithoutQuery(req)} -> ${res.statusCode}`.slice(0, MAX_DESCRIPTION);
}

function auditLog(req, res, next) {
    if (!shouldAudit(req) || !isEnabled()) {
        return next();
    }

    // Guarda o corpo JSON apenas em memória para extrair um ID de referência.
    // O conteúdo não é persistido nem registrado.
    const originalJson = res.json.bind(res);

    res.json = (body) => {
        res.locals.auditResponseBody = body;
        return originalJson(body);
    };

    res.on('finish', () => {
        recordAudit({
            reference_id: referenceIdFor(req, res),
            id_user: isValid(req.userId) ? req.userId : null,
            status: res.statusCode < 400 ? 'sucesso' : 'falha',
            operation: operationFor(req),
            table: tableFor(req),
            description: describe(req, res),
            ip: clientIp(req),
            user_agent: userAgent(req)
        });
    });

    return next();
}

module.exports = auditLog;
module.exports.operationFor = operationFor;
module.exports.tableFor = tableFor;
module.exports.referenceIdFor = referenceIdFor;
module.exports.isEnabled = isEnabled;
module.exports.shouldAudit = shouldAudit;
