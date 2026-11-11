"use strict";

const shoppingService = require("../src/services/shoppingService");
const controller = require("../src/controllers/shoppingController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const SHOPPING_ID = "4d5e6f70-8192-4d0e-9f2a-3b4c5d6e7f80";
const PRODUCT_ID = "5e6f7081-92a3-4e1f-8a3b-4c5d6e7f8091";

function shoppingFixture(overrides = {}) {
    return {
        id: SHOPPING_ID,
        id_user: USER_ID,
        status: "pending",
        items: [{ id_product: PRODUCT_ID, seller_id: USER_ID, quantity: 1 }],
        ...overrides
    };
}

describe("shoppingController.createShopping", () => {
    test("exige ao menos um item", async () => {
        const create = jest.spyOn(shoppingService, "createShopping");

        const { status, body } = await invoke(controller.createShopping, { body: {} });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A compra deve conter ao menos um item no array 'items'." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa items que não é array", async () => {
        const { status, body } = await invoke(controller.createShopping, {
            body: { items: "produto" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A compra deve conter ao menos um item no array 'items'." });
    });

    test("recusa id_product que não é UUID", async () => {
        const create = jest.spyOn(shoppingService, "createShopping");

        const { status, body } = await invoke(controller.createShopping, {
            body: { items: [{ id_product: "abc", quantity: 1 }] }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID de produto inválido: abc" });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa quantidade zero", async () => {
        const create = jest.spyOn(shoppingService, "createShopping");

        const { status, body } = await invoke(controller.createShopping, {
            body: { items: [{ id_product: PRODUCT_ID, quantity: 0 }] }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A quantidade do produto deve ser um número inteiro maior que zero." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa quantidade não numérica", async () => {
        const { status, body } = await invoke(controller.createShopping, {
            body: { items: [{ id_product: PRODUCT_ID, quantity: "duas" }] }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A quantidade do produto deve ser um número inteiro maior que zero." });
    });

    test("converte a quantidade para número antes de chamar o service", async () => {
        const shopping = shoppingFixture();
        const create = jest.spyOn(shoppingService, "createShopping")
            .mockResolvedValue({ shopping });

        const { status, body } = await invoke(controller.createShopping, {
            body: { items: [{ id_product: PRODUCT_ID, quantity: "2" }] }
        });

        expect(create).toHaveBeenCalledWith(USER_ID, [{ id_product: PRODUCT_ID, quantity: 2 }], "Usuário de Teste");
        expect(status).toBe(201);
        expect(body).toEqual({ message: "Compra registrada com sucesso.", shopping });
    });

    test("usa nome padrão quando o usuário não tem nome", async () => {
        const create = jest.spyOn(shoppingService, "createShopping")
            .mockResolvedValue({ shopping: shoppingFixture() });

        await invoke(controller.createShopping, {
            body: { items: [{ id_product: PRODUCT_ID, quantity: 1 }] },
            userName: ""
        });

        expect(create.mock.calls[0][2]).toBe("Um usuário");
    });

    test("repassa o status de erro do service", async () => {
        jest.spyOn(shoppingService, "createShopping")
            .mockRejectedValue(serviceError("Estoque insuficiente.", 400));

        const { status, body } = await invoke(controller.createShopping, {
            body: { items: [{ id_product: PRODUCT_ID, quantity: 1 }] }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Estoque insuficiente." });
    });

    test("repassa 404 de produto inexistente", async () => {
        jest.spyOn(shoppingService, "createShopping")
            .mockRejectedValue(serviceError("Produto não encontrado.", 404));

        const { status, body } = await invoke(controller.createShopping, {
            body: { items: [{ id_product: PRODUCT_ID, quantity: 1 }] }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Produto não encontrado." });
    });

    test("devolve 500 genérico quando o service falha sem status", async () => {
        jest.spyOn(shoppingService, "createShopping")
            .mockRejectedValue(unexpectedError("deadlock"));

        const { status, body } = await invoke(controller.createShopping, {
            body: { items: [{ id_product: PRODUCT_ID, quantity: 1 }] }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao registrar compra." });
    });
});

describe("shoppingController.getShoppings", () => {
    test("lista as compras do usuário com o papel da sessão", async () => {
        const shoppings = [{ id: SHOPPING_ID }];
        const list = jest.spyOn(shoppingService, "getShoppings").mockResolvedValue(shoppings);

        const { status, body } = await invoke(controller.getShoppings);

        expect(list).toHaveBeenCalledWith(USER_ID, "user");
        expect(status).toBe(200);
        expect(body).toEqual(shoppings);
    });

    test("repassa o papel de administrador ao service", async () => {
        const list = jest.spyOn(shoppingService, "getShoppings").mockResolvedValue([]);

        await invoke(controller.getShoppings, { role: "admin" });

        expect(list).toHaveBeenCalledWith(USER_ID, "admin");
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(shoppingService, "getShoppings")
            .mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.getShoppings);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar compras." });
    });
});

describe("shoppingController.getShoppingById", () => {
    test("recusa ID que não é UUID", async () => {
        const getById = jest.spyOn(shoppingService, "getShoppingById");

        const { status, body } = await invoke(controller.getShoppingById, {
            params: { id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("devolve 404 quando a compra não existe", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getShoppingById, {
            params: { id: SHOPPING_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Compra não encontrada." });
    });

    test("bloqueia a leitura por outro comprador", async () => {
        const shopping = shoppingFixture({ id_user: OTHER_ID });
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shopping);

        const { status, body } = await invoke(controller.getShoppingById, {
            params: { id: SHOPPING_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso negado a esta compra." });
    });

    test("devolve a compra do próprio comprador comparando sem diferenciar caixa", async () => {
        const shopping = shoppingFixture({ id_user: USER_ID.toUpperCase() });
        const getById = jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shopping);

        const { status, body } = await invoke(controller.getShoppingById, {
            params: { id: SHOPPING_ID }
        });

        expect(getById).toHaveBeenCalledWith(SHOPPING_ID);
        expect(status).toBe(200);
        expect(body).toEqual(shopping);
    });

    test("permite que o admin leia a compra de outro usuário", async () => {
        const shopping = shoppingFixture({ id_user: OTHER_ID });
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shopping);

        const { status, body } = await invoke(controller.getShoppingById, {
            params: { id: SHOPPING_ID },
            role: "admin"
        });

        expect(status).toBe(200);
        expect(body).toEqual(shopping);
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(shoppingService, "getShoppingById")
            .mockRejectedValue(unexpectedError("ER_NO_SUCH_TABLE"));

        const { status, body } = await invoke(controller.getShoppingById, {
            params: { id: SHOPPING_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar compra." });
    });
});

describe("shoppingController.cancelShopping", () => {
    test("recusa ID que não é UUID", async () => {
        const getById = jest.spyOn(shoppingService, "getShoppingById");

        const { status, body } = await invoke(controller.cancelShopping, {
            params: { id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("devolve 404 quando a compra não existe", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.cancelShopping, {
            params: { id: SHOPPING_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Compra não encontrada." });
    });

    test("bloqueia o cancelamento por quem não é o comprador", async () => {
        const shopping = shoppingFixture({ id_user: OTHER_ID });
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shopping);
        const update = jest.spyOn(shoppingService, "updateStatus");

        const { status, body } = await invoke(controller.cancelShopping, {
            params: { id: SHOPPING_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso negado para cancelar esta compra." });
        expect(update).not.toHaveBeenCalled();
    });

    test("recusa cancelamento de compra já finalizada", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(
            shoppingFixture({ status: "completed" })
        );
        const update = jest.spyOn(shoppingService, "updateStatus");

        const { status, body } = await invoke(controller.cancelShopping, {
            params: { id: SHOPPING_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Apenas compras aguardando aceite ou aceitas e não pagas podem ser canceladas. Status atual: \"completed\"."
        });
        expect(update).not.toHaveBeenCalled();
    });

    test("cancela a reserva pendente e devolve apenas message e shopping", async () => {
        const shopping = shoppingFixture();
        const updated = shoppingFixture({ status: "cancelled" });
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shopping);
        const update = jest.spyOn(shoppingService, "updateStatus").mockResolvedValue({
            shopping: updated,
            previousStatus: "pending",
            changed: true
        });

        const { status, body } = await invoke(controller.cancelShopping, {
            params: { id: SHOPPING_ID }
        });

        expect(update).toHaveBeenCalledWith(SHOPPING_ID, "cancelled", {
            allowedFrom: ["pending", "accepted"],
            notificationActorName: "Usuário de Teste"
        });
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Compra cancelada com sucesso. O estoque dos produtos foi restaurado.",
            shopping: updated
        });
        expect(Object.keys(body)).toEqual(["message", "shopping"]);
        expect(body).not.toHaveProperty("previousStatus");
        expect(body).not.toHaveProperty("changed");
    });

    test("identifica o admin como autor do cancelamento", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(
            shoppingFixture({ id_user: OTHER_ID, status: "accepted" })
        );
        const update = jest.spyOn(shoppingService, "updateStatus").mockResolvedValue({
            shopping: shoppingFixture({ status: "cancelled" }),
            previousStatus: "accepted",
            changed: true
        });

        const { status } = await invoke(controller.cancelShopping, {
            params: { id: SHOPPING_ID },
            role: "admin"
        });

        expect(update).toHaveBeenCalledWith(SHOPPING_ID, "cancelled", {
            allowedFrom: ["pending", "accepted"],
            notificationActorName: "O administrador"
        });
        expect(status).toBe(200);
    });

    test("devolve 404 quando a transição não encontra a compra", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(shoppingService, "updateStatus").mockResolvedValue(null);

        const { status, body } = await invoke(controller.cancelShopping, {
            params: { id: SHOPPING_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Compra não encontrada." });
    });

    test("repassa o status de erro do service", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(shoppingService, "updateStatus")
            .mockRejectedValue(serviceError("Esta reserva já foi paga.", 409));

        const { status, body } = await invoke(controller.cancelShopping, {
            params: { id: SHOPPING_ID }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Esta reserva já foi paga." });
    });

    test("devolve 500 genérico quando o service falha sem status", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(shoppingService, "updateStatus")
            .mockRejectedValue(unexpectedError("deadlock"));

        const { status, body } = await invoke(controller.cancelShopping, {
            params: { id: SHOPPING_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao cancelar compra." });
    });
});

describe("shoppingController.updateStatus", () => {
    test("recusa ID que não é UUID", async () => {
        const getById = jest.spyOn(shoppingService, "getShoppingById");

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: "abc" },
            body: { status: "accepted" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("recusa status fora do catálogo", async () => {
        const getById = jest.spyOn(shoppingService, "getShoppingById");

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "pago" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Status inválido. Use um dos seguintes: pending, accepted, refused, cancelled, completed."
        });
        expect(getById).not.toHaveBeenCalled();
    });

    test("devolve 404 quando a compra não existe", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "accepted" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Compra não encontrada." });
    });

    test("bloqueia quem não é vendedor dos itens", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(
            shoppingFixture({ items: [{ id_product: PRODUCT_ID, seller_id: OTHER_ID, quantity: 1 }] })
        );
        const update = jest.spyOn(shoppingService, "updateStatus");

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "accepted" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({
            error: "Apenas o vendedor responsável por todos os itens ou um administrador podem alterar o status desta compra."
        });
        expect(update).not.toHaveBeenCalled();
    });

    test("bloqueia vendedor de compra com itens de vários vendedores", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(
            shoppingFixture({
                items: [
                    { id_product: PRODUCT_ID, seller_id: USER_ID, quantity: 1 },
                    { id_product: PRODUCT_ID, seller_id: OTHER_ID, quantity: 1 }
                ]
            })
        );
        const update = jest.spyOn(shoppingService, "updateStatus");

        const { status } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "accepted" }
        });

        expect(status).toBe(403);
        expect(update).not.toHaveBeenCalled();
    });

    test("vendedor só pode aceitar ou recusar", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        const update = jest.spyOn(shoppingService, "updateStatus");

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "completed" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "O vendedor só pode aceitar ou recusar a reserva." });
        expect(update).not.toHaveBeenCalled();
    });

    test("vendedor aceita a reserva e metadados da transição não vazam", async () => {
        const shopping = shoppingFixture();
        const updated = shoppingFixture({ status: "accepted" });
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shopping);
        const update = jest.spyOn(shoppingService, "updateStatus").mockResolvedValue({
            shopping: updated,
            previousStatus: "pending",
            changed: true
        });

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "accepted" }
        });

        expect(update).toHaveBeenCalledWith(SHOPPING_ID, "accepted", {
            notificationActorName: "Usuário de Teste"
        });
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Status da compra atualizado para \"accepted\".",
            shopping: updated
        });
        expect(Object.keys(body)).toEqual(["message", "shopping"]);
        expect(body).not.toHaveProperty("previousStatus");
        expect(body).not.toHaveProperty("changed");
    });

    test("admin altera qualquer status e é identificado como autor", async () => {
        const shopping = shoppingFixture({ id_user: OTHER_ID });
        const updated = shoppingFixture({ status: "completed" });
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shopping);
        const update = jest.spyOn(shoppingService, "updateStatus").mockResolvedValue({
            shopping: updated,
            previousStatus: "pending",
            changed: true
        });

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "completed" },
            role: "admin"
        });

        expect(update).toHaveBeenCalledWith(SHOPPING_ID, "completed", {
            notificationActorName: "O administrador"
        });
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Status da compra atualizado para \"completed\".",
            shopping: updated
        });
    });

    test("admin cancelando também é identificado como autor do aviso", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        const update = jest.spyOn(shoppingService, "updateStatus").mockResolvedValue({
            shopping: shoppingFixture({ status: "cancelled" }),
            previousStatus: "pending",
            changed: true
        });

        await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "cancelled" },
            role: "admin"
        });

        expect(update).toHaveBeenCalledWith(SHOPPING_ID, "cancelled", {
            notificationActorName: "O administrador"
        });
    });

    test("devolve 404 quando a transição não encontra a compra", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(shoppingService, "updateStatus").mockResolvedValue(null);

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "accepted" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Compra não encontrada." });
    });

    test("repassa o status de erro do service", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(shoppingService, "updateStatus")
            .mockRejectedValue(serviceError("Esta compra já foi finalizada.", 400));

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "accepted" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Esta compra já foi finalizada." });
    });

    test("devolve 500 genérico quando o service falha sem status", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(shoppingService, "updateStatus")
            .mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.updateStatus, {
            params: { id: SHOPPING_ID },
            body: { status: "accepted" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar status da compra." });
    });
});
