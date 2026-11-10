const logService = require('./logService');
const { isValid } = require('../utils/uuid');

const MAX_DESCRIPTION = 255;
const MAX_USER_AGENT = 255;
const MAX_IP = 45;

// A auditoria fica desativada quando o ambiente de banco não está configurado
// (útil em testes de rota que não usam MySQL).
function isEnabled() {
    return Boolean(process.env.DB_HOST && process.env.DB_NAME);
}

function isReadAuditEnabled() {
    const value = String(process.env.AUDIT_LOG_READS || '').trim().toLowerCase();

    return value === '1' || value === 'true';
}

function truncate(value, max) {
    if (typeof value !== 'string' || !value) return null;

    return value.slice(0, max);
}

// Registra uma entrada de auditoria sem interromper o fluxo chamador.
// Usado pelo middleware HTTP e pelos eventos de Socket.IO.
function recordAudit(entry = {}) {
    if (!isEnabled()) return Promise.resolve(null);

    const payload = {
        reference_id: isValid(entry.reference_id) ? entry.reference_id : null,
        id_user: isValid(entry.id_user) ? entry.id_user : null,
        status: truncate(entry.status, 50) || 'sucesso',
        operation: truncate(entry.operation, 20) || 'other',
        table: truncate(entry.table, 20) || 'unknown',
        description: truncate(entry.description, MAX_DESCRIPTION),
        ip: truncate(entry.ip, MAX_IP),
        user_agent: truncate(entry.user_agent, MAX_USER_AGENT)
    };

    return Promise.resolve()
        .then(() => logService.createLog(payload))
        .catch((err) => {
            console.error('Falha ao registrar log de auditoria:', err && (err.code || err.message));
            return null;
        });
}

module.exports = {
    isEnabled,
    isReadAuditEnabled,
    recordAudit
};
