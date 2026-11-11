"use strict";

const logService = require("../src/services/logService");
const controller = require("../src/controllers/logController");
const { invoke, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const LOG = {
    id: OTHER_ID,
    reference_id: USER_ID,
    id_user: USER_ID,
    status: "200",
    operation: "update",
    table: "user",
    description: "Atualização de cadastro",
    datetime: "2026-11-01 10:00:00",
    ip: "127.0.0.1",
    user_agent: "jest"
};

describe("logController constantes exportadas", () => {
    test("expõe os limites de tamanho usados na validação", () => {
        expect(controller.MAX_STATUS).toBe(50);
        expect(controller.MAX_OPERATION).toBe(20);
        expect(controller.MAX_TABLE).toBe(20);
        expect(controller.MAX_DESCRIPTION).toBe(255);
    });
});

describe("logController.createLog", () => {
    test("recusa 400 quando status não é informado", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, { body: {} });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "status é obrigatório." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando operation não é informado", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, {
            body: { status: "200" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "operation é obrigatório." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando table não é informado", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, {
            body: { status: "200", operation: "create" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "table é obrigatório." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando status passa de 50 caracteres", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, {
            body: { status: "a".repeat(51), operation: "create", table: "user" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "status deve ter no máximo 50 caracteres." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando operation passa de 20 caracteres", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, {
            body: { status: "200", operation: "a".repeat(21), table: "user" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "operation deve ter no máximo 20 caracteres." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando table passa de 20 caracteres", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, {
            body: { status: "200", operation: "create", table: "a".repeat(21) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "table deve ter no máximo 20 caracteres." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando description passa de 255 caracteres", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, {
            body: {
                status: "200",
                operation: "create",
                table: "user",
                description: "a".repeat(256)
            }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "description deve ter no máximo 255 caracteres." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando description não é texto", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, {
            body: { status: "200", operation: "create", table: "user", description: 123 }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "description deve ser um texto." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando reference_id não é UUID", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, {
            body: { reference_id: "compra-1", status: "200", operation: "create", table: "user" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "reference_id inválido." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando id_user não é UUID", async () => {
        const create = jest.spyOn(logService, "createLog");

        const { status, body } = await invoke(controller.createLog, {
            body: { id_user: "usuario-1", status: "200", operation: "create", table: "user" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "id_user inválido." });
        expect(create).not.toHaveBeenCalled();
    });

    test("registra o log aparando os textos e responde 201", async () => {
        const create = jest.spyOn(logService, "createLog").mockResolvedValue(OTHER_ID);

        const { status, body } = await invoke(controller.createLog, {
            body: {
                reference_id: ` ${USER_ID} `,
                status: " 200 ",
                operation: " update ",
                table: " user ",
                description: " Atualização de cadastro "
            }
        });

        expect(create).toHaveBeenCalledWith({
            reference_id: USER_ID,
            id_user: USER_ID,
            status: "200",
            operation: "update",
            table: "user",
            description: "Atualização de cadastro"
        });
        expect(status).toBe(201);
        expect(body).toEqual({ message: "Log registrado com sucesso.", id: OTHER_ID });
    });

    test("usa o usuário do token e reference_id nulo quando ausentes", async () => {
        const create = jest.spyOn(logService, "createLog").mockResolvedValue(OTHER_ID);

        await invoke(controller.createLog, {
            body: { status: "201", operation: "create", table: "shopping" }
        });

        expect(create).toHaveBeenCalledWith({
            reference_id: null,
            id_user: USER_ID,
            status: "201",
            operation: "create",
            table: "shopping",
            description: undefined
        });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(logService, "createLog").mockRejectedValue(unexpectedError("tabela log bloqueada"));

        const { status, body } = await invoke(controller.createLog, {
            body: { status: "200", operation: "create", table: "user" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao registrar o log." });
    });
});

describe("logController.listLogs", () => {
    test("recusa 400 quando reference_id do filtro não é UUID", async () => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, {
            query: { reference_id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "reference_id inválido." });
        expect(list).not.toHaveBeenCalled();
    });

    test("recusa 400 quando id_user do filtro não é UUID", async () => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, {
            query: { id_user: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "id_user inválido." });
        expect(list).not.toHaveBeenCalled();
    });

    test("recusa 400 quando status do filtro passa de 50 caracteres", async () => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, {
            query: { status: "a".repeat(51) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "status deve ter no máximo 50 caracteres." });
        expect(list).not.toHaveBeenCalled();
    });

    test("recusa 400 quando operation do filtro passa de 20 caracteres", async () => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, {
            query: { operation: "a".repeat(21) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "operation deve ter no máximo 20 caracteres." });
        expect(list).not.toHaveBeenCalled();
    });

    test("recusa 400 quando table do filtro passa de 20 caracteres", async () => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, {
            query: { table: "a".repeat(21) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "table deve ter no máximo 20 caracteres." });
        expect(list).not.toHaveBeenCalled();
    });

    test("recusa 400 quando a data não está em formato aceito", async () => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, {
            query: { from: "ontem" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "from e to devem ser textos no formato YYYY-MM-DD ou YYYY-MM-DD HH:MM:SS."
        });
        expect(list).not.toHaveBeenCalled();
    });

    test("recusa 400 quando a data tem formato válido mas é inexistente", async () => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, {
            query: { to: "2026-13-45 99:99:99" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "from ou to contém uma data inválida." });
        expect(list).not.toHaveBeenCalled();
    });

    test("aceita data de calendário inexistente porque o Date faz rollover", async () => {
        const list = jest.spyOn(logService, "listLogs")
            .mockResolvedValue({ total: 0, limit: 50, offset: 0, logs: [] });

        const { status } = await invoke(controller.listLogs, {
            query: { from: "2026-02-30" }
        });

        expect(list).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-02-30 00:00:00" }));
        expect(status).toBe(200);
    });

    test.each([
        ["limit", { limit: "abc" }],
        ["offset", { offset: "1.5" }]
    ])("recusa 400 quando %s não é inteiro", async (_label, query) => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, { query });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "limit e offset devem ser números inteiros." });
        expect(list).not.toHaveBeenCalled();
    });

    test.each([
        ["zero", { limit: "0" }],
        ["acima do máximo", { limit: "201" }]
    ])("recusa 400 quando limit é %s", async (_label, query) => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, { query });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "limit deve ser um inteiro entre 1 e 200." });
        expect(list).not.toHaveBeenCalled();
    });

    test("recusa 400 quando offset é negativo", async () => {
        const list = jest.spyOn(logService, "listLogs");

        const { status, body } = await invoke(controller.listLogs, {
            query: { offset: "-1" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "offset deve ser um inteiro maior ou igual a 0." });
        expect(list).not.toHaveBeenCalled();
    });

    test("normaliza filtros, datas e paginação antes de consultar", async () => {
        const result = { total: 1, limit: 10, offset: 5, logs: [LOG] };
        const list = jest.spyOn(logService, "listLogs").mockResolvedValue(result);

        const { status, body } = await invoke(controller.listLogs, {
            query: {
                reference_id: USER_ID,
                id_user: OTHER_ID,
                status: "200",
                operation: "update",
                table: "user",
                from: "2026-01-01",
                to: "2026-01-31",
                limit: "10",
                offset: "5"
            }
        });

        expect(list).toHaveBeenCalledWith({
            reference_id: USER_ID,
            id_user: OTHER_ID,
            status: "200",
            operation: "update",
            table: "user",
            from: "2026-01-01 00:00:00",
            to: "2026-01-31 23:59:59",
            limit: 10,
            offset: 5
        });
        expect(status).toBe(200);
        expect(body).toEqual(result);
    });

    test("aceita data e hora separadas por T", async () => {
        const list = jest.spyOn(logService, "listLogs")
            .mockResolvedValue({ total: 0, limit: 50, offset: 0, logs: [] });

        await invoke(controller.listLogs, {
            query: { from: "2026-01-01T10:20:30", to: "2026-01-31 23:00:00" }
        });

        expect(list).toHaveBeenCalledWith({
            reference_id: null,
            id_user: null,
            status: null,
            operation: null,
            table: null,
            from: "2026-01-01 10:20:30",
            to: "2026-01-31 23:00:00",
            limit: undefined,
            offset: undefined
        });
    });

    test("consulta sem filtros enviando nulos e paginação indefinida", async () => {
        const result = { total: 0, limit: 50, offset: 0, logs: [] };
        const list = jest.spyOn(logService, "listLogs").mockResolvedValue(result);

        const { status, body } = await invoke(controller.listLogs);

        expect(list).toHaveBeenCalledWith({
            reference_id: null,
            id_user: null,
            status: null,
            operation: null,
            table: null,
            from: null,
            to: null,
            limit: undefined,
            offset: undefined
        });
        expect(status).toBe(200);
        expect(body).toEqual(result);
    });

    test("aceita limit no limite máximo do service", async () => {
        const list = jest.spyOn(logService, "listLogs")
            .mockResolvedValue({ total: 0, limit: 200, offset: 0, logs: [] });

        const { status } = await invoke(controller.listLogs, { query: { limit: "200" } });

        expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
        expect(status).toBe(200);
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(logService, "listLogs").mockRejectedValue(unexpectedError("COUNT travou"));

        const { status, body } = await invoke(controller.listLogs);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar os logs." });
    });
});

