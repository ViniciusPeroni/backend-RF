"use strict";

const loc = require("../src/services/localizationService");
const controller = require("../src/controllers/localizationController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const LOCATION = {
    id: OTHER_ID,
    zip_code: "14400000",
    street: "Rua das Flores",
    neighborhood: "Centro",
    number: "10",
    city: "Franca",
    state: "SP",
    latitude: -20.5391,
    longitude: -47.4008,
    id_user: USER_ID
};

describe("localizationController.getCompaniesForMap", () => {
    test("devolve 200 com a lista de empresas do service", async () => {
        const companies = [
            {
                id: OTHER_ID,
                companyId: USER_ID,
                name: "Empresa Teste",
                neighborhood: "Centro",
                city: "Franca",
                state: "SP",
                latitude: -20.54,
                longitude: -47.4,
                categories: ["papel"],
                availableProducts: 2
            }
        ];
        const getCompanies = jest.spyOn(loc, "getCompaniesForMap").mockResolvedValue(companies);

        const { status, body } = await invoke(controller.getCompaniesForMap);

        expect(getCompanies).toHaveBeenCalledTimes(1);
        expect(status).toBe(200);
        expect(body).toEqual(companies);
    });

    test("responde 500 com mensagem própria quando o service falha", async () => {
        jest.spyOn(loc, "getCompaniesForMap")
            .mockRejectedValue(unexpectedError("conexão perdida com o MySQL"));

        const { status, body } = await invoke(controller.getCompaniesForMap);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar empresas para o mapa." });
    });
});

