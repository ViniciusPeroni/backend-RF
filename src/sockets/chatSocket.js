const uuid = require('../utils/uuid');
const messageService = require('../services/messageService');
const conversationService = require('../services/conversationService');
const notificationService = require('../services/notificationService');
const { recordAudit, isReadAuditEnabled } = require('../services/auditService');
const { extractToken, getDecodedToken, getUserIdFromToken, userRoom } = require('./notificationSocket');

// Auditoria de Socket.IO não passa pelo middleware HTTP; registra o evento
// sem bloquear a resposta e sem persistir conteúdo de mensagem.
function auditSocket(socket, userId, data) {
    const handshake = socket.handshake || {};

    return recordAudit({
        id_user: userId || socket.userId,
        ip: handshake.address,
        user_agent: handshake.headers && handshake.headers['user-agent'],
        ...data
    });
}

function chatSocket(io) {

    io.on("connection", (socket) => {

        if (!socket.userId) {
            const decoded = getDecodedToken(extractToken(socket));
            if (decoded) {
                socket.userId = decoded.id;
                socket.userName = decoded.name;
            }
        }

        console.log(`Socket conectado: ${socket.id}`);

        socket.on("join_conversation", async (conversationId, callback) => {
            const respond = typeof callback === "function" ? callback : () => { };

            try {
                const userId = socket.userId || getUserIdFromToken(extractToken(socket));

                if (!userId) {
                    return respond({ error: "Autenticação necessária para entrar na conversa." });
                }

                if (!conversationId || !uuid.isValid(String(conversationId))) {
                    return respond({ error: "conversationId inválido." });
                }

                const belongs = await conversationService.userBelongsToConversation(String(conversationId), userId);
                if (!belongs) {
                    return respond({ error: "Você não participa desta conversa." });
                }

                socket.join(String(conversationId));

                console.log(
                    `Socket ${socket.id} entrou na conversa ${conversationId}`
                );

                return respond({ message: "Entrou na conversa com sucesso.", conversationId: String(conversationId) });
            } catch (error) {
                console.error("Erro em join_conversation:", error);
                if (error.status) {
                    return respond({ error: error.message });
                }
                return respond({ error: "Erro ao entrar na conversa." });
            }
        });

        socket.on("get_or_create_conversation", async (payload, callback) => {
            const respond = typeof callback === "function" ? callback : () => { };

            try {
                const userId = socket.userId || getUserIdFromToken(extractToken(socket));

                if (!userId) {
                    return respond({ error: "Autenticação necessária." });
                }

                const { otherUserId } = payload || {};

                if (!otherUserId || !uuid.isValid(otherUserId)) {
                    return respond({ error: "otherUserId inválido." });
                }

                if (String(userId).toLowerCase() === String(otherUserId).toLowerCase()) {
                    return respond({ error: "Não é possível criar uma conversa consigo mesmo." });
                }

                const result = await conversationService.getOrCreateConversation(userId, otherUserId);

                auditSocket(socket, userId, {
                    status: 'sucesso',
                    operation: result.created ? 'create' : 'other',
                    table: 'conversation',
                    reference_id: result.conversationId,
                    description: `socket get_or_create_conversation -> ${result.created ? 'criada' : 'existente'}`
                });

                return respond(result);
            } catch (error) {
                console.error("Erro em get_or_create_conversation:", error);

                auditSocket(socket, socket.userId, {
                    status: 'falha',
                    operation: 'create',
                    table: 'conversation',
                    description: 'socket get_or_create_conversation -> erro'
                });

                if (error.status) {
                    return respond({ error: error.message });
                }
                return respond({ error: "Erro ao obter/criar conversa." });
            }
        });

        socket.on("load_conversations", async (payload, callback) => {
            const respond = typeof callback === "function" ? callback : () => { };

            try {
                const userId = socket.userId || getUserIdFromToken(extractToken(socket));

                if (!userId) {
                    return respond({ error: "Autenticação necessária." });
                }

                const conversations = await conversationService.listConversationsForUser(userId);

                if (isReadAuditEnabled()) {
                    auditSocket(socket, userId, {
                        status: 'sucesso',
                        operation: 'read',
                        table: 'conversation',
                        description: 'socket load_conversations'
                    });
                }

                return respond({ conversations });
            } catch (error) {
                console.error("Erro em load_conversations:", error);
                if (error.status) {
                    return respond({ error: error.message });
                }
                return respond({ error: "Erro ao listar conversas." });
            }
        });

        socket.on("load_messages", async (payload, callback) => {
            const respond = typeof callback === "function" ? callback : () => { };

            try {
                const userId = socket.userId || getUserIdFromToken(extractToken(socket));

                if (!userId) {
                    return respond({ error: "Autenticação necessária." });
                }

                const { conversationId, limit, before } = payload || {};

                if (!conversationId || !uuid.isValid(String(conversationId))) {
                    return respond({ error: "conversationId inválido." });
                }

                const messages = await messageService.listMessages({
                    conversationId: String(conversationId),
                    userId,
                    limit,
                    before
                });

                if (isReadAuditEnabled()) {
                    auditSocket(socket, userId, {
                        status: 'sucesso',
                        operation: 'read',
                        table: 'message',
                        reference_id: String(conversationId),
                        description: 'socket load_messages'
                    });
                }

                return respond({ messages });
            } catch (error) {
                console.error("Erro em load_messages:", error);
                if (error.status) {
                    return respond({ error: error.message });
                }
                return respond({ error: "Erro ao carregar mensagens." });
            }
        });

        socket.on("mark_read", async (payload, callback) => {
            const respond = typeof callback === "function" ? callback : () => { };

            try {
                const userId = socket.userId || getUserIdFromToken(extractToken(socket));

                if (!userId) {
                    return respond({ error: "Autenticação necessária." });
                }

                const { conversationId, upToMessageId } = payload || {};

                if (!conversationId || !uuid.isValid(String(conversationId))) {
                    return respond({ error: "conversationId inválido." });
                }

                if (upToMessageId && !uuid.isValid(upToMessageId)) {
                    return respond({ error: "upToMessageId inválido." });
                }

                const result = await messageService.markConversationAsRead({
                    conversationId: String(conversationId),
                    userId,
                    upToMessageId
                });

                auditSocket(socket, userId, {
                    status: 'sucesso',
                    operation: 'update',
                    table: 'message',
                    reference_id: String(conversationId),
                    description: 'socket mark_read'
                });

                return respond(result);
            } catch (error) {
                console.error("Erro em mark_read:", error);

                auditSocket(socket, socket.userId, {
                    status: 'falha',
                    operation: 'update',
                    table: 'message',
                    description: 'socket mark_read -> erro'
                });

                if (error.status) {
                    return respond({ error: error.message });
                }
                return respond({ error: "Erro ao marcar conversa como lida." });
            }
        });

        socket.on("send_message", async (payload, callback) => {

            const respond = typeof callback === "function" ? callback : () => { };

            try {
                const userId = socket.userId || getUserIdFromToken(extractToken(socket));

                if (!userId) {
                    return respond({ error: "Autenticação necessária para enviar mensagem." });
                }

                const { conversationId, type = "texto", content, id_answer } = payload || {};

                if (!conversationId || !uuid.isValid(conversationId)) {
                    return respond({ error: "conversationId inválido." });
                }

                if (!messageService.MESSAGE_TYPES.includes(type)) {
                    return respond({
                        error: `type inválido. Valores permitidos: ${messageService.MESSAGE_TYPES.join(', ')}.`
                    });
                }

                if (type === "texto" && (!content || !String(content).trim())) {
                    return respond({ error: "content é obrigatório para mensagens de texto." });
                }

                if (id_answer && !uuid.isValid(id_answer)) {
                    return respond({ error: "id_answer inválido." });
                }

                const { id, recipients } = await messageService.createMessage({
                    conversationId,
                    id_user: userId,
                    type,
                    content,
                    id_answer
                });

                auditSocket(socket, userId, {
                    status: 'sucesso',
                    operation: 'create',
                    table: 'message',
                    reference_id: id,
                    description: `socket send_message -> tipo ${type}`
                });

                const message = {
                    id,
                    type,
                    content: content ?? null,
                    created_in: new Date().toISOString(),
                    edited_in: null,
                    deleted_in: null,
                    id_user: userId,
                    id_conversation: conversationId,
                    id_answer: id_answer || null
                };

                const messageEmitter = recipients.reduce(
                    (emitter, recipient) => emitter.to(userRoom(recipient)),
                    io.to(String(conversationId))
                );

                messageEmitter.emit("new_message", message);

                const senderName = socket.userName || "Usuário";
                const preview = type === "texto"
                    ? String(content).trim().slice(0, 120)
                    : `Enviou uma mensagem do tipo ${type}.`;

                for (const recipient of recipients) {
                    try {
                        await notificationService.notifyUser({
                            id_user: recipient,
                            type: "nova_mensagem",
                            title: `Nova mensagem de ${senderName}`.slice(0, 100),
                            content: preview,
                            reference_table: "conversation",
                            reference_id: conversationId
                        });
                    } catch (notifyError) {
                        console.error("Erro ao notificar nova mensagem:", notifyError);
                    }
                }

                return respond({ message: "Mensagem enviada com sucesso.", id });

            } catch (error) {
                console.error("Erro em send_message:", error);

                auditSocket(socket, socket.userId, {
                    status: 'falha',
                    operation: 'create',
                    table: 'message',
                    description: 'socket send_message -> erro'
                });

                if (error.status) {
                    return respond({ error: error.message });
                }

                return respond({ error: "Erro ao enviar mensagem." });
            }
        });

        socket.on("edit_message", async (payload, callback) => {
            const respond = typeof callback === "function" ? callback : () => { };

            try {
                const userId = socket.userId || getUserIdFromToken(extractToken(socket));

                if (!userId) {
                    return respond({ error: "Autenticação necessária." });
                }

                const { messageId, content } = payload || {};

                if (!messageId || !uuid.isValid(messageId)) {
                    return respond({ error: "messageId inválido." });
                }

                if (typeof content !== 'string' || !content.trim()) {
                    return respond({ error: "content é obrigatório." });
                }

                const result = await messageService.editMessage({
                    messageId,
                    userId,
                    content
                });

                auditSocket(socket, userId, {
                    status: 'sucesso',
                    operation: 'update',
                    table: 'message',
                    reference_id: messageId,
                    description: 'socket edit_message'
                });

                io.to(String(result.id_conversation)).emit("message_edited", {
                    id: result.id,
                    id_conversation: result.id_conversation,
                    content: result.content,
                    edited_in: result.edited_in
                });

                return respond({ message: "Mensagem editada com sucesso.", ...result });
            } catch (error) {
                console.error("Erro em edit_message:", error);

                auditSocket(socket, socket.userId, {
                    status: 'falha',
                    operation: 'update',
                    table: 'message',
                    description: 'socket edit_message -> erro'
                });

                if (error.status) {
                    return respond({ error: error.message });
                }
                return respond({ error: "Erro ao editar mensagem." });
            }
        });

        socket.on("delete_message", async (payload, callback) => {
            const respond = typeof callback === "function" ? callback : () => { };

            try {
                const userId = socket.userId || getUserIdFromToken(extractToken(socket));

                if (!userId) {
                    return respond({ error: "Autenticação necessária." });
                }

                const { messageId } = payload || {};

                if (!messageId || !uuid.isValid(messageId)) {
                    return respond({ error: "messageId inválido." });
                }

                const result = await messageService.deleteMessage({
                    messageId,
                    userId
                });

                auditSocket(socket, userId, {
                    status: 'sucesso',
                    operation: 'delete',
                    table: 'message',
                    reference_id: messageId,
                    description: 'socket delete_message'
                });

                io.to(String(result.id_conversation)).emit("message_deleted", {
                    id: result.id,
                    id_conversation: result.id_conversation,
                    deleted_in: result.deleted_in || new Date().toISOString()
                });

                return respond({ message: "Mensagem excluída com sucesso.", ...result });
            } catch (error) {
                console.error("Erro em delete_message:", error);

                auditSocket(socket, socket.userId, {
                    status: 'falha',
                    operation: 'delete',
                    table: 'message',
                    description: 'socket delete_message -> erro'
                });

                if (error.status) {
                    return respond({ error: error.message });
                }
                return respond({ error: "Erro ao excluir mensagem." });
            }
        });

        socket.on("leave_conversation", async (payload, callback) => {
            const respond = typeof callback === "function" ? callback : () => { };

            try {
                const userId = socket.userId || getUserIdFromToken(extractToken(socket));

                if (!userId) {
                    return respond({ error: "Autenticação necessária." });
                }

                const { conversationId } = payload || {};

                if (!conversationId || !uuid.isValid(String(conversationId))) {
                    return respond({ error: "conversationId inválido." });
                }

                const result = await conversationService.leaveConversation(String(conversationId), userId);
                socket.leave(String(conversationId));

                auditSocket(socket, userId, {
                    status: 'sucesso',
                    operation: 'delete',
                    table: 'conversation',
                    reference_id: String(conversationId),
                    description: 'socket leave_conversation'
                });

                return respond({ message: "Você saiu da conversa.", ...result });
            } catch (error) {
                console.error("Erro em leave_conversation:", error);

                auditSocket(socket, socket.userId, {
                    status: 'falha',
                    operation: 'delete',
                    table: 'conversation',
                    description: 'socket leave_conversation -> erro'
                });

                if (error.status) {
                    return respond({ error: error.message });
                }
                return respond({ error: "Erro ao sair da conversa." });
            }
        });

        socket.on("disconnect", () => {

            console.log(
                `Socket desconectado: ${socket.id}`
            );
        });

    });

}

module.exports = chatSocket;
