"use strict";

/**
 * Testes de unidade de `src/controllers/paymentController.js`.
 *
 * Nenhuma chamada externa: `paymentProviderService`, `paymentService` e
 * `shoppingService` são interceptados com `jest.spyOn`, então o Mercado Pago,
 * o banco e o filesystem de checkout não são tocados.
 */

const paymentService = require("../src/services/paymentService");
const shoppingService = require("../src/services/shoppingService");
const paymentProviderService = require("../src/services/paymentProviderService");
const controller = require("../src/controllers/paymentController");
const {
    USER_ID,
    OTHER_ID,
    invoke,
    serviceError,
    unexpectedError
} = require("./helpers/http");

const PAYMENT_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const SHOPPING_ID = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

function shoppingFixture(overrides = {}) {
    return {
        id: SHOPPING_ID,
        id_user: USER_ID,
        status: "accepted",
        value: "100.50",
        user_email: "comprador@example.com",
        ...overrides
    };
}

describe("paymentController.webhook", () => {
    test("entrega a requisição ao provider e responde 200 com received", async () => {
        const webhook = jest.spyOn(paymentProviderService, "webhook").mockResolvedValue(undefined);

        const { req, status, body } = await invoke(controller.webhook, {
            query: { type: "order", "data.id": "123" },
            body: { type: "order", data: { id: "123" } },
            userId: null
        });

        expect(webhook).toHaveBeenCalledTimes(1);
        expect(webhook.mock.calls[0][0]).toBe(req);
        expect(status).toBe(200);
        expect(body).toEqual({ received: true });
    });

    test("repassa status e mensagem quando a assinatura do webhook é recusada", async () => {
        jest.spyOn(paymentProviderService, "webhook")
            .mockRejectedValue(serviceError("Assinatura do webhook inválida.", 401));

        const { status, body } = await invoke(controller.webhook, {
            query: { type: "order" },
            userId: null
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Assinatura do webhook inválida." });
    });

    test("inclui providerDetails do provider na falha com status", async () => {
        jest.spyOn(paymentProviderService, "webhook").mockRejectedValue(
            serviceError("Webhook sem vínculo com o split local.", 409, {
                providerDetails: { payment_id: PAYMENT_ID }
            })
        );

        const { status, body } = await invoke(controller.webhook, {
            query: { type: "payment" },
            userId: null
        });

        expect(status).toBe(409);
        expect(body).toEqual({
            error: "Webhook sem vínculo com o split local.",
            payment_id: PAYMENT_ID
        });
    });

    test("usa 500 e mensagem genérica quando o provider falha sem status", async () => {
        jest.spyOn(paymentProviderService, "webhook")
            .mockRejectedValue(unexpectedError("stack interna do axios"));

        const { status, body } = await invoke(controller.webhook, {
            query: { type: "order" },
            userId: null
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Falha ao processar webhook." });
    });
});

describe("paymentController.getCheckout", () => {
    test("exige usuário autenticado com UUID válido", async () => {
        const getPaymentById = jest.spyOn(paymentService, "getPaymentById");

        const { status, body } = await invoke(controller.getCheckout, {
            userId: "nao-e-um-uuid",
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(getPaymentById).not.toHaveBeenCalled();
    });

    test("recusa id de pagamento inválido com 400", async () => {
        const getPaymentById = jest.spyOn(paymentService, "getPaymentById");

        const { status, body } = await invoke(controller.getCheckout, {
            params: { id: "id-invalido" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do pagamento inválido." });
        expect(getPaymentById).not.toHaveBeenCalled();
    });

    test("responde 404 quando o pagamento não pertence ao usuário", async () => {
        jest.spyOn(paymentService, "getPaymentById").mockResolvedValue(null);
        const getCheckout = jest.spyOn(paymentProviderService, "getCheckout");

        const { status, body } = await invoke(controller.getCheckout, {
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Pagamento não encontrado." });
        expect(getCheckout).not.toHaveBeenCalled();
    });

    test("devolve pagamento e checkout do provider", async () => {
        const payment = { id: PAYMENT_ID, status: "pending", method: "pix" };
        const checkout = { provider: "simulated", status: "pending" };
        const getPaymentById = jest.spyOn(paymentService, "getPaymentById").mockResolvedValue(payment);
        const getCheckout = jest.spyOn(paymentProviderService, "getCheckout").mockResolvedValue(checkout);

        const { status, body } = await invoke(controller.getCheckout, {
            params: { id: PAYMENT_ID }
        });

        expect(getPaymentById).toHaveBeenCalledWith(PAYMENT_ID, USER_ID);
        expect(getCheckout).toHaveBeenCalledWith(PAYMENT_ID);
        expect(status).toBe(200);
        expect(body).toEqual({ payment, checkout });
    });

    test("repassa o status do service sem espalhar providerDetails", async () => {
        jest.spyOn(paymentService, "getPaymentById").mockRejectedValue(
            serviceError("Pagamento de outro provedor ou ambiente.", 409, {
                providerDetails: { provider_code: "outro_ambiente" }
            })
        );

        const { status, body } = await invoke(controller.getCheckout, {
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Pagamento de outro provedor ou ambiente." });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(paymentService, "getPaymentById")
            .mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.getCheckout, {
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao consultar checkout." });
    });
});

describe("paymentController.sync", () => {
    test("exige usuário autenticado com UUID válido", async () => {
        const sync = jest.spyOn(paymentProviderService, "sync");

        const { status, body } = await invoke(controller.sync, {
            userId: "invalido",
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(sync).not.toHaveBeenCalled();
    });

    test("recusa id de pagamento inválido com 400", async () => {
        const sync = jest.spyOn(paymentProviderService, "sync");

        const { status, body } = await invoke(controller.sync, {
            params: { id: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do pagamento inválido." });
        expect(sync).not.toHaveBeenCalled();
    });

    test("devolve 200 com o resultado da sincronização", async () => {
        const result = { payment: { id: PAYMENT_ID, status: "approved" }, checkout: { status: "approved" } };
        const sync = jest.spyOn(paymentProviderService, "sync").mockResolvedValue(result);

        const { status, body } = await invoke(controller.sync, {
            params: { id: PAYMENT_ID }
        });

        expect(sync).toHaveBeenCalledWith(PAYMENT_ID, USER_ID, undefined);
        expect(status).toBe(200);
        expect(body).toEqual(result);
    });

    test("repassa 404 do service quando o pagamento é de outra conta", async () => {
        jest.spyOn(paymentProviderService, "sync")
            .mockRejectedValue(serviceError("Pagamento não encontrado.", 404));

        const { status, body } = await invoke(controller.sync, {
            params: { id: PAYMENT_ID },
            userId: OTHER_ID
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Pagamento não encontrado." });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(paymentProviderService, "sync")
            .mockRejectedValue(unexpectedError("timeout"));

        const { status, body } = await invoke(controller.sync, {
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao processar pagamento." });
    });
});

describe("paymentController.cancel", () => {
    test("exige usuário autenticado com UUID válido", async () => {
        const cancel = jest.spyOn(paymentProviderService, "cancel");

        const { status, body } = await invoke(controller.cancel, {
            userId: "invalido",
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(cancel).not.toHaveBeenCalled();
    });

    test("recusa id de pagamento inválido com 400", async () => {
        const cancel = jest.spyOn(paymentProviderService, "cancel");

        const { status, body } = await invoke(controller.cancel, {
            params: { id: "123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do pagamento inválido." });
        expect(cancel).not.toHaveBeenCalled();
    });

    test("encaminha o userId para o service decidir a posse do pagamento", async () => {
        const result = { payment: { id: PAYMENT_ID, status: "pending" }, checkout: { provider_status: "canceled" } };
        const cancel = jest.spyOn(paymentProviderService, "cancel").mockResolvedValue(result);

        const { status, body } = await invoke(controller.cancel, {
            params: { id: PAYMENT_ID }
        });

        expect(cancel).toHaveBeenCalledWith(PAYMENT_ID, USER_ID, undefined);
        expect(status).toBe(200);
        expect(body).toEqual(result);
    });

    test("repassa 409 quando o pagamento já não está pendente", async () => {
        jest.spyOn(paymentProviderService, "cancel").mockRejectedValue(
            serviceError("Somente pagamentos pendentes podem ser cancelados.", 409)
        );

        const { status, body } = await invoke(controller.cancel, {
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Somente pagamentos pendentes podem ser cancelados." });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(paymentProviderService, "cancel")
            .mockRejectedValue(unexpectedError("falha de socket"));

        const { status, body } = await invoke(controller.cancel, {
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao processar pagamento." });
    });
});

describe("paymentController.refund", () => {
    test("bloqueia reembolso de quem não é admin sem chamar o service", async () => {
        const refund = jest.spyOn(paymentProviderService, "refund");

        const { status, body } = await invoke(controller.refund, {
            role: "user",
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Reembolso exige um administrador." });
        expect(refund).not.toHaveBeenCalled();
    });

    test("exige usuário autenticado com UUID válido antes do papel", async () => {
        const refund = jest.spyOn(paymentProviderService, "refund");

        const { status, body } = await invoke(controller.refund, {
            role: "admin",
            userId: "invalido",
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(refund).not.toHaveBeenCalled();
    });

    test("recusa id de pagamento inválido com 400 mesmo para admin", async () => {
        const refund = jest.spyOn(paymentProviderService, "refund");

        const { status, body } = await invoke(controller.refund, {
            role: "admin",
            params: { id: "id-invalido" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do pagamento inválido." });
        expect(refund).not.toHaveBeenCalled();
    });

    test("admin recebe 200 com o resultado do reembolso", async () => {
        const result = { payment: { id: PAYMENT_ID, status: "refunded" }, checkout: { status: "refunded" } };
        const refund = jest.spyOn(paymentProviderService, "refund").mockResolvedValue(result);

        const { status, body } = await invoke(controller.refund, {
            role: "admin",
            params: { id: PAYMENT_ID }
        });

        expect(refund).toHaveBeenCalledWith(PAYMENT_ID, USER_ID, undefined);
        expect(status).toBe(200);
        expect(body).toEqual(result);
    });

    test("repassa a regra de status do service com providerDetails", async () => {
        jest.spyOn(paymentProviderService, "refund").mockRejectedValue(
            serviceError("Reembolso automático disponível somente para pagamento aprovado de compra não concluída.", 409, {
                providerDetails: { payment_id: PAYMENT_ID }
            })
        );

        const { status, body } = await invoke(controller.refund, {
            role: "admin",
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(409);
        expect(body).toEqual({
            error: "Reembolso automático disponível somente para pagamento aprovado de compra não concluída.",
            payment_id: PAYMENT_ID
        });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(paymentProviderService, "refund")
            .mockRejectedValue(unexpectedError("erro de criptografia"));

        const { status, body } = await invoke(controller.refund, {
            role: "admin",
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao processar pagamento." });
    });
});

describe("paymentController.simulate", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalProvider = process.env.PAYMENT_PROVIDER;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalProvider === undefined) delete process.env.PAYMENT_PROVIDER;
        else process.env.PAYMENT_PROVIDER = originalProvider;
    });

    test("exige usuário autenticado com UUID válido", async () => {
        const simulate = jest.spyOn(paymentProviderService, "simulate");

        const { status, body } = await invoke(controller.simulate, {
            userId: "invalido",
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(simulate).not.toHaveBeenCalled();
    });

    test("recusa id de pagamento inválido com 400", async () => {
        const simulate = jest.spyOn(paymentProviderService, "simulate");

        const { status, body } = await invoke(controller.simulate, {
            params: { id: "xyz" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do pagamento inválido." });
        expect(simulate).not.toHaveBeenCalled();
    });

    test("respeita o bloqueio de produção do provider real (NODE_ENV=production)", async () => {
        process.env.PAYMENT_PROVIDER = "simulated";
        process.env.NODE_ENV = "production";

        // Sem spy: o provider real recusa antes de qualquer acesso a banco ou rede.
        const { status, body } = await invoke(controller.simulate, {
            params: { id: PAYMENT_ID },
            body: { status: "approved" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Simulação desabilitada neste ambiente." });
    });

    test("encaminha o status do body e devolve o resultado da simulação", async () => {
        const result = { payment: { id: PAYMENT_ID, status: "approved" }, checkout: { status: "approved" } };
        const simulate = jest.spyOn(paymentProviderService, "simulate").mockResolvedValue(result);

        const { status, body } = await invoke(controller.simulate, {
            params: { id: PAYMENT_ID },
            body: { status: "approved" }
        });

        expect(simulate).toHaveBeenCalledWith(PAYMENT_ID, USER_ID, "approved");
        expect(status).toBe(200);
        expect(body).toEqual(result);
    });

    test("repassa 400 do service quando o status simulado é inválido", async () => {
        jest.spyOn(paymentProviderService, "simulate")
            .mockRejectedValue(serviceError("Na simulação, use approved ou refused.", 400));

        const { status, body } = await invoke(controller.simulate, {
            params: { id: PAYMENT_ID },
            body: { status: "canceled" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Na simulação, use approved ou refused." });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(paymentProviderService, "simulate")
            .mockRejectedValue(unexpectedError("checkout corrompido"));

        const { status, body } = await invoke(controller.simulate, {
            params: { id: PAYMENT_ID },
            body: { status: "approved" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao processar pagamento." });
    });
});

describe("paymentController.createPayment", () => {
    test("exige usuário autenticado com UUID válido", async () => {
        const prepare = jest.spyOn(paymentProviderService, "prepare");

        const { status, body } = await invoke(controller.createPayment, {
            userId: "invalido",
            body: { id_shopping: SHOPPING_ID, method: "pix" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(prepare).not.toHaveBeenCalled();
    });

    test("recusa id da compra inválido com 400", async () => {
        const prepare = jest.spyOn(paymentProviderService, "prepare");

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: "compra-invalida", method: "pix" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra inválido." });
        expect(prepare).not.toHaveBeenCalled();
    });

    test("recusa método de pagamento fora da lista com 400", async () => {
        const prepare = jest.spyOn(paymentProviderService, "prepare");

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "boleto" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Método inválido. Use pix, credit_card ou debit_card." });
        expect(prepare).not.toHaveBeenCalled();
    });

    test("responde 404 quando a compra não existe", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(undefined);
        const prepare = jest.spyOn(paymentProviderService, "prepare");

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "pix" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Compra não encontrada." });
        expect(prepare).not.toHaveBeenCalled();
    });

    test("bloqueia compra de outro usuário com 403 antes de preparar o provider", async () => {
        jest.spyOn(shoppingService, "getShoppingById")
            .mockResolvedValue(shoppingFixture({ id_user: OTHER_ID }));
        const prepare = jest.spyOn(paymentProviderService, "prepare");

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "pix" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso negado a esta compra." });
        expect(prepare).not.toHaveBeenCalled();
    });

    test("aceita a posse mesmo com caixa diferente no UUID", async () => {
        jest.spyOn(shoppingService, "getShoppingById")
            .mockResolvedValue(shoppingFixture({ id_user: USER_ID.toUpperCase() }));
        jest.spyOn(paymentProviderService, "prepare")
            .mockResolvedValue({ input: {}, gateway: { provider: "simulated", split: null } });
        jest.spyOn(paymentService, "createPayment")
            .mockResolvedValue({ reused: true, id: PAYMENT_ID });
        jest.spyOn(paymentProviderService, "createPayment").mockResolvedValue({ status: "pending" });
        jest.spyOn(paymentService, "getPaymentById").mockResolvedValue({ id: PAYMENT_ID });

        const { status } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "pix" }
        });

        expect(status).toBe(200);
    });

    test("responde 409 quando a reserva ainda está pendente de aceite", async () => {
        jest.spyOn(shoppingService, "getShoppingById")
            .mockResolvedValue(shoppingFixture({ status: "pending" }));
        const prepare = jest.spyOn(paymentProviderService, "prepare");

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "pix" }
        });

        expect(status).toBe(409);
        expect(body).toEqual({
            error: "A empresa ainda não aceitou esta reserva. O pagamento é liberado depois do aceite."
        });
        expect(prepare).not.toHaveBeenCalled();
    });

    test("responde 409 quando a compra está em outro status final", async () => {
        jest.spyOn(shoppingService, "getShoppingById")
            .mockResolvedValue(shoppingFixture({ status: "refused" }));
        const prepare = jest.spyOn(paymentProviderService, "prepare");

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "pix" }
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "A compra não está disponível para pagamento." });
        expect(prepare).not.toHaveBeenCalled();
    });

    test("recusa compra sem valor positivo com 400", async () => {
        jest.spyOn(shoppingService, "getShoppingById")
            .mockResolvedValue(shoppingFixture({ value: "0" }));
        const prepare = jest.spyOn(paymentProviderService, "prepare");

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "pix" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A compra deve possuir um valor maior que zero." });
        expect(prepare).not.toHaveBeenCalled();
    });

    test("registra um pagamento novo e responde 201", async () => {
        const shopping = shoppingFixture();
        const prepared = {
            input: { method: "pix" },
            gateway: { provider: "simulated", environment: "simulated", split: null }
        };
        const created = { reused: false, id: PAYMENT_ID, status: "pending" };
        const payment = { id: PAYMENT_ID, status: "pending" };
        const updated = { id: PAYMENT_ID, status: "pending", method: "pix" };
        const checkout = { provider: "simulated", status: "pending", qr_code: null };
        const body = { id_shopping: SHOPPING_ID, method: "pix" };

        const getShoppingById = jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shopping);
        const prepare = jest.spyOn(paymentProviderService, "prepare").mockResolvedValue(prepared);
        const create = jest.spyOn(paymentService, "createPayment").mockResolvedValue(created);
        const createProvider = jest.spyOn(paymentProviderService, "createPayment").mockResolvedValue(checkout);
        const getPaymentById = jest.spyOn(paymentService, "getPaymentById").mockResolvedValue(updated);

        const result = await invoke(controller.createPayment, { body });

        expect(getShoppingById).toHaveBeenCalledWith(SHOPPING_ID);
        expect(prepare).toHaveBeenCalledWith("pix", body, "comprador@example.com", SHOPPING_ID);
        expect(create).toHaveBeenCalledWith({
            id_shopping: SHOPPING_ID,
            userId: USER_ID,
            method: "pix",
            gateway: prepared.gateway
        });
        expect(createProvider).toHaveBeenCalledWith(payment, prepared);
        expect(getPaymentById).toHaveBeenCalledWith(PAYMENT_ID, USER_ID);
        expect(result.status).toBe(201);
        expect(result.body).toEqual({
            message: "Pagamento registrado com sucesso.",
            payment: updated,
            checkout
        });
    });

    test("recupera pagamento existente com 200 quando o service reusa o registro", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(paymentProviderService, "prepare")
            .mockResolvedValue({ input: {}, gateway: { provider: "simulated", split: null } });
        jest.spyOn(paymentService, "createPayment")
            .mockResolvedValue({ reused: true, id: PAYMENT_ID, status: "pending" });
        const createProvider = jest.spyOn(paymentProviderService, "createPayment")
            .mockResolvedValue({ provider: "simulated", status: "pending" });
        const updated = { id: PAYMENT_ID, status: "pending" };
        jest.spyOn(paymentService, "getPaymentById").mockResolvedValue(updated);

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "credit_card" }
        });

        expect(createProvider).toHaveBeenCalledWith({ id: PAYMENT_ID, status: "pending" }, expect.anything());
        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Pagamento recuperado com sucesso.",
            payment: updated,
            checkout: { provider: "simulated", status: "pending" }
        });
    });

    test("repassa status, mensagem e providerDetails do provider", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(paymentProviderService, "prepare")
            .mockResolvedValue({ input: {}, gateway: { provider: "mercado_pago", split: null } });
        jest.spyOn(paymentService, "createPayment")
            .mockResolvedValue({ reused: false, id: PAYMENT_ID, status: "pending" });
        jest.spyOn(paymentProviderService, "createPayment").mockRejectedValue(
            serviceError("Pagamento ainda não localizado. Sincronize novamente; não crie outra cobrança.", 409, {
                providerDetails: { payment_id: PAYMENT_ID, reconciliation_required: true }
            })
        );

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "pix" }
        });

        expect(status).toBe(409);
        expect(body).toEqual({
            error: "Pagamento ainda não localizado. Sincronize novamente; não crie outra cobrança.",
            payment_id: PAYMENT_ID,
            reconciliation_required: true
        });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(paymentProviderService, "prepare")
            .mockRejectedValue(unexpectedError("hash do provider quebrou"));

        const { status, body } = await invoke(controller.createPayment, {
            body: { id_shopping: SHOPPING_ID, method: "pix" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao registrar pagamento." });
    });
});

describe("paymentController.getPaymentById", () => {
    test("exige usuário autenticado com UUID válido", async () => {
        const getPaymentById = jest.spyOn(paymentService, "getPaymentById");

        const { status, body } = await invoke(controller.getPaymentById, {
            userId: "invalido",
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(getPaymentById).not.toHaveBeenCalled();
    });

    test("recusa id de pagamento inválido com 400", async () => {
        const getPaymentById = jest.spyOn(paymentService, "getPaymentById");

        const { status, body } = await invoke(controller.getPaymentById, {
            params: { id: "id-invalido" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do pagamento inválido." });
        expect(getPaymentById).not.toHaveBeenCalled();
    });

    test("responde 404 quando o service não devolve pagamento", async () => {
        jest.spyOn(paymentService, "getPaymentById").mockResolvedValue(null);

        const { status, body } = await invoke(controller.getPaymentById, {
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Pagamento não encontrado." });
    });

    test("devolve o pagamento cru com 200", async () => {
        const payment = { id: PAYMENT_ID, status: "approved", method: "pix" };
        const getPaymentById = jest.spyOn(paymentService, "getPaymentById").mockResolvedValue(payment);

        const { status, body } = await invoke(controller.getPaymentById, {
            params: { id: PAYMENT_ID }
        });

        expect(getPaymentById).toHaveBeenCalledWith(PAYMENT_ID, USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(payment);
    });

    test("comportamento atual: ignora error.status do service e responde 500 genérico", async () => {
        jest.spyOn(paymentService, "getPaymentById")
            .mockRejectedValue(serviceError("Pagamento não encontrado.", 404));

        const { status, body } = await invoke(controller.getPaymentById, {
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao consultar pagamento." });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(paymentService, "getPaymentById")
            .mockRejectedValue(unexpectedError("banco fora do ar"));

        const { status, body } = await invoke(controller.getPaymentById, {
            params: { id: PAYMENT_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao consultar pagamento." });
    });
});

describe("paymentController.getPaymentsByShoppingId", () => {
    test("exige usuário autenticado com UUID válido", async () => {
        const getPayments = jest.spyOn(paymentService, "getPaymentsByShoppingId");

        const { status, body } = await invoke(controller.getPaymentsByShoppingId, {
            userId: "invalido",
            params: { shoppingId: SHOPPING_ID }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(getPayments).not.toHaveBeenCalled();
    });

    test("recusa id da compra inválido com 400", async () => {
        const getPayments = jest.spyOn(paymentService, "getPaymentsByShoppingId");

        const { status, body } = await invoke(controller.getPaymentsByShoppingId, {
            params: { shoppingId: "compra-invalida" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID da compra inválido." });
        expect(getPayments).not.toHaveBeenCalled();
    });

    test("responde 404 quando a compra não existe", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(null);
        const getPayments = jest.spyOn(paymentService, "getPaymentsByShoppingId");

        const { status, body } = await invoke(controller.getPaymentsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Compra não encontrada." });
        expect(getPayments).not.toHaveBeenCalled();
    });

    test("bloqueia consulta da compra de outro usuário com 403", async () => {
        jest.spyOn(shoppingService, "getShoppingById")
            .mockResolvedValue(shoppingFixture({ id_user: OTHER_ID }));
        const getPayments = jest.spyOn(paymentService, "getPaymentsByShoppingId");

        const { status, body } = await invoke(controller.getPaymentsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso negado a esta compra." });
        expect(getPayments).not.toHaveBeenCalled();
    });

    test("devolve a lista de pagamentos do dono com 200", async () => {
        const payments = [{ id: PAYMENT_ID, status: "approved" }];
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        const getPayments = jest.spyOn(paymentService, "getPaymentsByShoppingId")
            .mockResolvedValue(payments);

        const { status, body } = await invoke(controller.getPaymentsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(getPayments).toHaveBeenCalledWith(SHOPPING_ID, USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(payments);
    });

    test("comportamento atual: ignora error.status do service e responde 500 genérico", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(paymentService, "getPaymentsByShoppingId")
            .mockRejectedValue(serviceError("Pagamento não encontrado.", 404));

        const { status, body } = await invoke(controller.getPaymentsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao consultar pagamentos da compra." });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(shoppingService, "getShoppingById").mockResolvedValue(shoppingFixture());
        jest.spyOn(paymentService, "getPaymentsByShoppingId")
            .mockRejectedValue(unexpectedError("pool esgotado"));

        const { status, body } = await invoke(controller.getPaymentsByShoppingId, {
            params: { shoppingId: SHOPPING_ID }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao consultar pagamentos da compra." });
    });
});
