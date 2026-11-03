const shoppingProductService = require("../services/shoppingProductService");
const uuid = require("../utils/uuid");

const getItems = async (req, res) => {
    try {
        const { shoppingId, productId } = req.query;

        const filters = {
            id_shopping: shoppingId,
            id_product: productId
        };

        const items = await shoppingProductService.getItems(filters, { id: req.userId, role: req.role });

        return res.status(200).json(items);

    } catch (error) {
        if ([400, 401].includes(error.status)) return res.status(error.status).json({ error: error.message });
        console.error("Erro em getItems de shoppingProduct:", error);

        return res.status(500).json({
            error: "Erro ao buscar itens de compra."
        });
    }
};


const getItemById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID do item inválido."
            });
        }

        const item = await shoppingProductService.getItemById(id, { id: req.userId, role: req.role });

        if (!item) {
            return res.status(404).json({
                error: "Item não encontrado."
            });
        }

        return res.status(200).json(item);

    } catch (error) {
        if ([400, 401].includes(error.status)) return res.status(error.status).json({ error: error.message });
        console.error("Erro em getItemById de shoppingProduct:", error);

        return res.status(500).json({
            error: "Erro ao buscar item de compra."
        });
    }
};


const getItemsByShoppingId = async (req, res) => {
    try {
        const { shoppingId } = req.params;

        if (!uuid.isValid(shoppingId)) {
            return res.status(400).json({
                error: "ID da compra inválido."
            });
        }

        const items = await shoppingProductService.getItemsByShoppingId(shoppingId, { id: req.userId, role: req.role });

        return res.status(200).json(items);

    } catch (error) {
        if ([400, 401].includes(error.status)) return res.status(error.status).json({ error: error.message });
        console.error("Erro em getItemsByShoppingId:", error);

        return res.status(500).json({
            error: "Erro ao buscar itens da compra."
        });
    }
};


module.exports = {
    getItems,
    getItemById,
    getItemsByShoppingId
};
