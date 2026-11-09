const accounts = require("../services/paymentAccountService");
const split = require("../services/paymentSplitService");
const mercadoPago = require("../services/providers/mercadoPagoPaymentProvider");
const uuid = require("../utils/uuid");

function operation(name) {
    return async (req, res) => {
        try {
            if (!uuid.isValid(req.userId)) return res.status(401).json({ error: "Autenticação necessária." });
            return res.status(200).json(await accounts[name](req.userId));
        } catch (error) {
            if (!error.status) console.error("Erro na conta de pagamento:", error.code || error.name);
            return res.status(error.status || 500).json({ error: error.status ? error.message : "Erro ao processar a conta de pagamento.", ...(error.providerDetails || {}) });
        }
    };
}

async function callback(req, res) {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    try { return res.status(200).json(await accounts.callback(req.query)); }
    catch (error) {
        console.error("Erro no callback de pagamento:", error.status || error.code || error.name, error.providerDetails?.provider_code || "");
        return res.status(error.status || 500).json({ error: error.status ? error.message : "Erro ao vincular o Mercado Pago.", ...(error.providerDetails || {}) });
    }
}

async function configuration(req, res) {
    try {
        if (!uuid.isValid(req.userId)) return res.status(401).json({ error: "Autenticação necessária." });
        const { environment } = mercadoPago.configuration();
        let oauthConfigured = false;
        try { accounts.configuration(); oauthConfigured = true; } catch (error) { /* Requisitos exibidos sem expor segredos. */ }
        const publicKey = process.env.MERCADO_PAGO_PUBLIC_KEY || "";
        return res.status(200).json({ environment, split_payment: split.enabled(),
            public_key: /^(APP_USR|TEST)-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(publicKey) ? publicKey : null,
            webhook_configured: !!process.env.MERCADO_PAGO_WEBHOOK_SECRET,
            webhook_url_configured: !!process.env.PAYMENT_WEBHOOK_URL,
            oauth_configured: oauthConfigured, external_validation_required: true });
    } catch (error) { return res.status(error.status || 500).json({ error: error.status ? error.message : "Erro ao consultar configuração de pagamento." }); }
}

module.exports = { start: operation("start"), status: operation("status"), disconnect: operation("disconnect"), callback, configuration };
