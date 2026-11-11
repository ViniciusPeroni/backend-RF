
const productService = require("../services/productService");
const uuid = require("../utils/uuid");

const extractPhotos = (req) => {
    const photos = [];

    // Fotos enviadas via multipart/form-data (upload.array)
    if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
            if (file.buffer) {
                photos.push(file.buffer);
            }
        }
    } else if (req.file && req.file.buffer) {
        photos.push(req.file.buffer);
    }

    // Fotos enviadas via JSON / body (strings base64 ou buffers)
    if (req.body && req.body.photos) {
        const rawPhotos = Array.isArray(req.body.photos) ? req.body.photos : [req.body.photos];
        for (const p of rawPhotos) {
            if (Buffer.isBuffer(p)) {
                photos.push(p);
            } else if (typeof p === "string" && p.trim()) {
                const base64Data = p.replace(/^data:image\/\w+;base64,/, "");
                photos.push(Buffer.from(base64Data, "base64"));
            }
        }
    }

    return photos;
};

const getPhotosForUpdate = (req) => {
    const hasFiles = Boolean((req.files && req.files.length > 0) || req.file);
    const hasBodyPhotos = Boolean(req.body && req.body.photos !== undefined);

    if (!hasFiles && !hasBodyPhotos) {
        return null;
    }

    return extractPhotos(req);
};

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

        if (type_negotiation === "sale" && (price == null || price === "")) {
            return res.status(400).json({
                error: "Produtos para venda devem possuir preço."
            });
        }

        if (type_negotiation === "donation" && price != null && price !== "") {
            return res.status(400).json({
                error: "Produtos para doação não podem possuir preço."
            });
        }

        const id = uuid.generateId();
        const photos = extractPhotos(req);

        await productService.createProduct(
            {
                id,
                name,
                description,
                price: (price === "" || price == null) ? null : price,
                priority,
                quantity,
                status,
                category,
                type_negotiation,
                weight,
                conservation_state,
                id_user: req.userId,
                id_localization
            },
            photos
        );

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
        // ?photos=none lista sem as fotos (bem mais leve), ex.: mapa de materiais.
        const products = await productService.getProducts({ withPhotos: req.query.photos !== "none" });

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

        const photos = getPhotosForUpdate(req);

        const product = await productService.updateProduct(
            uuid.toBin(id),
            {
                name,
                description,
                price: (price === "" || price == null) ? null : price,
                priority,
                quantity,
                status,
                category,
                type_negotiation,
                weight,
                conservation_state,
                id_localization
            },
            req.userId,
            photos
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

        // Se for admin, pode excluir qualquer produto; senão apenas o proprietário
        const isAdmin = req.role === 'admin';
        const deleted = await productService.deleteProduct(
            uuid.toBin(id),
            req.userId,
            isAdmin
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


const addPhotos = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({
                error: "ID do produto inválido."
            });
        }

        const photos = extractPhotos(req);

        if (!photos || photos.length === 0) {
            return res.status(400).json({
                error: "Nenhuma foto foi enviada."
            });
        }

        const added = await productService.addPhotos(
            uuid.toBin(id),
            photos
        );

        if (!added) {
            return res.status(404).json({
                error: "Produto não encontrado."
            });
        }

        return res.status(201).json({
            message: "Foto(s) adicionada(s) com sucesso.",
            photos: added
        });

    } catch (error) {
        console.error("Erro em addPhotos:", error);

        return res.status(500).json({
            error: "Erro ao adicionar foto(s)."
        });
    }
};


const updatePhoto = async (req, res) => {
    try {
        const { photoId } = req.params;

        if (!uuid.isValid(photoId)) {
            return res.status(400).json({
                error: "ID da foto inválido."
            });
        }

        let photoBuffer = req.file ? req.file.buffer : null;
        if (!photoBuffer && req.body && req.body.photo) {
            if (Buffer.isBuffer(req.body.photo)) {
                photoBuffer = req.body.photo;
            } else if (typeof req.body.photo === "string" && req.body.photo.trim()) {
                const base64Data = req.body.photo.replace(/^data:image\/\w+;base64,/, "");
                photoBuffer = Buffer.from(base64Data, "base64");
            }
        }

        if (!photoBuffer) {
            return res.status(400).json({
                error: "Nenhuma foto foi enviada para atualização."
            });
        }

        const updated = await productService.updatePhoto(
            uuid.toBin(photoId),
            photoBuffer
        );

        if (!updated) {
            return res.status(404).json({
                error: "Foto não encontrada."
            });
        }

        return res.status(200).json({
            message: "Foto atualizada com sucesso.",
            photo: updated
        });

    } catch (error) {
        console.error("Erro em updatePhoto:", error);

        return res.status(500).json({
            error: "Erro ao atualizar foto."
        });
    }
};


const deletePhoto = async (req, res) => {
    try {
        const { photoId } = req.params;

        if (!uuid.isValid(photoId)) {
            return res.status(400).json({
                error: "ID da foto inválido."
            });
        }

        const deleted = await productService.deletePhoto(
            uuid.toBin(photoId)
        );

        if (!deleted) {
            return res.status(404).json({
                error: "Foto não encontrada."
            });
        }

        return res.status(200).json({
            message: "Foto excluída com sucesso."
        });

    } catch (error) {
        console.error("Erro em deletePhoto:", error);

        return res.status(500).json({
            error: "Erro ao excluir foto."
        });
    }
};


module.exports = {
    createProduct,
    getProducts,
    getProductById,
    updateProduct,
    deleteProduct,
    addPhotos,
    updatePhoto,
    deletePhoto
};
