const commissionService = require("../services/commissionService");

const generateCommission = async (req, res) => {
    if (req.role !== "admin") {
        return res.status(403).json({ error: "Acesso não autorizado." });
    }

    try {
        const commission = await commissionService.generateCommission(req.params.paymentId);

        return res.status(200).json({
            message: "Comissão gerada com sucesso.",
            commission
        });
    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao gerar comissão." });
    }
};

module.exports = { generateCommission };
