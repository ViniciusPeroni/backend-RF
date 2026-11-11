"use strict";

const service = require("../src/services/notificationPreferencesService");
const controller = require("../src/controllers/notificationPreferencesController");
const { invoke, serviceError, unexpectedError, USER_ID } = require("./helpers/http");

const DEVICE_ID = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

function codedError(message, status, code) {
    return Object.assign(new Error(message), { status, code });
}

describe("notificationPreferencesController.getPreferences", () => {
    test("devolve as preferências do usuário autenticado", async () => {
        const preferences = { email: true, push: false };
        const getPreferences = jest.spyOn(service, "getPreferences").mockResolvedValue(preferences);

        const { status, body } = await invoke(controller.getPreferences);

        expect(getPreferences).toHaveBeenCalledWith(USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual({ email: true, push: false });
    });

    test("devolve 500 genérico quando o service falha sem status", async () => {
        jest.spyOn(service, "getPreferences")
            .mockRejectedValue(unexpectedError("ER_ACCESS_DENIED_ERROR"));

        const { status, body } = await invoke(controller.getPreferences);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "NOTIFICATION_SETTINGS_ERROR" });
    });
});

describe("notificationPreferencesController.putPreferences", () => {
    test("repassa o corpo ao service e devolve o resultado", async () => {
        const input = { email: false, push: true };
        const updatePreferences = jest.spyOn(service, "updatePreferences").mockResolvedValue(input);

        const { status, body } = await invoke(controller.putPreferences, { body: input });

        expect(updatePreferences).toHaveBeenCalledWith(USER_ID, input);
        expect(status).toBe(200);
        expect(body).toEqual({ email: false, push: true });
    });

    test("não valida o corpo na controller: delega ao service", async () => {
        const updatePreferences = jest.spyOn(service, "updatePreferences")
            .mockRejectedValue(codedError("corpo inválido", 400, "INVALID_NOTIFICATION_INPUT"));

        const { status, body } = await invoke(controller.putPreferences, { body: { email: "sim" } });

        expect(updatePreferences).toHaveBeenCalledWith(USER_ID, { email: "sim" });
        expect(status).toBe(400);
        expect(body).toEqual({ error: "INVALID_NOTIFICATION_INPUT" });
    });

    test("devolve 500 genérico quando o service falha sem status", async () => {
        jest.spyOn(service, "updatePreferences")
            .mockRejectedValue(unexpectedError("deadlock"));

        const { status, body } = await invoke(controller.putPreferences, {
            body: { email: true, push: true }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "NOTIFICATION_SETTINGS_ERROR" });
    });
});