describe("localizationController.createLocalization", () => {
    test("recusa 403 quando o corpo traz userId de outra pessoa", async () => {
        const create = jest.spyOn(loc, "createLocalization");

        const { status, body } = await invoke(controller.createLocalization, {
            body: { userId: OTHER_ID, zipCode: "14400000" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Você só pode criar localizações para o próprio usuário." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa 403 quando o corpo não informa userId", async () => {
        const create = jest.spyOn(loc, "createLocalization");

        const { status, body } = await invoke(controller.createLocalization, {
            body: { zipCode: "14400000" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Você só pode criar localizações para o próprio usuário." });
        expect(create).not.toHaveBeenCalled();
    });

    test("cria a localização do próprio usuário e responde 201", async () => {
        const body = {
            userId: USER_ID,
            zipCode: "14400000",
            street: "Rua das Flores",
            neighborhood: "Centro",
            number: 10,
            city: "Franca",
            state: "SP"
        };
        const create = jest.spyOn(loc, "createLocalization").mockResolvedValue(OTHER_ID);

        const { status, body: responseBody } = await invoke(controller.createLocalization, { body });

        expect(create).toHaveBeenCalledWith(body);
        expect(status).toBe(201);
        expect(responseBody).toEqual({ message: "Localização criada com sucesso.", id: OTHER_ID });
    });

    test("repassa status e mensagem de erro de validação do service", async () => {
        jest.spyOn(loc, "createLocalization")
            .mockRejectedValue(serviceError("CEP inválido. Deve conter 8 dígitos numéricos (sem hífen)", 400));

        const { status, body } = await invoke(controller.createLocalization, {
            body: { userId: USER_ID, zipCode: "1440-000" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "CEP inválido. Deve conter 8 dígitos numéricos (sem hífen)" });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(loc, "createLocalization")
            .mockRejectedValue(unexpectedError("pool esgotado"));

        const { status, body } = await invoke(controller.createLocalization, {
            body: { userId: USER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro interno ao criar localização." });
    });
});

describe("localizationController.getLocalizations", () => {
    test("lista somente as localizações do usuário do token", async () => {
        const getByUser = jest.spyOn(loc, "getLocalizationsByUser").mockResolvedValue([LOCATION]);

        const { status, body } = await invoke(controller.getLocalizations, {
            query: { userId: OTHER_ID }
        });

        expect(getByUser).toHaveBeenCalledWith(USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual([LOCATION]);
    });

    test("responde 500 com mensagem própria quando o service falha", async () => {
        jest.spyOn(loc, "getLocalizationsByUser")
            .mockRejectedValue(unexpectedError("erro de sintaxe SQL"));

        const { status, body } = await invoke(controller.getLocalizations);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar localizações." });
    });
});

describe("localizationController.getLocalization", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const getById = jest.spyOn(loc, "getLocalizationById");

        const { status, body } = await invoke(controller.getLocalization, {
            params: { id: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da localização inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("busca a localização escopada pelo usuário do token", async () => {
        const getById = jest.spyOn(loc, "getLocalizationById").mockResolvedValue(LOCATION);

        const { status, body } = await invoke(controller.getLocalization, {
            params: { id: OTHER_ID }
        });

        expect(getById).toHaveBeenCalledWith(OTHER_ID, USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(LOCATION);
    });

    test("responde 404 quando o service não encontra a localização", async () => {
        jest.spyOn(loc, "getLocalizationById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getLocalization, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Localização não encontrada." });
    });

    test("responde 500 com mensagem própria quando o service falha", async () => {
        jest.spyOn(loc, "getLocalizationById")
            .mockRejectedValue(unexpectedError("timeout de conexão"));

        const { status, body } = await invoke(controller.getLocalization, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar localização." });
    });
});

describe("localizationController.updateLocalization", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const getById = jest.spyOn(loc, "getLocalizationById");

        const { status, body } = await invoke(controller.updateLocalization, {
            params: { id: "123" },
            body: { city: "Franca" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da localização inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("recusa 400 quando nenhum campo aceito é enviado", async () => {
        const getById = jest.spyOn(loc, "getLocalizationById");

        const { status, body } = await invoke(controller.updateLocalization, {
            params: { id: OTHER_ID },
            body: { userId: OTHER_ID, foo: "bar" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Nenhum campo válido para atualizar. Campos aceitos: zipCode, street, neighborhood, number, city, state, latitude, longitude."
        });
        expect(getById).not.toHaveBeenCalled();
    });

    test("responde 404 quando a localização não pertence ao usuário", async () => {
        jest.spyOn(loc, "getLocalizationById").mockResolvedValue(null);
        const update = jest.spyOn(loc, "updateLocalization");

        const { status, body } = await invoke(controller.updateLocalization, {
            params: { id: OTHER_ID },
            body: { city: "Franca" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Localização não encontrada." });
        expect(update).not.toHaveBeenCalled();
    });

    test("valida o estado final do registro antes de atualizar", async () => {
        const existing = {
            id: OTHER_ID,
            zip_code: "14400000",
            street: "Rua das Flores",
            neighborhood: "Centro",
            number: "10",
            city: "Franca",
            state: "SP",
            latitude: null,
            longitude: null
        };
        jest.spyOn(loc, "getLocalizationById").mockResolvedValue(existing);
        jest.spyOn(loc, "validateLocalization").mockReturnValue("Estado inválido. Informe a sigla com 2 letras (ex: SP)");
        const update = jest.spyOn(loc, "updateLocalization");

        const { status, body } = await invoke(controller.updateLocalization, {
            params: { id: OTHER_ID },
            body: { state: "Sao Paulo" }
        });

        expect(loc.validateLocalization).toHaveBeenCalledWith({
            userId: USER_ID,
            zipCode: "14400000",
            street: "Rua das Flores",
            neighborhood: "Centro",
            number: "10",
            city: "Franca",
            state: "Sao Paulo",
            latitude: null,
            longitude: null
        });
        expect(status).toBe(400);
        expect(body).toEqual({ error: "Estado inválido. Informe a sigla com 2 letras (ex: SP)" });
        expect(update).not.toHaveBeenCalled();
    });

    test("normaliza o corpo, ignora userId e atualiza a localização", async () => {
        const existing = {
            id: OTHER_ID,
            zip_code: "14400000",
            street: "Rua das Flores",
            neighborhood: "Centro",
            number: "10",
            city: "Franca",
            state: "SP",
            latitude: null,
            longitude: null
        };
        const updated = { ...existing, street: "Rua Nova", number: "42", latitude: -21.5 };
        jest.spyOn(loc, "getLocalizationById").mockResolvedValue(existing);
        jest.spyOn(loc, "validateLocalization").mockReturnValue(null);
        const update = jest.spyOn(loc, "updateLocalization").mockResolvedValue(updated);

        const { status, body } = await invoke(controller.updateLocalization, {
            params: { id: OTHER_ID },
            body: {
                userId: OTHER_ID,
                id_user: OTHER_ID,
                street: "  Rua Nova  ",
                number: 42,
                latitude: "-21.5"
            }
        });

        expect(update).toHaveBeenCalledWith(OTHER_ID, USER_ID, {
            street: "Rua Nova",
            number: "42",
            latitude: -21.5
        });
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Localização atualizada com sucesso.",
            localization: updated
        });
    });

    test("repassa status e mensagem de conflito do service", async () => {
        jest.spyOn(loc, "getLocalizationById").mockResolvedValue({
            id: OTHER_ID,
            zip_code: "14400000",
            street: "Rua das Flores",
            neighborhood: "Centro",
            number: "10",
            city: "Franca",
            state: "SP",
            latitude: null,
            longitude: null
        });
        jest.spyOn(loc, "validateLocalization").mockReturnValue(null);
        jest.spyOn(loc, "updateLocalization")
            .mockRejectedValue(serviceError("Localização alterada por outra sessão.", 409));

        const { status, body } = await invoke(controller.updateLocalization, {
            params: { id: OTHER_ID },
            body: { city: "Franca" }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Localização alterada por outra sessão." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(loc, "getLocalizationById")
            .mockRejectedValue(unexpectedError("tabela inexistente"));

        const { status, body } = await invoke(controller.updateLocalization, {
            params: { id: OTHER_ID },
            body: { city: "Franca" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar localização." });
    });
});

describe("localizationController.deleteLocalization", () => {
    test("recusa 400 quando o ID não é UUID", async () => {
        const remove = jest.spyOn(loc, "deleteLocalization");

        const { status, body } = await invoke(controller.deleteLocalization, {
            params: { id: "uuid-invalido" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da localização inválido." });
        expect(remove).not.toHaveBeenCalled();
    });

    test("exclui a localização do usuário do token e responde 200", async () => {
        const remove = jest.spyOn(loc, "deleteLocalization").mockResolvedValue(true);

        const { status, body } = await invoke(controller.deleteLocalization, {
            params: { id: OTHER_ID }
        });

        expect(remove).toHaveBeenCalledWith(OTHER_ID, USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Localização excluída com sucesso." });
    });

    test("responde 404 quando o service não exclui nada", async () => {
        jest.spyOn(loc, "deleteLocalization").mockResolvedValue(null);

        const { status, body } = await invoke(controller.deleteLocalization, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Localização não encontrada." });
    });

    test("repassa 409 quando a localização está vinculada a anúncio", async () => {
        jest.spyOn(loc, "deleteLocalization").mockRejectedValue(serviceError(
            "Não é possível excluir: esta localização está vinculada a um ou mais anúncios.",
            409
        ));

        const { status, body } = await invoke(controller.deleteLocalization, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(409);
        expect(body).toEqual({
            error: "Não é possível excluir: esta localização está vinculada a um ou mais anúncios."
        });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(loc, "deleteLocalization")
            .mockRejectedValue(unexpectedError("deadlock detectado"));

        const { status, body } = await invoke(controller.deleteLocalization, {
            params: { id: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir localização." });
    });
});

describe("localizationController.getProductLocation", () => {
    test("recusa 400 quando o ID do anúncio não é UUID", async () => {
        const getByProduct = jest.spyOn(loc, "getLocationByProduct");

        const { status, body } = await invoke(controller.getProductLocation, {
            params: { productId: "produto-1" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do anúncio inválido." });
        expect(getByProduct).not.toHaveBeenCalled();
    });

    test("devolve a visão pública repassando o usuário do token", async () => {
        const location = {
            productId: OTHER_ID,
            city: "Franca",
            neighborhood: "Centro",
            latitude: -20.54,
            longitude: -47.4,
            addressFull: false
        };
        const getByProduct = jest.spyOn(loc, "getLocationByProduct").mockResolvedValue(location);

        const { status, body } = await invoke(controller.getProductLocation, {
            params: { productId: OTHER_ID }
        });

        expect(getByProduct).toHaveBeenCalledWith(OTHER_ID, USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(location);
    });

    test("repassa viewer nulo quando a rota é anônima", async () => {
        const getByProduct = jest.spyOn(loc, "getLocationByProduct").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getProductLocation, {
            params: { productId: OTHER_ID },
            userId: null
        });

        expect(getByProduct).toHaveBeenCalledWith(OTHER_ID, null);
        expect(status).toBe(404);
        expect(body).toEqual({ error: "Localização do anúncio não encontrada." });
    });

    test("responde 500 com mensagem própria quando o service falha", async () => {
        jest.spyOn(loc, "getLocationByProduct")
            .mockRejectedValue(unexpectedError("falha no JOIN de product"));

        const { status, body } = await invoke(controller.getProductLocation, {
            params: { productId: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar localização do anúncio." });
    });
});
