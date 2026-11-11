"use strict";

/**
 * Testes unitários de `src/controllers/userController.js`.
 *
 * Nenhum banco real, nenhum e-mail, nenhum OAuth e nenhuma requisição HTTP:
 * pool MySQL, bcrypt, axios e os serviços/utils externos são dublês
 * controlados por teste.
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

jest.mock("axios", () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock("bcrypt", () => ({ hash: jest.fn(), compare: jest.fn() }));

jest.mock("../src/services/otpService", () => ({ sendOtp: jest.fn(), verifyOtp: jest.fn() }));
jest.mock("../src/services/docService", () => ({ createDoc: jest.fn() }));
jest.mock("../src/services/localizationService", () => ({ createLocalization: jest.fn() }));
jest.mock("../src/services/notificationOutboxService", () => ({
    enqueue: jest.fn(),
    flush: jest.fn()
}));
jest.mock("../src/services/googleIdentityService", () => ({ verifyGoogleIdentity: jest.fn() }));
jest.mock("../src/services/googleLoginService", () => ({ findOrCreateGoogleUser: jest.fn() }));
jest.mock("../src/utils/sendAdminCredentials", () => jest.fn());
jest.mock("../src/utils/sendPasswordReset", () => jest.fn());

const connect = require("../src/db/connect");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const otpService = require("../src/services/otpService");
const docService = require("../src/services/docService");
const locService = require("../src/services/localizationService");
const outbox = require("../src/services/notificationOutboxService");
const googleIdentity = require("../src/services/googleIdentityService");
const googleLogin = require("../src/services/googleLoginService");
const sendAdminCredentials = require("../src/utils/sendAdminCredentials");
const sendPasswordReset = require("../src/utils/sendPasswordReset");
const uuid = require("../src/utils/uuid");
const controller = require("../src/controllers/userController");
const {
    invoke,
    createRequest,
    createResponse,
    USER_ID,
    OTHER_ID,
    serviceError,
    unexpectedError
} = require("./helpers/http");

const poolQuery = connect.__query;
const getConnection = connect.__getConnection;

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

const userPayload = {
    cpf: "12345678901",
    name: "Maria Souza",
    email: "maria@exemplo.com",
    password: "segredo123",
    cellphone: "16999998888",
    birthday: "1990-01-01",
    zip_code: "14400000",
    street: "Rua das Flores",
    neighborhood: "Centro",
    number: "10",
    city: "Franca",
    state: "SP"
};

const companyPayload = {
    cpf: "12345678901",
    name: "Empresa Reaproveita",
    email: "empresa@exemplo.com",
    cnpj: "12345678000199",
    password: "segredo123",
    cellphone: "16999998888",
    zip_code: "14400000",
    street: "Rua das Flores",
    neighborhood: "Centro",
    number: "10",
    city: "Franca",
    state: "SP"
};

const adminPayload = {
    cpf: "12345678901",
    name: "Admin Teste",
    email: "admin@exemplo.com",
    cellphone: "16999998888",
    birthday: "1990-01-01",
    zip_code: "14400000",
    street: "Rua das Flores",
    neighborhood: "Centro",
    number: "10",
    city: "Franca",
    state: "SP"
};

function createConnection(queryImpl) {
    const conn = {
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        release: jest.fn(),
        query: jest.fn(queryImpl || (async () => [[]]))
    };
    getConnection.mockResolvedValue(conn);
    return conn;
}

function mockEmailTaken(conn, taken) {
    conn.query.mockImplementation(async (sql) =>
        sql.includes("SELECT id FROM `user` WHERE email") ? [taken] : [[]]
    );
}

function makeIdToken(payload) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.assinatura`;
}

function setLinkedinEnv() {
    process.env.LINKEDIN_CLIENT_ID = "client-id-sintetico";
    process.env.LINKEDIN_CLIENT_SECRET = "client-secret-sintetico";
    process.env.LINKEDIN_REDIRECT_URI = "https://app.exemplo.com/linkedin/callback";
}

function clearLinkedinEnv() {
    delete process.env.LINKEDIN_CLIENT_ID;
    delete process.env.LINKEDIN_CLIENT_SECRET;
    delete process.env.LINKEDIN_REDIRECT_URI;
}

function mockSocialQueries({ byProvider = [], byEmail = [] } = {}) {
    poolQuery.mockImplementation(async (sql) => {
        if (sql.includes("UPDATE `user`")) return [{}];
        if (sql.includes("WHERE email = ?")) return [byEmail];
        if (sql.includes("WHERE `linkedin_id` = ?") || sql.includes("WHERE `google_id` = ?")) {
            return [byProvider];
        }
        throw new Error(`query não esperada: ${sql}`);
    });
}

/**
 * `getUserPhoto` chama `res.set`/`res.type`, que o `invoke` não implementa.
 * Aqui os mesmos req/res dos helpers recebem só esses dois métodos.
 */
async function invokeWithExpressResponse(handler, options = {}) {
    const req = createRequest(options);
    const res = createResponse();
    res.set = (name, value) => {
        res.headers[name] = value;
        return res;
    };
    res.type = (value) => {
        res.contentType = value;
        return res;
    };
    await handler(req, res);
    return { req, res, status: res.statusCode, body: res.body };
}

/**
 * `invoke` só monta as propriedades fixas do request. `createCompany` lê
 * `req.googleIdentity`, preenchido por middleware, então ele é injetado aqui.
 */
async function invokeWithRequestProps(handler, options = {}, extraProps = {}) {
    const req = Object.assign(createRequest(options), extraProps);
    const res = createResponse();
    await handler(req, res);
    return { req, res, status: res.statusCode, body: res.body };
}

beforeEach(() => {
    poolQuery.mockReset();
    getConnection.mockReset();
    axios.post.mockReset();
    axios.get.mockReset();
    bcrypt.hash.mockReset();
    bcrypt.compare.mockReset();
    otpService.sendOtp.mockReset();
    docService.createDoc.mockReset();
    locService.createLocalization.mockReset();
    outbox.enqueue.mockReset();
    outbox.flush.mockReset();
    googleIdentity.verifyGoogleIdentity.mockReset();
    googleLogin.findOrCreateGoogleUser.mockReset();
    sendAdminCredentials.mockReset();
    sendPasswordReset.mockReset();

    bcrypt.hash.mockImplementation(async (value) => `hash:${value}`);
    bcrypt.compare.mockResolvedValue(false);
    otpService.sendOtp.mockResolvedValue(undefined);
    docService.createDoc.mockResolvedValue("documento-1");
    locService.createLocalization.mockResolvedValue("localizacao-1");
    outbox.enqueue.mockResolvedValue({ id: "notificacao-1" });
    outbox.flush.mockResolvedValue(undefined);
    sendAdminCredentials.mockResolvedValue(undefined);
    sendPasswordReset.mockResolvedValue(undefined);
});

afterEach(() => {
    clearLinkedinEnv();
});

