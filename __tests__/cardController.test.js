"use strict";

const cardService = require("../src/services/cardService");
const controller = require("../src/controllers/cardController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const CARD_ID = "0b1c2d3e-4f50-4a6b-8c9d-0e1f2a3b4c5d";

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1;
// Um mês já vencido em relação a hoje (sem depender do mês corrente do calendário).
const EXPIRED_MONTH = CURRENT_MONTH > 1 ? CURRENT_MONTH - 1 : 12;
const EXPIRED_YEAR = CURRENT_MONTH > 1 ? CURRENT_YEAR : CURRENT_YEAR - 1;

function requestBody(overrides = {}) {
    return {
        holder_name: "Maria Silva",
        brand: "Visa",
        last_digits: "1234",
        type: "credit",
        expiration_month: 12,
        expiration_year: CURRENT_YEAR + 2,
        payment_token: "tok_sintetico",
        ...overrides
    };
}

function storedCard(overrides = {}) {
    return {
        id: CARD_ID,
        holder_name: "Maria Silva",
        brand: "Visa",
        last_digits: "1234",
        type: "credit",
        expiration_month: 12,
        expiration_year: CURRENT_YEAR + 2,
        id_user: USER_ID,
        ...overrides
    };
}

// =========================================================
// createCard
// =========================================================
describe("cardController.createCard", () => {
    test("cadastra o cartão do usuário autenticado e responde 201", async () => {
        const created = storedCard();
        const create = jest.spyOn(cardService, "createCard").mockResolvedValue(created);

        const { status, body } = await invoke(controller.createCard, { body: requestBody() });

        expect(create).toHaveBeenCalledWith({
            id: expect.any(String),
            holder_name: "Maria Silva",
            brand: "Visa",
            last_digits: "1234",
            type: "credit",
            expiration_month: 12,
            expiration_year: CURRENT_YEAR + 2,
            payment_token: "tok_sintetico",
            id_user: USER_ID
        });
        expect(status).toBe(201);
        expect(body).toEqual({ message: "Cartão cadastrado com sucesso.", card: created });
    });

    test("normaliza textos, tipo, dígitos e campos numéricos antes de salvar", async () => {
        const create = jest.spyOn(cardService, "createCard").mockResolvedValue(storedCard());

        await invoke(controller.createCard, {
            body: requestBody({
                holder_name: "  Maria Silva  ",
                brand: "  Visa ",
                last_digits: 1234,
                type: "  CREDIT ",
                expiration_month: "05",
                expiration_year: String(CURRENT_YEAR + 2),
                payment_token: "  tok_sintetico  "
            })
        });

        expect(create).toHaveBeenCalledWith({
            id: expect.any(String),
            holder_name: "Maria Silva",
            brand: "Visa",
            last_digits: "1234",
            type: "credit",
            expiration_month: 5,
            expiration_year: CURRENT_YEAR + 2,
            payment_token: "tok_sintetico",
            id_user: USER_ID
        });
    });

    test("ignora id, id_user e campos desconhecidos enviados no corpo", async () => {
        const create = jest.spyOn(cardService, "createCard").mockResolvedValue(storedCard());

        await invoke(controller.createCard, {
            body: requestBody({ id: "id-forjado", id_user: OTHER_ID, extra: "ignorado" })
        });

        const input = create.mock.calls[0][0];
        expect(input.id).not.toBe("id-forjado");
        expect(input.id_user).toBe(USER_ID);
        expect(input).not.toHaveProperty("extra");
        expect(Object.keys(input).sort()).toEqual([
            "brand",
            "expiration_month",
            "expiration_year",
            "holder_name",
            "id",
            "id_user",
            "last_digits",
            "payment_token",
            "type"
        ]);
    });

    test.each([
        ["holder_name ausente", { holder_name: undefined }, "holder_name é obrigatório."],
        ["holder_name em branco", { holder_name: "   " }, "holder_name é obrigatório."],
        ["holder_name não textual", { holder_name: 123 }, "holder_name é obrigatório."],
        [
            "holder_name com 101 caracteres",
            { holder_name: "a".repeat(101) },
            "holder_name deve ter no máximo 100 caracteres."
        ],
        ["brand ausente", { brand: undefined }, "brand é obrigatório."],
        ["brand em branco", { brand: "  " }, "brand é obrigatório."],
        ["brand com 51 caracteres", { brand: "b".repeat(51) }, "brand deve ter no máximo 50 caracteres."],
        [
            "last_digits com 3 dígitos",
            { last_digits: "123" },
            "last_digits deve conter exatamente 4 dígitos."
        ],
        [
            "last_digits com letras",
            { last_digits: "12a4" },
            "last_digits deve conter exatamente 4 dígitos."
        ],
        ["type não suportado", { type: "pix" }, "type inválido. Valores permitidos: credit, debit."],
        [
            "expiration_month zero",
            { expiration_month: 0 },
            "expiration_month deve ser um número inteiro entre 1 e 12."
        ],
        [
            "expiration_month 13",
            { expiration_month: 13 },
            "expiration_month deve ser um número inteiro entre 1 e 12."
        ],
        [
            "expiration_month fracionário",
            { expiration_month: 1.5 },
            "expiration_month deve ser um número inteiro entre 1 e 12."
        ],
        [
            "expiration_month não numérico",
            { expiration_month: "abc" },
            "expiration_month deve ser um número inteiro entre 1 e 12."
        ],
        [
            "expiration_year fracionário",
            { expiration_year: "2027.5" },
            "expiration_year deve ser um número inteiro."
        ],
        [
            "expiration_year zero",
            { expiration_year: 0 },
            "expiration_year deve estar entre 1 e 9999."
        ],
        [
            "expiration_year acima do limite",
            { expiration_year: 10000 },
            "expiration_year deve estar entre 1 e 9999."
        ],
        ["cartão vencido no ano", { expiration_year: CURRENT_YEAR - 1 }, "O cartão está vencido."],
        [
            "cartão vencido no mês",
            { expiration_year: EXPIRED_YEAR, expiration_month: EXPIRED_MONTH },
            "O cartão está vencido."
        ],
        ["payment_token ausente", { payment_token: undefined }, "payment_token é obrigatório."],
        ["payment_token em branco", { payment_token: "   " }, "payment_token é obrigatório."],
        ["payment_token não textual", { payment_token: 123 }, "payment_token é obrigatório."],
        [
            "payment_token com 256 caracteres",
            { payment_token: "t".repeat(256) },
            "payment_token deve ter no máximo 255 caracteres."
        ]
    ])("rejeita %s com 400 e não chama o service", async (_label, overrides, expectedError) => {
        const create = jest.spyOn(cardService, "createCard");

        const { status, body } = await invoke(controller.createCard, {
            body: requestBody(overrides)
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: expectedError });
        expect(create).not.toHaveBeenCalled();
    });

    test("responde 401 quando a FK de id_user barra o INSERT (usuário excluído)", async () => {
        jest.spyOn(cardService, "createCard").mockRejectedValue(
            Object.assign(new Error("fk"), { code: "ER_NO_REFERENCED_ROW_2" })
        );

        const { status, body } = await invoke(controller.createCard, { body: requestBody() });

        expect(status).toBe(401);
        expect(body).toEqual({
            auth: false,
            message: "Usuário não encontrado. Faça login novamente."
        });
    });

    test("não repassa o status do service: erro com status 400 vira 500 genérico", async () => {
        jest.spyOn(cardService, "createCard").mockRejectedValue(
            serviceError("Usuário inválido.", 400)
        );

        const { status, body } = await invoke(controller.createCard, { body: requestBody() });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao cadastrar cartão." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(cardService, "createCard").mockRejectedValue(
            unexpectedError("senha do banco vazou")
        );

        const { status, body } = await invoke(controller.createCard, { body: requestBody() });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao cadastrar cartão." });
    });
});

