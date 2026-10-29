const shoppingService = require("../services/shoppingService");
const notificationService = require("../services/notificationService");
const uuid = require("../utils/uuid");

const VALID_STATUSES = ["pending", "accepted", "refused", "cancelled", "completed"];

function buildReservationContent(buyerName, items) {
    if (items.length === 1) {
        return `${buyerName} solicitou ${items[0].quantity} unidade(s) de "${items[0].name}".`;
    }

    const details = items
        .map((item) => `"${item.name}" (${item.quantity})`)
        .join(", ");

    return `${buyerName} solicitou ${items.length} itens: ${details}.`;
}

function getSellerIds(shopping) {
    return [...new Set(shopping.items.map((item) => String(item.seller_id).toLowerCase()))];
}

function getActorName(req, fallback) {
    return req.role === "admin" ? "O administrador" : (req.userName || fallback);
}

async function notifyBuyerAboutStatus(shopping, status, actorName) {
    const config = {
        accepted: {
            type: "reserva_aceita",
            title: "Reserva aceita",
            content: `${actorName} aceitou a sua solicitação de reserva.`
        },
        refused: {
            type: "reserva_recusada",
            title: "Reserva recusada",
            content: `${actorName} recusou a sua solicitação de reserva.`
        }
    }[status];

    if (!config) return;

    try {
        await notificationService.notifyUser({
            id_user: shopping.id_user,
            type: config.type,
            title: config.title,
            content: config.content,
            reference_table: "shopping",
            reference_id: shopping.id
        });
    } catch (notificationError) {
        console.error("Erro ao notificar comprador sobre status da reserva:", notificationError);
    }
}

async function notifySellersAboutCancellation(shopping, actorName) {
    for (const sellerId of getSellerIds(shopping)) {
        try {
            await notificationService.notifyUser({
                id_user: sellerId,
                type: "sistema",
                title: "Reserva cancelada",
                content: `${actorName} cancelou a solicitação de reserva.`,
                reference_table: "shopping",
                reference_id: shopping.id
            });
        } catch (notificationError) {
            console.error("Erro ao notificar vendedor sobre cancelamento:", notificationError);
        }
    }
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

        const { shopping, sellers } = await shoppingService.createShopping(req.userId, items);

        const buyerName = req.userName || "Um usuário";

        // A compra já foi confirmada no banco. Falha ao notificar não deve
        // desfazer a reserva nem impedir a resposta de sucesso.
        for (const seller of sellers) {
            try {
                await notificationService.notifyUser({
                    id_user: seller.id,
                    type: "reserva_solicitada",
                    title: "Nova solicitação de reserva",
                    content: buildReservationContent(buyerName, seller.items),
                    reference_table: "shopping",
                    reference_id: shopping.id
                });
            } catch (notificationError) {
                console.error("Erro ao notificar vendedor sobre reserva:", notificationError);
            }
        }

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

        const transition = await shoppingService.updateStatus(id, "cancelled", { onlyPending: true });

        if (!transition) {
            return res.status(404).json({ error: "Compra não encontrada." });
        }

        const { shopping: updated, changed } = transition;
        if (changed) {
            await notifySellersAboutCancellation(updated, getActorName(req, "O comprador"));
        }

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

        const transition = await shoppingService.updateStatus(id, status);

        if (!transition) {
            return res.status(404).json({
                error: "Compra não encontrada."
            });
        }

        const { shopping: updated, changed } = transition;

        if (["accepted", "refused"].includes(status) && changed) {
            await notifyBuyerAboutStatus(updated, status, getActorName(req, "O vendedor"));
        }

        if (status === "cancelled" && changed) {
            await notifySellersAboutCancellation(updated, getActorName(req, "O comprador"));
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