describe("logController.getLogById", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const getById = jest.spyOn(logService, "getLogById");

        const { status, body } = await invoke(controller.getLogById, {
            params: { id: "log-1" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do log inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("devolve o log encontrado", async () => {
        const getById = jest.spyOn(logService, "getLogById").mockResolvedValue(LOG);

        const { status, body } = await invoke(controller.getLogById, {
            params: { id: OTHER_ID }
        });

        expect(getById).toHaveBeenCalledWith(OTHER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(LOG);
    });

    test("responde 404 quando o log não existe", async () => {
        jest.spyOn(logService, "getLogById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getLogById, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Log não encontrado." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(logService, "getLogById").mockRejectedValue(unexpectedError("BIN_TO_UUID falhou"));

        const { status, body } = await invoke(controller.getLogById, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar o log." });
    });
});

describe("logController.updateLog", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const update = jest.spyOn(logService, "updateLog");

        const { status, body } = await invoke(controller.updateLog, {
            params: { id: "log-1" },
            body: { status: "500" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do log inválido." });
        expect(update).not.toHaveBeenCalled();
    });

    test("recusa 400 quando nenhum campo editável é enviado", async () => {
        const update = jest.spyOn(logService, "updateLog");

        const { status, body } = await invoke(controller.updateLog, {
            params: { id: OTHER_ID },
            body: {}
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Informe ao menos um campo para atualizar: status, operation, table ou description."
        });
        expect(update).not.toHaveBeenCalled();
    });

    test("ignora reference_id e id_user no corpo", async () => {
        const update = jest.spyOn(logService, "updateLog");

        const { status, body } = await invoke(controller.updateLog, {
            params: { id: OTHER_ID },
            body: { reference_id: OTHER_ID, id_user: OTHER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Informe ao menos um campo para atualizar: status, operation, table ou description."
        });
        expect(update).not.toHaveBeenCalled();
    });

    test("recusa 400 quando status enviado passa de 50 caracteres", async () => {
        const update = jest.spyOn(logService, "updateLog");

        const { status, body } = await invoke(controller.updateLog, {
            params: { id: OTHER_ID },
            body: { status: "a".repeat(51) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "status deve ter no máximo 50 caracteres." });
        expect(update).not.toHaveBeenCalled();
    });

    test("atualiza o log com os textos aparados", async () => {
        const updated = { ...LOG, status: "500" };
        const update = jest.spyOn(logService, "updateLog").mockResolvedValue(updated);

        const { status, body } = await invoke(controller.updateLog, {
            params: { id: OTHER_ID },
            body: { status: " 500 ", description: " Falha interna " }
        });

        expect(update).toHaveBeenCalledWith(OTHER_ID, {
            status: "500",
            description: "Falha interna"
        });
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Log atualizado com sucesso.", log: updated });
    });

    test("responde 404 quando o log não existe", async () => {
        jest.spyOn(logService, "updateLog").mockResolvedValue(null);

        const { status, body } = await invoke(controller.updateLog, {
            params: { id: OTHER_ID },
            body: { operation: "delete" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Log não encontrado." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(logService, "updateLog").mockRejectedValue(unexpectedError("UPDATE sem permissão"));

        const { status, body } = await invoke(controller.updateLog, {
            params: { id: OTHER_ID },
            body: { operation: "delete" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar o log." });
    });
});

describe("logController.deleteLog", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const remove = jest.spyOn(logService, "deleteLog");

        const { status, body } = await invoke(controller.deleteLog, {
            params: { id: "log-1" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do log inválido." });
        expect(remove).not.toHaveBeenCalled();
    });

    test("exclui o log e responde 200", async () => {
        const remove = jest.spyOn(logService, "deleteLog").mockResolvedValue(true);

        const { status, body } = await invoke(controller.deleteLog, {
            params: { id: OTHER_ID }
        });

        expect(remove).toHaveBeenCalledWith(OTHER_ID);
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Log excluído com sucesso." });
    });

    test("responde 404 quando o log não existe", async () => {
        jest.spyOn(logService, "deleteLog").mockResolvedValue(false);

        const { status, body } = await invoke(controller.deleteLog, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Log não encontrado." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(logService, "deleteLog").mockRejectedValue(unexpectedError("FK impediu o DELETE"));

        const { status, body } = await invoke(controller.deleteLog, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir o log." });
    });
});
