
const disputeService = require("../services/disputeService");
const uuid = require("../utils/uuid");

// Tipos válidos para validação no controller (espelho do service/banco)
const VALID_TYPES = [
    "material_incompativel",
    "nao_retirado",
    "nao_comparecimento",
    "comportamento_inadequado",
    "item_danificado",
    "outro"
];


// =========================================================
// CRIAR DISPUTA
// POST /dispute/create
// =========================================================
const createDispute = async (req, res) => {
    try {
        const { type, description, id_shopping } = req.body;

        if (!type || !description || !id_shopping) {
            return res.status(400).json({
                error: "Os campos type, description e id_shopping são obrigatórios."
            });
        }

        if (typeof description !== "string" || description.trim() === "") {
            return res.status(400).json({
                error: "A descrição não pode ser vazia."
            });
        }

        if (!VALID_TYPES.includes(type)) {
            return res.status(400).json({
                error: `Tipo de disputa inválido. Valores aceitos: ${VALID_TYPES.join(", ")}.`
            });
        }

        if (!uuid.isValid(id_shopping)) {
            return res.status(400).json({
                error: "ID da compra inválido."
            });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Usuário não autenticado."
            });
        }

        const id = await disputeService.createDispute({
            type,
            description,
            id_shopping,
            id_opened_by: req.userId
        });

        return res.status(201).json({
            message: "Disputa aberta com sucesso.",
            id
        });

    } catch (error) {
        console.error("Erro em createDispute:", error);

        if (error.code === "SHOPPING_NOT_FOUND") {
            return res.status(404).json({ error: "Compra não encontrada." });
        }
        if (error.code === "DISPUTE_NOT_ALLOWED") {
            return res.status(403).json({ error: error.message });
        }
        if (error.code === "DISPUTE_ALREADY_EXISTS") {
            return res.status(409).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao abrir disputa." });
    }
};


// =========================================================
// LISTAR DISPUTAS
// GET /dispute
// =========================================================
const getDisputes = async (req, res) => {
    try {
        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        const disputes = await disputeService.getDisputes(req.userId, req.role);

        return res.status(200).json(disputes);

    } catch (error) {
        console.error("Erro em getDisputes:", error);
        return res.status(500).json({ error: "Erro ao buscar disputas." });
    }
};


// =========================================================
// BUSCAR DISPUTA POR ID
// GET /dispute/:id
// =========================================================
const getDisputeById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: "ID da disputa inválido." });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        const dispute = await disputeService.getDisputeById(
            uuid.toBin(id),
            req.userId,
            req.role
        );

        if (!dispute) {
            return res.status(404).json({ error: "Disputa não encontrada." });
        }

        return res.status(200).json(dispute);

    } catch (error) {
        console.error("Erro em getDisputeById:", error);

        if (error.code === "FORBIDDEN") {
            return res.status(403).json({ error: "Você não tem acesso a esta disputa." });
        }

        return res.status(500).json({ error: "Erro ao buscar disputa." });
    }
};


// =========================================================
// ATUALIZAR DISPUTA
// PUT /dispute/:id
// =========================================================
const updateDispute = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, description, status } = req.body;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: "ID da disputa inválido." });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        if (type === undefined && description === undefined && status === undefined) {
            return res.status(400).json({
                error: "Informe ao menos um campo para atualizar: type, description ou status."
            });
        }

        if (description !== undefined && (typeof description !== "string" || description.trim() === "")) {
            return res.status(400).json({
                error: "A descrição não pode ser vazia."
            });
        }

        const dispute = await disputeService.updateDispute(
            uuid.toBin(id),
            { type, description, status },
            req.userId,
            req.role
        );

        return res.status(200).json({
            message: "Disputa atualizada com sucesso.",
            dispute
        });

    } catch (error) {
        console.error("Erro em updateDispute:", error);

        if (error.code === "NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }
        if (error.code === "FORBIDDEN") {
            return res.status(403).json({ error: error.message });
        }
        if (error.code === "NO_FIELDS") {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === "DISPUTE_FINALIZED") {
            return res.status(409).json({ error: error.message });
        }
        if (error.code === "DISPUTE_STATUS_CONFLICT") {
            return res.status(409).json({ error: error.message });
        }
        if (error.code === "INVALID_TYPE") {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === "INVALID_STATUS") {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === "USE_SPECIFIC_ENDPOINT") {
            return res.status(400).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao atualizar disputa." });
    }
};


// =========================================================
// RESOLVER DISPUTA
// PATCH /dispute/:id/resolve
// Exclusivo para admins.
// =========================================================
const resolveDispute = async (req, res) => {
    try {
        const { id } = req.params;
        const { resolution } = req.body;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: "ID da disputa inválido." });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        if (!resolution || resolution.trim() === "") {
            return res.status(400).json({
                error: "O campo resolution é obrigatório para resolver uma disputa."
            });
        }

        const dispute = await disputeService.resolveDispute(
            uuid.toBin(id),
            resolution,
            req.userId
        );

        if (!dispute) {
            return res.status(404).json({ error: "Disputa não encontrada." });
        }

        return res.status(200).json({
            message: "Disputa resolvida com sucesso.",
            dispute
        });

    } catch (error) {
        console.error("Erro em resolveDispute:", error);

        if (error.code === "DISPUTE_ALREADY_FINAL") {
            return res.status(409).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao resolver disputa." });
    }
};


// =========================================================
// REJEITAR DISPUTA
// PATCH /dispute/:id/reject
// Exclusivo para admins.
// =========================================================
const rejectDispute = async (req, res) => {
    try {
        const { id } = req.params;
        const { resolution } = req.body;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: "ID da disputa inválido." });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        if (!resolution || resolution.trim() === "") {
            return res.status(400).json({
                error: "O campo resolution (justificativa) é obrigatório para rejeitar uma disputa."
            });
        }

        const dispute = await disputeService.rejectDispute(
            uuid.toBin(id),
            resolution,
            req.userId
        );

        if (!dispute) {
            return res.status(404).json({ error: "Disputa não encontrada." });
        }

        return res.status(200).json({
            message: "Disputa rejeitada com sucesso.",
            dispute
        });

    } catch (error) {
        console.error("Erro em rejectDispute:", error);

        if (error.code === "DISPUTE_ALREADY_FINAL") {
            return res.status(409).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao rejeitar disputa." });
    }
};


module.exports = {
    createDispute,
    getDisputes,
    getDisputeById,
    updateDispute,
    resolveDispute,
    rejectDispute
};
