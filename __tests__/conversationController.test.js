"use strict";

const conversationService = require("../src/services/conversationService");
const controller = require("../src/controllers/conversationController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const CONVERSATION_ID = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d";

// =========================================================
// getOrCreateConversation
// =========================================================
describe("conversationController.getOrCreateConversation", () => {
    test("exige otherUserId no corpo", async () => {
        const getOrCreate = jest.spyOn(conversationService, "getOrCreateConversation");

        const { status, body } = await invoke(controller.getOrCreateConversation, { body: {} });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "otherUserId é obrigatório." });
        expect(getOrCreate).not.toHaveBeenCalled();
    });

    test("rejeita otherUserId que não é UUID", async () => {
        const getOrCreate = jest.spyOn(conversationService, "getOrCreateConversation");

        const { status, body } = await invoke(controller.getOrCreateConversation, {
            body: { otherUserId: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "otherUserId inválido." });
        expect(getOrCreate).not.toHaveBeenCalled();
    });

    test("responde 201 quando a conversa é criada", async () => {
        const result = { conversationId: CONVERSATION_ID, created: true };
        const getOrCreate = jest
            .spyOn(conversationService, "getOrCreateConversation")
            .mockResolvedValue(result);

        const { status, body } = await invoke(controller.getOrCreateConversation, {
            body: { otherUserId: OTHER_ID }
        });

        expect(getOrCreate).toHaveBeenCalledWith(USER_ID, OTHER_ID);
        expect(status).toBe(201);
        expect(body).toEqual(result);
    });

    test("responde 200 quando a conversa já existia", async () => {
        const result = { conversationId: CONVERSATION_ID, created: false };
        jest.spyOn(conversationService, "getOrCreateConversation").mockResolvedValue(result);

        const { status, body } = await invoke(controller.getOrCreateConversation, {
            body: { otherUserId: OTHER_ID }
        });

        expect(status).toBe(200);
        expect(body).toEqual(result);
    });

    test("repassa o 400 de conversa consigo mesmo vindo do service", async () => {
        jest.spyOn(conversationService, "getOrCreateConversation").mockRejectedValue(
            serviceError("Não é possível criar uma conversa consigo mesmo.", 400)
        );

        const { status, body } = await invoke(controller.getOrCreateConversation, {
            body: { otherUserId: USER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Não é possível criar uma conversa consigo mesmo." });
    });

    test("repassa o 409 de conversa duplicada vindo do service", async () => {
        jest.spyOn(conversationService, "getOrCreateConversation").mockRejectedValue(
            serviceError("Já existe uma conversa entre estes usuários.", 409)
        );

        const { status, body } = await invoke(controller.getOrCreateConversation, {
            body: { otherUserId: OTHER_ID }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Já existe uma conversa entre estes usuários." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(conversationService, "getOrCreateConversation").mockRejectedValue(
            unexpectedError("falha no getConnection")
        );

        const { status, body } = await invoke(controller.getOrCreateConversation, {
            body: { otherUserId: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao obter/criar conversa." });
    });
});

// =========================================================
// listConversations
// =========================================================
describe("conversationController.listConversations", () => {
    test("lista as conversas do usuário autenticado", async () => {
        const conversations = [
            { conversationId: CONVERSATION_ID, otherUserId: OTHER_ID, unreadCount: 2 }
        ];
        const list = jest
            .spyOn(conversationService, "listConversationsForUser")
            .mockResolvedValue(conversations);

        const { status, body } = await invoke(controller.listConversations);

        expect(list).toHaveBeenCalledWith(USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(conversations);
    });

    test("repassa o 400 de usuário inválido vindo do service", async () => {
        jest.spyOn(conversationService, "listConversationsForUser").mockRejectedValue(
            serviceError("UUID de usuário inválido.", 400)
        );

        const { status, body } = await invoke(controller.listConversations);

        expect(status).toBe(400);
        expect(body).toEqual({ error: "UUID de usuário inválido." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(conversationService, "listConversationsForUser").mockRejectedValue(
            unexpectedError()
        );

        const { status, body } = await invoke(controller.listConversations);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao listar conversas." });
    });
});

// =========================================================
// getConversationById
// =========================================================
describe("conversationController.getConversationById", () => {
    test("rejeita ID inválido com 400 sem chamar o service", async () => {
        const belongs = jest.spyOn(conversationService, "userBelongsToConversation");

        const { status, body } = await invoke(controller.getConversationById, {
            params: { id: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da conversa inválido." });
        expect(belongs).not.toHaveBeenCalled();
    });

    test("bloqueia quem não participa da conversa com 403", async () => {
        const belongs = jest
            .spyOn(conversationService, "userBelongsToConversation")
            .mockResolvedValue(false);
        const participants = jest.spyOn(conversationService, "getConversationParticipants");

        const { status, body } = await invoke(controller.getConversationById, {
            params: { id: CONVERSATION_ID }
        });

        expect(belongs).toHaveBeenCalledWith(CONVERSATION_ID, USER_ID);
        expect(status).toBe(403);
        expect(body).toEqual({ error: "Você não participa desta conversa." });
        expect(participants).not.toHaveBeenCalled();
    });

    test("devolve os participantes para quem participa da conversa", async () => {
        jest.spyOn(conversationService, "userBelongsToConversation").mockResolvedValue(true);
        const participants = jest
            .spyOn(conversationService, "getConversationParticipants")
            .mockResolvedValue([USER_ID, OTHER_ID]);

        const { status, body } = await invoke(controller.getConversationById, {
            params: { id: CONVERSATION_ID }
        });

        expect(participants).toHaveBeenCalledWith(CONVERSATION_ID);
        expect(status).toBe(200);
        expect(body).toEqual({ conversationId: CONVERSATION_ID, participants: [USER_ID, OTHER_ID] });
    });

    test("repassa o status do service na checagem de participação", async () => {
        jest.spyOn(conversationService, "userBelongsToConversation").mockRejectedValue(
            serviceError("Conversa indisponível.", 404)
        );

        const { status, body } = await invoke(controller.getConversationById, {
            params: { id: CONVERSATION_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Conversa indisponível." });
    });

    test("repassa o 400 do service ao buscar participantes", async () => {
        jest.spyOn(conversationService, "userBelongsToConversation").mockResolvedValue(true);
        jest.spyOn(conversationService, "getConversationParticipants").mockRejectedValue(
            serviceError("conversationId inválido.", 400)
        );

        const { status, body } = await invoke(controller.getConversationById, {
            params: { id: CONVERSATION_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "conversationId inválido." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(conversationService, "userBelongsToConversation").mockRejectedValue(
            unexpectedError()
        );

        const { status, body } = await invoke(controller.getConversationById, {
            params: { id: CONVERSATION_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar conversa." });
    });
});

// =========================================================
// leaveConversation
// =========================================================
describe("conversationController.leaveConversation", () => {
    test("rejeita ID inválido com 400 sem chamar o service", async () => {
        const leave = jest.spyOn(conversationService, "leaveConversation");

        const { status, body } = await invoke(controller.leaveConversation, {
            params: { id: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da conversa inválido." });
        expect(leave).not.toHaveBeenCalled();
    });

    test("sai da conversa e mescla o resultado do service na resposta", async () => {
        const leave = jest
            .spyOn(conversationService, "leaveConversation")
            .mockResolvedValue({ left: true, deletedConversation: false });

        const { status, body } = await invoke(controller.leaveConversation, {
            params: { id: CONVERSATION_ID }
        });

        expect(leave).toHaveBeenCalledWith(CONVERSATION_ID, USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Você saiu da conversa.",
            left: true,
            deletedConversation: false
        });
    });

    test("informa quando a conversa foi apagada por não ter mais participantes", async () => {
        jest.spyOn(conversationService, "leaveConversation").mockResolvedValue({
            left: true,
            deletedConversation: true
        });

        const { status, body } = await invoke(controller.leaveConversation, {
            params: { id: CONVERSATION_ID }
        });

        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Você saiu da conversa.",
            left: true,
            deletedConversation: true
        });
    });

    test("repassa o 403 de quem não participa da conversa", async () => {
        jest.spyOn(conversationService, "leaveConversation").mockRejectedValue(
            serviceError("Você não participa desta conversa.", 403)
        );

        const { status, body } = await invoke(controller.leaveConversation, {
            params: { id: CONVERSATION_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Você não participa desta conversa." });
    });

    test("repassa o 400 de parâmetro inválido vindo do service", async () => {
        jest.spyOn(conversationService, "leaveConversation").mockRejectedValue(
            serviceError("conversationId ou userId inválido.", 400)
        );

        const { status, body } = await invoke(controller.leaveConversation, {
            params: { id: CONVERSATION_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "conversationId ou userId inválido." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(conversationService, "leaveConversation").mockRejectedValue(
            unexpectedError("falha no rollback")
        );

        const { status, body } = await invoke(controller.leaveConversation, {
            params: { id: CONVERSATION_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao sair da conversa." });
    });
});
