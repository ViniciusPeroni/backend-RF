"use strict";

const shoppingProductService = require("../src/services/shoppingProductService");
const controller = require("../src/controllers/shoppingProductController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const ITEM_ID = "3c4d5e6f-7081-4a9b-8c1d-2e3f4a5b6c7d";
const SHOPPING_ID = "4d5e6f70-8192-4a0b-9c2d-3e4f5a6b7c8d";

function storedItem(overrides = {}) {
    return {
        id: ITEM_ID,
        value: 25.5,
        quantity: 2,
        id_product: OTHER_ID,
        id_shopping: SHOPPING_ID,
        product_name: "Cadeira usada",
        product_category: "Móveis",
        product_price: 12.75,
        type_negotiation: "venda",
        shopping_status: "pending",
        shopping_datetime: "2026-11-10T10:00:00.000Z",
        ...overrides
    };
}

// =========================================================
// getItems
// =========================================================
describe("shoppingProductController.getItems", () => {
    test("busca itens sem filtros e passa o ator autenticado", async () => {
        const items = [storedItem()];
        const getItems = jest.spyOn(shoppingProductService, "getItems").mockResolvedValue(items);

        const { status, body } = await invoke(controller.getItems, { query: {} });

        expect(getItems).toHaveBeenCalledWith(
            { id_shopping: undefined, id_product: undefined },
            { id: USER_ID, role: "user" }
        );
        expect(status).toBe(200);
        expect(body).toEqual(items);
    });

    test("converte shoppingId/productId da query em filtros do service", async () => {
        const getItems = jest.spyOn(shoppingProductService, "getItems").mockResolvedValue([]);

        await invoke(controller.getItems, {
            query: { shoppingId: SHOPPING_ID, productId: OTHER_ID },
            role: "admin"
        });

        expect(getItems).toHaveBeenCalledWith(
            { id_shopping: SHOPPING_ID, id_product: OTHER_ID },
            { id: USER_ID, role: "admin" }
        );
    });

    test("repassa o 400 de filtro inválido vindo do service", async () => {
        jest.spyOn(shoppingProductService, "getItems").mockRejectedValue(
            serviceError("Filtro de identificação inválido.", 400)
        );

        const { status, body } = await invoke(controller.getItems, {
            query: { shoppingId: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Filtro de identificação inválido." });
    });

    test("repassa o 401 de autenticação vindo do service", async () => {
        jest.spyOn(shoppingProductService, "getItems").mockRejectedValue(
            serviceError("Autenticação necessária.", 401)
        );

        const { status, body } = await invoke(controller.getItems, { query: {} });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
    });

    test("converte em 500 genérico o status que não seja 400/401", async () => {
        jest.spyOn(shoppingProductService, "getItems").mockRejectedValue(
            serviceError("Compra não encontrada.", 404)
        );

        const { status, body } = await invoke(controller.getItems, { query: {} });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar itens de compra." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(shoppingProductService, "getItems").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.getItems, { query: {} });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar itens de compra." });
    });
});

// =========================================================
// getItemById
// =========================================================
describe("shoppingProductController.getItemById", () => {
    test("rejeita ID inválido com 400 sem chamar o service", async () => {
        const find = jest.spyOn(shoppingProductService, "getItemById");

        const { status, body } = await invoke(controller.getItemById, {
            params: { id: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do item inválido." });
        expect(find).not.toHaveBeenCalled();
    });

    test("devolve o item do comprador dono com 200", async () => {
        const item = storedItem();
        const find = jest.spyOn(shoppingProductService, "getItemById").mockResolvedValue(item);

        const { status, body } = await invoke(controller.getItemById, {
            params: { id: ITEM_ID }
        });

        expect(find).toHaveBeenCalledWith(ITEM_ID, { id: USER_ID, role: "user" });
        expect(status).toBe(200);
        expect(body).toEqual(item);
    });

    test("responde 404 quando o item não existe ou é de outra compra", async () => {
        jest.spyOn(shoppingProductService, "getItemById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getItemById, {
            params: { id: ITEM_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Item não encontrado." });
    });

    test("repassa o 400 de identificação inválida vindo do service", async () => {
        jest.spyOn(shoppingProductService, "getItemById").mockRejectedValue(
            serviceError("Filtro de identificação inválido.", 400)
        );

        const { status, body } = await invoke(controller.getItemById, {
            params: { id: ITEM_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Filtro de identificação inválido." });
    });

    test("repassa o 401 de autenticação vindo do service", async () => {
        jest.spyOn(shoppingProductService, "getItemById").mockRejectedValue(
            serviceError("Autenticação necessária.", 401)
        );

        const { status, body } = await invoke(controller.getItemById, {
            params: { id: ITEM_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
    });

    test("converte em 500 genérico o status que não seja 400/401", async () => {
        jest.spyOn(shoppingProductService, "getItemById").mockRejectedValue(
            serviceError("Sem permissão para este item.", 403)
        );

        const { status, body } = await invoke(controller.getItemById, {
            params: { id: ITEM_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar item de compra." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(shoppingProductService, "getItemById").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.getItemById, {
            params: { id: ITEM_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar item de compra." });
    });
});

// =========================================================
// getItemsByShoppingId
// =========================================================
describe("shoppingProductController.getItemsByShoppingId", () => {
    test("rejeita ID da compra inválido com 400 sem chamar o service", async () => {
        const find = jest.spyOn(shoppingProductService, "getItemsByShoppingId");

        const { status, body } = await invoke(controller.getItemsByShoppingId, {
            params: { shoppingId: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra inválido." });
        expect(find).not.toHaveBeenCalled();
    });

    test("lista os itens da compra com o ator autenticado", async () => {
        const items = [storedItem(), storedItem({ id: OTHER_ID })];
        const find = jest
            .spyOn(shoppingProductService, "getItemsByShoppingId")
            .mockResolvedValue(items);

        const { status, body } = await invoke(controller.getItemsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(find).toHaveBeenCalledWith(SHOPPING_ID, { id: USER_ID, role: "user" });
        expect(status).toBe(200);
        expect(body).toEqual(items);
    });

    test("repassa o 400 de filtro inválido vindo do service", async () => {
        jest.spyOn(shoppingProductService, "getItemsByShoppingId").mockRejectedValue(
            serviceError("Filtro de identificação inválido.", 400)
        );

        const { status, body } = await invoke(controller.getItemsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Filtro de identificação inválido." });
    });

    test("repassa o 401 de autenticação vindo do service", async () => {
        jest.spyOn(shoppingProductService, "getItemsByShoppingId").mockRejectedValue(
            serviceError("Autenticação necessária.", 401)
        );

        const { status, body } = await invoke(controller.getItemsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
    });

    test("converte em 500 genérico o status que não seja 400/401", async () => {
        jest.spyOn(shoppingProductService, "getItemsByShoppingId").mockRejectedValue(
            serviceError("Compra não encontrada.", 404)
        );

        const { status, body } = await invoke(controller.getItemsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar itens da compra." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(shoppingProductService, "getItemsByShoppingId").mockRejectedValue(
            unexpectedError()
        );

        const { status, body } = await invoke(controller.getItemsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar itens da compra." });
    });
});
