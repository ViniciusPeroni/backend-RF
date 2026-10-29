
const productService = require("../services/productService");
const uuid = require("../utils/uuid");

// CADASTRAR PRODUTO
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

        if (!name || !category || !type_negotiation ||
            !weight || !conservation_state || !id_localization) {
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

// LISTAR PRODUTOS
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

// BUSCAR PRODUTO POR ID
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

// ATUALIZAR PRODUTO
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

        // Verifica se o usuário está autenticado
        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Usuário não autenticado."
            });
        }

        // Passa o ID do usuário autenticado para o service
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
            },
            req.userId
        );

        if (!product) {
            return res.status(404).json({
                error: "Produto não encontrado ou não pertence a você."
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

// EXCLUIR PRODUTO
const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID do produto inválido."
            });
        }

        // Verifica se o usuário está autenticado
        if (!uuid.isValid(req.userId)) {
            return res.status(401).json({
                error: "Usuário não autenticado."
            });
        }

        // Passa o ID do proprietário para a exclusão
        const deleted = await productService.deleteProduct(
            uuid.toBin(id),
            req.userId
        );

        if (!deleted) {
            return res.status(404).json({
                error: "Produto não encontrado ou não pertence a você."
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
