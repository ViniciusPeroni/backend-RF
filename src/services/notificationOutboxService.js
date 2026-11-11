const { generateId, toBin } = require('../utils/uuid');

// A conexão deve ser a mesma transação que confirma a operação de domínio.
// Não capturar este erro: sem evento durável a operação não pode confirmar.
async function enqueue(conn, data) {
    const entry = { ...data, id: generateId() };
    await conn.query(
        `INSERT INTO notification_retry
            (id, id_user, type, title, content, reference_table, reference_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [toBin(entry.id), toBin(entry.id_user), entry.type, entry.title,
            entry.content || null, entry.reference_table || null,
            entry.reference_id ? toBin(entry.reference_id) : null]
    );
    return entry;
}

// Só chamar depois do commit e de liberar a conexão. O worker recupera falhas.
async function flush(entries) {
    const notifications = require('./notificationService');
    for (const entry of entries) {
        try {
            await notifications.notifyUser(entry);
        } catch (error) {
            console.error('Aviso pendente na outbox:', error.code || error.name);
        }
    }
}

module.exports = { enqueue, flush };
