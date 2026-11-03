const paymentService = require("../services/paymentService");
const paymentWebhookService = require("../services/paymentWebhookService");

async function createCheckout(req, res) {
    try {
        const { shoppingId, method } = req.body || {};
        const payment = await paymentService.createCheckout({
            userId: req.userId,
            shoppingId,
            method
        });
        return res.status(201).json(payment);
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: "Erro ao iniciar o checkout." });
    }
}

async function getPaymentStatus(req, res) {
    try {
        const payment = await paymentService.getPaymentStatus({
            paymentId: req.params.paymentId,
            userId: req.userId,
            role: req.role
        });
        return res.status(200).json(payment);
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: "Erro ao consultar o pagamento." });
    }
}

async function handleWebhook(req, res) {
    try {
        await paymentWebhookService.processNotification({
            paymentId: req.query?.["data.id"],
            requestId: req.headers["x-request-id"],
            signature: req.headers["x-signature"]
        });
        return res.status(200).json({ received: true });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: "Erro ao processar notificação de pagamento." });
    }
}

module.exports = { createCheckout, getPaymentStatus, handleWebhook };
