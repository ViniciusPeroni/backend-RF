const QRCode = require("qrcode");

const simulatedPaymentProvider = {

    async createPayment(payment) {
        const validMethods = [
            "pix",
            "credit_card",
            "debit_card"
        ];

        if (!validMethods.includes(payment.method)) {
            throw new Error("Método de pagamento não suportado.");
        }

        const result = {
            provider: "simulated",
            simulation: true,
            provider_payment_id: `sim_${payment.id}`,
            status: "pending",
            method: payment.method,
            qr_code: null,
            qr_code_base64: null
        };

        if (payment.method === "pix") {
            const content = JSON.stringify({
                simulation: true,
                payment_id: payment.id,
                value: payment.value,
                message: "SIMULACAO RF - SEM VALOR PARA PAGAMENTO"
            });

            const image = await QRCode.toDataURL(content, {
                type: "image/png",
                width: 320,
                margin: 2,
                errorCorrectionLevel: "M"
            });

            result.qr_code = content;
            result.qr_code_base64 = image.split(",")[1];
        }

        return result;
    }

};

module.exports = simulatedPaymentProvider;