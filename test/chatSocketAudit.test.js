const assert = require("node:assert/strict");
const { test, mock } = require("node:test");

const logService = require("../src/services/logService");
const messageService = require("../src/services/messageService");
const chatSocket = require("../src/sockets/chatSocket");

const USER_ID = "0190f2c4-4444-7000-8000-000000000004";
const CONVERSATION_ID = "0190f2c4-5555-7000-8000-000000000005";
const MESSAGE_ID = "0190f2c4-6666-7000-8000-000000000006";

async function waitFor(condition, timeout = 1500) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
        if (condition()) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return false;
}

function createHarness() {
    const connectionHandlers = {};

    const io = {
        on(event, handler) {
            connectionHandlers[event] = handler;
        },
        to() {
            return { emit() {} };
        }
    };

    const socketHandlers = {};
    const socket = {
        id: "socket-audit-test",
        userId: USER_ID,
        userName: "Teste",
        handshake: { address: "127.0.0.1", headers: { "user-agent": "audit-test" } },
        on(event, handler) {
            socketHandlers[event] = handler;
        },
        join() {},
        leave() {}
    };

    chatSocket(io);
    connectionHandlers.connection(socket);

    return { socketHandlers, socket };
}

test("send_message audita criação de mensagem com sucesso", async (t) => {
    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_NAME = "audit-test-db";
    t.after(() => {
        delete process.env.DB_HOST;
        delete process.env.DB_NAME;
    });

    const entries = [];

    const logMock = mock.method(logService, "createLog", async (entry) => {
        entries.push(entry);
        return MESSAGE_ID;
    });
    t.after(() => logMock.mock.restore());

    const messageMock = mock.method(messageService, "createMessage", async () => ({
        id: MESSAGE_ID,
        recipients: []
    }));
    t.after(() => messageMock.mock.restore());

    const { socketHandlers } = createHarness();

    let response;
    await socketHandlers.send_message(
        { conversationId: CONVERSATION_ID, type: "texto", content: "oi" },
        (payload) => { response = payload; }
    );

    assert.equal(response.id, MESSAGE_ID);
    assert.equal(await waitFor(() => entries.length === 1), true);

    assert.equal(entries[0].status, "sucesso");
    assert.equal(entries[0].operation, "create");
    assert.equal(entries[0].table, "message");
    assert.equal(entries[0].reference_id, MESSAGE_ID);
    assert.equal(entries[0].id_user, USER_ID);
    assert.equal(entries[0].ip, "127.0.0.1");
    assert.equal(entries[0].user_agent, "audit-test");
    assert.match(entries[0].description, /^socket send_message -> tipo texto$/);
});

test("send_message audita falha de criação", async (t) => {
    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_NAME = "audit-test-db";
    t.after(() => {
        delete process.env.DB_HOST;
        delete process.env.DB_NAME;
    });

    const entries = [];

    const logMock = mock.method(logService, "createLog", async (entry) => {
        entries.push(entry);
        return MESSAGE_ID;
    });
    t.after(() => logMock.mock.restore());

    const messageMock = mock.method(messageService, "createMessage", async () => {
        throw new Error("falha simulada");
    });
    t.after(() => messageMock.mock.restore());

    const { socketHandlers } = createHarness();

    const originalError = console.error;
    console.error = () => {};
    t.after(() => { console.error = originalError; });

    let response;
    await socketHandlers.send_message(
        { conversationId: CONVERSATION_ID, type: "texto", content: "oi" },
        (payload) => { response = payload; }
    );

    assert.equal(response.error, "Erro ao enviar mensagem.");
    assert.equal(await waitFor(() => entries.length === 1), true);
    assert.equal(entries[0].status, "falha");
    assert.equal(entries[0].operation, "create");
    assert.equal(entries[0].table, "message");
    assert.match(entries[0].description, /^socket send_message -> erro$/);
});
