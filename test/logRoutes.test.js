const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { test, mock } = require("node:test");
const logService = require("../src/services/logService");
const auditService = require("../src/services/auditService");
const auditLog = require("../src/middlewares/auditLog");

const secret = "log-route-test-secret";
delete process.env.DB_HOST;
delete process.env.DB_NAME;
process.env.SECRET = secret;
process.env.DOCUMENT_ENC_KEY = "a".repeat(64);
process.env.DOCUMENT_HMAC_KEY = "b".repeat(64);

const apiRoutes = require("../src/routes/apiRoutes");

const USER_ID = "0190f2c4-1111-7000-8000-000000000001";
const LOG_ID = "0190f2c4-2222-7000-8000-000000000002";
const REFERENCE_ID = "0190f2c4-3333-7000-8000-000000000003";

async function startServer(t) {
    const app = express();
    app.use(express.json());
    app.use("/api/reaproveitafranca", apiRoutes);
    const server = http.createServer(app);

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));

    return `http://127.0.0.1:${server.address().port}`;
}

function tokenFor(role) {
    return jwt.sign({ id: USER_ID, role, name: "Test User" }, secret);
}

function request(baseUrl, path, { method = "GET", role, body } = {}) {
    const headers = {};

    if (role) headers.Authorization = `Bearer ${tokenFor(role)}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    return fetch(`${baseUrl}/api/reaproveitafranca${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function waitFor(condition, timeout = 1500) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
        if (condition()) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return false;
}

test("log routes require authentication", async (t) => {
    const called = mock.method(logService, "listLogs", async () => ({ total: 0, logs: [] }));
    t.after(() => called.mock.restore());
    const baseUrl = await startServer(t);

    const response = await request(baseUrl, "/log");

    assert.equal(response.status, 401);
});

test("log routes are restricted to admins", async (t) => {
    const called = mock.method(logService, "listLogs", async () => ({ total: 0, logs: [] }));
    t.after(() => called.mock.restore());
    const baseUrl = await startServer(t);

    const response = await request(baseUrl, "/log", { role: "user" });

    assert.equal(response.status, 403);
    assert.equal(called.mock.callCount(), 0);
});

test("logs are listed for admins with pagination metadata", async (t) => {
    const logs = [{ id: LOG_ID, status: "sucesso", operation: "create", table: "log" }];
    let received;

    const called = mock.method(logService, "listLogs", async (filters) => {
        received = filters;
        return { total: 1, limit: 10, offset: 0, logs };
    });
    t.after(() => called.mock.restore());

    const baseUrl = await startServer(t);
    const response = await request(baseUrl, "/log?limit=10&offset=0&operation=create", { role: "admin" });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { total: 1, limit: 10, offset: 0, logs });
    assert.equal(received.operation, "create");
    assert.equal(received.limit, 10);
    assert.equal(received.offset, 0);
});

test("listing rejects invalid UUID filters and pagination", async (t) => {
    const baseUrl = await startServer(t);

    const invalidReference = await request(baseUrl, "/log?reference_id=abc", { role: "admin" });
    assert.equal(invalidReference.status, 400);

    const invalidLimit = await request(baseUrl, "/log?limit=999", { role: "admin" });
    assert.equal(invalidLimit.status, 400);

    const invalidDate = await request(baseUrl, "/log?from=10/11/2026", { role: "admin" });
    assert.equal(invalidDate.status, 400);
});

test("admin registers a log entry", async (t) => {
    let received;
    const called = mock.method(logService, "createLog", async (entry) => {
        received = entry;
        return LOG_ID;
    });
    t.after(() => called.mock.restore());

    const baseUrl = await startServer(t);
    const response = await request(baseUrl, "/log", {
        method: "POST",
        role: "admin",
        body: {
            reference_id: REFERENCE_ID,
            status: "sucesso",
            operation: "create",
            table: "product"
        }
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { message: "Log registrado com sucesso.", id: LOG_ID });
    assert.equal(received.reference_id, REFERENCE_ID);
    assert.equal(received.id_user, USER_ID);
    assert.equal(received.table, "product");
});

test("creating a log validates required fields and reference_id", async (t) => {
    const baseUrl = await startServer(t);

    const missing = await request(baseUrl, "/log", { method: "POST", role: "admin", body: {} });
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /status/);

    const invalidReference = await request(baseUrl, "/log", {
        method: "POST",
        role: "admin",
        body: { reference_id: "abc", status: "sucesso", operation: "create", table: "product" }
    });
    assert.equal(invalidReference.status, 400);
    assert.match((await invalidReference.json()).error, /reference_id/);
});

