const shoppingService = require("../services/shoppingService");
const uuid = require("../utils/uuid");

const VALID_STATUSES = ["pending", "accepted", "refused", "cancelled", "completed"];

function getSellerIds(shopping) {
    return [...new Set(shopping.items.map((item) => String(item.seller_id).toLowerCase()))];
}

function getActorName(req, fallback) {
    return req.role === "admin" ? "O administrador" : (req.userName || fallback);
}

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

        const { shopping } = await shoppingService.createShopping(req.userId, items, req.userName || "Um usuário");

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

        // Aceite antes do pagamento: o comprador cancela enquanto a reserva
        // estiver aguardando aceite ou aceita e ainda não paga.
        if (!["pending", "accepted"].includes(shopping.status)) {
            return res.status(400).json({
                error: `Apenas compras aguardando aceite ou aceitas e não pagas podem ser canceladas. Status atual: "${shopping.status}".`
            });
        }

        const transition = await shoppingService.updateStatus(id, "cancelled", {
            allowedFrom: ["pending", "accepted"],
            notificationActorName: getActorName(req, "O comprador")
        });

        if (!transition) {
            return res.status(404).json({ error: "Compra não encontrada." });
        }

        const { shopping: updated } = transition;

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

        const shopping = await shoppingService.getShoppingById(id);

        if (!shopping) {
            return res.status(404).json({
                error: "Compra não encontrada."
            });
        }

        const isAdmin = req.role === "admin";
        const sellerIds = getSellerIds(shopping);

        // Sem admin, somente o vendedor de todos os itens pode aceitar ou
        // recusar. Compras com itens de vários vendedores ficam restritas
        // ao administrador.
        if (!isAdmin) {
            const isSingleSellerOwner =
                sellerIds.length === 1 &&
                sellerIds[0] === String(req.userId).toLowerCase();

            if (!isSingleSellerOwner) {
                return res.status(403).json({
                    error: "Apenas o vendedor responsável por todos os itens ou um administrador podem alterar o status desta compra."
                });
            }

            if (!["accepted", "refused"].includes(status)) {
                return res.status(403).json({
                    error: "O vendedor só pode aceitar ou recusar a reserva."
                });
            }
        }

        const transition = await shoppingService.updateStatus(id, status, {
            notificationActorName: getActorName(req, status === "cancelled" ? "O comprador" : "O vendedor")
        });

        if (!transition) {
            return res.status(404).json({
                error: "Compra não encontrada."
            });
        }

        const { shopping: updated } = transition;

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
