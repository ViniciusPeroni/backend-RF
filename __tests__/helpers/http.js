"use strict";

/**
 * Helpers para exercitar uma controller sem Express e sem banco.
 *
 * `invoke` monta `req`/`res` falsos, executa o handler e devolve
 * `{ status, body }` para asserção.
 */

const USER_ID = "3f4c1a2b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const OTHER_ID = "7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";

function createRequest(options = {}) {
    const {
        body = {},
        params = {},
        query = {},
        headers = {},
        userId = USER_ID,
        role = "user",
        userName = "Usuário de Teste",
        file = null,
        files = null
    } = options;

    return {
        body,
        params,
        query,
        headers,
        userId,
        role,
        userName,
        file,
        files
    };
}

function createResponse() {
    const res = {
        statusCode: 200,
        body: undefined,
        headers: {},
        finished: false,
        status(code) {
            res.statusCode = code;
            return res;
        },
        json(payload) {
            res.body = payload;
            res.finished = true;
            return res;
        },
        send(payload) {
            res.body = payload;
            res.finished = true;
            return res;
        },
        end(payload) {
            res.body = payload;
            res.finished = true;
            return res;
        },
        sendStatus(code) {
            res.statusCode = code;
            res.finished = true;
            return res;
        },
        setHeader(name, value) {
            res.headers[name] = value;
            return res;
        },
        set(name, value) {
            if (typeof name === "object" && name !== null) {
                Object.assign(res.headers, name);
            } else {
                res.headers[name] = value;
            }
            return res;
        },
        type(value) {
            res.headers["Content-Type"] = value;
            return res;
        },
        attachment(filename) {
            res.headers["Content-Disposition"] = filename ? `attachment; filename="${filename}"` : "attachment";
            return res;
        },
        redirect(url) {
            res.redirectedTo = url;
            return res;
        }
    };

    return res;
}

async function invoke(handler, options = {}) {
    if (typeof handler !== "function") {
        throw new TypeError("invoke espera um handler de controller");
    }

    const req = createRequest(options);
    const res = createResponse();
    await handler(req, res);

    return { req, res, status: res.statusCode, body: res.body };
}

/** Erro no formato usado pelos services: `error.status` + `error.message`. */
function serviceError(message, status, extra = {}) {
    return Object.assign(new Error(message), { status }, extra);
}

/** Erro inesperado, sem `status`, para exercitar o fallback 500. */
function unexpectedError(message = "falha interna do banco") {
    return new Error(message);
}

module.exports = {
    USER_ID,
    OTHER_ID,
    createRequest,
    createResponse,
    invoke,
    serviceError,
    unexpectedError
};
