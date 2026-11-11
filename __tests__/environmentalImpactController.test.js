"use strict";

const service = require("../src/services/environmentalImpactService");
const uuid = require("../src/utils/uuid");
const controller = require("../src/controllers/environmentalImpactController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

/** Erro no formato usado pelo service: `error.code` (sem `status`). */
function codedError(code, message) {
    return Object.assign(new Error(message), { code });
}

const IMPACT = {
    id: OTHER_ID,
    estimated_weight_kg: 12.5,
    co2_saved_kg: 3.2,
    water_saved_liters: 40,
    energy_saved_kwh: 1.1,
    calculation_method: "regra_fixa",
    calculated_in: "2026-11-01 10:00:00",
    id_shopping: USER_ID
};

describe("environmentalImpactController.createImpact", () => {
    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const create = jest.spyOn(service, "createImpact");

        const { status, body } = await invoke(controller.createImpact, {
            userId: "sem-uuid",
            body: { id_shopping: USER_ID, calculation_method: "regra_fixa" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 sem id_shopping", async () => {
        const create = jest.spyOn(service, "createImpact");

        const { status, body } = await invoke(controller.createImpact, {
            body: { calculation_method: "regra_fixa" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "O campo id_shopping é obrigatório." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 sem calculation_method", async () => {
        const create = jest.spyOn(service, "createImpact");

        const { status, body } = await invoke(controller.createImpact, {
            body: { id_shopping: USER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "O campo calculation_method é obrigatório. Valores aceitos: regra_fixa, ia."
        });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando id_shopping não é UUID", async () => {
        const create = jest.spyOn(service, "createImpact");

        const { status, body } = await invoke(controller.createImpact, {
            body: { id_shopping: "compra-1", calculation_method: "regra_fixa" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra inválido." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 400 quando o método de cálculo não é aceito", async () => {
        const create = jest.spyOn(service, "createImpact");

        const { status, body } = await invoke(controller.createImpact, {
            body: { id_shopping: USER_ID, calculation_method: "manual" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Método de cálculo inválido. Valores aceitos: regra_fixa, ia."
        });
        expect(create).not.toHaveBeenCalled();
    });

    test("registra o impacto e responde 201 repassando usuário e papel", async () => {
        const create = jest.spyOn(service, "createImpact").mockResolvedValue(IMPACT);

        const { status, body } = await invoke(controller.createImpact, {
            role: "company",
            body: { id_shopping: USER_ID, calculation_method: "regra_fixa" }
        });

        expect(create).toHaveBeenCalledWith({
            id_shopping: USER_ID,
            calculation_method: "regra_fixa",
            requestedBy: USER_ID,
            role: "company"
        });
        expect(status).toBe(201);
        expect(body).toEqual({
            message: "Impacto ambiental registrado com sucesso.",
            impact: IMPACT
        });
    });

    test.each([
        ["SHOPPING_NOT_FOUND", "Compra não encontrada.", 404],
        ["FORBIDDEN", "Você não tem autorização para registrar o impacto ambiental desta compra.", 403],
        ["SHOPPING_NOT_ELIGIBLE", "Somente compras com status 'accepted' ou 'completed' geram impacto ambiental.", 409],
        ["IMPACT_ALREADY_EXISTS", "Esta compra já possui um registro de impacto ambiental.", 409],
        ["IA_NOT_IMPLEMENTED", "O método 'ia' ainda não possui integração ativa com serviço externo. Utilize 'regra_fixa'.", 501],
        ["NO_ITEMS", "A compra não possui itens para calcular o impacto ambiental.", 422],
        ["ZERO_WEIGHT", "O peso total da compra é zero; não há impacto a calcular.", 422]
    ])("mapeia o código %s para HTTP %i com a mensagem do service", async (code, message, expectedStatus) => {
        jest.spyOn(service, "createImpact").mockRejectedValue(codedError(code, message));

        const { status, body } = await invoke(controller.createImpact, {
            body: { id_shopping: USER_ID, calculation_method: "regra_fixa" }
        });

        expect(status).toBe(expectedStatus);
        expect(body).toEqual({ error: message });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(service, "createImpact")
            .mockRejectedValue(unexpectedError("ECONNREFUSED 3306"));

        const { status, body } = await invoke(controller.createImpact, {
            body: { id_shopping: USER_ID, calculation_method: "regra_fixa" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao registrar impacto ambiental." });
    });
});

describe("environmentalImpactController.getImpacts", () => {
    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const getImpacts = jest.spyOn(service, "getImpacts");

        const { status, body } = await invoke(controller.getImpacts, { userId: null });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(getImpacts).not.toHaveBeenCalled();
    });

    test("lista repassando usuário e papel para o filtro do service", async () => {
        const getImpacts = jest.spyOn(service, "getImpacts").mockResolvedValue([IMPACT]);

        const { status, body } = await invoke(controller.getImpacts, { role: "admin" });

        expect(getImpacts).toHaveBeenCalledWith(USER_ID, "admin");
        expect(status).toBe(200);
        expect(body).toEqual([IMPACT]);
    });

    test("responde 500 com mensagem própria quando o service falha", async () => {
        jest.spyOn(service, "getImpacts").mockRejectedValue(unexpectedError("tabela travada"));

        const { status, body } = await invoke(controller.getImpacts);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao listar impactos ambientais." });
    });
});

describe("environmentalImpactController.getImpactById", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const getById = jest.spyOn(service, "getImpactById");

        const { status, body } = await invoke(controller.getImpactById, {
            params: { id: "impacto-1" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do impacto inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const getById = jest.spyOn(service, "getImpactById");

        const { status, body } = await invoke(controller.getImpactById, {
            params: { id: OTHER_ID },
            userId: null
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("busca o impacto convertendo o UUID para binário", async () => {
        const getById = jest.spyOn(service, "getImpactById").mockResolvedValue(IMPACT);

        const { status, body } = await invoke(controller.getImpactById, {
            params: { id: OTHER_ID },
            role: "user"
        });

        expect(getById).toHaveBeenCalledWith(uuid.toBin(OTHER_ID), USER_ID, "user");
        expect(status).toBe(200);
        expect(body).toEqual(IMPACT);
    });

    test("responde 404 quando o service retorna null", async () => {
        jest.spyOn(service, "getImpactById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getImpactById, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Registro de impacto ambiental não encontrado." });
    });

    test("mapeia FORBIDDEN para 403 com a mensagem do service", async () => {
        jest.spyOn(service, "getImpactById").mockRejectedValue(
            codedError("FORBIDDEN", "Você não tem autorização para consultar este impacto ambiental.")
        );

        const { status, body } = await invoke(controller.getImpactById, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Você não tem autorização para consultar este impacto ambiental." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(service, "getImpactById").mockRejectedValue(unexpectedError("Buffer inválido"));

        const { status, body } = await invoke(controller.getImpactById, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar impacto ambiental." });
    });
});

describe("environmentalImpactController.getImpactByShopping", () => {
    test("recusa 400 quando o ID da compra não é UUID", async () => {
        const getByShopping = jest.spyOn(service, "getImpactByShopping");

        const { status, body } = await invoke(controller.getImpactByShopping, {
            params: { idShopping: "compra-x" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra inválido." });
        expect(getByShopping).not.toHaveBeenCalled();
    });

    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const getByShopping = jest.spyOn(service, "getImpactByShopping");

        const { status, body } = await invoke(controller.getImpactByShopping, {
            params: { idShopping: OTHER_ID },
            userId: "x"
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(getByShopping).not.toHaveBeenCalled();
    });

    test("busca por compra convertendo o UUID para binário", async () => {
        const getByShopping = jest.spyOn(service, "getImpactByShopping").mockResolvedValue(IMPACT);

        const { status, body } = await invoke(controller.getImpactByShopping, {
            params: { idShopping: OTHER_ID },
            role: "company"
        });

        expect(getByShopping).toHaveBeenCalledWith(uuid.toBin(OTHER_ID), USER_ID, "company");
        expect(status).toBe(200);
        expect(body).toEqual(IMPACT);
    });

    test.each([
        ["SHOPPING_NOT_FOUND", "Compra não encontrada.", 404],
        ["IMPACT_NOT_FOUND", "Nenhum impacto ambiental registrado para esta compra.", 404],
        ["FORBIDDEN", "Você não tem autorização para consultar o impacto ambiental desta compra.", 403]
    ])("mapeia o código %s para HTTP %i", async (code, message, expectedStatus) => {
        jest.spyOn(service, "getImpactByShopping").mockRejectedValue(codedError(code, message));

        const { status, body } = await invoke(controller.getImpactByShopping, {
            params: { idShopping: OTHER_ID }
        });

        expect(status).toBe(expectedStatus);
        expect(body).toEqual({ error: message });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(service, "getImpactByShopping")
            .mockRejectedValue(unexpectedError("erro de leitura no replica"));

        const { status, body } = await invoke(controller.getImpactByShopping, {
            params: { idShopping: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar impacto ambiental da compra." });
    });
});

describe("environmentalImpactController.updateImpact", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const update = jest.spyOn(service, "updateImpact");

        const { status, body } = await invoke(controller.updateImpact, {
            params: { id: "0" },
            body: { recalculate: true }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do impacto inválido." });
        expect(update).not.toHaveBeenCalled();
    });

    test("responde 401 quando o token não traz UUID de usuário", async () => {
        const update = jest.spyOn(service, "updateImpact");

        const { status, body } = await invoke(controller.updateImpact, {
            params: { id: OTHER_ID },
            userId: null,
            body: { recalculate: true }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(update).not.toHaveBeenCalled();
    });

    test("recusa 400 quando nenhum campo é informado", async () => {
        const update = jest.spyOn(service, "updateImpact");

        const { status, body } = await invoke(controller.updateImpact, {
            params: { id: OTHER_ID },
            body: { id_shopping: OTHER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Informe ao menos um campo válido para atualizar ou 'recalculate: true'."
        });
        expect(update).not.toHaveBeenCalled();
    });

    test("atualiza o impacto convertendo o UUID para binário", async () => {
        const update = jest.spyOn(service, "updateImpact").mockResolvedValue(IMPACT);

        const { status, body } = await invoke(controller.updateImpact, {
            params: { id: OTHER_ID },
            body: { estimated_weight_kg: 12.5, recalculate: true }
        });

        expect(update).toHaveBeenCalledWith(uuid.toBin(OTHER_ID), {
            estimated_weight_kg: 12.5,
            co2_saved_kg: undefined,
            water_saved_liters: undefined,
            energy_saved_kwh: undefined,
            calculation_method: undefined,
            recalculate: true
        });
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Impacto ambiental atualizado com sucesso.",
            impact: IMPACT
        });
    });

    test.each([
        ["NOT_FOUND", "Registro de impacto ambiental não encontrado.", 404],
        ["FORBIDDEN", "Você não tem permissão para atualizar este impacto.", 403],
        ["INVALID_VALUE", "estimated_weight_kg deve ser um número não negativo.", 400],
        ["INVALID_METHOD", "Método de cálculo inválido.", 400],
        ["NO_FIELDS", "Nenhum campo válido para atualizar.", 400],
        ["NO_ITEMS", "A compra não possui itens para recalcular.", 422]
    ])("mapeia o código %s para HTTP %i", async (code, message, expectedStatus) => {
        jest.spyOn(service, "updateImpact").mockRejectedValue(codedError(code, message));

        const { status, body } = await invoke(controller.updateImpact, {
            params: { id: OTHER_ID },
            body: { recalculate: true }
        });

        expect(status).toBe(expectedStatus);
        expect(body).toEqual({ error: message });
    });

    test("não verifica o papel na controller: usuário comum chega ao service", async () => {
        const update = jest.spyOn(service, "updateImpact").mockResolvedValue(IMPACT);

        const { status } = await invoke(controller.updateImpact, {
            params: { id: OTHER_ID },
            role: "user",
            body: { recalculate: true }
        });

        expect(update).toHaveBeenCalledTimes(1);
        expect(status).toBe(200);
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(service, "updateImpact")
            .mockRejectedValue(unexpectedError("conexão encerrada pelo servidor"));

        const { status, body } = await invoke(controller.updateImpact, {
            params: { id: OTHER_ID },
            body: { recalculate: true }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar impacto ambiental." });
    });
});
