// Diagnostico somente leitura: nao altera .env nem cria cobrancas.
const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns/promises");
const dotenv = require("dotenv");

async function request(url) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
        const body = await response.json().catch(() => null);
        return { status: response.status, body };
    } catch (error) {
        return { error: error.cause?.code || error.code || error.name };
    }
}

async function main() {
    const root = path.join(__dirname, "..");
    const env = dotenv.parse(fs.readFileSync(path.join(root, ".env")));
    const callbackPath = "/api/reaproveitafranca/payment/mercado-pago/oauth/callback";
    const webhookPath = "/api/reaproveitafranca/payment/webhook/mercado-pago";
    const port = Number(env.PORT || 5000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT invalida.");
    const callback = new URL(env.MERCADO_PAGO_REDIRECT_URI);
    const webhook = new URL(env.PAYMENT_WEBHOOK_URL);
    if (callback.protocol !== "https:" || callback.username || callback.password || callback.search || callback.hash ||
        webhook.protocol !== "https:" || webhook.username || webhook.password || webhook.search || webhook.hash) {
        throw new Error("Use URLs HTTPS publicas sem credenciais, query ou fragmento.");
    }
    // Permite conferir o hostname novo ANTES de atualizar as URLs do .env.
    const publicUrl = new URL(process.argv[2] || callback.origin);
    if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== "/") {
        throw new Error("Informe somente a origem HTTPS do tunel, sem caminho ou parametros.");
    }
    const [local, ready, publicApi, lookup] = await Promise.all([
        request(`http://127.0.0.1:${port}${callbackPath}`),
        request("http://127.0.0.1:20241/ready"),
        request(`${publicUrl.origin}${callbackPath}`),
        dns.lookup(publicUrl.hostname).then(() => ({ resolved: true })).catch(error => ({ resolved: false, error: error.code })),
    ]);
    const responds = result => result.status === 400 && result.body?.error === "Callback OAuth inválido.";
    const healthy = responds(local) && ready.status === 200 && ready.body?.readyConnections > 0 && responds(publicApi);
    const configurationMatches = callback.origin === publicUrl.origin && webhook.origin === publicUrl.origin &&
        callback.pathname === callbackPath && webhook.pathname === webhookPath;
    console.log(JSON.stringify({
        local: { status: local.status, error: local.error, expectedCallbackResponse: responds(local) },
        tunnel: { status: ready.status, connections: ready.body?.readyConnections || 0, error: ready.error },
        public: { origin: publicUrl.origin, ...lookup, status: publicApi.status, error: publicApi.error, expectedCallbackResponse: responds(publicApi) },
        configurationMatches,
        healthy,
    }, null, 2));
    if (!healthy || !configurationMatches) process.exitCode = 1;
}

main().catch(error => { console.error("Diagnostico:", error.code || error.message); process.exitCode = 1; });
