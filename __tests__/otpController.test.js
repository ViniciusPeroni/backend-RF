"use strict";

/**
 * Testes unitários de `src/controllers/otpController.js`.
 *
 * Nenhum banco real, nenhum e-mail e nenhuma requisição externa: o pool do
 * MySQL, o serviço de OTP e a outbox de notificações são substituídos por
 * dublês controlados em cada teste.
 */

jest.mock("../src/db/connect", () => {
    const query = jest.fn();
    const getConnection = jest.fn();
    return {
        __query: query,
        __getConnection: getConnection,
        promise: () => ({ query, getConnection })
    };
});

jest.mock("../src/services/otpService", () => ({
    sendOtp: jest.fn(),
    verifyOtp: jest.fn()
}));

jest.mock("../src/services/notificationOutboxService", () => ({
    enqueue: jest.fn(),
    flush: jest.fn()
}));

const connect = require("../src/db/connect");
const otpService = require("../src/services/otpService");
const notificationOutbox = require("../src/services/notificationOutboxService");
const controller = require("../src/controllers/otpController");
const { invoke, serviceError, unexpectedError } = require("./helpers/http");

const poolQuery = connect.__query;
const getConnection = connect.__getConnection;

// IDs distintos por cenário: o Map de rate limit vive no escopo do módulo.
const SEND_ID_OK = "11111111-1111-4111-8111-111111111111";
const SEND_ID_RATE_LIMIT = "22222222-2222-4222-8222-222222222222";
const SEND_ID_DB_ERROR = "33333333-3333-4333-8333-333333333333";
const SEND_ID_OTP_ERROR = "44444444-4444-4444-8444-444444444444";
const VERIFY_ID = "55555555-5555-4555-8555-555555555555";

function createConnection({ users = [], activation = { affectedRows: 1 } } = {}) {
    const conn = {
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        release: jest.fn(),
        query: jest.fn(async (sql) => {
            if (sql.includes("SELECT status")) return [users];
            if (sql.includes("UPDATE `user` SET status")) return [activation];
            throw new Error(`query não esperada: ${sql}`);
        })
    };
    getConnection.mockResolvedValue(conn);
    return conn;
}

beforeEach(() => {
    poolQuery.mockReset();
    getConnection.mockReset();
    otpService.sendOtp.mockReset();
    otpService.verifyOtp.mockReset();
    notificationOutbox.enqueue.mockReset();
    notificationOutbox.flush.mockReset();
    notificationOutbox.enqueue.mockResolvedValue({ id: "notificacao-1" });
    notificationOutbox.flush.mockResolvedValue(undefined);
});