describe("userController.createUser", () => {
    test("exige todos os campos obrigatórios antes de abrir transação", async () => {
        const { status, body } = await invoke(controller.createUser, {
            body: { ...userPayload, email: undefined }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Todos os campos são obrigatórios." });
        expect(getConnection).not.toHaveBeenCalled();
    });

    test("rejeita role fora da lista permitida", async () => {
        const { status, body } = await invoke(controller.createUser, {
            body: { ...userPayload, role: "superadmin" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Role inválida. Use: user, company ou admin." });
        expect(getConnection).not.toHaveBeenCalled();
    });

    test("rejeita email com formato inválido", async () => {
        const { status, body } = await invoke(controller.createUser, {
            body: { ...userPayload, email: "maria-arroba-exemplo" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Email inválido." });
    });

    test("rejeita senha com menos de seis caracteres", async () => {
        const { status, body } = await invoke(controller.createUser, {
            body: { ...userPayload, password: "12345" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A senha deve ter no mínimo 6 caracteres." });
    });

    test("rejeita celular que não tem 11 dígitos", async () => {
        const { status, body } = await invoke(controller.createUser, {
            body: { ...userPayload, cellphone: "1699999888" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Celular inválido. Informe 11 dígitos numéricos (DDD + número)."
        });
    });

    test("cria o usuário, enfileira o aviso e envia o OTP", async () => {
        const conn = createConnection();

        const { status, body } = await invoke(controller.createUser, {
            body: userPayload,
            file: { buffer: PNG }
        });

        expect(status).toBe(201);
        expect(body).toEqual({
            message: "Usuário criado com sucesso. Confirme o email para ativar a conta.",
            id: expect.any(String),
            emailSent: true
        });
        expect(uuid.isValid(body.id)).toBe(true);
        expect(bcrypt.hash).toHaveBeenCalledWith("segredo123", 10);
        expect(docService.createDoc).toHaveBeenCalledWith(
            { userId: body.id, docType: "CPF", doc: "12345678901" },
            conn
        );
        expect(locService.createLocalization).toHaveBeenCalledWith(
            {
                userId: body.id,
                zipCode: "14400000",
                street: "Rua das Flores",
                neighborhood: "Centro",
                number: "10",
                city: "Franca",
                state: "SP"
            },
            conn
        );
        expect(outbox.enqueue).toHaveBeenCalledWith(conn, {
            id_user: body.id,
            type: "sistema",
            title: "Bem-vindo(a) ao Reaproveita Franca",
            content: "Sua conta foi criada. Confirme seu e-mail, se necessário, para acessar a conta."
        });
        expect(otpService.sendOtp).toHaveBeenCalledWith(body.id, "maria@exemplo.com");
        expect(outbox.flush).toHaveBeenCalledWith([{ id: "notificacao-1" }]);
        expect(conn.commit).toHaveBeenCalledTimes(1);
        expect(conn.rollback).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
        const insert = conn.query.mock.calls[1];
        expect(insert[0]).toContain("INSERT INTO `user`");
        expect(insert[1][1]).toBe("user");
        expect(insert[1][4]).toBe("hash:segredo123");
        expect(insert[1][6]).toEqual(PNG);
    });

    test("responde 201 com aviso de falha quando o OTP não é enviado", async () => {
        createConnection();
        otpService.sendOtp.mockRejectedValue(unexpectedError("SMTP fora do ar"));

        const { status, body } = await invoke(controller.createUser, {
            body: userPayload
        });

        expect(status).toBe(201);
        expect(body).toEqual({
            message: "Usuário criado, mas o e-mail de confirmação falhou. Solicite um novo código.",
            id: expect.any(String),
            emailSent: false
        });
    });

    test("responde 409 e faz rollback quando o email já está cadastrado", async () => {
        const conn = createConnection();
        mockEmailTaken(conn, [{ id: USER_ID }]);

        const { status, body } = await invoke(controller.createUser, {
            body: userPayload
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Email já cadastrado." });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
        expect(docService.createDoc).not.toHaveBeenCalled();
        expect(otpService.sendOtp).not.toHaveBeenCalled();
    });

    test("converte ER_DUP_ENTRY do MySQL em 409", async () => {
        const conn = createConnection();
        conn.query.mockImplementation(async (sql) => {
            if (sql.includes("SELECT id FROM `user` WHERE email")) return [[]];
            throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
        });

        const { status, body } = await invoke(controller.createUser, {
            body: userPayload
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Email já cadastrado." });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
    });

    test("repassa 409 quando o documento já está registrado", async () => {
        const conn = createConnection();
        docService.createDoc.mockRejectedValue(new Error("Documento já registrado"));

        const { status, body } = await invoke(controller.createUser, {
            body: userPayload
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Documento já registrado" });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
    });

    test("repassa o status de erro de um serviço auxiliar", async () => {
        createConnection();
        locService.createLocalization.mockRejectedValue(serviceError("Endereço inválido.", 422));

        const { status, body } = await invoke(controller.createUser, {
            body: userPayload
        });

        expect(status).toBe(422);
        expect(body).toEqual({ error: "Endereço inválido." });
    });

    test("responde 500 genérico quando a falha não tem status", async () => {
        const conn = createConnection();
        conn.query.mockRejectedValue(unexpectedError("pool esgotado"));

        const { status, body } = await invoke(controller.createUser, {
            body: userPayload
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao criar usuário." });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
    });

    // A rota pública remove `role` do body (forceUserRole em userRoutes.js),
    // mas a controller, isolada, aceita qualquer role válida.
    test("aceita role admin vinda do body (comportamento atual da controller)", async () => {
        const conn = createConnection();

        const { status, body } = await invoke(controller.createUser, {
            body: { ...userPayload, role: "admin" }
        });

        expect(status).toBe(201);
        expect(body.emailSent).toBe(true);
        expect(conn.query.mock.calls[1][1][1]).toBe("admin");
    });
});

describe("userController.createAdmin", () => {
    test("exige todos os campos obrigatórios", async () => {
        const { status, body } = await invoke(controller.createAdmin, {
            body: { ...adminPayload, cpf: undefined }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Todos os campos são obrigatórios." });
        expect(getConnection).not.toHaveBeenCalled();
    });

    test("rejeita email inválido", async () => {
        const { status, body } = await invoke(controller.createAdmin, {
            body: { ...adminPayload, email: "sem-arroba" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Email inválido." });
    });

    test("rejeita celular inválido", async () => {
        const { status, body } = await invoke(controller.createAdmin, {
            body: { ...adminPayload, cellphone: "119999" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Celular inválido. Informe 11 dígitos numéricos (DDD + número)."
        });
    });

    test("cria admin com senha gerada, envia credenciais e não devolve a senha", async () => {
        const conn = createConnection();

        const { status, body } = await invoke(controller.createAdmin, {
            body: adminPayload
        });

        expect(status).toBe(201);
        expect(body).toEqual({
            message: "Admin criado com sucesso. As credenciais foram enviadas para o email.",
            id: expect.any(String),
            credentialsSent: true
        });
        expect(body.password).toBeUndefined();
        const [generatedPassword, rounds] = bcrypt.hash.mock.calls[0];
        expect(generatedPassword).toHaveLength(6);
        expect(rounds).toBe(10);
        expect(sendAdminCredentials).toHaveBeenCalledWith("admin@exemplo.com", generatedPassword);
        expect(docService.createDoc).toHaveBeenCalledWith(
            { userId: body.id, docType: "CPF", doc: "12345678901" },
            conn
        );
        const insert = conn.query.mock.calls[1];
        expect(insert[0]).toContain("'firstLogin'");
        expect(insert[1][1]).toBe("admin");
        expect(conn.commit).toHaveBeenCalledTimes(1);
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    test("responde 201 com aviso quando o e-mail de credenciais falha", async () => {
        createConnection();
        sendAdminCredentials.mockRejectedValue(unexpectedError("SMTP fora do ar"));

        const { status, body } = await invoke(controller.createAdmin, {
            body: adminPayload
        });

        expect(status).toBe(201);
        expect(body).toEqual({
            message: "Admin criado, mas o e-mail com as credenciais falhou. Solicite o reenvio.",
            id: expect.any(String),
            credentialsSent: false
        });
    });

    test("responde 409 quando o email já está cadastrado", async () => {
        const conn = createConnection();
        mockEmailTaken(conn, [{ id: USER_ID }]);

        const { status, body } = await invoke(controller.createAdmin, {
            body: adminPayload
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Email já cadastrado." });
        expect(sendAdminCredentials).not.toHaveBeenCalled();
        expect(conn.rollback).toHaveBeenCalledTimes(1);
    });

    test("responde 500 genérico em falha inesperada", async () => {
        const conn = createConnection();
        conn.query.mockRejectedValue(unexpectedError("conexão caiu"));

        const { status, body } = await invoke(controller.createAdmin, {
            body: adminPayload
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao criar usuário." });
    });
});

describe("userController.createCompany", () => {
    test("exige todos os campos obrigatórios", async () => {
        const { status, body } = await invoke(controller.createCompany, {
            body: { ...companyPayload, cnpj: undefined }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Todos os campos são obrigatórios." });
        expect(getConnection).not.toHaveBeenCalled();
    });

    test("rejeita campos que não são texto", async () => {
        const { status, body } = await invoke(controller.createCompany, {
            body: { ...companyPayload, number: 10 }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Informe os dados da empresa em texto." });
    });

    test("rejeita documentos e endereço fora do padrão", async () => {
        const { status, body } = await invoke(controller.createCompany, {
            body: { ...companyPayload, cnpj: "123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Confira os documentos e o endereço da empresa." });
    });

    test("rejeita email inválido", async () => {
        const { status, body } = await invoke(controller.createCompany, {
            body: { ...companyPayload, email: "empresa.exemplo.com" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Email inválido." });
    });

    test("rejeita senha curta quando não há identidade Google", async () => {
        const { status, body } = await invoke(controller.createCompany, {
            body: { ...companyPayload, password: "123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A senha deve ter no mínimo 6 caracteres." });
    });

    test("rejeita celular inválido", async () => {
        const { status, body } = await invoke(controller.createCompany, {
            body: { ...companyPayload, cellphone: "1699999888" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Celular inválido. Informe 11 dígitos numéricos (DDD + número)."
        });
    });

    test("cria a empresa com CPF e CNPJ e envia o OTP", async () => {
        const conn = createConnection();

        const { status, body } = await invoke(controller.createCompany, {
            body: companyPayload
        });

        expect(status).toBe(201);
        expect(body).toEqual({
            message: "Empresa criada com sucesso. Confirme o email para ativar a conta.",
            id: expect.any(String),
            emailSent: true
        });
        expect(docService.createDoc).toHaveBeenCalledTimes(2);
        expect(docService.createDoc.mock.calls[0][0]).toEqual({
            userId: body.id,
            docType: "CPF",
            doc: "12345678901"
        });
        expect(docService.createDoc.mock.calls[1][0]).toEqual({
            userId: body.id,
            docType: "CNPJ",
            doc: "12345678000199"
        });
        expect(outbox.enqueue).toHaveBeenCalledWith(conn, {
            id_user: body.id,
            type: "sistema",
            title: "Bem-vindo(a) ao Reaproveita Franca",
            content: "Sua empresa foi cadastrada. Confirme seu e-mail, se necessário, para acessar a conta."
        });
        expect(otpService.sendOtp).toHaveBeenCalledWith(body.id, "empresa@exemplo.com");
        expect(conn.query.mock.calls[1][1][8]).toBe("awaitingForEmail");
        expect(conn.commit).toHaveBeenCalledTimes(1);
    });

    test("cria empresa com Google sem senha e devolve token", async () => {
        const conn = createConnection();
        conn.query.mockImplementation(async (sql) => {
            if (sql.includes("WHERE email = ?")) return [[]];
            if (sql.includes("WHERE google_id = ?")) return [[]];
            return [[]];
        });

        const { status, body } = await invokeWithRequestProps(controller.createCompany, {
            body: { ...companyPayload, password: undefined }
        }, { googleIdentity: { sub: "google-123" } });

        expect(status).toBe(201);
        expect(body.message).toBe("Empresa criada com Google.");
        expect(body.mustChangePassword).toBe(false);
        expect(body.user).toEqual({
            id: expect.any(String),
            role: "company",
            name: "Empresa Reaproveita",
            email: "empresa@exemplo.com",
            status: "active"
        });
        expect(typeof body.token).toBe("string");
        expect(jwt.decode(body.token)).toEqual({
            id: body.user.id,
            role: "company",
            name: "Empresa Reaproveita",
            iat: expect.any(Number),
            exp: expect.any(Number)
        });
        expect(otpService.sendOtp).not.toHaveBeenCalled();
        const insert = conn.query.mock.calls[2];
        expect(insert[1][4]).toBeNull();
        expect(insert[1][7]).toBe("google-123");
        expect(insert[1][8]).toBe("active");
    });

    test("responde 409 quando o Google já está vinculado a outra conta", async () => {
        const conn = createConnection();
        conn.query.mockImplementation(async (sql) => {
            if (sql.includes("WHERE email = ?")) return [[]];
            if (sql.includes("WHERE google_id = ?")) return [[{ id: OTHER_ID }]];
            return [[]];
        });

        const { status, body } = await invokeWithRequestProps(controller.createCompany, {
            body: { ...companyPayload, password: undefined }
        }, { googleIdentity: { sub: "google-123" } });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Conta vinculada a outro acesso Google." });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
    });

    test("responde 409 quando o email da empresa já existe", async () => {
        const conn = createConnection();
        mockEmailTaken(conn, [{ id: USER_ID }]);

        const { status, body } = await invoke(controller.createCompany, {
            body: companyPayload
        });

        expect(status).toBe(409);
        expect(body).toEqual({ error: "Email já cadastrado." });
        expect(conn.rollback).toHaveBeenCalledTimes(1);
    });

    test("responde 500 genérico em falha inesperada", async () => {
        const conn = createConnection();
        conn.query.mockRejectedValue(unexpectedError("pool indisponível"));

        const { status, body } = await invoke(controller.createCompany, {
            body: companyPayload
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao criar usuário." });
    });
});

describe("userController.loginUser", () => {
    test("exige email e senha", async () => {
        const { status, body } = await invoke(controller.loginUser, {
            body: { email: "maria@exemplo.com" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Email e senha são obrigatórios." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("responde 401 quando o email não existe", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invoke(controller.loginUser, {
            body: { email: "ninguem@exemplo.com", password: "segredo123" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Email ou senha incorretos." });
        expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    test("responde 401 para conta criada só por login social", async () => {
        poolQuery.mockResolvedValueOnce([
            [{ id: USER_ID, role: "user", name: "Maria", password: null, status: "active" }]
        ]);

        const { status, body } = await invoke(controller.loginUser, {
            body: { email: "maria@exemplo.com", password: "segredo123" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({
            error: "Conta criada via login social. Use login com Google ou LinkedIn."
        });
    });

    test("responde 401 quando a senha não confere", async () => {
        poolQuery.mockResolvedValueOnce([
            [{ id: USER_ID, role: "user", name: "Maria", password: "hash", status: "active" }]
        ]);
        bcrypt.compare.mockResolvedValue(false);

        const { status, body } = await invoke(controller.loginUser, {
            body: { email: "maria@exemplo.com", password: "errada123" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Email ou senha incorretos." });
        expect(bcrypt.compare).toHaveBeenCalledWith("errada123", "hash");
    });

    test("responde 403 com dados de verificação para conta não confirmada", async () => {
        poolQuery.mockResolvedValueOnce([
            [{ id: USER_ID, role: "user", name: "Maria", password: "hash", status: "awaitingForEmail" }]
        ]);
        bcrypt.compare.mockResolvedValue(true);

        const { status, body } = await invoke(controller.loginUser, {
            body: { email: "maria@exemplo.com", password: "segredo123" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({
            error: "Conta ainda não ativada. Confirme seu email.",
            code: "EMAIL_VERIFICATION_REQUIRED",
            verification: { id: USER_ID, email: "maria@exemplo.com" }
        });
    });

    test("responde 403 para conta inativa", async () => {
        poolQuery.mockResolvedValueOnce([
            [{ id: USER_ID, role: "user", name: "Maria", password: "hash", status: "inactive" }]
        ]);
        bcrypt.compare.mockResolvedValue(true);

        const { status, body } = await invoke(controller.loginUser, {
            body: { email: "maria@exemplo.com", password: "segredo123" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Conta inativa. Entre em contato com o suporte." });
    });

    test("faz login e devolve token sem a senha do usuário", async () => {
        poolQuery.mockResolvedValueOnce([
            [{ id: USER_ID, role: "company", name: "Empresa", password: "hash", status: "active" }]
        ]);
        bcrypt.compare.mockResolvedValue(true);

        const { status, body } = await invoke(controller.loginUser, {
            body: { email: "empresa@exemplo.com", password: "segredo123" }
        });

        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Login realizado com sucesso.",
            token: expect.any(String),
            user: { id: USER_ID, role: "company", name: "Empresa", status: "active" },
            mustChangePassword: false
        });
        expect(jwt.decode(body.token)).toEqual({
            id: USER_ID,
            role: "company",
            name: "Empresa",
            iat: expect.any(Number),
            exp: expect.any(Number)
        });
    });

    test("marca mustChangePassword no primeiro login de admin", async () => {
        poolQuery.mockResolvedValueOnce([
            [{ id: USER_ID, role: "admin", name: "Admin", password: "hash", status: "firstLogin" }]
        ]);
        bcrypt.compare.mockResolvedValue(true);

        const { status, body } = await invoke(controller.loginUser, {
            body: { email: "admin@exemplo.com", password: "segredo123" }
        });

        expect(status).toBe(200);
        expect(body.mustChangePassword).toBe(true);
        expect(body.user).toEqual({ id: USER_ID, role: "admin", name: "Admin", status: "firstLogin" });
    });

    test("responde 500 genérico quando a consulta falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.loginUser, {
            body: { email: "maria@exemplo.com", password: "segredo123" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao realizar login." });
    });
});

describe("userController.loginGoogle", () => {
    const payload = {
        sub: "google-123",
        email: "maria@gmail.com",
        email_verified: true,
        name: "Maria"
    };

    test("faz login com Google, envia os avisos e devolve token", async () => {
        googleIdentity.verifyGoogleIdentity.mockResolvedValue(payload);
        googleLogin.findOrCreateGoogleUser.mockResolvedValue({
            user: { id: USER_ID, role: "user", name: "Maria", email: "maria@gmail.com", status: "active" },
            notifications: [{ id: "notificacao-1" }]
        });

        const { status, body } = await invoke(controller.loginGoogle, {
            body: { idToken: "token-google" }
        });

        expect(status).toBe(200);
        expect(googleIdentity.verifyGoogleIdentity).toHaveBeenCalledWith("token-google");
        expect(googleLogin.findOrCreateGoogleUser).toHaveBeenCalledWith(payload, 0, false);
        expect(outbox.flush).toHaveBeenCalledWith([{ id: "notificacao-1" }]);
        expect(body).toEqual({
            message: "Login com Google realizado com sucesso.",
            token: expect.any(String),
            user: { id: USER_ID, role: "user", name: "Maria", email: "maria@gmail.com", status: "active" },
            mustChangePassword: false
        });
        expect(jwt.decode(body.token).id).toBe(USER_ID);
    });

    test("usa credential e sinaliza conta de empresa", async () => {
        googleIdentity.verifyGoogleIdentity.mockResolvedValue(payload);
        googleLogin.findOrCreateGoogleUser.mockResolvedValue({
            user: { id: USER_ID, role: "company", name: "Empresa", status: "firstLogin" },
            notifications: []
        });

        const { status, body } = await invoke(controller.loginGoogle, {
            body: { credential: "credential-google", accountType: "company" }
        });

        expect(status).toBe(200);
        expect(googleIdentity.verifyGoogleIdentity).toHaveBeenCalledWith("credential-google");
        expect(googleLogin.findOrCreateGoogleUser).toHaveBeenCalledWith(payload, 0, true);
        expect(body.mustChangePassword).toBe(true);
    });

    test("repassa status de erro da validação do Google", async () => {
        googleIdentity.verifyGoogleIdentity.mockRejectedValue(
            serviceError("Token Google inválido ou expirado.", 401)
        );

        const { status, body } = await invoke(controller.loginGoogle, {
            body: { idToken: "token-google" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Token Google inválido ou expirado." });
        expect(googleLogin.findOrCreateGoogleUser).not.toHaveBeenCalled();
    });

    test("repassa 503 quando o Google está indisponível", async () => {
        googleIdentity.verifyGoogleIdentity.mockRejectedValue(
            serviceError("Google temporariamente indisponível.", 503)
        );

        const { status, body } = await invoke(controller.loginGoogle, {
            body: { idToken: "token-google" }
        });

        expect(status).toBe(503);
        expect(body).toEqual({ error: "Google temporariamente indisponível." });
    });

    test("usa 500 mas mantém a mensagem quando o status não é tratado", async () => {
        googleIdentity.verifyGoogleIdentity.mockRejectedValue(serviceError("erro interno", 418));

        const { status, body } = await invoke(controller.loginGoogle, {
            body: { idToken: "token-google" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "erro interno" });
    });

    test("usa 500 genérico para falha inesperada na validação", async () => {
        googleIdentity.verifyGoogleIdentity.mockRejectedValue(unexpectedError("rede caiu"));

        const { status, body } = await invoke(controller.loginGoogle, {
            body: { idToken: "token-google" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Não foi possível validar o Google." });
    });

    test("repassa 403 quando a conta Google não é de empresa", async () => {
        googleIdentity.verifyGoogleIdentity.mockResolvedValue(payload);
        googleLogin.findOrCreateGoogleUser.mockRejectedValue(
            serviceError("Esta conta não é de empresa. Entre como comprador.", 403)
        );

        const { status, body } = await invoke(controller.loginGoogle, {
            body: { idToken: "token-google", accountType: "company" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Esta conta não é de empresa. Entre como comprador." });
        expect(outbox.flush).not.toHaveBeenCalled();
    });

    test("repassa 404 quando a empresa ainda não está cadastrada", async () => {
        googleIdentity.verifyGoogleIdentity.mockResolvedValue(payload);
        googleLogin.findOrCreateGoogleUser.mockRejectedValue(
            serviceError("Empresa ainda não cadastrada. Preencha o cadastro de empresa com Google.", 404)
        );

        const { status, body } = await invoke(controller.loginGoogle, {
            body: { idToken: "token-google", accountType: "company" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({
            error: "Empresa ainda não cadastrada. Preencha o cadastro de empresa com Google."
        });
    });

    test("usa 500 genérico quando o vínculo falha sem status tratado", async () => {
        googleIdentity.verifyGoogleIdentity.mockResolvedValue(payload);
        googleLogin.findOrCreateGoogleUser.mockRejectedValue(unexpectedError("banco caiu"));

        const { status, body } = await invoke(controller.loginGoogle, {
            body: { idToken: "token-google" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({
            error: "Não foi possível concluir o acesso com Google. Tente novamente."
        });
    });
});

describe("userController.linkedinAuthUrl", () => {
    test("responde 500 quando o LinkedIn não está configurado", async () => {
        const { status, body } = await invoke(controller.linkedinAuthUrl);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Login LinkedIn não configurado." });
    });

    test("devolve a URL de autorização com state aleatório", async () => {
        setLinkedinEnv();

        const { status, body } = await invoke(controller.linkedinAuthUrl);

        expect(status).toBe(200);
        expect(body.state).toMatch(/^[a-f0-9]{32}$/);
        expect(body.url).toBe(
            "https://www.linkedin.com/oauth/v2/authorization" +
            "?response_type=code" +
            "&client_id=client-id-sintetico" +
            "&redirect_uri=" + encodeURIComponent("https://app.exemplo.com/linkedin/callback") +
            "&scope=openid%20profile%20email" +
            "&state=" + body.state
        );
    });
});

describe("userController.linkedinCallback", () => {
    const userinfo = {
        sub: "linkedin-123",
        email: "maria@exemplo.com",
        email_verified: true,
        name: "Maria Souza"
    };

    test("exige o parâmetro code", async () => {
        const { status, body } = await invoke(controller.linkedinCallback, { query: {} });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Parâmetro code é obrigatório." });
    });

    test("responde 500 quando o LinkedIn não está configurado", async () => {
        const { status, body } = await invoke(controller.linkedinCallback, {
            query: { code: "codigo-1" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Login LinkedIn não configurado." });
        expect(axios.post).not.toHaveBeenCalled();
    });

    test("responde 401 quando o LinkedIn não devolve access_token", async () => {
        setLinkedinEnv();
        axios.post.mockResolvedValue({ data: {} });

        const { status, body } = await invoke(controller.linkedinCallback, {
            query: { code: "codigo-1" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Não foi possível autenticar com o LinkedIn." });
        expect(axios.get).not.toHaveBeenCalled();
    });

    test("responde 401 quando a troca do code falha na rede", async () => {
        setLinkedinEnv();
        axios.post.mockRejectedValue(Object.assign(new Error("timeout"), { response: { data: "timeout" } }));

        const { status, body } = await invoke(controller.linkedinCallback, {
            query: { code: "codigo-1" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Falha na autenticação com o LinkedIn." });
    });

    test("faz login pelo userinfo e devolve token", async () => {
        setLinkedinEnv();
        axios.post.mockResolvedValue({ data: { access_token: "access-1" } });
        axios.get.mockResolvedValue({ data: userinfo });
        mockSocialQueries({
            byProvider: [],
            byEmail: [{ id: USER_ID, role: "user", name: "Maria Souza", email: "maria@exemplo.com", status: "active" }]
        });

        const { status, body } = await invoke(controller.linkedinCallback, {
            query: { code: "codigo-1" }
        });

        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Login com LinkedIn realizado com sucesso.",
            token: expect.any(String),
            user: { id: USER_ID, role: "user", name: "Maria Souza", email: "maria@exemplo.com", status: "active", linkedin_id: "linkedin-123" },
            mustChangePassword: false
        });
        expect(axios.get).toHaveBeenCalledWith("https://api.linkedin.com/v2/userinfo", {
            headers: { Authorization: "Bearer access-1" },
            timeout: 15000
        });
        expect(jwt.decode(body.token).id).toBe(USER_ID);
    });

    test("usa o id_token quando o userinfo falha", async () => {
        setLinkedinEnv();
        axios.post.mockResolvedValue({
            data: {
                access_token: "access-1",
                id_token: makeIdToken({ sub: "linkedin-999", email: "outra@exemplo.com", email_verified: true, name: "Outra" })
            }
        });
        axios.get.mockRejectedValue(unexpectedError("userinfo indisponível"));
        mockSocialQueries({ byProvider: [{ id: OTHER_ID, role: "user", name: "Outra", email: "outra@exemplo.com", status: "active" }] });

        const { status, body } = await invoke(controller.linkedinCallback, {
            query: { code: "codigo-1" }
        });

        expect(status).toBe(200);
        expect(body.user.id).toBe(OTHER_ID);
        expect(poolQuery.mock.calls[0][1]).toEqual(["linkedin-999"]);
        expect(body.message).toBe("Login com LinkedIn realizado com sucesso.");
    });

    test("responde 401 quando nem userinfo nem id_token trazem identidade", async () => {
        setLinkedinEnv();
        axios.post.mockResolvedValue({ data: { access_token: "access-1" } });
        axios.get.mockRejectedValue(unexpectedError("userinfo indisponível"));

        const { status, body } = await invoke(controller.linkedinCallback, {
            query: { code: "codigo-1" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "LinkedIn não retornou identidade válida." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("responde 403 quando o e-mail do LinkedIn não é verificado", async () => {
        setLinkedinEnv();
        axios.post.mockResolvedValue({ data: { access_token: "access-1" } });
        axios.get.mockResolvedValue({ data: { ...userinfo, email_verified: false } });

        const { status, body } = await invoke(controller.linkedinCallback, {
            query: { code: "codigo-1" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "E-mail do LinkedIn não verificado." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("reativa conta vinculada ao LinkedIn que estava inativa", async () => {
        setLinkedinEnv();
        axios.post.mockResolvedValue({ data: { access_token: "access-1" } });
        axios.get.mockResolvedValue({ data: userinfo });
        mockSocialQueries({
            byProvider: [{ id: USER_ID, role: "user", name: "Maria", email: "maria@exemplo.com", status: "inactive" }]
        });

        const { status, body } = await invoke(controller.linkedinCallback, {
            query: { code: "codigo-1" }
        });

        expect(status).toBe(200);
        expect(body.user.status).toBe("active");
        expect(poolQuery.mock.calls[1][0]).toContain("UPDATE `user` SET status = 'active'");
    });

    test("cria conta mínima quando o LinkedIn traz identidade nova", async () => {
        setLinkedinEnv();
        axios.post.mockResolvedValue({ data: { access_token: "access-1" } });
        axios.get.mockResolvedValue({ data: userinfo });
        mockSocialQueries({ byProvider: [], byEmail: [] });
        const conn = createConnection();

        const { status, body } = await invoke(controller.linkedinCallback, {
            query: { code: "codigo-1" }
        });

        expect(status).toBe(200);
        expect(uuid.isValid(body.user.id)).toBe(true);
        expect(body.user.role).toBe("user");
        expect(body.user.status).toBe("active");
        expect(conn.commit).toHaveBeenCalledTimes(1);
        expect(conn.release).toHaveBeenCalledTimes(1);
        expect(outbox.flush).toHaveBeenCalledWith([{ id: "notificacao-1" }]);
    });
});

describe("userController.getAllUsers", () => {
    test("lista os usuários", async () => {
        const rows = [
            { id: USER_ID, role: "user", name: "Maria", email: "maria@exemplo.com", status: "active" }
        ];
        poolQuery.mockResolvedValueOnce([rows]);

        const { status, body } = await invoke(controller.getAllUsers);

        expect(status).toBe(200);
        expect(body).toEqual(rows);
        expect(poolQuery.mock.calls[0][0]).toContain("LIMIT 100");
    });

    test("responde 500 quando a listagem falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.getAllUsers);

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao listar usuários." });
    });
});

describe("userController.getUsersByName", () => {
    test("exige o parâmetro name", async () => {
        const { status, body } = await invoke(controller.getUsersByName, { params: {} });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Informe o parâmetro name para buscar." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("rejeita name em branco", async () => {
        const { status, body } = await invoke(controller.getUsersByName, {
            params: { name: "   " }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Informe o parâmetro name para buscar." });
    });

    test("busca com o termo normalizado", async () => {
        const rows = [{ id: USER_ID, name: "Maria" }];
        poolQuery.mockResolvedValueOnce([rows]);

        const { status, body } = await invoke(controller.getUsersByName, {
            params: { name: "  Maria  " }
        });

        expect(status).toBe(200);
        expect(body).toEqual(rows);
        expect(poolQuery.mock.calls[0][0]).toContain("WHERE name LIKE ?");
        expect(poolQuery.mock.calls[0][1]).toEqual(["%Maria%"]);
    });

    test("responde 500 quando a busca falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.getUsersByName, {
            params: { name: "Maria" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar usuários." });
    });
});

describe("userController.updateUser", () => {
    const updatedRow = {
        id: USER_ID,
        role: "user",
        name: "Maria Souza",
        email: "maria@exemplo.com",
        cellphone: "16999998888",
        birthday: "1990-01-01",
        status: "active",
        createdIn: "2026-01-01T00:00:00.000Z"
    };

    test("rejeita UUID inválido", async () => {
        const { status, body } = await invoke(controller.updateUser, {
            params: { id: "id-invalido" },
            body: { name: "Maria" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do usuário inválido." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("bloqueia quem não é o dono nem admin", async () => {
        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: OTHER_ID,
            role: "user",
            body: { name: "Maria" }
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso negado." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("atualiza o próprio usuário e devolve os dados novos", async () => {
        poolQuery
            .mockResolvedValueOnce([[{ id: USER_ID }]])
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([[updatedRow]]);

        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            body: { name: "  Maria Souza  " }
        });

        expect(status).toBe(200);
        expect(body).toEqual({ message: "Usuário atualizado com sucesso.", user: updatedRow });
        expect(poolQuery.mock.calls[1][0]).toBe("UPDATE `user` SET `name` = ? WHERE id = ?");
        expect(poolQuery.mock.calls[1][1][0]).toBe("Maria Souza");
    });

    test("admin pode atualizar outro usuário", async () => {
        poolQuery
            .mockResolvedValueOnce([[{ id: OTHER_ID }]])
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([[{ ...updatedRow, id: OTHER_ID }]]);

        const { status, body } = await invoke(controller.updateUser, {
            params: { id: OTHER_ID },
            userId: USER_ID,
            role: "admin",
            body: { cellphone: "16999997777" }
        });

        expect(status).toBe(200);
        expect(body.user.id).toBe(OTHER_ID);
        expect(poolQuery.mock.calls[1][1][0]).toBe("16999997777");
    });

    test("exige ao menos um campo atualizável", async () => {
        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            body: { email: "outro@exemplo.com", role: "admin" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Nenhum campo para atualizar. Envie name, cellphone, birthday ou photo."
        });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("rejeita nome vazio", async () => {
        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            body: { name: "   " }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Nome inválido." });
    });

    test("rejeita celular inválido", async () => {
        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            body: { cellphone: "1699999888" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({
            error: "Celular inválido. Informe 11 dígitos numéricos (DDD + número)."
        });
    });

    test("rejeita data de nascimento inválida", async () => {
        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            body: { birthday: "data-invalida" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Data de nascimento inválida. Use YYYY-MM-DD." });
    });

    test("recusa foto maior que 5 MB", async () => {
        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            file: { size: 5 * 1024 * 1024 + 1, buffer: PNG }
        });

        expect(status).toBe(413);
        expect(body).toEqual({ error: "A foto deve ter até 5 MB." });
    });

    test("recusa arquivo que não é imagem suportada", async () => {
        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            file: { size: 10, buffer: Buffer.from("<svg></svg>") }
        });

        expect(status).toBe(415);
        expect(body).toEqual({ error: "Escolha uma foto JPG, PNG, WebP ou GIF." });
    });

    test("grava a foto válida junto dos outros campos", async () => {
        poolQuery
            .mockResolvedValueOnce([[{ id: USER_ID }]])
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([[updatedRow]]);

        const { status } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            body: { name: "Maria Souza" },
            file: { size: PNG.length, buffer: PNG }
        });

        expect(status).toBe(200);
        expect(poolQuery.mock.calls[1][0]).toBe("UPDATE `user` SET `name` = ?, `photo` = ? WHERE id = ?");
        expect(poolQuery.mock.calls[1][1][1]).toEqual(PNG);
    });

    test("responde 404 quando o usuário não existe", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            body: { name: "Maria Souza" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário não encontrado." });
    });

    test("responde 500 quando a atualização falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.updateUser, {
            params: { id: USER_ID },
            userId: USER_ID,
            body: { name: "Maria Souza" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar usuário." });
    });
});

describe("userController.deleteUser", () => {
    test("rejeita UUID inválido", async () => {
        const { status, body } = await invoke(controller.deleteUser, {
            params: { id: "id-invalido" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do usuário inválido." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("bloqueia quem não é o dono nem admin", async () => {
        const { status, body } = await invoke(controller.deleteUser, {
            params: { id: USER_ID },
            userId: OTHER_ID,
            role: "user"
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso negado." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("exclui o próprio usuário", async () => {
        poolQuery.mockResolvedValueOnce([[{ id: USER_ID }]]).mockResolvedValueOnce([{}]);

        const { status, body } = await invoke(controller.deleteUser, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(200);
        expect(body).toEqual({ message: "Usuário excluído com sucesso." });
        expect(poolQuery.mock.calls[1][0]).toContain("DELETE FROM `user` WHERE id = ?");
    });

    test("admin pode excluir outro usuário", async () => {
        poolQuery.mockResolvedValueOnce([[{ id: OTHER_ID }]]).mockResolvedValueOnce([{}]);

        const { status, body } = await invoke(controller.deleteUser, {
            params: { id: OTHER_ID },
            userId: USER_ID,
            role: "admin"
        });

        expect(status).toBe(200);
        expect(body).toEqual({ message: "Usuário excluído com sucesso." });
    });

    test("responde 404 quando o usuário não existe", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invoke(controller.deleteUser, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário não encontrado." });
    });

    test("responde 409 quando o usuário tem vínculos", async () => {
        poolQuery
            .mockResolvedValueOnce([[{ id: USER_ID }]])
            .mockRejectedValueOnce(Object.assign(new Error("fk"), { code: "ER_ROW_IS_REFERENCED_2" }));

        const { status, body } = await invoke(controller.deleteUser, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(409);
        expect(body).toEqual({
            error: "Não é possível excluir: o usuário possui vínculos (conversas, compras etc.)."
        });
    });

    test("responde 500 em falha inesperada", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.deleteUser, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao excluir usuário." });
    });
});

describe("userController.getUserById", () => {
    const row = {
        id: USER_ID,
        role: "user",
        name: "Maria",
        email: "maria@exemplo.com",
        cellphone: "16999998888",
        birthday: "1990-01-01",
        status: "active",
        createdIn: "2026-01-01T00:00:00.000Z"
    };

    test("rejeita UUID inválido", async () => {
        const { status, body } = await invoke(controller.getUserById, {
            params: { id: "id-invalido" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do usuário inválido." });
    });

    test("bloqueia consulta de outra conta", async () => {
        const { status, body } = await invoke(controller.getUserById, {
            params: { id: USER_ID },
            userId: OTHER_ID,
            role: "user"
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso negado." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("devolve o próprio usuário", async () => {
        poolQuery.mockResolvedValueOnce([[row]]);

        const { status, body } = await invoke(controller.getUserById, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(200);
        expect(body).toEqual(row);
    });

    test("admin consulta qualquer usuário", async () => {
        poolQuery.mockResolvedValueOnce([[{ ...row, id: OTHER_ID }]]);

        const { status, body } = await invoke(controller.getUserById, {
            params: { id: OTHER_ID },
            userId: USER_ID,
            role: "admin"
        });

        expect(status).toBe(200);
        expect(body.id).toBe(OTHER_ID);
    });

    test("responde 404 quando o usuário não existe", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invoke(controller.getUserById, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário não encontrado." });
    });

    test("responde 500 quando a consulta falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.getUserById, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao buscar usuário." });
    });
});

describe("userController.getUserPhoto", () => {
    test("rejeita UUID inválido", async () => {
        const { status, body } = await invokeWithExpressResponse(controller.getUserPhoto, {
            params: { id: "id-invalido" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "ID do usuário inválido." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("bloqueia a foto de outra conta", async () => {
        const { status, body } = await invokeWithExpressResponse(controller.getUserPhoto, {
            params: { id: USER_ID },
            userId: OTHER_ID,
            role: "user"
        });

        expect(status).toBe(403);
        expect(body).toEqual({ error: "Acesso negado." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("responde 404 quando o usuário não existe", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invokeWithExpressResponse(controller.getUserPhoto, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário não encontrado." });
    });

    test("responde 204 quando o usuário não tem foto", async () => {
        poolQuery.mockResolvedValueOnce([[{ photo: null }]]);

        const { status, body } = await invokeWithExpressResponse(controller.getUserPhoto, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(204);
        expect(body).toBeUndefined();
    });

    test("responde 415 quando o formato armazenado não é suportado", async () => {
        poolQuery.mockResolvedValueOnce([[{ photo: Buffer.from("<html></html>") }]]);

        const { status, body } = await invokeWithExpressResponse(controller.getUserPhoto, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(415);
        expect(body).toEqual({ error: "Formato de foto não suportado." });
    });

    test("devolve a imagem com cabeçalhos privados", async () => {
        poolQuery.mockResolvedValueOnce([[{ photo: PNG }]]);

        const { status, body, res } = await invokeWithExpressResponse(controller.getUserPhoto, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(200);
        expect(body).toEqual(PNG);
        expect(res.headers["Cache-Control"]).toBe("private, no-store");
        expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
        expect(res.contentType).toBe("image/png");
    });

    test("responde 500 quando a consulta da foto falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invokeWithExpressResponse(controller.getUserPhoto, {
            params: { id: USER_ID },
            userId: USER_ID
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Não foi possível consultar a foto." });
    });
});

describe("userController.patchPassword", () => {
    test("exige senha atual e nova senha", async () => {
        const { status, body } = await invoke(controller.patchPassword, {
            body: { currentPassword: "atual123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Senha atual e nova senha são obrigatórias." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("exige nova senha com ao menos seis caracteres", async () => {
        const { status, body } = await invoke(controller.patchPassword, {
            body: { currentPassword: "atual123", newPassword: "12345" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A nova senha deve ter no mínimo 6 caracteres." });
    });

    test("recusa nova senha igual à atual", async () => {
        const { status, body } = await invoke(controller.patchPassword, {
            body: { currentPassword: "atual123", newPassword: "atual123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A nova senha deve ser diferente da atual." });
    });

    test("responde 404 quando o usuário do token não existe", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invoke(controller.patchPassword, {
            body: { currentPassword: "atual123", newPassword: "nova123" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário não encontrado." });
    });

    test("responde 401 quando a senha atual está errada", async () => {
        poolQuery.mockResolvedValueOnce([[{ password: "hash-atual" }]]);
        bcrypt.compare.mockResolvedValue(false);

        const { status, body } = await invoke(controller.patchPassword, {
            body: { currentPassword: "errada123", newPassword: "nova123" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Senha atual incorreta." });
        expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    test("troca a senha do usuário autenticado", async () => {
        poolQuery.mockResolvedValueOnce([[{ password: "hash-atual" }]]).mockResolvedValueOnce([{}]);
        bcrypt.compare.mockResolvedValue(true);

        const { status, body } = await invoke(controller.patchPassword, {
            body: { currentPassword: "atual123", newPassword: "nova123" }
        });

        expect(status).toBe(200);
        expect(body).toEqual({ message: "Senha atualizada com sucesso." });
        expect(bcrypt.compare).toHaveBeenCalledWith("atual123", "hash-atual");
        expect(bcrypt.hash).toHaveBeenCalledWith("nova123", 10);
        expect(poolQuery.mock.calls[1][0]).toBe("UPDATE `user` SET password = ? WHERE id = ?");
        expect(poolQuery.mock.calls[1][1][0]).toBe("hash:nova123");
        expect(Buffer.isBuffer(poolQuery.mock.calls[1][1][1])).toBe(true);
    });

    test("responde 500 quando a atualização falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.patchPassword, {
            body: { currentPassword: "atual123", newPassword: "nova123" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao atualizar senha." });
    });
});

describe("userController.forgotPassword", () => {
    test("exige o email", async () => {
        const { status, body } = await invoke(controller.forgotPassword, { body: {} });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Email é obrigatório." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("envia o link de redefinição com token de propósito correto", async () => {
        poolQuery.mockResolvedValueOnce([[{ id: USER_ID }]]);

        const { status, body } = await invoke(controller.forgotPassword, {
            body: { email: "maria@exemplo.com" }
        });

        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Se o email estiver cadastrado, você receberá o link de redefinição."
        });
        expect(sendPasswordReset).toHaveBeenCalledTimes(1);
        const [email, token] = sendPasswordReset.mock.calls[0];
        expect(email).toBe("maria@exemplo.com");
        expect(jwt.decode(token)).toEqual({
            id: USER_ID,
            purpose: "password_reset",
            iat: expect.any(Number),
            exp: expect.any(Number)
        });
    });

    test("mantém a mesma resposta quando o email não está cadastrado", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invoke(controller.forgotPassword, {
            body: { email: "ninguem@exemplo.com" }
        });

        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Se o email estiver cadastrado, você receberá o link de redefinição."
        });
        expect(sendPasswordReset).not.toHaveBeenCalled();
    });

    test("mantém a resposta quando o envio do email falha", async () => {
        poolQuery.mockResolvedValueOnce([[{ id: USER_ID }]]);
        sendPasswordReset.mockRejectedValue(unexpectedError("SMTP fora do ar"));

        const { status, body } = await invoke(controller.forgotPassword, {
            body: { email: "maria@exemplo.com" }
        });

        expect(status).toBe(200);
        expect(body).toEqual({
            message: "Se o email estiver cadastrado, você receberá o link de redefinição."
        });
    });

    test("responde 500 quando a consulta falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.forgotPassword, {
            body: { email: "maria@exemplo.com" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao solicitar redefinição de senha." });
    });
});

describe("userController.resetPassword", () => {
    const validToken = () =>
        jwt.sign({ id: USER_ID, purpose: "password_reset" }, process.env.SECRET, { expiresIn: "30m" });

    test("exige token e nova senha", async () => {
        const { status, body } = await invoke(controller.resetPassword, {
            body: { token: "abc" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Token e nova senha são obrigatórios." });
    });

    test("exige nova senha com ao menos seis caracteres", async () => {
        const { status, body } = await invoke(controller.resetPassword, {
            body: { token: "abc", newPassword: "123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A nova senha deve ter no mínimo 6 caracteres." });
    });

    test("responde 401 para token inválido", async () => {
        const { status, body } = await invoke(controller.resetPassword, {
            body: { token: "token-invalido", newPassword: "nova123" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Link inválido ou expirado." });
        expect(poolQuery).not.toHaveBeenCalled();
    });

    test("responde 401 para token de outro propósito", async () => {
        const token = jwt.sign({ id: USER_ID, purpose: "login" }, process.env.SECRET);

        const { status, body } = await invoke(controller.resetPassword, {
            body: { token, newPassword: "nova123" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Link inválido ou expirado." });
    });

    test("responde 401 quando o id do token não é UUID", async () => {
        const token = jwt.sign({ id: "id-invalido", purpose: "password_reset" }, process.env.SECRET);

        const { status, body } = await invoke(controller.resetPassword, {
            body: { token, newPassword: "nova123" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Link inválido ou expirado." });
    });

    test("responde 404 quando o usuário do token não existe", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invoke(controller.resetPassword, {
            body: { token: validToken(), newPassword: "nova123" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário não encontrado." });
    });

    test("redefine a senha com token válido", async () => {
        poolQuery.mockResolvedValueOnce([[{ id: USER_ID }]]).mockResolvedValueOnce([{}]);

        const { status, body } = await invoke(controller.resetPassword, {
            body: { token: validToken(), newPassword: "nova123" }
        });

        expect(status).toBe(200);
        expect(body).toEqual({ message: "Senha redefinida com sucesso." });
        expect(bcrypt.hash).toHaveBeenCalledWith("nova123", 10);
        expect(poolQuery.mock.calls[1][0]).toBe("UPDATE `user` SET password = ? WHERE id = ?");
        expect(poolQuery.mock.calls[1][1][0]).toBe("hash:nova123");
    });

    test("responde 500 quando a atualização falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.resetPassword, {
            body: { token: validToken(), newPassword: "nova123" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao redefinir senha." });
    });
});

describe("userController.firstAccessPassword", () => {
    test("exige senha temporária e nova senha", async () => {
        const { status, body } = await invoke(controller.firstAccessPassword, {
            body: { newPassword: "nova123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Senha temporária e nova senha são obrigatórias." });
    });

    test("exige nova senha com ao menos seis caracteres", async () => {
        const { status, body } = await invoke(controller.firstAccessPassword, {
            body: { currentPassword: "temp123", newPassword: "123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A nova senha deve ter no mínimo 6 caracteres." });
    });

    test("recusa nova senha igual à temporária", async () => {
        const { status, body } = await invoke(controller.firstAccessPassword, {
            body: { currentPassword: "temp123", newPassword: "temp123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "A nova senha deve ser diferente da temporária." });
    });

    test("responde 404 quando o usuário do token não existe", async () => {
        poolQuery.mockResolvedValueOnce([[]]);

        const { status, body } = await invoke(controller.firstAccessPassword, {
            body: { currentPassword: "temp123", newPassword: "nova123" }
        });

        expect(status).toBe(404);
        expect(body).toEqual({ error: "Usuário não encontrado." });
    });

    test("recusa quando a senha já foi definida", async () => {
        poolQuery.mockResolvedValueOnce([[{ password: "hash", status: "active" }]]);

        const { status, body } = await invoke(controller.firstAccessPassword, {
            body: { currentPassword: "temp123", newPassword: "nova123" }
        });

        expect(status).toBe(400);
        expect(body).toEqual({ error: "Senha já definida. Use a troca de senha normal." });
        expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    test("responde 401 quando a senha temporária está errada", async () => {
        poolQuery.mockResolvedValueOnce([[{ password: "hash-temp", status: "firstLogin" }]]);
        bcrypt.compare.mockResolvedValue(false);

        const { status, body } = await invoke(controller.firstAccessPassword, {
            body: { currentPassword: "errada123", newPassword: "nova123" }
        });

        expect(status).toBe(401);
        expect(body).toEqual({ error: "Senha temporária incorreta." });
        expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    test("define a nova senha e ativa a conta", async () => {
        poolQuery.mockResolvedValueOnce([[{ password: "hash-temp", status: "firstLogin" }]]).mockResolvedValueOnce([{}]);
        bcrypt.compare.mockResolvedValue(true);

        const { status, body } = await invoke(controller.firstAccessPassword, {
            body: { currentPassword: "temp123", newPassword: "nova123" }
        });

        expect(status).toBe(200);
        expect(body).toEqual({ message: "Nova senha definida com sucesso. Bem-vindo!" });
        expect(bcrypt.compare).toHaveBeenCalledWith("temp123", "hash-temp");
        expect(poolQuery.mock.calls[1][0]).toBe("UPDATE `user` SET password = ?, status = 'active' WHERE id = ?");
        expect(poolQuery.mock.calls[1][1][0]).toBe("hash:nova123");
    });

    test("responde 500 quando a atualização falha", async () => {
        poolQuery.mockRejectedValue(unexpectedError("conexão perdida"));

        const { status, body } = await invoke(controller.firstAccessPassword, {
            body: { currentPassword: "temp123", newPassword: "nova123" }
        });

        expect(status).toBe(500);
        expect(body).toEqual({ error: "Erro ao definir nova senha." });
    });
});