describe("notificationPreferencesController.putDevice", () => {
    test("repassa usuário, id do dispositivo e corpo ao service", async () => {
        const input = { token: "token-fcm", platform: "android" };
        const putDevice = jest.spyOn(service, "putDevice")
            .mockResolvedValue({ id: DEVICE_ID, platform: "android", active: true });

        const { status, body } = await invoke(controller.putDevice, {
            params: { id: DEVICE_ID },
            body: input
        });

        expect(putDevice).toHaveBeenCalledWith(USER_ID, DEVICE_ID, input);
        expect(status).toBe(200);
        expect(body).toEqual({ id: DEVICE_ID, platform: "android", active: true });
    });

    test("repassa 400 de dispositivo inválido", async () => {
        jest.spyOn(service, "putDevice")
            .mockRejectedValue(codedError("id inválido", 400, "INVALID_DEVICE_ID"));

        const { status, body } = await invoke(controller.putDevice, {
            params: { id: "abc" },
            body: { token: "t", platform: "web" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "INVALID_DEVICE_ID" });
    });

    test("repassa 409 de conflito de dispositivo", async () => {
        jest.spyOn(service, "putDevice")
            .mockRejectedValue(codedError("token de outro usuário", 409, "DEVICE_CONFLICT"));

        const { status, body } = await invoke(controller.putDevice, {
            params: { id: DEVICE_ID },
            body: { token: "t", platform: "ios" }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "DEVICE_CONFLICT" });
    });

    test("repassa 503 quando a chave de criptografia não está configurada", async () => {
        jest.spyOn(service, "putDevice")
            .mockRejectedValue(codedError("chave ausente", 503, "NOTIFICATION_KEY_UNAVAILABLE"));

        const { status, body } = await invoke(controller.putDevice, {
            params: { id: DEVICE_ID },
            body: { token: "t", platform: "web" }
        });

        expect(status).toBe(503);
        expect(body).toEqual({ error: "NOTIFICATION_KEY_UNAVAILABLE" });
    });

    test("devolve 500 genérico quando o service falha sem status", async () => {
        jest.spyOn(service, "putDevice")
            .mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.putDevice, {
            params: { id: DEVICE_ID },
            body: { token: "t", platform: "web" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "NOTIFICATION_SETTINGS_ERROR" });
    });
});

describe("notificationPreferencesController.deleteDevice", () => {
    test("recusa corpo com campos extras sem chamar o service", async () => {
        const remove = jest.spyOn(service, "deleteDevice");

        const { status, body } = await invoke(controller.deleteDevice, {
            params: { id: DEVICE_ID },
            body: { force: true }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "INVALID_NOTIFICATION_INPUT" });
        expect(remove).not.toHaveBeenCalled();
    });

    test("recusa corpo em formato de array sem chamar o service", async () => {
        const remove = jest.spyOn(service, "deleteDevice");

        const { status, body } = await invoke(controller.deleteDevice, {
            params: { id: DEVICE_ID },
            body: []
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "INVALID_NOTIFICATION_INPUT" });
        expect(remove).not.toHaveBeenCalled();
    });

    test("desvincula o dispositivo e responde 204 sem corpo", async () => {
        const remove = jest.spyOn(service, "deleteDevice").mockResolvedValue(undefined);

        const { status, body } = await invoke(controller.deleteDevice, {
            params: { id: DEVICE_ID },
            body: null
        });

        expect(remove).toHaveBeenCalledWith(USER_ID, DEVICE_ID);
        expect(status).toBe(204);
        expect(body).toBeUndefined();
    });

    test("repassa 404 quando o dispositivo não pertence ao usuário", async () => {
        jest.spyOn(service, "deleteDevice")
            .mockRejectedValue(codedError("dispositivo não encontrado", 404, "DEVICE_NOT_FOUND"));

        const { status, body } = await invoke(controller.deleteDevice, {
            params: { id: DEVICE_ID },
            body: {}
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "DEVICE_NOT_FOUND" });
    });

    test("repassa 400 de id de dispositivo inválido", async () => {
        jest.spyOn(service, "deleteDevice")
            .mockRejectedValue(codedError("id inválido", 400, "INVALID_DEVICE_ID"));

        const { status, body } = await invoke(controller.deleteDevice, {
            params: { id: "abc" },
            body: {}
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "INVALID_DEVICE_ID" });
    });

    test("devolve 500 genérico quando o service falha sem status", async () => {
        jest.spyOn(service, "deleteDevice")
            .mockRejectedValue(unexpectedError("lock wait timeout"));

        const { status, body } = await invoke(controller.deleteDevice, {
            params: { id: DEVICE_ID },
            body: {}
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "NOTIFICATION_SETTINGS_ERROR" });
    });
});

describe("notificationPreferencesController.mapeamento de erro", () => {
    test.each([400, 403, 404, 409, 503])(
        "repassa status %i e usa error.code em vez de error.message",
        async (status) => {
            jest.spyOn(service, "getPreferences")
                .mockRejectedValue(codedError("mensagem interna que não deve vazar", status, "CODIGO_ESTAVEL"));

            const result = await invoke(controller.getPreferences);

            expect(result.status).toBe(status);
            expect(result.body).toEqual({ error: "CODIGO_ESTAVEL" });
        }
    );

    test.each([401, 402, 500, undefined])(
        "converte status %s fora da lista em 500 genérico",
        async (status) => {
            jest.spyOn(service, "getPreferences")
                .mockRejectedValue(codedError("mensagem interna que não deve vazar", status, "CODIGO_ESTAVEL"));

            const result = await invoke(controller.getPreferences);

            expect(result.status).toBe(500);
            expect(result.body).toEqual({ error: "NOTIFICATION_SETTINGS_ERROR" });
        }
    );

    test("erro sem status e sem code também cai no 500 genérico", async () => {
        jest.spyOn(service, "getPreferences").mockRejectedValue(new Error("falha crua"));

        const { status, body } = await invoke(controller.getPreferences);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "NOTIFICATION_SETTINGS_ERROR" });
    });

    test("erro conhecido sem code devolve error.code indefinido no corpo", async () => {
        jest.spyOn(service, "getPreferences").mockRejectedValue(serviceError("sem código", 404));

        const { status, body } = await invoke(controller.getPreferences);

        expect(status).toBe(404);
        expect(body.error).toBeUndefined();
    });
});
