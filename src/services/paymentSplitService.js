const connect = require("../db/connect");
const uuid = require("../utils/uuid");
const accounts = require("./paymentAccountService");
const distribution = require("./paymentDistributionService");
const mercadoPago = require("./providers/mercadoPagoPaymentProvider");
const paymentError = require("../utils/paymentError");

function enabled() {
    const value = process.env.split_payment ?? "false";
    if (!["true", "false"].includes(value)) throw paymentError("split_payment deve ser true ou false.", 503);
    return value === "true";
}

async function prepare(shoppingId) {
    if (!enabled()) return null;
    if (process.env.PAYMENT_PROVIDER !== "mercado_pago") throw paymentError("Split real exige o provedor Mercado Pago.", 503);
    accounts.configuration();
    const marketplace = await mercadoPago.verifyAccount();
    const [items] = await connect.promise().query(
        `SELECT sp.value, BIN_TO_UUID(p.id_user) AS seller_id FROM shopping_product sp
         INNER JOIN product p ON p.id = sp.id_product WHERE sp.id_shopping = ?`, [uuid.toBin(shoppingId)]
    );
    const [shops] = await connect.promise().query("SELECT value FROM shopping WHERE id = ?", [uuid.toBin(shoppingId)]);
    const plan = distribution.calculate(items, shops[0]?.value);
    if (plan.sellers.length !== 1) throw paymentError("Split 1:1 exige uma compra por vendedor. Separe os vendedores em compras distintas.", 409);
    const sellerId = plan.sellers[0].seller_id;
    const [rows] = await connect.promise().query(
        "SELECT BIN_TO_UUID(id) AS account_id, collector_id, marketplace_id, application_id, environment FROM payment_seller_account WHERE id_user = ? AND environment = ? AND disconnected_at IS NULL",
        [uuid.toBin(sellerId), marketplace.environment]
    );
    const account = rows[0];
    if (!account) throw paymentError("O vendedor ainda não vinculou o Mercado Pago. Conecte a conta antes de cobrar com split.", 409);
    if (account.marketplace_id !== marketplace.id || account.application_id !== process.env.MERCADO_PAGO_CLIENT_ID || account.collector_id === marketplace.id) {
        throw paymentError("A conta do vendedor não corresponde a este marketplace.", 409);
    }
    await accounts.assertCanReceive(account.account_id);
    return { account_id: account.account_id, seller_id: sellerId, collector_id: account.collector_id, marketplace_id: marketplace.id,
        environment: marketplace.environment, application_fee: plan.marketplace_amount, gross_amount: plan.gross_amount };
}

async function getBinding(paymentId) {
    const [rows] = await connect.promise().query(
        `SELECT BIN_TO_UUID(id_account) AS account_id, BIN_TO_UUID(id_seller) AS seller_id,
                collector_id, marketplace_id, environment, application_fee, gross_amount
         FROM payment_split WHERE id_payment = ?`, [uuid.toBin(paymentId)]
    );
    return rows[0] || null;
}

async function accountForWebhook(paymentId, collectorId) {
    const [known] = await connect.promise().query(
        `SELECT BIN_TO_UUID(s.id_account) AS account_id FROM payment_split s
         INNER JOIN payment_gateway g ON g.id_payment = s.id_payment
         WHERE g.provider = 'mercado_pago' AND g.environment = ? AND g.transaction_id = ? LIMIT 2`,
        [mercadoPago.configuration().environment, paymentId]
    );
    if (known.length === 1) return known[0].account_id;
    if (known.length > 1) throw paymentError("Pagamento externo com vínculos duplicados; conciliação necessária.", 409);
    if (!/^\d{1,40}$/.test(String(collectorId))) throw paymentError("Notificação sem recebedor identificável; sincronize o pagamento.", 503);
    const [accounts] = await connect.promise().query(
        "SELECT BIN_TO_UUID(id) AS id FROM payment_seller_account WHERE collector_id = ? AND environment = ?", [String(collectorId), mercadoPago.configuration().environment]
    );
    return accounts[0]?.id || null;
}

module.exports = { enabled, prepare, getBinding, accountForWebhook };
