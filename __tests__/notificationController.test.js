"use strict";

jest.mock("../src/sockets/notificationSocket", () => ({ emitToUser: jest.fn() }));

const notificationService = require("../src/services/notificationService");
const { emitToUser } = require("../src/sockets/notificationSocket");
const controller = require("../src/controllers/notificationController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const NOTIFICATION_ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const { NOTIFICATION_TYPES } = notificationService;

describe("notificationController.createNotification", () => {
    test("recusa corpo que não é objeto JSON", async () => {
        const notifyUser = jest.spyOn(notificationService, "notifyUser");

        const { status, body } = await invoke(controller.createNotification, { body: [] });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "O corpo deve ser um objeto JSON." });
        expect(notifyUser).not.toHaveBeenCalled();
    });

    test("exige type e title", async () => {
        const notifyUser = jest.spyOn(notificationService, "notifyUser");

        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "type e title são obrigatórios." });
        expect(notifyUser).not.toHaveBeenCalled();
    });

    test("recusa title só com espaços", async () => {
        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema", title: "   " }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "title deve ser um texto não vazio." });
    });

    test("recusa type fora do catálogo", async () => {
        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "promocao", title: "Aviso" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: `type inválido. Valores permitidos: ${NOTIFICATION_TYPES.join(", ")}.`
        });
    });

    test("recusa title acima de 100 caracteres", async () => {
        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema", title: "a".repeat(101) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "title deve ter no máximo 100 caracteres." });
    });

    test("recusa content que não é texto", async () => {
        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema", title: "Aviso", content: 123 }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "content deve ser um texto." });
    });

    test("recusa content acima de 65535 bytes", async () => {
        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema", title: "Aviso", content: "a".repeat(65536) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "content deve ter no máximo 65535 bytes em UTF-8." });
    });

    test("recusa reference_table vazio", async () => {
        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema", title: "Aviso", reference_table: "   " }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "reference_table deve ser um texto não vazio." });
    });

    test("recusa reference_table acima de 30 caracteres", async () => {
        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema", title: "Aviso", reference_table: "a".repeat(31) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "reference_table deve ter no máximo 30 caracteres." });
    });

    test("recusa reference_id que não é UUID", async () => {
        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema", title: "Aviso", reference_id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "reference_id inválido. Deve ser um UUID válido." });
    });

    test("cria a notificação do usuário autenticado e devolve 201", async () => {
        const notifyUser = jest.spyOn(notificationService, "notifyUser")
            .mockResolvedValue({ id: NOTIFICATION_ID });

        const { status, body } = await invoke(controller.createNotification, {
            body: {
                type: "sistema",
                title: "Aviso",
                content: "Conteúdo",
                reference_table: "shopping",
                reference_id: OTHER_ID
            }
        });

        expect(notifyUser).toHaveBeenCalledWith({
            id_user: USER_ID,
            type: "sistema",
            title: "Aviso",
            content: "Conteúdo",
            reference_table: "shopping",
            reference_id: OTHER_ID
        });
        expect(status).toBe(201);
        expect(body).toEqual({ message: "Notificação criada com sucesso.", id: NOTIFICATION_ID });
    });

    test("mantém 500 genérico mesmo quando o service tem status", async () => {
        jest.spyOn(notificationService, "notifyUser")
            .mockRejectedValue(serviceError("Destinatário inexistente.", 404));

        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema", title: "Aviso" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao criar notificação." });
    });

    test("usa mensagem genérica para falha inesperada", async () => {
        jest.spyOn(notificationService, "notifyUser")
            .mockRejectedValue(unexpectedError("senha do banco vazou"));

        const { status, body } = await invoke(controller.createNotification, {
            body: { type: "sistema", title: "Aviso" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao criar notificação." });
    });
});

describe("notificationController.listNotifications", () => {
    test("lista sem filtros repassando apenas os campos previstos", async () => {
        const notifications = [{ id: NOTIFICATION_ID, title: "Aviso" }];
        const list = jest.spyOn(notificationService, "listNotifications").mockResolvedValue(notifications);

        const { status, body } = await invoke(controller.listNotifications);

        expect(list).toHaveBeenCalledWith(USER_ID, {
            read: undefined,
            type: undefined,
            reference_table: undefined,
            reference_id: undefined
        });
        expect(status).toBe(200);
        expect(body).toEqual(notifications);
    });

    test("converte limit/offset e aplica trim em reference_table", async () => {
        const list = jest.spyOn(notificationService, "listNotifications").mockResolvedValue([]);

        const { status } = await invoke(controller.listNotifications, {
            query: {
                read: "nao",
                type: "sistema",
                reference_table: "  shopping  ",
                reference_id: OTHER_ID,
                limit: "10",
                offset: "5"
            }
        });

        expect(list).toHaveBeenCalledWith(USER_ID, {
            read: "nao",
            type: "sistema",
            reference_table: "shopping",
            reference_id: OTHER_ID,
            limit: 10,
            offset: 5
        });
        expect(status).toBe(200);
    });

    test("recusa read fora de sim/nao", async () => {
        const list = jest.spyOn(notificationService, "listNotifications");

        const { status, body } = await invoke(controller.listNotifications, {
            query: { read: "talvez" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "read inválido. Valores permitidos: 'sim' ou 'nao'." });
        expect(list).not.toHaveBeenCalled();
    });

    test("recusa type fora do catálogo", async () => {
        const { status, body } = await invoke(controller.listNotifications, {
            query: { type: "promocao" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "type inválido." });
    });

    test("recusa reference_table vazio", async () => {
        const { status, body } = await invoke(controller.listNotifications, {
            query: { reference_table: "   " }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "reference_table deve ser um texto não vazio." });
    });

    test("recusa reference_table acima de 30 caracteres", async () => {
        const { status, body } = await invoke(controller.listNotifications, {
            query: { reference_table: "a".repeat(31) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "reference_table deve ter no máximo 30 caracteres." });
    });

    test("recusa reference_id que não é UUID", async () => {
        const { status, body } = await invoke(controller.listNotifications, {
            query: { reference_id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "reference_id inválido." });
    });

    test("recusa limit fora da faixa", async () => {
        const { status, body } = await invoke(controller.listNotifications, {
            query: { limit: "101" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "limit deve ser um inteiro entre 1 e 100." });
    });

    test("recusa offset negativo", async () => {
        const { status, body } = await invoke(controller.listNotifications, {
            query: { offset: "-1" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "offset deve ser um inteiro entre 0 e 2147483647." });
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(notificationService, "listNotifications")
            .mockRejectedValue(serviceError("range inválido", 400));

        const { status, body } = await invoke(controller.listNotifications);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar notificações." });
    });
});

describe("notificationController.getNotificationById", () => {
    test("recusa ID que não é UUID sem chamar o service", async () => {
        const getById = jest.spyOn(notificationService, "getNotificationById");

        const { status, body } = await invoke(controller.getNotificationById, {
            params: { id: "123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da notificação inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("devolve 404 quando a notificação não pertence ao usuário", async () => {
        jest.spyOn(notificationService, "getNotificationById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getNotificationById, {
            params: { id: NOTIFICATION_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Notificação não encontrada." });
    });

    test("devolve a notificação do próprio usuário", async () => {
        const notification = { id: NOTIFICATION_ID, title: "Aviso", read: "nao" };
        const getById = jest.spyOn(notificationService, "getNotificationById").mockResolvedValue(notification);

        const { status, body } = await invoke(controller.getNotificationById, {
            params: { id: NOTIFICATION_ID }
        });

        expect(getById).toHaveBeenCalledWith(NOTIFICATION_ID, USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(notification);
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(notificationService, "getNotificationById")
            .mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.getNotificationById, {
            params: { id: NOTIFICATION_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar notificação." });
    });
});

describe("notificationController.countUnread", () => {
    test("devolve o total de não lidas do usuário autenticado", async () => {
        const count = jest.spyOn(notificationService, "countUnread").mockResolvedValue(3);

        const { status, body } = await invoke(controller.countUnread);

        expect(count).toHaveBeenCalledWith(USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual({ total: 3 });
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(notificationService, "countUnread")
            .mockRejectedValue(unexpectedError("tabela ausente"));

        const { status, body } = await invoke(controller.countUnread);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao contar notificações não lidas." });
    });
});

describe("notificationController.markAsRead", () => {
    test("recusa ID que não é UUID", async () => {
        const markAsRead = jest.spyOn(notificationService, "markAsRead");

        const { status, body } = await invoke(controller.markAsRead, {
            params: { id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da notificação inválido." });
        expect(markAsRead).not.toHaveBeenCalled();
        expect(emitToUser).not.toHaveBeenCalled();
    });

    test("devolve 404 sem emitir evento quando não encontra", async () => {
        jest.spyOn(notificationService, "markAsRead").mockResolvedValue(null);

        const { status, body } = await invoke(controller.markAsRead, {
            params: { id: NOTIFICATION_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Notificação não encontrada." });
        expect(emitToUser).not.toHaveBeenCalled();
    });

    test("marca como lida e emite notification_read para o usuário", async () => {
        const notification = { id: NOTIFICATION_ID, read: "sim" };
        const markAsRead = jest.spyOn(notificationService, "markAsRead").mockResolvedValue(notification);

        const { status, body } = await invoke(controller.markAsRead, {
            params: { id: NOTIFICATION_ID }
        });

        expect(markAsRead).toHaveBeenCalledWith(NOTIFICATION_ID, USER_ID);
        expect(emitToUser).toHaveBeenCalledWith(USER_ID, "notification_read", { id: NOTIFICATION_ID });
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Notificação marcada como lida.", notification });
    });

    test("não emite evento e devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(notificationService, "markAsRead")
            .mockRejectedValue(unexpectedError("deadlock"));

        const { status, body } = await invoke(controller.markAsRead, {
            params: { id: NOTIFICATION_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao marcar notificação como lida." });
        expect(emitToUser).not.toHaveBeenCalled();
    });
});

describe("notificationController.markAllAsRead", () => {
    test("marca todas como lidas e emite notifications_read_all", async () => {
        const markAll = jest.spyOn(notificationService, "markAllAsRead").mockResolvedValue(7);

        const { status, body } = await invoke(controller.markAllAsRead);

        expect(markAll).toHaveBeenCalledWith(USER_ID);
        expect(emitToUser).toHaveBeenCalledWith(USER_ID, "notifications_read_all", { updated: 7 });
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Notificações marcadas como lidas.", updated: 7 });
    });

    test("não emite evento e devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(notificationService, "markAllAsRead")
            .mockRejectedValue(serviceError("timeout", 503));

        const { status, body } = await invoke(controller.markAllAsRead);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao marcar notificações como lidas." });
        expect(emitToUser).not.toHaveBeenCalled();
    });
});

describe("notificationController.deleteNotification", () => {
    test("recusa ID que não é UUID", async () => {
        const remove = jest.spyOn(notificationService, "deleteNotification");

        const { status, body } = await invoke(controller.deleteNotification, {
            params: { id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da notificação inválido." });
        expect(remove).not.toHaveBeenCalled();
        expect(emitToUser).not.toHaveBeenCalled();
    });

    test("devolve 404 sem emitir evento quando nada foi excluído", async () => {
        jest.spyOn(notificationService, "deleteNotification").mockResolvedValue(false);

        const { status, body } = await invoke(controller.deleteNotification, {
            params: { id: NOTIFICATION_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Notificação não encontrada." });
        expect(emitToUser).not.toHaveBeenCalled();
    });

    test("exclui e emite notification_deleted para o usuário", async () => {
        const remove = jest.spyOn(notificationService, "deleteNotification").mockResolvedValue(true);

        const { status, body } = await invoke(controller.deleteNotification, {
            params: { id: NOTIFICATION_ID }
        });

        expect(remove).toHaveBeenCalledWith(NOTIFICATION_ID, USER_ID);
        expect(emitToUser).toHaveBeenCalledWith(USER_ID, "notification_deleted", { id: NOTIFICATION_ID });
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Notificação excluída com sucesso." });
    });

    test("não emite evento e devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(notificationService, "deleteNotification")
            .mockRejectedValue(unexpectedError("lock timeout"));

        const { status, body } = await invoke(controller.deleteNotification, {
            params: { id: NOTIFICATION_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir notificação." });
        expect(emitToUser).not.toHaveBeenCalled();
    });
});
