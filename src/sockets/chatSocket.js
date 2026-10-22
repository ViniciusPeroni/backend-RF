const uuid = require('../utils/uuid');
const messageService = require('../services/messageService');
const notificationService = require('../services/notificationService');
const { extractToken, getDecodedToken, getUserIdFromToken, emitToUser } = require('./notificationSocket');

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

        socket.on("join_conversation", (conversationId) => {

            socket.join(String(conversationId));

            console.log(
                `Socket ${socket.id} entrou na conversa ${conversationId}`
            );
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

                const { id, recipient } = await messageService.createMessage({
                    conversationId,
                    id_user: userId,
                    type,
                    content,
                    id_answer
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

                io.to(String(conversationId)).emit("new_message", message);

                emitToUser(recipient, "new_message", message);

                const senderName = socket.userName || "Usuário";
                const preview = type === "texto"
                    ? String(content).trim().slice(0, 120)
                    : `Enviou uma mensagem do tipo ${type}.`;

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

                return respond({ message: "Mensagem enviada com sucesso.", id });

            } catch (error) {
                console.error("Erro em send_message:", error);

                if (error.status) {
                    return respond({ error: error.message });
                }

                return respond({ error: "Erro ao enviar mensagem." });
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
