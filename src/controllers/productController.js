const productService = require("../services/productService");
const uuid = require("../utils/uuid");

const createProduct = async (req, res) => {
    try {
        const {
            name,
            description,
            price,
            priority,
            quantity,
            status,
            category,
            type_negotiation,
            weight,
            conservation_state,
            id_localization
        } = req.body;

        if (!name || !category || !type_negotiation || !weight || !conservation_state || !id_localization) {
            return res.status(400).json({
                error: "Todos os campos obrigatórios devem ser preenchidos."
            });
        }

        if (type_negotiation === "sale" && price == null) {
            return res.status(400).json({
                error: "Produtos para venda devem possuir preço."
            });
        }

        if (type_negotiation === "donation" && price != null) {
            return res.status(400).json({
                error: "Produtos para doação não podem possuir preço."
            });
        }

        const id = uuid.generateId();

        await productService.createProduct({
            id,
            name,
            description,
            price,
            priority,
            quantity,
            status,
            category,
            type_negotiation,
            weight,
            conservation_state,
            id_user: req.userId,
            id_localization
        });

        return res.status(201).json({
            message: "Produto cadastrado com sucesso.",
            id
        });

    } catch (error) {
        console.error("Erro em createProduct:", error);

        return res.status(500).json({
            error: "Erro ao cadastrar produto."
        });
    }
};


const getProducts = async (req, res) => {
    try {
        const products = await productService.getProducts();

        return res.status(200).json(products);

    } catch (error) {
        console.error("Erro em getProducts:", error);

        return res.status(500).json({
            error: "Erro ao buscar produtos."
        });
    }
};


const getProductById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID do produto inválido."
            });
        }

        const product = await productService.getProductById(
            uuid.toBin(id)
        );

        if (!product) {
            return res.status(404).json({
                error: "Produto não encontrado."
            });
        }

        return res.status(200).json(product);

    } catch (error) {
        console.error("Erro em getProductById:", error);

        return res.status(500).json({
            error: "Erro ao buscar produto."
        });
    }
};


const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID do produto inválido."
            });
        }

        const {
            name,
            description,
            price,
            priority,
            quantity,
            status,
            category,
            type_negotiation,
            weight,
            conservation_state,
            id_localization
        } = req.body;

        const product = await productService.updateProduct(
            uuid.toBin(id),
            {
                name,
                description,
                price,
                priority,
                quantity,
                status,
                category,
                type_negotiation,
                weight,
                conservation_state,
                id_localization
            }
        );

        if (!product) {
            return res.status(404).json({
                error: "Produto não encontrado."
            });
        }

        return res.status(200).json({
            message: "Produto atualizado com sucesso.",
            product
        });

    } catch (error) {
        console.error("Erro em updateProduct:", error);

        return res.status(500).json({
            error: "Erro ao atualizar produto."
        });
    }
};


const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID do produto inválido."
            });
        }

        const deleted = await productService.deleteProduct(
            uuid.toBin(id)
        );

        if (!deleted) {
            return res.status(404).json({
                error: "Produto não encontrado."
            });
        }

        return res.status(200).json({
            message: "Produto excluído com sucesso."
        });

    } catch (error) {
        console.error("Erro em deleteProduct:", error);

        return res.status(500).json({
            error: "Erro ao excluir produto."
        });
    }
};


module.exports = {
    createProduct,
    getProducts,
    getProductById,
    updateProduct,
    deleteProduct
};