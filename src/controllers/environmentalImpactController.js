
const environmentalImpactService = require("../services/environmentalImpactService");
const uuid = require("../utils/uuid");

const VALID_METHODS = ["regra_fixa", "ia"];

// =====================================================================
// CRIAR REGISTRO DE IMPACTO AMBIENTAL
// POST /environmental-impact  ou  POST /environmental-impact/create
// =====================================================================
const createImpact = async (req, res) => {
    try {
        // 1. Autenticação obrigatória
        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        const { id_shopping, calculation_method } = req.body;

        // 2. Validação de campos obrigatórios
        if (!id_shopping) {
            return res.status(400).json({ error: "O campo id_shopping é obrigatório." });
        }

        if (!calculation_method) {
            return res.status(400).json({
                error: `O campo calculation_method é obrigatório. Valores aceitos: ${VALID_METHODS.join(", ")}.`
            });
        }

        // 3. Validação do UUID da compra
        if (!uuid.isValid(id_shopping)) {
            return res.status(400).json({ error: "ID da compra inválido." });
        }

        // 4. Validação do método de cálculo
        if (!VALID_METHODS.includes(calculation_method)) {
            return res.status(400).json({
                error: `Método de cálculo inválido. Valores aceitos: ${VALID_METHODS.join(", ")}.`
            });
        }

        const result = await environmentalImpactService.createImpact({
            id_shopping,
            calculation_method,
            requestedBy: req.userId,
            role: req.role
        });

        return res.status(201).json({
            message: "Impacto ambiental registrado com sucesso.",
            impact: result
        });

    } catch (error) {
        console.error("Erro em createImpact:", error);

        if (error.code === "SHOPPING_NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }
        if (error.code === "FORBIDDEN") {
            return res.status(403).json({ error: error.message });
        }
        if (error.code === "SHOPPING_NOT_ELIGIBLE") {
            return res.status(409).json({ error: error.message });
        }
        if (error.code === "IMPACT_ALREADY_EXISTS") {
            return res.status(409).json({ error: error.message });
        }
        if (error.code === "IA_NOT_IMPLEMENTED") {
            return res.status(501).json({ error: error.message });
        }
        if (error.code === "NO_ITEMS") {
            return res.status(422).json({ error: error.message });
        }
        if (error.code === "ZERO_WEIGHT") {
            return res.status(422).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao registrar impacto ambiental." });
    }
};


// =====================================================================
// LISTAR IMPACTOS AMBIENTAIS
// GET /environmental-impact
// Protegido por JWT — filtragem por papel aplicada na camada de serviço.
// =====================================================================
const getImpacts = async (req, res) => {
    try {
        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        const impacts = await environmentalImpactService.getImpacts(req.userId, req.role);

        return res.status(200).json(impacts);

    } catch (error) {
        console.error("Erro em getImpacts:", error);
        return res.status(500).json({ error: "Erro ao listar impactos ambientais." });
    }
};


// =====================================================================
// BUSCAR IMPACTO POR ID
// GET /environmental-impact/:id
// =====================================================================
const getImpactById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: "ID do impacto inválido." });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        const impact = await environmentalImpactService.getImpactById(
            uuid.toBin(id),
            req.userId,
            req.role
        );

        if (!impact) {
            return res.status(404).json({ error: "Registro de impacto ambiental não encontrado." });
        }

        return res.status(200).json(impact);

    } catch (error) {
        console.error("Erro em getImpactById:", error);

        if (error.code === "FORBIDDEN") {
            return res.status(403).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao buscar impacto ambiental." });
    }
};


// =====================================================================
// BUSCAR IMPACTO POR COMPRA
// GET /environmental-impact/shopping/:idShopping
// =====================================================================
const getImpactByShopping = async (req, res) => {
    try {
        const { idShopping } = req.params;

        if (!uuid.isValid(idShopping)) {
            return res.status(400).json({ error: "ID da compra inválido." });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        const impact = await environmentalImpactService.getImpactByShopping(
            uuid.toBin(idShopping),
            req.userId,
            req.role
        );

        return res.status(200).json(impact);

    } catch (error) {
        console.error("Erro em getImpactByShopping:", error);

        if (error.code === "SHOPPING_NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }
        if (error.code === "IMPACT_NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }
        if (error.code === "FORBIDDEN") {
            return res.status(403).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao buscar impacto ambiental da compra." });
    }
};


// =====================================================================
// ATUALIZAR IMPACTO AMBIENTAL
// PUT /environmental-impact/:id
// Restrito a administradores (validado por middleware e na controller).
// =====================================================================
const updateImpact = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: "ID do impacto inválido." });
        }

        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({ error: "Usuário não autenticado." });
        }

        const {
            estimated_weight_kg,
            co2_saved_kg,
            water_saved_liters,
            energy_saved_kwh,
            calculation_method,
            recalculate
        } = req.body;

        // Ao menos um campo ou sinalizador de recálculo deve ser informado
        const hasAnyField = [
            estimated_weight_kg,
            co2_saved_kg,
            water_saved_liters,
            energy_saved_kwh,
            calculation_method,
            recalculate
        ].some(v => v !== undefined);

        if (!hasAnyField) {
            return res.status(400).json({
                error: "Informe ao menos um campo válido para atualizar ou 'recalculate: true'."
            });
        }

        const impact = await environmentalImpactService.updateImpact(
            uuid.toBin(id),
            {
                estimated_weight_kg,
                co2_saved_kg,
                water_saved_liters,
                energy_saved_kwh,
                calculation_method,
                recalculate
            }
        );

        return res.status(200).json({
            message: "Impacto ambiental atualizado com sucesso.",
            impact
        });

    } catch (error) {
        console.error("Erro em updateImpact:", error);

        if (error.code === "NOT_FOUND") {
            return res.status(404).json({ error: error.message });
        }
        if (error.code === "FORBIDDEN") {
            return res.status(403).json({ error: error.message });
        }
        if (error.code === "INVALID_VALUE") {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === "INVALID_METHOD") {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === "NO_FIELDS") {
            return res.status(400).json({ error: error.message });
        }
        if (error.code === "NO_ITEMS") {
            return res.status(422).json({ error: error.message });
        }

        return res.status(500).json({ error: "Erro ao atualizar impacto ambiental." });
    }
};


module.exports = {
    createImpact,
    getImpacts,
    getImpactById,
    getImpactByShopping,
    updateImpact
};
