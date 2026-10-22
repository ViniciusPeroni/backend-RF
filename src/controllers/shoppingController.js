const shoppingService = require("../services/shoppingService");
const uuid = require("../utils/uuid");

const VALID_STATUSES = ["pending", "accepted", "refused", "cancelled", "completed"];

const createShopping = async (req, res) => {
    try {
        const { items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                error: "A compra deve conter ao menos um item no array 'items'."
            });
        }

        for (const item of items) {
            if (!item.id_product || !uuid.isValid(item.id_product)) {
                return res.status(400).json({
                    error: `ID de produto inválido: ${item.id_product}`
                });
            }

            const qty = Number(item.quantity);
            if (!Number.isInteger(qty) || qty <= 0) {
                return res.status(400).json({
                    error: `A quantidade do produto deve ser um número inteiro maior que zero.`
                });
            }
            item.quantity = qty;
        }

        const shopping = await shoppingService.createShopping(req.userId, items);

        return res.status(201).json({
            message: "Compra registrada com sucesso.",
            shopping
        });

    } catch (error) {
        console.error("Erro em createShopping:", error);

        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }

        return res.status(500).json({
            error: "Erro ao registrar compra."
        });
    }
};


const getShoppings = async (req, res) => {
    try {
        const shoppings = await shoppingService.getShoppings(req.userId, req.role);

        return res.status(200).json(shoppings);

    } catch (error) {
        console.error("Erro em getShoppings:", error);

        return res.status(500).json({
            error: "Erro ao buscar compras."
        });
    }
};


const getShoppingById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID da compra inválido."
            });
        }

        const shopping = await shoppingService.getShoppingById(id);

        if (!shopping) {
            return res.status(404).json({
                error: "Compra não encontrada."
            });
        }

        // Apenas o comprador ou um administrador podem ver os detalhes da compra
        if (req.role !== "admin" && String(shopping.id_user).toLowerCase() !== String(req.userId).toLowerCase()) {
            return res.status(403).json({
                error: "Acesso negado a esta compra."
            });
        }

        return res.status(200).json(shopping);

    } catch (error) {
        console.error("Erro em getShoppingById:", error);

        return res.status(500).json({
            error: "Erro ao buscar compra."
        });
    }
};


const cancelShopping = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID da compra inválido."
            });
        }

        const shopping = await shoppingService.getShoppingById(id);

        if (!shopping) {
            return res.status(404).json({
                error: "Compra não encontrada."
            });
        }

        if (req.role !== "admin" && String(shopping.id_user).toLowerCase() !== String(req.userId).toLowerCase()) {
            return res.status(403).json({
                error: "Acesso negado para cancelar esta compra."
            });
        }

        if (shopping.status !== "pending") {
            return res.status(400).json({
                error: `Apenas compras com status "pending" podem ser canceladas. Status atual: "${shopping.status}".`
            });
        }

        const updated = await shoppingService.updateStatus(id, "cancelled");

        return res.status(200).json({
            message: "Compra cancelada com sucesso. O estoque dos produtos foi restaurado.",
            shopping: updated
        });

    } catch (error) {
        console.error("Erro em cancelShopping:", error);

        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }

        return res.status(500).json({
            error: "Erro ao cancelar compra."
        });
    }
};


const updateStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID da compra inválido."
            });
        }

        if (!status || !VALID_STATUSES.includes(status)) {
            return res.status(400).json({
                error: `Status inválido. Use um dos seguintes: ${VALID_STATUSES.join(", ")}.`
            });
        }

        const updated = await shoppingService.updateStatus(id, status);

        if (!updated) {
            return res.status(404).json({
                error: "Compra não encontrada."
            });
        }

        return res.status(200).json({
            message: `Status da compra atualizado para "${status}".`,
            shopping: updated
        });

    } catch (error) {
        console.error("Erro em updateStatus:", error);

        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }

        return res.status(500).json({
            error: "Erro ao atualizar status da compra."
        });
    }
};


module.exports = {
    createShopping,
    getShoppings,
    getShoppingById,
    cancelShopping,
    updateStatus
};