test("updating a log requires at least one allowed field", async (t) => {
    const baseUrl = await startServer(t);

    const response = await request(baseUrl, `/log/${LOG_ID}`, {
        method: "PUT",
        role: "admin",
        body: { reference_id: REFERENCE_ID }
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /ao menos um campo/);
});

test("deleting an unknown log returns 404", async (t) => {
    const called = mock.method(logService, "deleteLog", async () => false);
    t.after(() => called.mock.restore());

    const baseUrl = await startServer(t);
    const response = await request(baseUrl, `/log/${LOG_ID}`, { method: "DELETE", role: "admin" });

    assert.equal(response.status, 404);
});

test("audit middleware maps HTTP verbs to operations and URL modules to tables", () => {
    assert.equal(auditLog.operationFor({ method: "POST", originalUrl: "/api/reaproveitafranca/product/create" }), "create");
    assert.equal(auditLog.operationFor({ method: "PUT", originalUrl: "/api/reaproveitafranca/product/123" }), "update");
    assert.equal(auditLog.operationFor({ method: "DELETE", originalUrl: "/api/reaproveitafranca/card/123" }), "delete");
    assert.equal(auditLog.operationFor({ method: "POST", originalUrl: "/api/reaproveitafranca/user/login" }), "login");

    assert.equal(auditLog.tableFor({ originalUrl: "/api/reaproveitafranca/shopping-product/123?x=1" }), "shopping-product");
    assert.equal(auditLog.tableFor({ originalUrl: "/api/reaproveitafranca/user/create" }), "user");
});

test("audit middleware records write operations automatically", async (t) => {
    const entries = [];

    const called = mock.method(logService, "createLog", async (entry) => {
        entries.push(entry);
        return LOG_ID;
    });
    t.after(() => called.mock.restore());

    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_NAME = "audit-test-db";
    t.after(() => {
        delete process.env.DB_HOST;
        delete process.env.DB_NAME;
    });

    const baseUrl = await startServer(t);
    const response = await request(baseUrl, "/log", {
        method: "POST",
        role: "admin",
        body: {
            reference_id: REFERENCE_ID,
            status: "sucesso",
            operation: "create",
            table: "product"
        }
    });

    assert.equal(response.status, 201);

    const recorded = await waitFor(() => entries.some((entry) => typeof entry.description === "string"));

    assert.equal(recorded, true);

    const auditEntry = entries.find((entry) => typeof entry.description === "string");

    assert.equal(auditEntry.status, "sucesso");
    assert.equal(auditEntry.operation, "create");
    assert.equal(auditEntry.table, "log");
    assert.equal(auditEntry.id_user, USER_ID);
    assert.equal(auditEntry.reference_id, REFERENCE_ID);
    assert.match(auditEntry.description, /^POST \/api\/reaproveitafranca\/log -> 201$/);
});

test("read auditing is disabled by default and can be enabled by env", async (t) => {
    assert.equal(auditLog.shouldAudit({ method: "GET" }), false);
    assert.equal(auditLog.shouldAudit({ method: "POST" }), true);

    const entries = [];

    const createMock = mock.method(logService, "createLog", async (entry) => {
        entries.push(entry);
        return LOG_ID;
    });
    t.after(() => createMock.mock.restore());

    const listMock = mock.method(logService, "listLogs", async () => ({ total: 0, limit: 50, offset: 0, logs: [] }));
    t.after(() => listMock.mock.restore());

    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_NAME = "audit-test-db";
    process.env.AUDIT_LOG_READS = "1";
    t.after(() => {
        delete process.env.DB_HOST;
        delete process.env.DB_NAME;
        delete process.env.AUDIT_LOG_READS;
    });

    const baseUrl = await startServer(t);
    const response = await request(baseUrl, "/log?limit=5", { role: "admin" });

    assert.equal(response.status, 200);
    assert.equal(await waitFor(() => entries.length > 0), true);

    const auditEntry = entries[0];

    assert.equal(auditEntry.operation, "read");
    assert.equal(auditEntry.table, "log");
    assert.equal(auditEntry.status, "sucesso");
    assert.match(auditEntry.description, /^GET \/api\/reaproveitafranca\/log -> 200$/);
});

test("audit middleware records every concurrent write", async (t) => {
    const entries = [];

    const createMock = mock.method(logService, "createLog", async (entry) => {
        entries.push(entry);
        return LOG_ID;
    });
    t.after(() => createMock.mock.restore());

    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_NAME = "audit-test-db";
    t.after(() => {
        delete process.env.DB_HOST;
        delete process.env.DB_NAME;
    });

    const app = express();
    app.use(express.json());
    app.use(auditLog);
    app.post("/write/:id", (req, res) => res.status(201).json({ ok: true }));

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const total = 20;

    await Promise.all(Array.from({ length: total }, (_, index) => fetch(
        `${baseUrl}/write/${REFERENCE_ID}?n=${index}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index }) }
    )));

    assert.equal(await waitFor(() => entries.length === total), true);
    assert.equal(entries.length, total);
    assert.equal(entries.every((entry) => entry.status === "sucesso" && entry.operation === "create"), true);
});

test("audit service sanitizes fields and does nothing without database", async (t) => {
    delete process.env.DB_HOST;
    delete process.env.DB_NAME;

    let called = false;
    const createMock = mock.method(logService, "createLog", async () => {
        called = true;
        return LOG_ID;
    });
    t.after(() => createMock.mock.restore());

    const skipped = await auditService.recordAudit({ status: "sucesso", operation: "create", table: "log" });

    assert.equal(skipped, null);
    assert.equal(called, false);

    process.env.DB_HOST = "127.0.0.1";
    process.env.DB_NAME = "audit-test-db";
    t.after(() => {
        delete process.env.DB_HOST;
        delete process.env.DB_NAME;
    });

    let received;
    createMock.mock.mockImplementation(async (entry) => {
        received = entry;
        return LOG_ID;
    });

    await auditService.recordAudit({
        reference_id: "nao-e-uuid",
        id_user: "nao-e-uuid",
        status: "x".repeat(80),
        operation: "y".repeat(40),
        table: "z".repeat(40),
        description: "d".repeat(400),
        ip: "1".repeat(60),
        user_agent: "u".repeat(400)
    });

    assert.equal(received.reference_id, null);
    assert.equal(received.id_user, null);
    assert.equal(received.status.length, 50);
    assert.equal(received.operation.length, 20);
    assert.equal(received.table.length, 20);
    assert.equal(received.description.length, 255);
    assert.equal(received.ip.length, 45);
    assert.equal(received.user_agent.length, 255);
});
