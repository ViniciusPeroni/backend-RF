"use strict";

const docService = require("../src/services/docService");
const controller = require("../src/controllers/documentController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const DOC_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const SYNTHETIC_DOC = "000.000.000-00";

function storedDoc(overrides = {}) {
    return {
        id: DOC_ID,
        idUser: USER_ID,
        docType: "CPF",
        ...overrides
    };
}

// =========================================================
// createDoc
// =========================================================
describe("documentController.createDoc", () => {
    test("registra o documento e responde 201 com o id gerado", async () => {
        const create = jest.spyOn(docService, "createDoc").mockResolvedValue(DOC_ID);

        const { status, body } = await invoke(controller.createDoc, {
            body: { userId: USER_ID, docType: "CPF", doc: SYNTHETIC_DOC }
        });

        expect(create).toHaveBeenCalledWith({
            userId: USER_ID,
            docType: "CPF",
            doc: SYNTHETIC_DOC
        });
        expect(status).toBe(201);
        expect(body).toEqual({ message: "Documento registrado com sucesso.", id: DOC_ID });
    });

    test("usa o userId do corpo, não o do token (comportamento atual)", async () => {
        const create = jest.spyOn(docService, "createDoc").mockResolvedValue(DOC_ID);

        const { status } = await invoke(controller.createDoc, {
            userId: USER_ID,
            body: { userId: OTHER_ID, docType: "CNPJ", doc: SYNTHETIC_DOC }
        });

        expect(status).toBe(201);
        expect(create).toHaveBeenCalledWith({
            userId: OTHER_ID,
            docType: "CNPJ",
            doc: SYNTHETIC_DOC
        });
    });

    test("repassa o 400 de validação do service", async () => {
        jest.spyOn(docService, "createDoc").mockRejectedValue(
            serviceError("userId, docType e doc são obrigatórios.", 400)
        );

        const { status, body } = await invoke(controller.createDoc, { body: {} });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "userId, docType e doc são obrigatórios." });
    });

    test("repassa o 409 de documento já registrado vindo do service", async () => {
        jest.spyOn(docService, "createDoc").mockRejectedValue(
            serviceError("Documento já registrado", 409)
        );

        const { status, body } = await invoke(controller.createDoc, {
            body: { userId: USER_ID, docType: "CPF", doc: SYNTHETIC_DOC }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Documento já registrado" });
    });

    test("converte em 409 a mensagem de duplicidade mesmo sem status no erro", async () => {
        jest.spyOn(docService, "createDoc").mockRejectedValue(
            unexpectedError("Documento já registrado")
        );

        const { status, body } = await invoke(controller.createDoc, {
            body: { userId: USER_ID, docType: "CPF", doc: SYNTHETIC_DOC }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Documento já registrado" });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(docService, "createDoc").mockRejectedValue(
            unexpectedError("falha na criptografia")
        );

        const { status, body } = await invoke(controller.createDoc, {
            body: { userId: USER_ID, docType: "CPF", doc: SYNTHETIC_DOC }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao registrar documento." });
    });
});

// =========================================================
// getDocById
// =========================================================
describe("documentController.getDocById", () => {
    test("devolve os metadados do documento com 200", async () => {
        const doc = storedDoc();
        const find = jest.spyOn(docService, "getDocById").mockResolvedValue(doc);

        const { status, body } = await invoke(controller.getDocById, { params: { id: DOC_ID } });

        expect(find).toHaveBeenCalledWith(DOC_ID);
        expect(status).toBe(200);
        expect(body).toEqual(doc);
    });

    test("repassa o 400 de ID inválido do service", async () => {
        jest.spyOn(docService, "getDocById").mockRejectedValue(
            serviceError("ID do documento inválido.", 400)
        );

        const { status, body } = await invoke(controller.getDocById, { params: { id: "nao-e-uuid" } });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do documento inválido." });
    });

    test("responde 404 quando o documento não existe", async () => {
        jest.spyOn(docService, "getDocById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getDocById, { params: { id: DOC_ID } });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Documento não encontrado." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(docService, "getDocById").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.getDocById, { params: { id: DOC_ID } });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar documento." });
    });
});

// =========================================================
// getDocsByUser
// =========================================================
describe("documentController.getDocsByUser", () => {
    test("lista os documentos do usuário informado na rota", async () => {
        const docs = [storedDoc(), storedDoc({ id: OTHER_ID, docType: "CNPJ" })];
        const list = jest.spyOn(docService, "listDocsByUser").mockResolvedValue(docs);

        const { status, body } = await invoke(controller.getDocsByUser, {
            params: { userId: OTHER_ID }
        });

        expect(list).toHaveBeenCalledWith(OTHER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(docs);
    });

    test("usa o userId do parâmetro mesmo quando difere do token (comportamento atual)", async () => {
        const list = jest.spyOn(docService, "listDocsByUser").mockResolvedValue([]);

        await invoke(controller.getDocsByUser, {
            userId: USER_ID,
            params: { userId: OTHER_ID }
        });

        expect(list).toHaveBeenCalledWith(OTHER_ID);
        expect(list).not.toHaveBeenCalledWith(USER_ID);
    });

    test("repassa o 400 de ID do usuário inválido do service", async () => {
        jest.spyOn(docService, "listDocsByUser").mockRejectedValue(
            serviceError("ID do usuário inválido.", 400)
        );

        const { status, body } = await invoke(controller.getDocsByUser, {
            params: { userId: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do usuário inválido." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(docService, "listDocsByUser").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.getDocsByUser, {
            params: { userId: USER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao listar documentos do usuário." });
    });
});

// =========================================================
// getDecryptedDoc
// =========================================================
describe("documentController.getDecryptedDoc", () => {
    test("devolve o documento descriptografado dentro de `document`", async () => {
        const decrypt = jest.spyOn(docService, "getDecryptedDoc").mockResolvedValue(SYNTHETIC_DOC);

        const { status, body } = await invoke(controller.getDecryptedDoc, {
            params: { id: DOC_ID },
            role: "admin"
        });

        expect(decrypt).toHaveBeenCalledWith(DOC_ID);
        expect(status).toBe(200);
        expect(body).toEqual({ document: SYNTHETIC_DOC });
    });

    test("responde 404 quando o documento não existe", async () => {
        jest.spyOn(docService, "getDecryptedDoc").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getDecryptedDoc, {
            params: { id: DOC_ID },
            role: "admin"
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Documento não encontrado." });
    });

    test("repassa o status do service, inclusive 403", async () => {
        jest.spyOn(docService, "getDecryptedDoc").mockRejectedValue(
            serviceError("Acesso restrito a administradores.", 403)
        );

        const { status, body } = await invoke(controller.getDecryptedDoc, {
            params: { id: DOC_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso restrito a administradores." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(docService, "getDecryptedDoc").mockRejectedValue(
            unexpectedError("chave de criptografia inválida")
        );

        const { status, body } = await invoke(controller.getDecryptedDoc, {
            params: { id: DOC_ID },
            role: "admin"
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao descriptografar documento." });
    });
});

// =========================================================
// deleteDoc
// =========================================================
describe("documentController.deleteDoc", () => {
    test("exclui o documento e responde 200", async () => {
        const remove = jest.spyOn(docService, "deleteDoc").mockResolvedValue(true);

        const { status, body } = await invoke(controller.deleteDoc, {
            params: { id: DOC_ID },
            role: "admin"
        });

        expect(remove).toHaveBeenCalledWith(DOC_ID);
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Documento excluído com sucesso." });
    });

    test("responde 404 quando o documento não existe", async () => {
        jest.spyOn(docService, "deleteDoc").mockResolvedValue(false);

        const { status, body } = await invoke(controller.deleteDoc, {
            params: { id: DOC_ID },
            role: "admin"
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Documento não encontrado." });
    });

    test("repassa o 400 de ID inválido do service", async () => {
        jest.spyOn(docService, "deleteDoc").mockRejectedValue(
            serviceError("ID do documento inválido.", 400)
        );

        const { status, body } = await invoke(controller.deleteDoc, {
            params: { id: "nao-e-uuid" },
            role: "admin"
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do documento inválido." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(docService, "deleteDoc").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.deleteDoc, {
            params: { id: DOC_ID },
            role: "admin"
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir documento." });
    });
});
