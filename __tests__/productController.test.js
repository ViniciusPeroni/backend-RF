"use strict";

const productService = require("../src/services/productService");
const uuid = require("../src/utils/uuid");
const controller = require("../src/controllers/productController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const PRODUCT_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const PHOTO_ID = "2b3c4d5e-6f70-4b8c-9d0e-1f2a3b4c5d6e";
const LOCALIZATION_ID = "3c4d5e6f-7081-4c9d-8e1f-2a3b4c5d6e7f";

function validProductBody(overrides = {}) {
    return {
        name: "Geladeira",
        description: "Usada, funcionando",
        price: 250,
        priority: 1,
        quantity: 2,
        status: "available",
        category: "eletrodomestico",
        type_negotiation: "sale",
        weight: 30,
        conservation_state: "bom",
        id_localization: LOCALIZATION_ID,
        ...overrides
    };
}

describe("productController.createProduct", () => {
    test("exige os campos obrigatórios", async () => {
        const create = jest.spyOn(productService, "createProduct");

        const { status, body } = await invoke(controller.createProduct, {
            body: { name: "Geladeira", price: 100 }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Todos os campos obrigatórios devem ser preenchidos." });
        expect(create).not.toHaveBeenCalled();
    });

    test("exige preço em produto para venda", async () => {
        const create = jest.spyOn(productService, "createProduct");

        const { status, body } = await invoke(controller.createProduct, {
            body: validProductBody({ price: "" })
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Produtos para venda devem possuir preço." });
        expect(create).not.toHaveBeenCalled();
    });

    test("recusa preço em produto para doação", async () => {
        const create = jest.spyOn(productService, "createProduct");

        const { status, body } = await invoke(controller.createProduct, {
            body: validProductBody({ type_negotiation: "donation", price: 10 })
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Produtos para doação não podem possuir preço." });
        expect(create).not.toHaveBeenCalled();
    });

    test("cadastra o produto do usuário autenticado e devolve 201", async () => {
        const generateId = jest.spyOn(uuid, "generateId").mockReturnValue(PRODUCT_ID);
        const create = jest.spyOn(productService, "createProduct").mockResolvedValue(PRODUCT_ID);

        const { status, body } = await invoke(controller.createProduct, {
            body: validProductBody()
        });

        expect(generateId).toHaveBeenCalledTimes(1);
        expect(create).toHaveBeenCalledWith(
            {
                id: PRODUCT_ID,
                name: "Geladeira",
                description: "Usada, funcionando",
                price: 250,
                priority: 1,
                quantity: 2,
                status: "available",
                category: "eletrodomestico",
                type_negotiation: "sale",
                weight: 30,
                conservation_state: "bom",
                id_user: USER_ID,
                id_localization: LOCALIZATION_ID
            },
            []
        );
        expect(status).toBe(201);
        expect(body).toEqual({ message: "Produto cadastrado com sucesso.", id: PRODUCT_ID });
    });

    test("normaliza preço vazio de doação para null", async () => {
        jest.spyOn(uuid, "generateId").mockReturnValue(PRODUCT_ID);
        const create = jest.spyOn(productService, "createProduct").mockResolvedValue(PRODUCT_ID);

        const { status } = await invoke(controller.createProduct, {
            body: validProductBody({ type_negotiation: "donation", price: "" })
        });

        expect(status).toBe(201);
        expect(create.mock.calls[0][0].price).toBeNull();
    });

    test("envia ao service o buffer de req.file", async () => {
        jest.spyOn(uuid, "generateId").mockReturnValue(PRODUCT_ID);
        const create = jest.spyOn(productService, "createProduct").mockResolvedValue(PRODUCT_ID);
        const buffer = Buffer.from("foto-unica");

        const { status } = await invoke(controller.createProduct, {
            body: validProductBody(),
            file: { buffer }
        });

        expect(status).toBe(201);
        expect(create.mock.calls[0][1]).toEqual([buffer]);
    });

    test("envia todos os buffers de req.files e ignora arquivo sem buffer", async () => {
        jest.spyOn(uuid, "generateId").mockReturnValue(PRODUCT_ID);
        const create = jest.spyOn(productService, "createProduct").mockResolvedValue(PRODUCT_ID);
        const first = Buffer.from("foto-1");
        const second = Buffer.from("foto-2");

        const { status } = await invoke(controller.createProduct, {
            body: validProductBody(),
            files: [{ buffer: first }, {}, { buffer: second }]
        });

        expect(status).toBe(201);
        expect(create.mock.calls[0][1]).toEqual([first, second]);
    });

    test("converte foto base64 do corpo em buffer", async () => {
        jest.spyOn(uuid, "generateId").mockReturnValue(PRODUCT_ID);
        const create = jest.spyOn(productService, "createProduct").mockResolvedValue(PRODUCT_ID);
        const base64 = `data:image/png;base64,${Buffer.from("conteudo").toString("base64")}`;

        const { status } = await invoke(controller.createProduct, {
            body: validProductBody({ photos: [base64, "   "] })
        });

        expect(status).toBe(201);
        expect(create.mock.calls[0][1]).toEqual([Buffer.from("conteudo")]);
    });

    test("mantém 500 genérico mesmo quando o service tem status", async () => {
        jest.spyOn(uuid, "generateId").mockReturnValue(PRODUCT_ID);
        jest.spyOn(productService, "createProduct")
            .mockRejectedValue(serviceError("Localização inexistente.", 404));

        const { status, body } = await invoke(controller.createProduct, {
            body: validProductBody()
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao cadastrar produto." });
    });

    test("usa mensagem genérica para falha inesperada", async () => {
        jest.spyOn(uuid, "generateId").mockReturnValue(PRODUCT_ID);
        jest.spyOn(productService, "createProduct")
            .mockRejectedValue(unexpectedError("ER_NO_SUCH_TABLE"));

        const { status, body } = await invoke(controller.createProduct, {
            body: validProductBody()
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao cadastrar produto." });
    });
});

describe("productController.getProducts", () => {
    test("devolve a lista de produtos com fotos por padrão", async () => {
        const products = [{ id: PRODUCT_ID, name: "Geladeira" }];
        const list = jest.spyOn(productService, "getProducts").mockResolvedValue(products);

        const { status, body } = await invoke(controller.getProducts);

        expect(list).toHaveBeenCalledWith({ withPhotos: true });
        expect(status).toBe(200);
        expect(body).toEqual(products);
    });

    test("lista sem fotos quando photos=none", async () => {
        const products = [{ id: PRODUCT_ID, name: "Geladeira" }];
        const list = jest.spyOn(productService, "getProducts").mockResolvedValue(products);

        const { status, body } = await invoke(controller.getProducts, {
            query: { photos: "none" }
        });

        expect(list).toHaveBeenCalledWith({ withPhotos: false });
        expect(status).toBe(200);
        expect(body).toEqual(products);
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(productService, "getProducts")
            .mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.getProducts);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar produtos." });
    });
});

describe("productController.getProductById", () => {
    test("recusa ID que não é UUID sem chamar o service", async () => {
        const getById = jest.spyOn(productService, "getProductById");

        const { status, body } = await invoke(controller.getProductById, {
            params: { id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do produto inválido." });
        expect(getById).not.toHaveBeenCalled();
    });

    test("devolve 404 quando o produto não existe", async () => {
        jest.spyOn(productService, "getProductById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getProductById, {
            params: { id: PRODUCT_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Produto não encontrado." });
    });

    test("converte o UUID para binário e devolve o produto", async () => {
        const product = { id: PRODUCT_ID, name: "Geladeira" };
        const getById = jest.spyOn(productService, "getProductById").mockResolvedValue(product);

        const { status, body } = await invoke(controller.getProductById, {
            params: { id: PRODUCT_ID }
        });

        expect(getById).toHaveBeenCalledWith(uuid.toBin(PRODUCT_ID));
        expect(status).toBe(200);
        expect(body).toEqual(product);
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(productService, "getProductById")
            .mockRejectedValue(unexpectedError("ER_NO_SUCH_TABLE"));

        const { status, body } = await invoke(controller.getProductById, {
            params: { id: PRODUCT_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar produto." });
    });
});

describe("productController.updateProduct", () => {
    test("recusa ID que não é UUID", async () => {
        const update = jest.spyOn(productService, "updateProduct");

        const { status, body } = await invoke(controller.updateProduct, {
            params: { id: "abc" },
            body: validProductBody()
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do produto inválido." });
        expect(update).not.toHaveBeenCalled();
    });

    test("recusa usuário não autenticado", async () => {
        const update = jest.spyOn(productService, "updateProduct");

        const { status, body } = await invoke(controller.updateProduct, {
            params: { id: PRODUCT_ID },
            body: validProductBody(),
            userId: "nao-e-uuid"
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(update).not.toHaveBeenCalled();
    });

    test("envia photos null quando nenhum upload é feito", async () => {
        const product = { id: PRODUCT_ID, name: "Geladeira" };
        const update = jest.spyOn(productService, "updateProduct").mockResolvedValue(product);

        const { status, body } = await invoke(controller.updateProduct, {
            params: { id: PRODUCT_ID },
            body: validProductBody()
        });

        expect(update).toHaveBeenCalledWith(
            uuid.toBin(PRODUCT_ID),
            expect.objectContaining({ name: "Geladeira", price: 250 }),
            USER_ID,
            null
        );
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Produto atualizado com sucesso.", product });
    });

    test("envia o buffer de req.file quando há upload", async () => {
        const update = jest.spyOn(productService, "updateProduct").mockResolvedValue({ id: PRODUCT_ID });
        const buffer = Buffer.from("nova-foto");

        const { status } = await invoke(controller.updateProduct, {
            params: { id: PRODUCT_ID },
            body: validProductBody(),
            file: { buffer }
        });

        expect(status).toBe(200);
        expect(update.mock.calls[0][3]).toEqual([buffer]);
    });

    test("envia lista vazia quando o corpo traz photos vazio", async () => {
        const update = jest.spyOn(productService, "updateProduct").mockResolvedValue({ id: PRODUCT_ID });

        const { status } = await invoke(controller.updateProduct, {
            params: { id: PRODUCT_ID },
            body: validProductBody({ photos: [] })
        });

        expect(status).toBe(200);
        expect(update.mock.calls[0][3]).toEqual([]);
    });

    test("normaliza preço vazio para null", async () => {
        const update = jest.spyOn(productService, "updateProduct").mockResolvedValue({ id: PRODUCT_ID });

        await invoke(controller.updateProduct, {
            params: { id: PRODUCT_ID },
            body: validProductBody({ price: "" })
        });

        expect(update.mock.calls[0][1].price).toBeNull();
    });

    test("devolve 404 quando o produto não existe ou é de outro usuário", async () => {
        jest.spyOn(productService, "updateProduct").mockResolvedValue(null);

        const { status, body } = await invoke(controller.updateProduct, {
            params: { id: PRODUCT_ID },
            body: validProductBody()
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Produto não encontrado ou não pertence a você." });
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(productService, "updateProduct")
            .mockRejectedValue(serviceError("Localização inválida.", 400));

        const { status, body } = await invoke(controller.updateProduct, {
            params: { id: PRODUCT_ID },
            body: validProductBody()
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar produto." });
    });
});

describe("productController.deleteProduct", () => {
    test("recusa ID que não é UUID", async () => {
        const remove = jest.spyOn(productService, "deleteProduct");

        const { status, body } = await invoke(controller.deleteProduct, {
            params: { id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do produto inválido." });
        expect(remove).not.toHaveBeenCalled();
    });

    test("recusa usuário não autenticado", async () => {
        const remove = jest.spyOn(productService, "deleteProduct");

        const { status, body } = await invoke(controller.deleteProduct, {
            params: { id: PRODUCT_ID },
            userId: "nao-e-uuid"
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(remove).not.toHaveBeenCalled();
    });

    test("informa que o usuário comum não é admin", async () => {
        const remove = jest.spyOn(productService, "deleteProduct").mockResolvedValue(true);

        const { status } = await invoke(controller.deleteProduct, {
            params: { id: PRODUCT_ID },
            role: "user"
        });

        expect(remove).toHaveBeenCalledWith(uuid.toBin(PRODUCT_ID), USER_ID, false);
        expect(status).toBe(200);
    });

    test("permite que o admin exclua qualquer produto", async () => {
        const remove = jest.spyOn(productService, "deleteProduct").mockResolvedValue(true);

        const { status, body } = await invoke(controller.deleteProduct, {
            params: { id: PRODUCT_ID },
            role: "admin",
            userId: OTHER_ID
        });

        expect(remove).toHaveBeenCalledWith(uuid.toBin(PRODUCT_ID), OTHER_ID, true);
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Produto excluído com sucesso." });
    });

    test("devolve 404 quando nada foi excluído", async () => {
        jest.spyOn(productService, "deleteProduct").mockResolvedValue(false);

        const { status, body } = await invoke(controller.deleteProduct, {
            params: { id: PRODUCT_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Produto não encontrado ou não pertence a você." });
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(productService, "deleteProduct")
            .mockRejectedValue(unexpectedError("FK constraint"));

        const { status, body } = await invoke(controller.deleteProduct, {
            params: { id: PRODUCT_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir produto." });
    });
});

describe("productController.addPhotos", () => {
    test("recusa ID que não é UUID", async () => {
        const add = jest.spyOn(productService, "addPhotos");

        const { status, body } = await invoke(controller.addPhotos, {
            params: { id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do produto inválido." });
        expect(add).not.toHaveBeenCalled();
    });

    test("exige ao menos uma foto", async () => {
        const add = jest.spyOn(productService, "addPhotos");

        const { status, body } = await invoke(controller.addPhotos, {
            params: { id: PRODUCT_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Nenhuma foto foi enviada." });
        expect(add).not.toHaveBeenCalled();
    });

    test("adiciona as fotos enviadas por upload", async () => {
        const first = Buffer.from("foto-1");
        const second = Buffer.from("foto-2");
        const added = [{ id: PHOTO_ID }];
        const add = jest.spyOn(productService, "addPhotos").mockResolvedValue(added);

        const { status, body } = await invoke(controller.addPhotos, {
            params: { id: PRODUCT_ID },
            files: [{ buffer: first }, { buffer: second }]
        });

        expect(add).toHaveBeenCalledWith(uuid.toBin(PRODUCT_ID), [first, second]);
        expect(status).toBe(201);
        expect(body).toEqual({ message: "Foto(s) adicionada(s) com sucesso.", photos: added });
    });

    test("aceita foto única em req.file", async () => {
        const buffer = Buffer.from("foto");
        const add = jest.spyOn(productService, "addPhotos").mockResolvedValue([{ id: PHOTO_ID }]);

        const { status } = await invoke(controller.addPhotos, {
            params: { id: PRODUCT_ID },
            file: { buffer }
        });

        expect(add).toHaveBeenCalledWith(uuid.toBin(PRODUCT_ID), [buffer]);
        expect(status).toBe(201);
    });

    test("devolve 404 quando o produto não existe", async () => {
        jest.spyOn(productService, "addPhotos").mockResolvedValue(null);

        const { status, body } = await invoke(controller.addPhotos, {
            params: { id: PRODUCT_ID },
            file: { buffer: Buffer.from("foto") }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Produto não encontrado." });
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(productService, "addPhotos")
            .mockRejectedValue(unexpectedError("ER_DATA_TOO_LONG"));

        const { status, body } = await invoke(controller.addPhotos, {
            params: { id: PRODUCT_ID },
            file: { buffer: Buffer.from("foto") }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao adicionar foto(s)." });
    });
});

describe("productController.updatePhoto", () => {
    test("recusa ID de foto que não é UUID", async () => {
        const update = jest.spyOn(productService, "updatePhoto");

        const { status, body } = await invoke(controller.updatePhoto, {
            params: { photoId: "abc" },
            file: { buffer: Buffer.from("foto") }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da foto inválido." });
        expect(update).not.toHaveBeenCalled();
    });

    test("exige uma foto para atualização", async () => {
        const update = jest.spyOn(productService, "updatePhoto");

        const { status, body } = await invoke(controller.updatePhoto, {
            params: { photoId: PHOTO_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Nenhuma foto foi enviada para atualização." });
        expect(update).not.toHaveBeenCalled();
    });

    test("atualiza a foto com o buffer de req.file", async () => {
        const buffer = Buffer.from("foto-nova");
        const photo = { id: PHOTO_ID };
        const update = jest.spyOn(productService, "updatePhoto").mockResolvedValue(photo);

        const { status, body } = await invoke(controller.updatePhoto, {
            params: { photoId: PHOTO_ID },
            file: { buffer }
        });

        expect(update).toHaveBeenCalledWith(uuid.toBin(PHOTO_ID), buffer);
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Foto atualizada com sucesso.", photo });
    });

    test("aceita foto base64 no corpo quando não há upload", async () => {
        const update = jest.spyOn(productService, "updatePhoto").mockResolvedValue({ id: PHOTO_ID });
        const base64 = `data:image/jpeg;base64,${Buffer.from("jpeg").toString("base64")}`;

        const { status } = await invoke(controller.updatePhoto, {
            params: { photoId: PHOTO_ID },
            body: { photo: base64 }
        });

        expect(update).toHaveBeenCalledWith(uuid.toBin(PHOTO_ID), Buffer.from("jpeg"));
        expect(status).toBe(200);
    });

    test("recusa corpo com photo que não é texto nem buffer", async () => {
        const update = jest.spyOn(productService, "updatePhoto");

        const { status, body } = await invoke(controller.updatePhoto, {
            params: { photoId: PHOTO_ID },
            body: { photo: 123 }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Nenhuma foto foi enviada para atualização." });
        expect(update).not.toHaveBeenCalled();
    });

    test("cai para o corpo quando req.file existe sem buffer", async () => {
        const update = jest.spyOn(productService, "updatePhoto").mockResolvedValue({ id: PHOTO_ID });

        const { status } = await invoke(controller.updatePhoto, {
            params: { photoId: PHOTO_ID },
            file: {},
            body: { photo: Buffer.from("buffer-do-corpo") }
        });

        expect(update).toHaveBeenCalledWith(uuid.toBin(PHOTO_ID), Buffer.from("buffer-do-corpo"));
        expect(status).toBe(200);
    });

    test("devolve 404 quando a foto não existe", async () => {
        jest.spyOn(productService, "updatePhoto").mockResolvedValue(null);

        const { status, body } = await invoke(controller.updatePhoto, {
            params: { photoId: PHOTO_ID },
            file: { buffer: Buffer.from("foto") }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Foto não encontrada." });
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(productService, "updatePhoto")
            .mockRejectedValue(unexpectedError("pacote corrompido"));

        const { status, body } = await invoke(controller.updatePhoto, {
            params: { photoId: PHOTO_ID },
            file: { buffer: Buffer.from("foto") }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar foto." });
    });
});

describe("productController.deletePhoto", () => {
    test("recusa ID de foto que não é UUID", async () => {
        const remove = jest.spyOn(productService, "deletePhoto");

        const { status, body } = await invoke(controller.deletePhoto, {
            params: { photoId: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da foto inválido." });
        expect(remove).not.toHaveBeenCalled();
    });

    test("exclui a foto convertendo o UUID para binário", async () => {
        const remove = jest.spyOn(productService, "deletePhoto").mockResolvedValue(true);

        const { status, body } = await invoke(controller.deletePhoto, {
            params: { photoId: PHOTO_ID }
        });

        expect(remove).toHaveBeenCalledWith(uuid.toBin(PHOTO_ID));
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Foto excluída com sucesso." });
    });

    test("devolve 404 quando a foto não existe", async () => {
        jest.spyOn(productService, "deletePhoto").mockResolvedValue(false);

        const { status, body } = await invoke(controller.deletePhoto, {
            params: { photoId: PHOTO_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Foto não encontrada." });
    });

    test("devolve 500 genérico quando o service falha", async () => {
        jest.spyOn(productService, "deletePhoto")
            .mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.deletePhoto, {
            params: { photoId: PHOTO_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir foto." });
    });
});