describe("otpController.sendCode", () => {
    test("exige o id do usuário antes de consultar o banco", async () => {
        const { status, body } = await invoke(controller.sendCode, { body: {} });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do usuário é obrigatório." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("rejeita id que não é UUID", async () => {
        const { status, body } = await invoke(controller.sendCode, {
            body: { id: "id-invalido" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do usuário inválido." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("responde 404 quando o usuário não existe", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invoke(controller.sendCode, {
            body: { id: SEND_ID_OK }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário não encontrado" });
        expect(otpService.sendOtp).not.toHaveBeenCalled();
    });

    test("bloqueia conta que não está aguardando confirmação de e-mail", async () => {
        poolQuery.mockResolvedValueOnce([[{ email: "pessoa@exemplo.com", status: "active" }]]);

        const { status, body } = await invoke(controller.sendCode, {
            body: { id: SEND_ID_OK }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Esta conta não está aguardando confirmação de e-mail." });
        expect(otpService.sendOtp).not.toHaveBeenCalled();
    });

    test("envia o código para o e-mail cadastrado e responde 200", async () => {
        poolQuery.mockResolvedValueOnce([[{ email: "pessoa@exemplo.com", status: "awaitingForEmail" }]]);
        otpService.sendOtp.mockResolvedValue(undefined);

        const { status, body } = await invoke(controller.sendCode, {
            body: { id: SEND_ID_OK }
        });

        expect(status).toBe(200);
        expect(body).toEqual({ message: "Código enviado para o email" });
        expect(otpService.sendOtp).toHaveBeenCalledTimes(1);
        const [userIdBin, email] = otpService.sendOtp.mock.calls[0];
        expect(Buffer.isBuffer(userIdBin)).toBe(true);
        expect(userIdBin).toHaveLength(16);
        expect(email).toBe("pessoa@exemplo.com");
    });

    test("aplica rate limit de 30s entre envios do mesmo usuário", async () => {
        poolQuery.mockResolvedValue([[{ email: "pessoa@exemplo.com", status: "awaitingForEmail" }]]);
        otpService.sendOtp.mockResolvedValue(undefined);

        const first = await invoke(controller.sendCode, {
            body: { id: SEND_ID_RATE_LIMIT }
        });
        const second = await invoke(controller.sendCode, {
            body: { id: SEND_ID_RATE_LIMIT }
        });

        expect(first.status).toBe(200);
        expect(first.body).toEqual({ message: "Código enviado para o email" });
        expect(second.status).toBe(429);
        expect(second.body).toEqual({ error: "Aguarde 30s antes de solicitar um novo código" });
        expect(otpService.sendOtp).toHaveBeenCalledTimes(1);
    });

    test("responde 500 quando a consulta ao banco falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.sendCode, {
            body: { id: SEND_ID_DB_ERROR }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro interno ao enviar o código." });
    });

    test("converte erro com status do envio de OTP em 500 genérico", async () => {
        poolQuery.mockResolvedValueOnce([[{ email: "pessoa@exemplo.com", status: "awaitingForEmail" }]]);
        otpService.sendOtp.mockRejectedValue(serviceError("SMTP indisponível", 503));

        const { status, body } = await invoke(controller.sendCode, {
            body: { id: SEND_ID_OTP_ERROR }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro interno ao enviar o código." });
    });
});

describe("otpController.verifyCode", () => {
    test("exige id e código", async () => {
        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do usuário e código são obrigatórios." });
        expect(getConnection).not.toHaveBeenCalled();
    });

    test("rejeita UUID inválido antes de abrir transação", async () => {
        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: "id-invalido", code: "123456" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do usuário inválido." });
        expect(getConnection).not.toHaveBeenCalled();
    });

    test("exige código com exatamente seis dígitos", async () => {
        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID, code: "12345" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Informe o código de 6 dígitos." });
        expect(getConnection).not.toHaveBeenCalled();
    });

    test("rejeita código com caracteres não numéricos", async () => {
        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID, code: "12a456" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Informe o código de 6 dígitos." });
    });

    test("devolve 403 e faz rollback quando a conta não aguarda confirmação", async () => {
        const conn = createConnection({ users: [] });

        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID, code: "123456" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Esta conta não está aguardando confirmação de e-mail." });
        expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
        expect(conn.rollback).toHaveBeenCalledTimes(1);
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    test("devolve 401 com o motivo informado pelo serviço de OTP", async () => {
        const conn = createConnection({ users: [{ status: "awaitingForEmail" }] });
        otpService.verifyOtp.mockResolvedValue({ valid: false, motive: "Código incorreto" });

        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID, code: "123456" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Código incorreto" });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
        expect(conn.commit).not.toHaveBeenCalled();
        expect(notificationOutbox.enqueue).not.toHaveBeenCalled();
    });

    test("devolve 403 quando a ativação não altera nenhuma linha", async () => {
        const conn = createConnection({
            users: [{ status: "awaitingForEmail" }],
            activation: { affectedRows: 0 }
        });
        otpService.verifyOtp.mockResolvedValue({ valid: true });

        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID, code: "123456" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Não foi possível ativar esta conta." });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
        expect(conn.commit).not.toHaveBeenCalled();
    });

    test("ativa a conta, enfileira o aviso e responde 200", async () => {
        const conn = createConnection({ users: [{ status: "awaitingForEmail" }] });
        otpService.verifyOtp.mockResolvedValue({ valid: true });

        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID, code: "123456" }
        });

        expect(status).toBe(200);
        expect(body).toEqual({ message: "Email confirmado! Faça seu login!" });
        expect(otpService.verifyOtp).toHaveBeenCalledTimes(1);
        expect(otpService.verifyOtp).toHaveBeenCalledWith(
            expect.any(Buffer),
            "123456",
            conn
        );
        expect(notificationOutbox.enqueue).toHaveBeenCalledWith(conn, {
            id_user: VERIFY_ID,
            type: "sistema",
            title: "Conta ativada",
            content: "Seu e-mail foi confirmado e sua conta está ativa."
        });
        expect(notificationOutbox.flush).toHaveBeenCalledWith([{ id: "notificacao-1" }]);
        expect(conn.commit).toHaveBeenCalledTimes(1);
        expect(conn.rollback).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    test("faz rollback e responde 500 quando a transação falha", async () => {
        const conn = createConnection({ users: [{ status: "awaitingForEmail" }] });
        otpService.verifyOtp.mockResolvedValue({ valid: true });
        conn.query.mockRejectedValue(unexpectedError("UPDATE falhou"));

        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID, code: "123456" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro interno ao verificar o código." });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    test("faz rollback e responde 500 quando a outbox falha", async () => {
        const conn = createConnection({ users: [{ status: "awaitingForEmail" }] });
        otpService.verifyOtp.mockResolvedValue({ valid: true });
        notificationOutbox.enqueue.mockRejectedValue(unexpectedError("outbox fora do ar"));

        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID, code: "123456" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro interno ao verificar o código." });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
        expect(conn.commit).not.toHaveBeenCalled();
        expect(notificationOutbox.flush).not.toHaveBeenCalled();
    });

    test("responde 500 quando o flush falha depois do commit", async () => {
        const conn = createConnection({ users: [{ status: "awaitingForEmail" }] });
        otpService.verifyOtp.mockResolvedValue({ valid: true });
        notificationOutbox.flush.mockRejectedValue(unexpectedError("falha ao notificar"));

        const { status, body } = await invoke(controller.verifyCode, {
            body: { id: VERIFY_ID, code: "123456" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro interno ao verificar o código." });
        // A conta já foi ativada e confirmada antes da falha do aviso.
        expect(conn.commit).toHaveBeenCalledTimes(1);
        expect(conn.release).toHaveBeenCalledTimes(1);
    });
});