// =========================================================
// getCards
// =========================================================
describe("cardController.getCards", () => {
    test("lista apenas os cartões do usuário autenticado", async () => {
        const cards = [storedCard(), storedCard({ id: OTHER_ID, last_digits: "9999" })];
        const list = jest.spyOn(cardService, "getCardsByUser").mockResolvedValue(cards);

        const { status, body } = await invoke(controller.getCards);

        expect(list).toHaveBeenCalledWith(USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(cards);
    });

    test("não repassa o status do service: erro com status 403 vira 500 genérico", async () => {
        jest.spyOn(cardService, "getCardsByUser").mockRejectedValue(
            serviceError("Acesso negado.", 403)
        );

        const { status, body } = await invoke(controller.getCards);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar cartões." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(cardService, "getCardsByUser").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.getCards);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar cartões." });
    });
});

// =========================================================
// getCardById
// =========================================================
describe("cardController.getCardById", () => {
    test("rejeita ID inválido com 400 sem chamar o service", async () => {
        const find = jest.spyOn(cardService, "getCardById");

        const { status, body } = await invoke(controller.getCardById, {
            params: { id: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do cartão inválido." });
        expect(find).not.toHaveBeenCalled();
    });

    test("devolve o cartão do dono com 200", async () => {
        const card = storedCard();
        const find = jest.spyOn(cardService, "getCardById").mockResolvedValue(card);

        const { status, body } = await invoke(controller.getCardById, {
            params: { id: CARD_ID }
        });

        expect(find).toHaveBeenCalledWith(CARD_ID, USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(card);
    });

    test("responde 404 quando o cartão não existe ou é de outro usuário", async () => {
        jest.spyOn(cardService, "getCardById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getCardById, {
            params: { id: CARD_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Cartão não encontrado." });
    });

    test("não repassa o status do service: erro com status 404 vira 500 genérico", async () => {
        jest.spyOn(cardService, "getCardById").mockRejectedValue(
            serviceError("Registro indisponível.", 404)
        );

        const { status, body } = await invoke(controller.getCardById, {
            params: { id: CARD_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar cartão." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(cardService, "getCardById").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.getCardById, {
            params: { id: CARD_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar cartão." });
    });
});

// =========================================================
// updateCard
// =========================================================
describe("cardController.updateCard", () => {
    test("rejeita ID inválido com 400 sem chamar o service", async () => {
        const find = jest.spyOn(cardService, "getCardById");

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: "nao-e-uuid" },
            body: { holder_name: "Novo Nome" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do cartão inválido." });
        expect(find).not.toHaveBeenCalled();
    });

    test("rejeita corpo sem campos aceitos com 400 sem chamar o service", async () => {
        const find = jest.spyOn(cardService, "getCardById");

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { id: OTHER_ID, id_user: OTHER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error:
                "Nenhum campo válido para atualizar. Campos aceitos: holder_name, brand, last_digits, type, expiration_month, expiration_year, payment_token."
        });
        expect(find).not.toHaveBeenCalled();
    });

    test("responde 404 quando o cartão não pertence ao usuário", async () => {
        jest.spyOn(cardService, "getCardById").mockResolvedValue(null);
        const update = jest.spyOn(cardService, "updateCard");

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { holder_name: "Novo Nome" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Cartão não encontrado." });
        expect(update).not.toHaveBeenCalled();
    });

    test("atualiza apenas os campos enviados e responde 200", async () => {
        jest.spyOn(cardService, "getCardById").mockResolvedValue(storedCard());
        const updated = storedCard({ holder_name: "Novo Nome" });
        const update = jest.spyOn(cardService, "updateCard").mockResolvedValue(updated);

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { holder_name: "  Novo Nome  " }
        });

        expect(update).toHaveBeenCalledWith(CARD_ID, USER_ID, { holder_name: "Novo Nome" });
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Cartão atualizado com sucesso.", card: updated });
    });

    test("valida o estado final do cartão ao enviar apenas o mês", async () => {
        jest.spyOn(cardService, "getCardById").mockResolvedValue(
            storedCard({ expiration_month: 12, expiration_year: CURRENT_YEAR })
        );
        const update = jest.spyOn(cardService, "updateCard").mockResolvedValue(
            storedCard({ expiration_month: CURRENT_MONTH, expiration_year: CURRENT_YEAR })
        );

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { expiration_month: CURRENT_MONTH }
        });

        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Cartão atualizado com sucesso.",
            card: storedCard({ expiration_month: CURRENT_MONTH, expiration_year: CURRENT_YEAR })
        });
        expect(update).toHaveBeenCalledWith(CARD_ID, USER_ID, {
            expiration_month: CURRENT_MONTH
        });
    });

    test("bloqueia alteração que deixaria o cartão vencido", async () => {
        jest.spyOn(cardService, "getCardById").mockResolvedValue(
            storedCard({ expiration_year: CURRENT_YEAR - 1 })
        );
        const update = jest.spyOn(cardService, "updateCard");

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { holder_name: "Novo Nome" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "O cartão está vencido." });
        expect(update).not.toHaveBeenCalled();
    });

    test("bloqueia valor inválido informado na edição", async () => {
        jest.spyOn(cardService, "getCardById").mockResolvedValue(storedCard());
        const update = jest.spyOn(cardService, "updateCard");

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { expiration_month: 13 }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "expiration_month deve ser um número inteiro entre 1 e 12." });
        expect(update).not.toHaveBeenCalled();
    });

    test("exige payment_token quando ele é enviado vazio na edição", async () => {
        jest.spyOn(cardService, "getCardById").mockResolvedValue(storedCard());
        const update = jest.spyOn(cardService, "updateCard");

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { payment_token: "   " }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "payment_token é obrigatório." });
        expect(update).not.toHaveBeenCalled();
    });

    test("aceita edição sem payment_token (token não vem do banco)", async () => {
        jest.spyOn(cardService, "getCardById").mockResolvedValue(storedCard());
        const update = jest.spyOn(cardService, "updateCard").mockResolvedValue(storedCard());

        const { status } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { brand: "Mastercard" }
        });

        expect(status).toBe(200);
        expect(update).toHaveBeenCalledWith(CARD_ID, USER_ID, { brand: "Mastercard" });
    });

    test("responde 404 quando o service não devolve o cartão atualizado", async () => {
        jest.spyOn(cardService, "getCardById").mockResolvedValue(storedCard());
        jest.spyOn(cardService, "updateCard").mockResolvedValue(null);

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { holder_name: "Novo Nome" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Cartão não encontrado." });
    });

    test("não repassa o status do service: erro com status 409 vira 500 genérico", async () => {
        jest.spyOn(cardService, "getCardById").mockRejectedValue(
            serviceError("Conflito de dados.", 409)
        );

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { holder_name: "Novo Nome" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar cartão." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(cardService, "getCardById").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.updateCard, {
            params: { id: CARD_ID },
            body: { holder_name: "Novo Nome" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar cartão." });
    });
});

// =========================================================
// deleteCard
// =========================================================
describe("cardController.deleteCard", () => {
    test("rejeita ID inválido com 400 sem chamar o service", async () => {
        const remove = jest.spyOn(cardService, "deleteCard");

        const { status, body } = await invoke(controller.deleteCard, {
            params: { id: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do cartão inválido." });
        expect(remove).not.toHaveBeenCalled();
    });

    test("exclui o cartão do dono e responde 200", async () => {
        const remove = jest.spyOn(cardService, "deleteCard").mockResolvedValue(true);

        const { status, body } = await invoke(controller.deleteCard, {
            params: { id: CARD_ID }
        });

        expect(remove).toHaveBeenCalledWith(CARD_ID, USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Cartão excluído com sucesso." });
    });

    test("responde 404 quando nada foi excluído", async () => {
        jest.spyOn(cardService, "deleteCard").mockResolvedValue(false);

        const { status, body } = await invoke(controller.deleteCard, {
            params: { id: CARD_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Cartão não encontrado." });
    });

    test("não repassa o status do service: erro com status 403 vira 500 genérico", async () => {
        jest.spyOn(cardService, "deleteCard").mockRejectedValue(
            serviceError("Sem permissão.", 403)
        );

        const { status, body } = await invoke(controller.deleteCard, {
            params: { id: CARD_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir cartão." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(cardService, "deleteCard").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.deleteCard, {
            params: { id: CARD_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir cartão." });
    });
});
