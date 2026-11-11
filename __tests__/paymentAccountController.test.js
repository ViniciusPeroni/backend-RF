"use strict";

/**
 * Testes de unidade de `src/controllers/paymentAccountController.js`.
 *
 * `paymentAccountService`, `paymentSplitService` e o provider do Mercado Pago
 * são interceptados com `jest.spyOn`: nenhuma chamada OAuth, HTTP ou banco.
 */

const accounts = require("../src/services/paymentAccountService");
const split = require("../src/services/paymentSplitService");
const mercadoPago = require("../src/services/providers/mercadoPagoPaymentProvider");
const controller = require("../src/controllers/paymentAccountController");
const {
    USER_ID,
    invoke,
    serviceError,
    unexpectedError
} = require("./helpers/http");

const ENV_KEYS = ["MERCADO_PAGO_PUBLIC_KEY", "MERCADO_PAGO_WEBHOOK_SECRET", "PAYMENT_WEBHOOK_URL"];
const originalEnv = {};

beforeAll(() => {
    ENV_KEYS.forEach((key) => {
        originalEnv[key] = process.env[key];
    });
});

afterEach(() => {
    ENV_KEYS.forEach((key) => {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
    });
});

function setEnv(values) {
    Object.entries(values).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
}

/**
 * `callback` usa `res.set`, que o helper de resposta não implementa. O wrapper
 * apenas completa o `res` falso e delega ao handler real via `invoke`.
 */
function invokeCallback(options = {}) {
    return invoke((req, res) => {
        res.set = (name, value) => {
            res.headers[name] = value;
            return res;
        };
        return controller.callback(req, res);
    }, options);
}

