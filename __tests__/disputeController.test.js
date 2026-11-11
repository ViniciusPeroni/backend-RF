"use strict";

const disputeService = require("../src/services/disputeService");
const uuid = require("../src/utils/uuid");
const controller = require("../src/controllers/disputeController");
const { invoke, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

/** Erro no formato usado pelo service: `error.code` (sem `status`). */
function codedError(code, message) {
    return Object.assign(new Error(message), { code });
}

const DISPUTE = {
    id: OTHER_ID,
    type: "material_incompativel",
    description: "Material recebido diferente do anúncio.",
    status: "aberta",
    resolution: null,
    created_in: "2026-11-01 10:00:00",
    updated_in: "2026-11-01 10:00:00",
    resolved_in: null,
    id_shopping: USER_ID,
    id_opened_by: USER_ID,
    id_resolved_by: null
};

const VALID_TYPES_MESSAGE =
    "Tipo de disputa inválido. Valores aceitos: material_incompativel, nao_retirado, nao_comparecimento, comportamento_inadequado, item_danificado, outro.";

describe("disputeController.createDispute", () => {
    test("recusa 400 quando falta algum campo obrigatório", async () => {
        const create = jest.spyOn(disputeService, "createDispute");

        const { status, body } = await invoke(controller.createDispute, {
            body: { type: "outro", description: "Problema no item" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Os campos type, description e id_shopping são obrigatórios." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando a descrição é só espaços", async () => {
        const create = jest.spyOn(disputeService, "createDispute");

        const { status, body } = await invoke(controller.createDispute, {
            body: { type: "outro", description: "   ", id_shopping: USER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A descrição não pode ser vazia." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando o tipo não está na lista aceita", async () => {
        const create = jest.spyOn(disputeService, "createDispute");

        const { status, body } = await invoke(controller.createDispute, {
            body: { type: "reclamacao", description: "Item quebrado", id_shopping: USER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: VALID_TYPES_MESSAGE });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando id_shopping não é UUID", async () => {
        const create = jest.spyOn(disputeService, "createDispute");

        const { status, body } = await invoke(controller.createDispute, {
            body: { type: "outro", description: "Item quebrado", id_shopping: "compra-1" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra inválido." });
        expect(create).not.toHaveBeenCalled();
    });

    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const create = jest.spyOn(disputeService, "createDispute");

        const { status, body } = await invoke(controller.createDispute, {
            userId: "sem-uuid",
            body: { type: "outro", description: "Item quebrado", id_shopping: USER_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(create).not.toHaveBeenCalled();
    });

    test("abre a disputa usando o usuário do token como autor", async () => {
        const create = jest.spyOn(disputeService, "createDispute").mockResolvedValue(OTHER_ID);

        const { status, body } = await invoke(controller.createDispute, {
            body: { type: "outro", description: "Item quebrado", id_shopping: USER_ID }
        });

        expect(create).toHaveBeenCalledWith({
            type: "outro",
            description: "Item quebrado",
            id_shopping: USER_ID,
            id_opened_by: USER_ID
        });
        expect(status).toBe(201);
        expect(body).toEqual({ message: "Disputa aberta com sucesso.", id: OTHER_ID });
    });

    test("ignora id_opened_by enviado no corpo", async () => {
        const create = jest.spyOn(disputeService, "createDispute").mockResolvedValue(OTHER_ID);

        await invoke(controller.createDispute, {
            body: {
                type: "outro",
                description: "Item quebrado",
                id_shopping: USER_ID,
                id_opened_by: OTHER_ID
            }
        });

        expect(create).toHaveBeenCalledWith({
            type: "outro",
            description: "Item quebrado",
            id_shopping: USER_ID,
            id_opened_by: USER_ID
        });
    });

    test("mapeia SHOPPING_NOT_FOUND para 404 com mensagem fixa da controller", async () => {
        jest.spyOn(disputeService, "createDispute")
            .mockRejectedValue(codedError("SHOPPING_NOT_FOUND", "detalhe interno da consulta"));

        const { status, body } = await invoke(controller.createDispute, {
            body: { type: "outro", description: "Item quebrado", id_shopping: USER_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Compra não encontrada." });
    });

    test("mapeia DISPUTE_NOT_ALLOWED para 403 com a mensagem do service", async () => {
        jest.spyOn(disputeService, "createDispute").mockRejectedValue(codedError(
            "DISPUTE_NOT_ALLOWED",
            "Você não possui vínculo com esta compra e não pode abrir uma disputa."
        ));

        const { status, body } = await invoke(controller.createDispute, {
            body: { type: "outro", description: "Item quebrado", id_shopping: USER_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({
            error: "Você não possui vínculo com esta compra e não pode abrir uma disputa."
        });
    });

    test("mapeia DISPUTE_ALREADY_EXISTS para 409 com a mensagem do service", async () => {
        jest.spyOn(disputeService, "createDispute").mockRejectedValue(codedError(
            "DISPUTE_ALREADY_EXISTS",
            "Você já possui uma disputa ativa para esta compra."
        ));

        const { status, body } = await invoke(controller.createDispute, {
            body: { type: "outro", description: "Item quebrado", id_shopping: USER_ID }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Você já possui uma disputa ativa para esta compra." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(disputeService, "createDispute")
            .mockRejectedValue(unexpectedError("rollback falhou"));

        const { status, body } = await invoke(controller.createDispute, {
            body: { type: "outro", description: "Item quebrado", id_shopping: USER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao abrir disputa." });
    });
});

describe("disputeController.getDisputes", () => {
    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const getDisputes = jest.spyOn(disputeService, "getDisputes");

        const { status, body } = await invoke(controller.getDisputes, { userId: "" });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(getDisputes).not.toHaveBeenCalled();
    });

    test("lista disputas de usuário comum repassando o papel", async () => {
        const getDisputes = jest.spyOn(disputeService, "getDisputes").mockResolvedValue([DISPUTE]);

        const { status, body } = await invoke(controller.getDisputes, { role: "user" });

        expect(getDisputes).toHaveBeenCalledWith(USER_ID, "user");
        expect(status).toBe(200);
        expect(body).toEqual([DISPUTE]);
    });

    test("lista todas as disputas quando o papel é admin", async () => {
        const getDisputes = jest.spyOn(disputeService, "getDisputes").mockResolvedValue([]);

        const { status, body } = await invoke(controller.getDisputes, { role: "admin" });

        expect(getDisputes).toHaveBeenCalledWith(USER_ID, "admin");
        expect(status).toBe(200);
        expect(body).toEqual([]);
    });

    test("responde 500 com mensagem própria quando o service falha", async () => {
        jest.spyOn(disputeService, "getDisputes").mockRejectedValue(unexpectedError("pool sem conexão"));

        const { status, body } = await invoke(controller.getDisputes);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar disputas." });
    });
});

describe("disputeController.getDisputeById", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const getById = jest.spyOn(disputeService, "getDisputeById");

        const { status, body } = await invoke(controller.getDisputeById, {
            params: { id: "disputa-1" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da disputa inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const getById = jest.spyOn(disputeService, "getDisputeById");

        const { status, body } = await invoke(controller.getDisputeById, {
            params: { id: OTHER_ID },
            userId: null
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("busca a disputa convertendo o UUID e repassando usuário e papel", async () => {
        const getById = jest.spyOn(disputeService, "getDisputeById").mockResolvedValue(DISPUTE);

        const { status, body } = await invoke(controller.getDisputeById, {
            params: { id: OTHER_ID },
            role: "admin"
        });

        expect(getById).toHaveBeenCalledWith(uuid.toBin(OTHER_ID), USER_ID, "admin");
        expect(status).toBe(200);
        expect(body).toEqual(DISPUTE);
    });

    test("responde 404 quando o service retorna null", async () => {
        jest.spyOn(disputeService, "getDisputeById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getDisputeById, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Disputa não encontrada." });
    });

    test("mapeia FORBIDDEN para 403 com mensagem fixa da controller", async () => {
        jest.spyOn(disputeService, "getDisputeById")
            .mockRejectedValue(codedError("FORBIDDEN", "Acesso negado."));

        const { status, body } = await invoke(controller.getDisputeById, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Você não tem acesso a esta disputa." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(disputeService, "getDisputeById")
            .mockRejectedValue(unexpectedError("uuid binário corrompido"));

        const { status, body } = await invoke(controller.getDisputeById, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar disputa." });
    });
});

describe("disputeController.updateDispute", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const update = jest.spyOn(disputeService, "updateDispute");

        const { status, body } = await invoke(controller.updateDispute, {
            params: { id: "x" },
            body: { description: "Nova descrição" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da disputa inválido." });
        expect(update).not.toHaveBeenCalled();
    });

    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const update = jest.spyOn(disputeService, "updateDispute");

        const { status, body } = await invoke(controller.updateDispute, {
            params: { id: OTHER_ID },
            userId: null,
            body: { description: "Nova descrição" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(update).not.toHaveBeenCalled();
    });

    test("recusa 400 quando nenhum campo é informado", async () => {
        const update = jest.spyOn(disputeService, "updateDispute");

        const { status, body } = await invoke(controller.updateDispute, {
            params: { id: OTHER_ID },
            body: { id_shopping: OTHER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Informe ao menos um campo para atualizar: type, description ou status."
        });
        expect(update).not.toHaveBeenCalled();
    });

    test("recusa 400 quando a descrição enviada é vazia", async () => {
        const update = jest.spyOn(disputeService, "updateDispute");

        const { status, body } = await invoke(controller.updateDispute, {
            params: { id: OTHER_ID },
            body: { description: "  " }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A descrição não pode ser vazia." });
        expect(update).not.toHaveBeenCalled();
    });

    test("atualiza repassando usuário e papel (autorização fica no service)", async () => {
        const updated = { ...DISPUTE, description: "Nova descrição" };
        const update = jest.spyOn(disputeService, "updateDispute").mockResolvedValue(updated);

        const { status, body } = await invoke(controller.updateDispute, {
            params: { id: OTHER_ID },
            role: "user",
            body: { description: "Nova descrição" }
        });

        expect(update).toHaveBeenCalledWith(
            uuid.toBin(OTHER_ID),
            { type: undefined, description: "Nova descrição", status: undefined },
            USER_ID,
            "user"
        );
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Disputa atualizada com sucesso.",
            dispute: updated
        });
    });

    test("repassa status quando quem edita é admin", async () => {
        const updated = { ...DISPUTE, status: "em_analise" };
        const update = jest.spyOn(disputeService, "updateDispute").mockResolvedValue(updated);

        const { status } = await invoke(controller.updateDispute, {
            params: { id: OTHER_ID },
            role: "admin",
            body: { status: "em_analise" }
        });

        expect(update).toHaveBeenCalledWith(
            uuid.toBin(OTHER_ID),
            { type: undefined, description: undefined, status: "em_analise" },
            USER_ID,
            "admin"
        );
        expect(status).toBe(200);
    });

    test.each([
        ["NOT_FOUND", "Disputa não encontrada.", 404],
        ["FORBIDDEN", "Usuários comuns não têm permissão para alterar o status da disputa.", 403],
        ["NO_FIELDS", "Nenhum campo válido para atualizar.", 400],
        ["DISPUTE_FINALIZED", "Não é possível alterar uma disputa já finalizada.", 409],
        ["DISPUTE_STATUS_CONFLICT", "O status da disputa mudou durante a atualização. Consulte a disputa novamente.", 409],
        ["INVALID_TYPE", "Tipo de disputa inválido.", 400],
        ["INVALID_STATUS", "Status inválido.", 400],
        ["USE_SPECIFIC_ENDPOINT", "Use as operações específicas de resolução ou rejeição para finalizar uma disputa.", 400]
    ])("mapeia o código %s para HTTP %i", async (code, message, expectedStatus) => {
        jest.spyOn(disputeService, "updateDispute").mockRejectedValue(codedError(code, message));

        const { status, body } = await invoke(controller.updateDispute, {
            params: { id: OTHER_ID },
            body: { description: "Nova descrição" }
        });

        expect(status).toBe(expectedStatus);
        expect(body).toEqual({ error: message });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(disputeService, "updateDispute")
            .mockRejectedValue(unexpectedError("lock wait timeout"));

        const { status, body } = await invoke(controller.updateDispute, {
            params: { id: OTHER_ID },
            body: { description: "Nova descrição" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar disputa." });
    });
});

describe("disputeController.resolveDispute", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const resolve = jest.spyOn(disputeService, "resolveDispute");

        const { status, body } = await invoke(controller.resolveDispute, {
            params: { id: "abc" },
            body: { resolution: "Reembolso aprovado" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da disputa inválido." });
        expect(resolve).not.toHaveBeenCalled();
    });

    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const resolve = jest.spyOn(disputeService, "resolveDispute");

        const { status, body } = await invoke(controller.resolveDispute, {
            params: { id: OTHER_ID },
            userId: null,
            body: { resolution: "Reembolso aprovado" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(resolve).not.toHaveBeenCalled();
    });

    test.each([
        ["ausente", {}],
        ["vazia", { resolution: "   " }]
    ])("recusa 400 quando a resolução está %s", async (_label, body) => {
        const resolve = jest.spyOn(disputeService, "resolveDispute");

        const { status, body: responseBody } = await invoke(controller.resolveDispute, {
            params: { id: OTHER_ID },
            body
        });

        expect(status).toBe(400);
        expect(responseBody).toEqual({
            error: "O campo resolution é obrigatório para resolver uma disputa."
        });
        expect(resolve).not.toHaveBeenCalled();
    });

    test("resolve a disputa e responde 200", async () => {
        const resolved = { ...DISPUTE, status: "resolvida", resolution: "Reembolso aprovado" };
        const resolve = jest.spyOn(disputeService, "resolveDispute").mockResolvedValue(resolved);

        const { status, body } = await invoke(controller.resolveDispute, {
            params: { id: OTHER_ID },
            role: "admin",
            body: { resolution: "Reembolso aprovado" }
        });

        expect(resolve).toHaveBeenCalledWith(uuid.toBin(OTHER_ID), "Reembolso aprovado", USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Disputa resolvida com sucesso.",
            dispute: resolved
        });
    });

    test("responde 404 quando o service retorna null", async () => {
        jest.spyOn(disputeService, "resolveDispute").mockResolvedValue(null);

        const { status, body } = await invoke(controller.resolveDispute, {
            params: { id: OTHER_ID },
            body: { resolution: "Reembolso aprovado" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Disputa não encontrada." });
    });

    test("mapeia DISPUTE_ALREADY_FINAL para 409", async () => {
        jest.spyOn(disputeService, "resolveDispute").mockRejectedValue(codedError(
            "DISPUTE_ALREADY_FINAL",
            "Esta disputa já foi finalizada e não pode ser resolvida novamente."
        ));

        const { status, body } = await invoke(controller.resolveDispute, {
            params: { id: OTHER_ID },
            body: { resolution: "Reembolso aprovado" }
        });

        expect(status).toBe(409);
        expect(body).toEqual({
            error: "Esta disputa já foi finalizada e não pode ser resolvida novamente."
        });
    });

    test("não verifica o papel na controller: usuário comum chega ao service", async () => {
        const resolve = jest.spyOn(disputeService, "resolveDispute")
            .mockResolvedValue({ ...DISPUTE, status: "resolvida" });

        const { status } = await invoke(controller.resolveDispute, {
            params: { id: OTHER_ID },
            role: "user",
            body: { resolution: "Reembolso aprovado" }
        });

        expect(resolve).toHaveBeenCalledTimes(1);
        expect(status).toBe(200);
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(disputeService, "resolveDispute")
            .mockRejectedValue(unexpectedError("deadlock na transação"));

        const { status, body } = await invoke(controller.resolveDispute, {
            params: { id: OTHER_ID },
            body: { resolution: "Reembolso aprovado" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao resolver disputa." });
    });
});

describe("disputeController.rejectDispute", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const reject = jest.spyOn(disputeService, "rejectDispute");

        const { status, body } = await invoke(controller.rejectDispute, {
            params: { id: "abc" },
            body: { resolution: "Sem evidências" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da disputa inválido." });
        expect(reject).not.toHaveBeenCalled();
    });

    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const reject = jest.spyOn(disputeService, "rejectDispute");

        const { status, body } = await invoke(controller.rejectDispute, {
            params: { id: OTHER_ID },
            userId: "x",
            body: { resolution: "Sem evidências" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(reject).not.toHaveBeenCalled();
    });

    test.each([
        ["ausente", {}],
        ["vazia", { resolution: "" }]
    ])("recusa 400 quando a justificativa está %s", async (_label, body) => {
        const reject = jest.spyOn(disputeService, "rejectDispute");

        const { status, body: responseBody } = await invoke(controller.rejectDispute, {
            params: { id: OTHER_ID },
            body
        });

        expect(status).toBe(400);
        expect(responseBody).toEqual({
            error: "O campo resolution (justificativa) é obrigatório para rejeitar uma disputa."
        });
        expect(reject).not.toHaveBeenCalled();
    });

    test("rejeita a disputa e responde 200", async () => {
        const rejected = { ...DISPUTE, status: "rejeitada", resolution: "Sem evidências" };
        const reject = jest.spyOn(disputeService, "rejectDispute").mockResolvedValue(rejected);

        const { status, body } = await invoke(controller.rejectDispute, {
            params: { id: OTHER_ID },
            role: "admin",
            body: { resolution: "Sem evidências" }
        });

        expect(reject).toHaveBeenCalledWith(uuid.toBin(OTHER_ID), "Sem evidências", USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Disputa rejeitada com sucesso.",
            dispute: rejected
        });
    });

    test("responde 404 quando o service retorna null", async () => {
        jest.spyOn(disputeService, "rejectDispute").mockResolvedValue(null);

        const { status, body } = await invoke(controller.rejectDispute, {
            params: { id: OTHER_ID },
            body: { resolution: "Sem evidências" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Disputa não encontrada." });
    });

    test("mapeia DISPUTE_ALREADY_FINAL para 409", async () => {
        jest.spyOn(disputeService, "rejectDispute").mockRejectedValue(codedError(
            "DISPUTE_ALREADY_FINAL",
            "Esta disputa já foi finalizada e não pode ser rejeitada novamente."
        ));

        const { status, body } = await invoke(controller.rejectDispute, {
            params: { id: OTHER_ID },
            body: { resolution: "Sem evidências" }
        });

        expect(status).toBe(409);
        expect(body).toEqual({
            error: "Esta disputa já foi finalizada e não pode ser rejeitada novamente."
        });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(disputeService, "rejectDispute")
            .mockRejectedValue(unexpectedError("falha ao gravar resolution"));

        const { status, body } = await invoke(controller.rejectDispute, {
            params: { id: OTHER_ID },
            body: { resolution: "Sem evidências" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao rejeitar disputa." });
    });
});
