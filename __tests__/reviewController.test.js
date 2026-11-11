"use strict";

const reviewService = require("../src/services/reviewService");
const uuid = require("../src/utils/uuid");
const controller = require("../src/controllers/reviewController");
const { invoke, serviceError, unexpectedError, USER_ID, OTHER_ID } = require("./helpers/http");

const REVIEW_ID = "5e6f7081-92a3-4b1c-8d3e-4f5a6b7c8d9e";
const SHOPPING_ID = "6f708192-a3b4-4c2d-9e4f-5a6b7c8d9e0f";

function codedError(message, code) {
    return Object.assign(new Error(message), { code });
}

function storedReview(overrides = {}) {
    return {
        id: REVIEW_ID,
        rating: 5,
        comment: "Atendimento excelente.",
        created_in: "2026-11-10T12:00:00.000Z",
        id_shopping: SHOPPING_ID,
        id_reviewer: USER_ID,
        id_reviewed: OTHER_ID,
        ...overrides
    };
}

// =========================================================
// createReview
// =========================================================
describe("reviewController.createReview", () => {
    test("exige usuário autenticado válido antes de validar o corpo", async () => {
        const create = jest.spyOn(reviewService, "createReview");

        const { status, body } = await invoke(controller.createReview, {
            userId: "nao-e-uuid",
            body: {}
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(create).not.toHaveBeenCalled();
    });

    test.each([
        ["sem nota", { id_shopping: SHOPPING_ID, id_reviewed: OTHER_ID }],
        ["sem compra", { rating: 5, id_reviewed: OTHER_ID }],
        ["sem usuário avaliado", { rating: 5, id_shopping: SHOPPING_ID }]
    ])("exige os campos obrigatórios (%s)", async (_label, requestBody) => {
        const create = jest.spyOn(reviewService, "createReview");

        const { status, body } = await invoke(controller.createReview, { body: requestBody });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Nota, compra e usuário avaliado são obrigatórios." });
        expect(create).not.toHaveBeenCalled();
    });

    test.each([
        ["fracionária", 4.5],
        ["zero", 0],
        ["acima de cinco", 6],
        ["textual", "5"]
    ])("rejeita nota %s com 400", async (_label, rating) => {
        const create = jest.spyOn(reviewService, "createReview");

        const { status, body } = await invoke(controller.createReview, {
            body: { rating, id_shopping: SHOPPING_ID, id_reviewed: OTHER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A nota deve ser um número inteiro entre 1 e 5." });
        expect(create).not.toHaveBeenCalled();
    });

    test("rejeita UUID inválido de compra ou de usuário avaliado", async () => {
        const create = jest.spyOn(reviewService, "createReview");

        const { status, body } = await invoke(controller.createReview, {
            body: { rating: 5, id_shopping: "nao-e-uuid", id_reviewed: OTHER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra ou do usuário inválido." });
        expect(create).not.toHaveBeenCalled();
    });

    test("impede autoavaliação", async () => {
        const create = jest.spyOn(reviewService, "createReview");

        const { status, body } = await invoke(controller.createReview, {
            body: { rating: 5, id_shopping: SHOPPING_ID, id_reviewed: USER_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Você não pode avaliar a si mesmo." });
        expect(create).not.toHaveBeenCalled();
    });

    test("rejeita comentário com mais de 1000 caracteres", async () => {
        const create = jest.spyOn(reviewService, "createReview");

        const { status, body } = await invoke(controller.createReview, {
            body: {
                rating: 5,
                comment: "c".repeat(1001),
                id_shopping: SHOPPING_ID,
                id_reviewed: OTHER_ID
            }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "O comentário não pode ultrapassar 1000 caracteres." });
        expect(create).not.toHaveBeenCalled();
    });

    test("cria a avaliação com o autor vindo do token e responde 201", async () => {
        const create = jest.spyOn(reviewService, "createReview").mockResolvedValue(REVIEW_ID);

        const { status, body } = await invoke(controller.createReview, {
            body: {
                rating: 4,
                comment: "Bom negócio.",
                id_shopping: SHOPPING_ID,
                id_reviewed: OTHER_ID
            }
        });

        expect(create).toHaveBeenCalledWith({
            rating: 4,
            comment: "Bom negócio.",
            id_shopping: SHOPPING_ID,
            id_reviewer: USER_ID,
            id_reviewed: OTHER_ID
        });
        expect(status).toBe(201);
        expect(body).toEqual({ message: "Avaliação cadastrada com sucesso.", id: REVIEW_ID });
    });

    test("ignora id_reviewer enviado no corpo", async () => {
        const create = jest.spyOn(reviewService, "createReview").mockResolvedValue(REVIEW_ID);

        await invoke(controller.createReview, {
            body: {
                rating: 4,
                id_shopping: SHOPPING_ID,
                id_reviewed: OTHER_ID,
                id_reviewer: OTHER_ID
            }
        });

        expect(create).toHaveBeenCalledWith({
            rating: 4,
            comment: undefined,
            id_shopping: SHOPPING_ID,
            id_reviewer: USER_ID,
            id_reviewed: OTHER_ID
        });
    });

    test("aceita comentário não textual sem validar o tipo (comportamento atual)", async () => {
        const create = jest.spyOn(reviewService, "createReview").mockResolvedValue(REVIEW_ID);

        const { status } = await invoke(controller.createReview, {
            body: { rating: 4, comment: 123, id_shopping: SHOPPING_ID, id_reviewed: OTHER_ID }
        });

        expect(status).toBe(201);
        expect(create).toHaveBeenCalledWith({
            rating: 4,
            comment: 123,
            id_shopping: SHOPPING_ID,
            id_reviewer: USER_ID,
            id_reviewed: OTHER_ID
        });
    });

    test("responde 404 quando a compra não existe", async () => {
        jest.spyOn(reviewService, "createReview").mockRejectedValue(
            codedError("Compra não encontrada.", "SHOPPING_NOT_FOUND")
        );

        const { status, body } = await invoke(controller.createReview, {
            body: { rating: 5, id_shopping: SHOPPING_ID, id_reviewed: OTHER_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Compra não encontrada." });
    });

    test("responde 403 quando a compra não permite avaliação", async () => {
        jest.spyOn(reviewService, "createReview").mockRejectedValue(
            codedError(
                "Usuários não possuem vínculo de compra e venda nesta transação.",
                "REVIEW_NOT_ALLOWED"
            )
        );

        const { status, body } = await invoke(controller.createReview, {
            body: { rating: 5, id_shopping: SHOPPING_ID, id_reviewed: OTHER_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({
            error: "Usuários não possuem vínculo de compra e venda nesta transação."
        });
    });

    test("responde 404 quando o usuário avaliado não existe", async () => {
        jest.spyOn(reviewService, "createReview").mockRejectedValue(
            codedError("Usuário avaliado não encontrado.", "USER_NOT_FOUND")
        );

        const { status, body } = await invoke(controller.createReview, {
            body: { rating: 5, id_shopping: SHOPPING_ID, id_reviewed: OTHER_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário avaliado não encontrado." });
    });

    test("responde 409 com mensagem fixa em duplicidade do banco", async () => {
        jest.spyOn(reviewService, "createReview").mockRejectedValue(
            codedError("Duplicate entry for key 'review.idx_review'", "ER_DUP_ENTRY")
        );

        const { status, body } = await invoke(controller.createReview, {
            body: { rating: 5, id_shopping: SHOPPING_ID, id_reviewed: OTHER_ID }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Você já avaliou essa compra." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(reviewService, "createReview").mockRejectedValue(
            unexpectedError("falha no flush da outbox")
        );

        const { status, body } = await invoke(controller.createReview, {
            body: { rating: 5, id_shopping: SHOPPING_ID, id_reviewed: OTHER_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao cadastrar avaliação." });
    });
});

// =========================================================
// getReviews
// =========================================================
describe("reviewController.getReviews", () => {
    test("lista todas as avaliações com 200", async () => {
        const reviews = [storedReview(), storedReview({ id: OTHER_ID, rating: 3 })];
        const list = jest.spyOn(reviewService, "getReviews").mockResolvedValue(reviews);

        const { status, body } = await invoke(controller.getReviews);

        expect(list).toHaveBeenCalledWith();
        expect(status).toBe(200);
        expect(body).toEqual(reviews);
    });

    test("não repassa o status do service: erro com status 400 vira 500 genérico", async () => {
        jest.spyOn(reviewService, "getReviews").mockRejectedValue(
            serviceError("Falha de leitura.", 400)
        );

        const { status, body } = await invoke(controller.getReviews);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar avaliações." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(reviewService, "getReviews").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.getReviews);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar avaliações." });
    });
});

// =========================================================
// getReviewById
// =========================================================
describe("reviewController.getReviewById", () => {
    test("rejeita ID inválido com 400 sem chamar o service", async () => {
        const find = jest.spyOn(reviewService, "getReviewById");

        const { status, body } = await invoke(controller.getReviewById, {
            params: { id: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da avaliação inválido." });
        expect(find).not.toHaveBeenCalled();
    });

    test("converte o UUID para binário e devolve a avaliação com 200", async () => {
        const review = storedReview();
        const find = jest.spyOn(reviewService, "getReviewById").mockResolvedValue(review);

        const { status, body } = await invoke(controller.getReviewById, {
            params: { id: REVIEW_ID }
        });

        expect(find).toHaveBeenCalledWith(uuid.toBin(REVIEW_ID));
        expect(Buffer.isBuffer(find.mock.calls[0][0])).toBe(true);
        expect(status).toBe(200);
        expect(body).toEqual(review);
    });

    test("responde 404 quando a avaliação não existe", async () => {
        jest.spyOn(reviewService, "getReviewById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getReviewById, {
            params: { id: REVIEW_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Avaliação não encontrada." });
    });

    test("não repassa o status do service: erro com status 404 vira 500 genérico", async () => {
        jest.spyOn(reviewService, "getReviewById").mockRejectedValue(
            serviceError("Registro indisponível.", 404)
        );

        const { status, body } = await invoke(controller.getReviewById, {
            params: { id: REVIEW_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar avaliação." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(reviewService, "getReviewById").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.getReviewById, {
            params: { id: REVIEW_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar avaliação." });
    });
});

// =========================================================
// updateReview
// =========================================================
describe("reviewController.updateReview", () => {
    test("exige usuário autenticado válido", async () => {
        const update = jest.spyOn(reviewService, "updateReview");

        const { status, body } = await invoke(controller.updateReview, {
            userId: "nao-e-uuid",
            params: { id: REVIEW_ID },
            body: { rating: 4 }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(update).not.toHaveBeenCalled();
    });

    test("rejeita ID da avaliação inválido", async () => {
        const update = jest.spyOn(reviewService, "updateReview");

        const { status, body } = await invoke(controller.updateReview, {
            params: { id: "nao-e-uuid" },
            body: { rating: 4 }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da avaliação inválido." });
        expect(update).not.toHaveBeenCalled();
    });

    test("exige ao menos um campo para atualizar", async () => {
        const update = jest.spyOn(reviewService, "updateReview");

        const { status, body } = await invoke(controller.updateReview, {
            params: { id: REVIEW_ID },
            body: {}
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Informe a nota ou o comentário para atualizar." });
        expect(update).not.toHaveBeenCalled();
    });

    test("rejeita nota fora do intervalo 1..5", async () => {
        const update = jest.spyOn(reviewService, "updateReview");

        const { status, body } = await invoke(controller.updateReview, {
            params: { id: REVIEW_ID },
            body: { rating: 6 }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A nota deve ser um número inteiro entre 1 e 5." });
        expect(update).not.toHaveBeenCalled();
    });

    test("rejeita comentário com mais de 1000 caracteres", async () => {
        const update = jest.spyOn(reviewService, "updateReview");

        const { status, body } = await invoke(controller.updateReview, {
            params: { id: REVIEW_ID },
            body: { comment: "c".repeat(1001) }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "O comentário não pode ultrapassar 1000 caracteres." });
        expect(update).not.toHaveBeenCalled();
    });

    test("atualiza a avaliação e repassa autor, corpo e papel ao service", async () => {
        const updated = storedReview({ rating: 4 });
        const update = jest.spyOn(reviewService, "updateReview").mockResolvedValue(updated);

        const { status, body } = await invoke(controller.updateReview, {
            params: { id: REVIEW_ID },
            body: { rating: 4 }
        });

        expect(update).toHaveBeenCalledWith(
            uuid.toBin(REVIEW_ID),
            USER_ID,
            { rating: 4, comment: undefined },
            "user"
        );
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Avaliação atualizada com sucesso.", review: updated });
    });

    test("permite admin editar avaliação de outro autor", async () => {
        const update = jest.spyOn(reviewService, "updateReview").mockResolvedValue(storedReview());

        const { status } = await invoke(controller.updateReview, {
            role: "admin",
            params: { id: REVIEW_ID },
            body: { comment: "Editado pela moderação." }
        });

        expect(status).toBe(200);
        expect(update).toHaveBeenCalledWith(
            uuid.toBin(REVIEW_ID),
            USER_ID,
            { rating: undefined, comment: "Editado pela moderação." },
            "admin"
        );
    });

    test("responde 404 quando a avaliação não existe", async () => {
        jest.spyOn(reviewService, "updateReview").mockRejectedValue(
            codedError("Avaliação não encontrada.", "NOT_FOUND")
        );

        const { status, body } = await invoke(controller.updateReview, {
            params: { id: REVIEW_ID },
            body: { rating: 4 }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Avaliação não encontrada." });
    });

    test("responde 403 quando o autor não é o dono nem admin", async () => {
        jest.spyOn(reviewService, "updateReview").mockRejectedValue(
            codedError("Você não tem permissão para editar esta avaliação.", "FORBIDDEN")
        );

        const { status, body } = await invoke(controller.updateReview, {
            params: { id: REVIEW_ID },
            body: { rating: 4 }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Você não tem permissão para editar esta avaliação." });
    });

    test("responde 400 quando o service sinaliza NO_FIELDS", async () => {
        jest.spyOn(reviewService, "updateReview").mockRejectedValue(
            codedError("Nenhum campo válido para atualizar.", "NO_FIELDS")
        );

        const { status, body } = await invoke(controller.updateReview, {
            params: { id: REVIEW_ID },
            body: { rating: 4 }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Nenhum campo válido para atualizar." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(reviewService, "updateReview").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.updateReview, {
            params: { id: REVIEW_ID },
            body: { rating: 4 }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar avaliação." });
    });
});

// =========================================================
// deleteReview
// =========================================================
describe("reviewController.deleteReview", () => {
    test("exige usuário autenticado válido", async () => {
        const remove = jest.spyOn(reviewService, "deleteReview");

        const { status, body } = await invoke(controller.deleteReview, {
            userId: "nao-e-uuid",
            params: { id: REVIEW_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Usuário não autenticado." });
        expect(remove).not.toHaveBeenCalled();
    });

    test("rejeita ID da avaliação inválido", async () => {
        const remove = jest.spyOn(reviewService, "deleteReview");

        const { status, body } = await invoke(controller.deleteReview, {
            params: { id: "nao-e-uuid" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da avaliação inválido." });
        expect(remove).not.toHaveBeenCalled();
    });

    test("exclui a avaliação e responde 200", async () => {
        const remove = jest.spyOn(reviewService, "deleteReview").mockResolvedValue(true);

        const { status, body } = await invoke(controller.deleteReview, {
            params: { id: REVIEW_ID }
        });

        expect(remove).toHaveBeenCalledWith(uuid.toBin(REVIEW_ID), USER_ID, "user");
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Avaliação excluída com sucesso." });
    });

    test("repassa o papel admin para o service", async () => {
        const remove = jest.spyOn(reviewService, "deleteReview").mockResolvedValue(true);

        await invoke(controller.deleteReview, {
            role: "admin",
            params: { id: REVIEW_ID }
        });

        expect(remove).toHaveBeenCalledWith(uuid.toBin(REVIEW_ID), USER_ID, "admin");
    });

    test("responde 404 quando a avaliação não existe", async () => {
        jest.spyOn(reviewService, "deleteReview").mockRejectedValue(
            codedError("Avaliação não encontrada.", "NOT_FOUND")
        );

        const { status, body } = await invoke(controller.deleteReview, {
            params: { id: REVIEW_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Avaliação não encontrada." });
    });

    test("responde 403 quando quem exclui não é o dono nem admin", async () => {
        jest.spyOn(reviewService, "deleteReview").mockRejectedValue(
            codedError("Você não tem permissão para excluir esta avaliação.", "FORBIDDEN")
        );

        const { status, body } = await invoke(controller.deleteReview, {
            params: { id: REVIEW_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Você não tem permissão para excluir esta avaliação." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(reviewService, "deleteReview").mockRejectedValue(unexpectedError());

        const { status, body } = await invoke(controller.deleteReview, {
            params: { id: REVIEW_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir avaliação." });
    });
});
