const conversationService = require('../services/conversationService');
const { isValid } = require('../utils/uuid');

const getOrCreateConversation = async (req, res) => {
    const { otherUserId } = req.body;

    if (!otherUserId) {
        return res.status(400).json({ error: 'otherUserId é obrigatório.' });
    }

    if (!isValid(otherUserId)) {
        return res.status(400).json({ error: 'otherUserId inválido.' });
    }

    try {
        const result = await conversationService.getOrCreateConversation(req.userId, otherUserId);
        return res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error('Erro em getOrCreateConversation:', err);
        return res.status(500).json({ error: 'Erro ao obter/criar conversa.' });
    }
};

const listConversations = async (req, res) => {
    try {
        const conversations = await conversationService.listConversationsForUser(req.userId);
        return res.status(200).json(conversations);
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error('Erro em listConversations:', err);
        return res.status(500).json({ error: 'Erro ao listar conversas.' });
    }
};

const getConversationById = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({ error: 'ID da conversa inválido.' });
    }

    try {
        const belongs = await conversationService.userBelongsToConversation(id, req.userId);
        if (!belongs) {
            return res.status(403).json({ error: 'Você não participa desta conversa.' });
        }

        const participants = await conversationService.getConversationParticipants(id);
        return res.status(200).json({ conversationId: id, participants });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error('Erro em getConversationById:', err);
        return res.status(500).json({ error: 'Erro ao buscar conversa.' });
    }
};

const leaveConversation = async (req, res) => {
    const { id } = req.params;

    if (!isValid(id)) {
        return res.status(400).json({ error: 'ID da conversa inválido.' });
    }

    try {
        const result = await conversationService.leaveConversation(id, req.userId);
        return res.status(200).json({ message: 'Você saiu da conversa.', ...result });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error('Erro em leaveConversation:', err);
        return res.status(500).json({ error: 'Erro ao sair da conversa.' });
    }
};

module.exports = {
    getOrCreateConversation,
    listConversations,
    getConversationById,
    leaveConversation
};
