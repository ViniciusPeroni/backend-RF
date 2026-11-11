"use strict";

const commissionService = require("../src/services/commissionService");
const controller = require("../src/controllers/commissionController");
const { invoke, serviceError, unexpectedError } = require("./helpers/http");

describe("commissionController.generateCommission", () => {
    test("bloqueia quem não é admin sem chamar o service", async () => {
        const generate = jest.spyOn(commissionService, "generateCommission");

        const { status, body } = await invoke(controller.generateCommission, {
            role: "user",
            params: { paymentId: "payment-id" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso não autorizado." });
        expect(generate).not.toHaveBeenCalled();
    });

    test("gera a comissão do admin e devolve o resultado do service", async () => {
        const commission = { id: "commission-id", percentage: 8, value: 9.88, id_payment: "payment-id" };
        const generate = jest.spyOn(commissionService, "generateCommission").mockResolvedValue(commission);

        const { status, body } = await invoke(controller.generateCommission, {
            role: "admin",
            params: { paymentId: "payment-id" }
        });

        expect(generate).toHaveBeenCalledWith("payment-id");
        expect(status).toBe(200);
        expect(body).toEqual({ message: "Comissão gerada com sucesso.", commission });
    });

    test("repassa o status de erro de validação do service", async () => {
        jest.spyOn(commissionService, "generateCommission")
            .mockRejectedValue(serviceError("Pagamento não encontrado.", 404));

        const { status, body } = await invoke(controller.generateCommission, {
            role: "admin",
            params: { paymentId: "payment-id" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Pagamento não encontrado." });
    });

    test("usa mensagem genérica e 500 para falha inesperada", async () => {
        jest.spyOn(commissionService, "generateCommission")
            .mockRejectedValue(unexpectedError("senha do banco vazou"));

        const { status, body } = await invoke(controller.generateCommission, {
            role: "admin",
            params: { paymentId: "payment-id" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao gerar comissão." });
    });
});
