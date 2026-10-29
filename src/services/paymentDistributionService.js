const uuid = require("../utils/uuid");
const paymentError = require("../utils/paymentError");

function toCents(value) {
    const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(value));
    if (!match) {
        throw paymentError("Valor monetário inválido para calcular a comissão.", 409);
    }
    return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
}

function money(cents) {
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function commissionRate() {
    const raw = process.env.PAYMENT_COMMISSION_PERCENT ?? "5";
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(raw)) {
        throw paymentError("PAYMENT_COMMISSION_PERCENT deve ser um percentual entre 0 e 100.", 503);
    }
    const basisPoints = toCents(raw);
    if (basisPoints > 10000) {
        throw paymentError("PAYMENT_COMMISSION_PERCENT deve ser um percentual entre 0 e 100.", 503);
    }
    return basisPoints;
}

function calculate(items, total, basisPoints = commissionRate()) {
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
        throw paymentError("Percentual de comissão inválido.", 503);
    }
    const amounts = new Map();
    for (const item of items) {
        if (!uuid.isValid(item.seller_id)) {
            throw paymentError("Fornecedor inválido na compra.", 409);
        }
        const sellerId = item.seller_id.toLowerCase();
        amounts.set(sellerId, (amounts.get(sellerId) || 0) + toCents(item.value));
    }
    const totalCents = toCents(total);
    const itemCents = [...amounts.values()].reduce((sum, value) => sum + value, 0);
    if (!items.length || totalCents <= 0 || totalCents !== itemCents) {
        throw paymentError("O valor dos itens diverge do total da compra.", 409);
    }

    const feeCents = Math.floor((totalCents * basisPoints + 5000) / 10000);
    const allocations = [...amounts].map(([sellerId, gross]) => ({
        sellerId, gross,
        fee: Math.floor(gross * basisPoints / 10000),
        remainder: gross * basisPoints % 10000
    }));
    const missingCents = feeCents - allocations.reduce((sum, item) => sum + item.fee, 0);
    allocations.sort((a, b) => b.remainder - a.remainder || a.sellerId.localeCompare(b.sellerId));
    for (let index = 0; index < missingCents; index++) allocations[index].fee++;
    allocations.sort((a, b) => a.sellerId.localeCompare(b.sellerId));

    return {
        currency: "BRL",
        percentage: money(basisPoints),
        gross_amount: money(totalCents),
        marketplace_amount: money(feeCents),
        sellers_amount_before_provider_fees: money(totalCents - feeCents),
        settlement_status: "not_configured",
        transfers_executed: false,
        sellers: allocations.map(item => ({
            seller_id: item.sellerId,
            gross_amount: money(item.gross),
            commission_amount: money(item.fee),
            amount_before_provider_fees: money(item.gross - item.fee)
        }))
    };
}

module.exports = { calculate, commissionRate };
