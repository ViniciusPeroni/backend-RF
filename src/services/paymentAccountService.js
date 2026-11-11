const crypto = require("crypto");
const axios = require("axios");
const connect = require("../db/connect");
const uuid = require("../utils/uuid");
const mercadoPago = require("./providers/mercadoPagoPaymentProvider");
const paymentError = require("../utils/paymentError");

function linkError(message, code) {
    const error = paymentError(message, 409);
    error.providerDetails = { provider_code: code };
    return error;
}

function encryptionKey() {
    const key = process.env.PAYMENT_TOKEN_ENCRYPTION_KEY || "";
    if (!/^[a-fA-F0-9]{64}$/.test(key)) throw paymentError("Configure PAYMENT_TOKEN_ENCRYPTION_KEY com 64 caracteres hexadecimais.", 503);
    return Buffer.from(key, "hex");
}

function encrypt(value, context) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
}

function decrypt(value, context) {
    const key = encryptionKey();
    try {
        const stored = JSON.parse(value);
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(stored.iv, "base64"));
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(stored.data, "base64")), decipher.final()]).toString("utf8");
    } catch (error) {
        throw paymentError("Não foi possível abrir a credencial do vendedor. Confira a chave de criptografia; não a rotacione sem migração.", 503);
    }
}

function configuration() {
    const { environment } = mercadoPago.configuration();
    const clientId = process.env.MERCADO_PAGO_CLIENT_ID || "";
    const clientSecret = process.env.MERCADO_PAGO_CLIENT_SECRET || "";
    const redirectUri = process.env.MERCADO_PAGO_REDIRECT_URI || "";
    if (!/^\d{1,40}$/.test(clientId) || !clientSecret) throw paymentError("Configure Client ID e Client Secret da aplicação Marketplace.", 503);
    let redirect;
    try { redirect = new URL(redirectUri); } catch (error) { throw paymentError("Configure MERCADO_PAGO_REDIRECT_URI com a URL do callback OAuth.", 503); }
    const localTest = environment === "test" && ["localhost", "127.0.0.1"].includes(redirect.hostname) && redirect.protocol === "http:";
    if ((!localTest && redirect.protocol !== "https:") || redirect.username || redirect.password || redirect.search || redirect.hash || redirectUri.length > 512) {
        throw paymentError("O callback OAuth deve usar HTTPS, sem credenciais, query ou fragmento.", 503);
    }
    encryptionKey();
    return { environment, clientId, clientSecret, redirectUri };
}

async function tokenRequest(config, data) {
    try {
        const response = await axios({
            method: "POST", url: "https://api.mercadopago.com/oauth/token", timeout: 10000, maxRedirects: 0,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            data: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...data }).toString()
        });
        return response.data;
    } catch (error) {
        const failure = paymentError("O Mercado Pago não confirmou a autorização do vendedor. Refaça a vinculação se o código ou refresh token expirou.", 503);
        const code = error.response?.data?.error;
        failure.providerDetails = { ...(error.response?.status ? { provider_status: error.response.status } : {}),
            ...(typeof code === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(code) ? { provider_code: code } : {}) };
        throw failure;
    }
}

async function getSellerAccount(token, collectorId, environment) {
    let account;
    try {
        account = (await axios({ method: "GET", url: "https://api.mercadopago.com/users/me", timeout: 10000, maxRedirects: 0,
            headers: { Authorization: `Bearer ${token}` } })).data;
    } catch (error) {
        if (![401, 403].includes(error.response?.status)) throw paymentError("Não foi possível validar a conta autorizada do vendedor.", 503);
        const failure = paymentError("A autorização do vendedor foi revogada no Mercado Pago. Desvincule e vincule a conta novamente.", 409);
        failure.providerDetails = { provider_status: error.response.status, provider_code: "seller_authorization_revoked" };
        throw failure;
    }
    if (String(account?.id) !== collectorId || !Array.isArray(account.tags) ||
        account.tags.includes("test_user") !== (environment === "test")) {
        throw paymentError("A conta autorizada não corresponde ao vendedor ou ambiente.", 409);
    }
    return account;
}