describe("paymentAccountController.start", () => {
    test("exige usuário autenticado com UUID válido", async () => {
        const start = jest.spyOn(accounts, "start");

        const { status, body } = await invoke(controller.start, { userId: "invalido" });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(start).not.toHaveBeenCalled();
    });

    test("devolve a URL de autorização OAuth com 200", async () => {
        const result = {
            authorization_url: "https://auth.mercadopago.com.br/authorization?client_id=123&state=abc",
            expires_in: 600
        };
        const start = jest.spyOn(accounts, "start").mockResolvedValue(result);

        const { status, body } = await invoke(controller.start);

        expect(start).toHaveBeenCalledWith(USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(result);
    });

    test("repassa 403 quando a conta local não está ativa", async () => {
        jest.spyOn(accounts, "start")
            .mockRejectedValue(serviceError("Ative a conta antes de vincular o Mercado Pago.", 403));

        const { status, body } = await invoke(controller.start);

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Ative a conta antes de vincular o Mercado Pago." });
    });

    test("inclui providerDetails quando a configuração do marketplace falha", async () => {
        jest.spyOn(accounts, "start").mockRejectedValue(
            serviceError("Configure Client ID e Client Secret da aplicação Marketplace.", 503, {
                providerDetails: { provider_code: "invalid_client" }
            })
        );

        const { status, body } = await invoke(controller.start);

        expect(status).toBe(503);
        expect(body).toEqual({
            error: "Configure Client ID e Client Secret da aplicação Marketplace.",
            provider_code: "invalid_client"
        });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(accounts, "start").mockRejectedValue(unexpectedError("crypto.randomBytes falhou"));

        const { status, body } = await invoke(controller.start);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao processar a conta de pagamento." });
    });
});

describe("paymentAccountController.status", () => {
    test("exige usuário autenticado com UUID válido", async () => {
        const status = jest.spyOn(accounts, "status");

        const { status: code, body } = await invoke(controller.status, { userId: null });

        expect(code).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(status).not.toHaveBeenCalled();
    });

    test("devolve o vínculo atual com 200", async () => {
        const result = { connected: false, environment: "test", credentials_expired: false };
        const status = jest.spyOn(accounts, "status").mockResolvedValue(result);

        const { status: code, body } = await invoke(controller.status);

        expect(status).toHaveBeenCalledWith(USER_ID);
        expect(code).toBe(200);
        expect(body).toEqual(result);
    });

    test("repassa erro de configuração do provider com status", async () => {
        jest.spyOn(accounts, "status").mockRejectedValue(
            serviceError("Configure o ambiente e o Access Token do Mercado Pago.", 503)
        );

        const { status, body } = await invoke(controller.status);

        expect(status).toBe(503);
        expect(body).toEqual({ error: "Configure o ambiente e o Access Token do Mercado Pago." });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(accounts, "status").mockRejectedValue(unexpectedError("query falhou"));

        const { status, body } = await invoke(controller.status);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao processar a conta de pagamento." });
    });
});

describe("paymentAccountController.disconnect", () => {
    test("exige usuário autenticado com UUID válido", async () => {
        const disconnect = jest.spyOn(accounts, "disconnect");

        const { status, body } = await invoke(controller.disconnect, { userId: "invalido" });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(disconnect).not.toHaveBeenCalled();
    });

    test("desativa o vínculo preservando histórico e autorização externa", async () => {
        const result = {
            message: "Mercado Pago desvinculado do sistema para novas cobranças.",
            connected: false,
            environment: "test",
            historical_payments_preserved: true,
            provider_authorization_revoked: false
        };
        const disconnect = jest.spyOn(accounts, "disconnect").mockResolvedValue(result);

        const { status, body } = await invoke(controller.disconnect);

        expect(disconnect).toHaveBeenCalledWith(USER_ID);
        expect(status).toBe(200);
        expect(body).toEqual(result);
        expect(body.historical_payments_preserved).toBe(true);
        expect(body.provider_authorization_revoked).toBe(false);
    });

    test("repassa 404 quando o usuário não existe", async () => {
        jest.spyOn(accounts, "disconnect")
            .mockRejectedValue(serviceError("Usuário não encontrado.", 404));

        const { status, body } = await invoke(controller.disconnect);

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário não encontrado." });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(accounts, "disconnect").mockRejectedValue(unexpectedError("rollback falhou"));

        const { status, body } = await invoke(controller.disconnect);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao processar a conta de pagamento." });
    });
});

describe("paymentAccountController.callback", () => {
    const STATE = "a".repeat(43);

    test("responde 200 com cabeçalhos no-store/no-referrer e encaminha a query", async () => {
        const result = {
            message: "Mercado Pago vinculado com sucesso. Você pode voltar ao aplicativo.",
            connected: true,
            environment: "test"
        };
        const callback = jest.spyOn(accounts, "callback").mockResolvedValue(result);
        const query = { code: "codigo-de-autorizacao", state: STATE };

        const { status, body, res } = await invokeCallback({ query, userId: null });

        expect(callback).toHaveBeenCalledWith(query);
        expect(res.headers["Cache-Control"]).toBe("no-store");
        expect(res.headers["Referrer-Policy"]).toBe("no-referrer");
        expect(status).toBe(200);
        expect(body).toEqual(result);
    });

    test("não exige JWT, pois é rota pública do provedor", async () => {
        jest.spyOn(accounts, "callback").mockResolvedValue({ connected: true });

        const { status, body } = await invokeCallback({
            query: { code: "codigo", state: STATE },
            userId: null
        });

        expect(status).toBe(200);
        expect(body).toEqual({ connected: true });
    });

    test("repassa 400 quando o state ou o code são inválidos", async () => {
        jest.spyOn(accounts, "callback")
            .mockRejectedValue(serviceError("Callback OAuth inválido.", 400));

        const { status, body } = await invokeCallback({
            query: { state: "state-curto", code: "codigo" },
            userId: null
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Callback OAuth inválido." });
    });

    test("repassa 409 com providerDetails do vínculo recusado", async () => {
        jest.spyOn(accounts, "callback").mockRejectedValue(
            serviceError("A conta Mercado Pago já possui vínculo histórico com outro vendedor ou aplicação.", 409, {
                providerDetails: { provider_code: "collector_linked_to_other_user" }
            })
        );

        const { status, body } = await invokeCallback({
            query: { state: STATE, code: "codigo" },
            userId: null
        });

        expect(status).toBe(409);
        expect(body).toEqual({
            error: "A conta Mercado Pago já possui vínculo histórico com outro vendedor ou aplicação.",
            provider_code: "collector_linked_to_other_user"
        });
    });

    test("usa 500 e mensagem genérica quando o service falha sem status", async () => {
        jest.spyOn(accounts, "callback")
            .mockRejectedValue(unexpectedError("ECONNRESET"));

        const { status, body } = await invokeCallback({
            query: { state: STATE, code: "codigo" },
            userId: null
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao vincular o Mercado Pago." });
    });
});

describe("paymentAccountController.configuration", () => {
    const PUBLIC_KEY = "TEST-12345678-1234-1234-1234-123456789012";

    test("exige usuário autenticado com UUID válido", async () => {
        const providerConfiguration = jest.spyOn(mercadoPago, "configuration");

        const { status, body } = await invoke(controller.configuration, { userId: "invalido" });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Autenticação necessária." });
        expect(providerConfiguration).not.toHaveBeenCalled();
    });

    test("devolve o resumo de configuração com dados prontos para o cliente", async () => {
        jest.spyOn(mercadoPago, "configuration").mockReturnValue({ environment: "test", token: "segredo" });
        jest.spyOn(split, "enabled").mockReturnValue(false);
        jest.spyOn(accounts, "configuration").mockReturnValue({ environment: "test" });
        setEnv({
            MERCADO_PAGO_PUBLIC_KEY: PUBLIC_KEY,
            MERCADO_PAGO_WEBHOOK_SECRET: "segredo-do-webhook",
            PAYMENT_WEBHOOK_URL: "https://exemplo.trycloudflare.com/api/reaproveitafranca/payment/webhook/mercado-pago"
        });

        const { status, body } = await invoke(controller.configuration);

        expect(status).toBe(200);
        expect(body).toEqual({
            environment: "test",
            split_payment: false,
            public_key: PUBLIC_KEY,
            webhook_configured: true,
            webhook_url_configured: true,
            oauth_configured: true,
            external_validation_required: true
        });
    });

    test("mascara a public key quando o formato não é o esperado", async () => {
        jest.spyOn(mercadoPago, "configuration").mockReturnValue({ environment: "production" });
        jest.spyOn(split, "enabled").mockReturnValue(true);
        jest.spyOn(accounts, "configuration").mockReturnValue({ environment: "production" });
        setEnv({
            MERCADO_PAGO_PUBLIC_KEY: "chave-invalida-vazada",
            MERCADO_PAGO_WEBHOOK_SECRET: undefined,
            PAYMENT_WEBHOOK_URL: undefined
        });

        const { status, body } = await invoke(controller.configuration);

        expect(status).toBe(200);
        expect(body).toEqual({
            environment: "production",
            split_payment: true,
            public_key: null,
            webhook_configured: false,
            webhook_url_configured: false,
            oauth_configured: true,
            external_validation_required: true
        });
    });

    test("marca oauth_configured=false sem expor o motivo quando o OAuth está incompleto", async () => {
        jest.spyOn(mercadoPago, "configuration").mockReturnValue({ environment: "test" });
        jest.spyOn(split, "enabled").mockReturnValue(false);
        jest.spyOn(accounts, "configuration").mockImplementation(() => {
            throw serviceError("Configure MERCADO_PAGO_REDIRECT_URI com a URL do callback OAuth.", 503);
        });
        setEnv({ MERCADO_PAGO_PUBLIC_KEY: PUBLIC_KEY });

        const { status, body } = await invoke(controller.configuration);

        expect(status).toBe(200);
        expect(body.oauth_configured).toBe(false);
        expect(body.public_key).toBe(PUBLIC_KEY);
        expect(body.external_validation_required).toBe(true);
    });

    test("repassa status e mensagem quando o ambiente do provider não está configurado", async () => {
        jest.spyOn(mercadoPago, "configuration").mockImplementation(() => {
            throw serviceError("Configure o ambiente e o Access Token do Mercado Pago.", 503);
        });

        const { status, body } = await invoke(controller.configuration);

        expect(status).toBe(503);
        expect(body).toEqual({ error: "Configure o ambiente e o Access Token do Mercado Pago." });
    });

    test("repassa 503 quando split_payment tem valor inválido", async () => {
        jest.spyOn(mercadoPago, "configuration").mockReturnValue({ environment: "test" });
        jest.spyOn(accounts, "configuration").mockReturnValue({ environment: "test" });
        jest.spyOn(split, "enabled").mockImplementation(() => {
            throw serviceError("split_payment deve ser true ou false.", 503);
        });

        const { status, body } = await invoke(controller.configuration);

        expect(status).toBe(503);
        expect(body).toEqual({ error: "split_payment deve ser true ou false." });
    });

    test("usa 500 e mensagem genérica para falha inesperada", async () => {
        jest.spyOn(mercadoPago, "configuration")
            .mockImplementation(() => { throw unexpectedError("env corrompida"); });

        const { status, body } = await invoke(controller.configuration);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao consultar configuração de pagamento." });
    });
});