async function validateCredentials(data, config, expectedCollector) {
    if (typeof data?.access_token !== "string" || !data.access_token || data.access_token.length > 4096 ||
        typeof data.refresh_token !== "string" || !data.refresh_token || data.refresh_token.length > 4096 ||
        !Number.isInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 31536000 ||
        data.live_mode !== (config.environment === "production") || !/^\d{1,40}$/.test(String(data.user_id)) ||
        typeof data.user_id === "number" && !Number.isSafeInteger(data.user_id)) {
        throw paymentError("Credencial OAuth inválida ou de outro ambiente.", 409);
    }
    const marketplace = await mercadoPago.verifyAccount();
    if (String(data.user_id) === marketplace.id) throw linkError("O vendedor deve ter uma conta distinta do marketplace. Entre no Mercado Pago com a conta do vendedor.", "seller_is_marketplace");
    if (expectedCollector && String(data.user_id) !== expectedCollector) throw linkError("O vendedor não pode trocar a conta de pagamentos existentes.", "collector_changed");
    await getSellerAccount(data.access_token, String(data.user_id), config.environment);
    return { collectorId: String(data.user_id), marketplaceId: marketplace.id, expires: new Date(Date.now() + data.expires_in * 1000) };
}

async function start(userId) {
    const config = configuration();
    const marketplace = await mercadoPago.verifyAccount();
    const state = crypto.randomBytes(32).toString("base64url");
    const hash = crypto.createHash("sha256").update(state).digest("hex");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const conn = await connect.promise().getConnection();
    try {
        await conn.beginTransaction();
        const [users] = await conn.query("SELECT status FROM `user` WHERE id = ? FOR UPDATE", [uuid.toBin(userId)]);
        if (users[0]?.status !== "active") throw paymentError("Ative a conta antes de vincular o Mercado Pago.", 403);
        await conn.query("DELETE FROM payment_oauth_state WHERE id_user = ? AND expires_at < CURRENT_TIMESTAMP", [uuid.toBin(userId)]);
        await conn.query(
            `INSERT INTO payment_oauth_state (state_hash, id_user, environment, application_id, marketplace_id, redirect_uri, verifier_enc, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [hash, uuid.toBin(userId), config.environment, config.clientId, marketplace.id, config.redirectUri, encrypt(verifier, `state:${hash}`), new Date(Date.now() + 600000)]
        );
        await conn.commit();
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
    const params = new URLSearchParams({ client_id: config.clientId, response_type: "code", platform_id: "mp", redirect_uri: config.redirectUri,
        state, code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    return { authorization_url: `https://auth.mercadopago.com.br/authorization?${params}`, expires_in: 600 };
}

async function callback(query) {
    const config = configuration();
    if (query.error) throw paymentError("Autorização não concedida. Inicie a vinculação novamente.", 400);
    if (typeof query.state !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(query.state) ||
        typeof query.code !== "string" || !query.code || query.code.length > 2048 || /[\s\x00-\x1f\x7f]/.test(query.code)) throw paymentError("Callback OAuth inválido.", 400);
    const hash = crypto.createHash("sha256").update(query.state).digest("hex");
    const [states] = await connect.promise().query("SELECT *, BIN_TO_UUID(id_user) AS user_id FROM payment_oauth_state WHERE state_hash = ?", [hash]);
    const state = states[0];
    const marketplace = await mercadoPago.verifyAccount();
    if (!state || state.consumed_at || new Date(state.expires_at).getTime() <= Date.now() || state.environment !== config.environment ||
        state.application_id !== config.clientId || state.redirect_uri !== config.redirectUri || state.marketplace_id !== marketplace.id) {
        throw paymentError("Estado OAuth expirado, já utilizado ou de outra configuração.", 409);
    }
    const [consumed] = await connect.promise().query("UPDATE payment_oauth_state SET consumed_at = CURRENT_TIMESTAMP WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP", [hash]);
    if (consumed.affectedRows !== 1) throw paymentError("Estado OAuth já utilizado ou expirado.", 409);
    const data = await tokenRequest(config, { grant_type: "authorization_code", code: query.code, redirect_uri: config.redirectUri,
        code_verifier: decrypt(state.verifier_enc, `state:${hash}`) });
    const verified = await validateCredentials(data, config);
    const conn = await connect.promise().getConnection();
    try {
        await conn.beginTransaction();
        const [owners] = await conn.query("SELECT status FROM `user` WHERE id = ? FOR UPDATE", [uuid.toBin(state.user_id)]);
        if (owners[0]?.status !== "active") throw paymentError("A conta local precisa estar ativa para concluir a vinculação.", 403);
        const [validStates] = await conn.query("SELECT state_hash FROM payment_oauth_state WHERE state_hash = ? AND expires_at > CURRENT_TIMESTAMP FOR UPDATE", [hash]);
        if (!validStates.length) throw paymentError("Autorização invalidada ou expirada. Inicie a vinculação novamente.", 409);
        const [accounts] = await conn.query("SELECT *, BIN_TO_UUID(id) AS account_id FROM payment_seller_account WHERE id_user = ? AND environment = ? AND disconnected_at IS NULL FOR UPDATE", [uuid.toBin(state.user_id), config.environment]);
        let existing = accounts[0];
        if (existing && (existing.collector_id !== verified.collectorId || existing.marketplace_id !== verified.marketplaceId || existing.application_id !== config.clientId)) {
            throw linkError("Esta conta local já está vinculada a outro recebedor ou aplicação. Desvincule a conexão atual antes de trocar.", "user_linked_to_other_collector");
        }
        if (!existing) {
            const [history] = await conn.query("SELECT *, BIN_TO_UUID(id) AS account_id, BIN_TO_UUID(id_user) AS user_id FROM payment_seller_account WHERE collector_id = ? AND environment = ? FOR UPDATE", [verified.collectorId, config.environment]);
            existing = history[0];
            // Mesma empresa com vínculo antigo desconectado (ex.: troca das credenciais da aplicação):
            // reaproveita o registro e mantém o histórico dos pagamentos que apontam para ele.
            const reconexao = existing && existing.user_id === state.user_id && existing.disconnected_at;
            if (existing && !reconexao && (existing.user_id !== state.user_id || existing.marketplace_id !== verified.marketplaceId || existing.application_id !== config.clientId)) {
                throw linkError("A conta Mercado Pago já possui vínculo histórico com outro vendedor ou aplicação.", "collector_linked_to_other_user");
            }
        }
        const id = existing?.account_id || uuid.generateId();
        const access = encrypt(data.access_token, `account:${id}:access`);
        const refresh = encrypt(data.refresh_token, `account:${id}:refresh`);
        if (existing) {
            await conn.query("UPDATE payment_seller_account SET application_id = ?, marketplace_id = ?, access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, disconnected_at = NULL WHERE id = ?", [config.clientId, verified.marketplaceId, access, refresh, verified.expires, uuid.toBin(id)]);
        } else {
            await conn.query(`INSERT INTO payment_seller_account (id, id_user, environment, application_id, marketplace_id, collector_id, access_token_enc, refresh_token_enc, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [uuid.toBin(id), uuid.toBin(state.user_id), config.environment, config.clientId, verified.marketplaceId, verified.collectorId, access, refresh, verified.expires]);
        }
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        if (error.code === "ER_DUP_ENTRY") throw paymentError("A conta Mercado Pago já está vinculada a outro vendedor.", 409);
        throw error;
    } finally { conn.release(); }
    return { message: "Mercado Pago vinculado com sucesso. Você pode voltar ao aplicativo.", connected: true, environment: config.environment };
}

async function status(userId) {
    const { environment } = mercadoPago.configuration();
    const [accounts] = await connect.promise().query("SELECT expires_at FROM payment_seller_account WHERE id_user = ? AND environment = ? AND disconnected_at IS NULL", [uuid.toBin(userId), environment]);
    return { connected: !!accounts[0], environment, credentials_expired: accounts[0] ? new Date(accounts[0].expires_at).getTime() <= Date.now() : false };
}

async function disconnect(userId) {
    const { environment } = mercadoPago.configuration();
    const conn = await connect.promise().getConnection();
    try {
        await conn.beginTransaction();
        const [users] = await conn.query("SELECT id FROM `user` WHERE id = ? FOR UPDATE", [uuid.toBin(userId)]);
        if (!users.length) throw paymentError("Usuário não encontrado.", 404);
        await conn.query("UPDATE payment_seller_account SET disconnected_at = CURRENT_TIMESTAMP WHERE id_user = ? AND environment = ? AND disconnected_at IS NULL", [uuid.toBin(userId), environment]);
        await conn.query("DELETE FROM payment_oauth_state WHERE id_user = ? AND environment = ?", [uuid.toBin(userId), environment]);
        await conn.commit();
        return { message: "Mercado Pago desvinculado do sistema para novas cobranças.", connected: false, environment,
            historical_payments_preserved: true, provider_authorization_revoked: false };
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
}

async function credentials(accountId) {
    const config = configuration();
    const conn = await connect.promise().getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query("SELECT * FROM payment_seller_account WHERE id = ? FOR UPDATE", [uuid.toBin(accountId)]);
        const account = rows[0];
        const marketplace = await mercadoPago.verifyAccount();
        if (!account || account.environment !== config.environment || account.application_id !== config.clientId || account.marketplace_id !== marketplace.id) {
            throw paymentError("Vínculo do vendedor não corresponde à configuração atual do marketplace.", 409);
        }
        let token;
        if (new Date(account.expires_at).getTime() > Date.now() + 60000) token = decrypt(account.access_token_enc, `account:${accountId}:access`);
        else {
            const data = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: decrypt(account.refresh_token_enc, `account:${accountId}:refresh`) });
            const verified = await validateCredentials(data, config, account.collector_id);
            await conn.query("UPDATE payment_seller_account SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ? WHERE id = ?", [
                encrypt(data.access_token, `account:${accountId}:access`), encrypt(data.refresh_token, `account:${accountId}:refresh`), verified.expires, uuid.toBin(accountId)
            ]);
            token = data.access_token;
        }
        await conn.commit();
        return { token, collectorId: account.collector_id, marketplaceId: account.marketplace_id };
    } catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
}

async function assertCanReceive(accountId) {
    const [connections] = await connect.promise().query("SELECT id FROM payment_seller_account WHERE id = ? AND disconnected_at IS NULL", [uuid.toBin(accountId)]);
    if (!connections.length) throw paymentError("O vendedor desvinculou o Mercado Pago. Conecte a conta antes de cobrar com split.", 409);
    const { environment } = configuration();
    const { token, collectorId } = await credentials(accountId);
    const account = await getSellerAccount(token, collectorId, environment);
    if (account.status?.sell?.allow === false) {
        const error = paymentError("A conta Mercado Pago do vendedor possui uma restrição para receber vendas. O titular precisa verificar e regularizar a conta no Mercado Pago.", 409);
        const codes = Array.isArray(account.status.sell.codes) ? account.status.sell.codes.filter(code => typeof code === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(code)) : [];
        error.providerDetails = { provider_code: "seller_account_restricted", seller_codes: codes };
        throw error;
    }
}

module.exports = { configuration, start, callback, status, disconnect, credentials, assertCanReceive };
