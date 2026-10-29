
const connect = require("../db/connect");
const uuid = require("../utils/uuid");

// Tipos válidos conforme ENUM do banco
const VALID_TYPES = [
    "material_incompativel",
    "nao_retirado",
    "nao_comparecimento",
    "comportamento_inadequado",
    "item_danificado",
    "outro"
];

// Status válidos conforme ENUM do banco
const VALID_STATUS = ["aberta", "em_analise", "resolvida", "rejeitada"];

// Status considerados finalizados — impedem novas operações
const FINAL_STATUS = ["resolvida", "rejeitada"];

const disputeService = {

    // =========================================================
    // CRIAR DISPUTA
    // Verifica se a compra existe e se o usuário autenticado
    // é comprador (id_user de shopping) ou vendedor de algum
    // produto da compra (id_user de product via shopping_product).
    // =========================================================
    async createDispute(data) {
        const conn = connect.promise();

        // Verifica se a compra existe e se o usuário está vinculado a ela
        const [shoppingRows] = await conn.query(
            `SELECT
                BIN_TO_UUID(s.id_user) AS buyer_id,
                s.status AS shopping_status
             FROM shopping s
             WHERE s.id = ?
             LIMIT 1`,
            [uuid.toBin(data.id_shopping)]
        );

        if (shoppingRows.length === 0) {
            const err = new Error("Compra não encontrada.");
            err.code = "SHOPPING_NOT_FOUND";
            throw err;
        }

        const shopping = shoppingRows[0];

        // Verifica se o usuário é comprador
        const isBuyer = shopping.buyer_id === data.id_opened_by;

        // Verifica se o usuário é vendedor de algum produto desta compra
        let isSeller = false;
        if (!isBuyer) {
            const [sellerRows] = await conn.query(
                `SELECT p.id
                 FROM shopping_product sp
                 JOIN product p ON p.id = sp.id_product
                 WHERE sp.id_shopping = ?
                   AND p.id_user = ?
                 LIMIT 1`,
                [uuid.toBin(data.id_shopping), uuid.toBin(data.id_opened_by)]
            );
            isSeller = sellerRows.length > 0;
        }

        if (!isBuyer && !isSeller) {
            const err = new Error(
                "Você não possui vínculo com esta compra e não pode abrir uma disputa."
            );
            err.code = "DISPUTE_NOT_ALLOWED";
            throw err;
        }

        // Verifica se já existe uma disputa ativa para esta compra aberta pelo mesmo usuário
        const [existingRows] = await conn.query(
            `SELECT id
             FROM dispute
             WHERE id_shopping = ?
               AND id_opened_by = ?
               AND status NOT IN ('resolvida', 'rejeitada')
             LIMIT 1`,
            [uuid.toBin(data.id_shopping), uuid.toBin(data.id_opened_by)]
        );

        if (existingRows.length > 0) {
            const err = new Error(
                "Você já possui uma disputa ativa para esta compra."
            );
            err.code = "DISPUTE_ALREADY_EXISTS";
            throw err;
        }

        const id = uuid.generateId();

        await conn.query(
            `INSERT INTO dispute (
                id,
                type,
                description,
                status,
                id_shopping,
                id_opened_by
            ) VALUES (?, ?, ?, 'aberta', ?, ?)`,
            [
                uuid.toBin(id),
                data.type,
                data.description,
                uuid.toBin(data.id_shopping),
                uuid.toBin(data.id_opened_by)
            ]
        );

        return id;
    },


    // =========================================================
    // LISTAR DISPUTAS
    // Administradores veem todas.
    // Usuários comuns veem apenas disputas de compras em que são
    // compradores ou vendedores.
    // =========================================================
    async getDisputes(userId, role) {
        const conn = connect.promise();

        if (role === "admin") {
            const [rows] = await conn.query(
                `SELECT
                    BIN_TO_UUID(d.id)             AS id,
                    d.type,
                    d.description,
                    d.status,
                    d.resolution,
                    d.created_in,
                    d.updated_in,
                    d.resolved_in,
                    BIN_TO_UUID(d.id_shopping)    AS id_shopping,
                    BIN_TO_UUID(d.id_opened_by)   AS id_opened_by,
                    BIN_TO_UUID(d.id_resolved_by) AS id_resolved_by
                 FROM dispute d
                 ORDER BY d.created_in DESC`
            );
            return rows;
        }

        // Usuário comum: compras em que é comprador OU vendedor
        const [rows] = await conn.query(
            `SELECT DISTINCT
                BIN_TO_UUID(d.id)             AS id,
                d.type,
                d.description,
                d.status,
                d.resolution,
                d.created_in,
                d.updated_in,
                d.resolved_in,
                BIN_TO_UUID(d.id_shopping)    AS id_shopping,
                BIN_TO_UUID(d.id_opened_by)   AS id_opened_by,
                BIN_TO_UUID(d.id_resolved_by) AS id_resolved_by
             FROM dispute d
             JOIN shopping s ON s.id = d.id_shopping
             LEFT JOIN shopping_product sp ON sp.id_shopping = s.id
             LEFT JOIN product p ON p.id = sp.id_product
             WHERE s.id_user = ?
                OR p.id_user = ?
             ORDER BY d.created_in DESC`,
            [uuid.toBin(userId), uuid.toBin(userId)]
        );

        return rows;
    },


    // =========================================================
    // BUSCAR DISPUTA POR ID
    // Retorna null se não existir.
    // Lança erro FORBIDDEN se o usuário não tiver permissão.
    // =========================================================
    async getDisputeById(id, userId, role) {
        const conn = connect.promise();

        const [rows] = await conn.query(
            `SELECT
                BIN_TO_UUID(d.id)             AS id,
                d.type,
                d.description,
                d.status,
                d.resolution,
                d.created_in,
                d.updated_in,
                d.resolved_in,
                BIN_TO_UUID(d.id_shopping)    AS id_shopping,
                BIN_TO_UUID(d.id_opened_by)   AS id_opened_by,
                BIN_TO_UUID(d.id_resolved_by) AS id_resolved_by
             FROM dispute d
             WHERE d.id = ?
             LIMIT 1`,
            [id]
        );

        if (rows.length === 0) return null;

        const dispute = rows[0];

        if (role === "admin") return dispute;

        // Verifica se o usuário é comprador ou vendedor da compra
        const [accessRows] = await conn.query(
            `SELECT 1
             FROM shopping s
             LEFT JOIN shopping_product sp ON sp.id_shopping = s.id
             LEFT JOIN product p ON p.id = sp.id_product
             WHERE s.id = ?
               AND (s.id_user = ? OR p.id_user = ?)
             LIMIT 1`,
            [
                uuid.toBin(dispute.id_shopping),
                uuid.toBin(userId),
                uuid.toBin(userId)
            ]
        );

        if (accessRows.length === 0) {
            const err = new Error("Acesso negado.");
            err.code = "FORBIDDEN";
            throw err;
        }

        return dispute;
    },


    // =========================================================
    // ATUALIZAR DISPUTA
    // Usuário comum: pode alterar type e description se a disputa
    //   for dele e estiver 'aberta'.
    // Admin: pode alterar type, description e status
    //   (exceto finalizar — use resolve/reject).
    // =========================================================
    async updateDispute(id, data, userId, role) {
        const conn = connect.promise();

        // Busca a disputa para checar estado e permissão
        const [rows] = await conn.query(
            `SELECT
                BIN_TO_UUID(id)           AS id,
                status,
                BIN_TO_UUID(id_opened_by) AS id_opened_by
             FROM dispute
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        if (rows.length === 0) {
            const err = new Error("Disputa não encontrada.");
            err.code = "NOT_FOUND";
            throw err;
        }

        const dispute = rows[0];

        // Impede alterações em disputas finalizadas
        if (FINAL_STATUS.includes(dispute.status)) {
            const err = new Error(
                "Não é possível alterar uma disputa já finalizada."
            );
            err.code = "DISPUTE_FINALIZED";
            throw err;
        }

        if (role !== "admin") {
            // Usuário comum não pode alterar status
            if (data.status !== undefined) {
                const err = new Error("Usuários comuns não têm permissão para alterar o status da disputa.");
                err.code = "FORBIDDEN";
                throw err;
            }

            // Usuário comum só pode editar a própria disputa
            if (dispute.id_opened_by !== userId) {
                const err = new Error("Você não tem permissão para alterar esta disputa.");
                err.code = "FORBIDDEN";
                throw err;
            }

            // Usuário comum só pode editar enquanto 'aberta'
            if (dispute.status !== "aberta") {
                const err = new Error(
                    "Somente disputas com status 'aberta' podem ser alteradas pelo solicitante."
                );
                err.code = "DISPUTE_STATUS_CONFLICT";
                throw err;
            }
        }

        const fields = [];
        const params = [];

        if (data.type !== undefined) {
            if (!VALID_TYPES.includes(data.type)) {
                const err = new Error("Tipo de disputa inválido.");
                err.code = "INVALID_TYPE";
                throw err;
            }
            fields.push("type = ?");
            params.push(data.type);
        }

        if (data.description !== undefined) {
            fields.push("description = ?");
            params.push(data.description);
        }

        // Admin pode alterar status (exceto finalizar — use resolve/reject)
        if (role === "admin" && data.status !== undefined) {
            if (!VALID_STATUS.includes(data.status)) {
                const err = new Error("Status inválido.");
                err.code = "INVALID_STATUS";
                throw err;
            }
            if (FINAL_STATUS.includes(data.status)) {
                const err = new Error(
                    "Use as operações específicas de resolução ou rejeição para finalizar uma disputa."
                );
                err.code = "USE_SPECIFIC_ENDPOINT";
                throw err;
            }
            fields.push("status = ?");
            params.push(data.status);
        }

        if (fields.length === 0) {
            const err = new Error("Nenhum campo válido para atualizar.");
            err.code = "NO_FIELDS";
            throw err;
        }

        fields.push("updated_in = NOW()");
        params.push(id);

        const [result] = await conn.query(
            `UPDATE dispute SET ${fields.join(", ")} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) return null;

        return disputeService.getDisputeById(id, userId, role);
    },


    // =========================================================
    // RESOLVER DISPUTA
    // Exclusivo para admins. Registra a resolução, o responsável
    // e a data. Muda status para 'resolvida'.
    // =========================================================
    async resolveDispute(id, resolution, resolvedById) {
        const conn = connect.promise();

        const [rows] = await conn.query(
            `SELECT status
             FROM dispute
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        if (rows.length === 0) return null;

        const { status } = rows[0];

        if (FINAL_STATUS.includes(status)) {
            const err = new Error(
                "Esta disputa já foi finalizada e não pode ser resolvida novamente."
            );
            err.code = "DISPUTE_ALREADY_FINAL";
            throw err;
        }

        const [result] = await conn.query(
            `UPDATE dispute
             SET
                status         = 'resolvida',
                resolution     = ?,
                id_resolved_by = ?,
                resolved_in    = NOW(),
                updated_in     = NOW()
             WHERE id = ?`,
            [resolution, uuid.toBin(resolvedById), id]
        );

        if (result.affectedRows === 0) return null;

        return disputeService.getDisputeById(id, resolvedById, "admin");
    },


    // =========================================================
    // REJEITAR DISPUTA
    // Exclusivo para admins. Registra a justificativa no campo
    // resolution, o responsável e a data. Muda status para
    // 'rejeitada'.
    // =========================================================
    async rejectDispute(id, resolution, resolvedById) {
        const conn = connect.promise();

        const [rows] = await conn.query(
            `SELECT status
             FROM dispute
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        if (rows.length === 0) return null;

        const { status } = rows[0];

        if (FINAL_STATUS.includes(status)) {
            const err = new Error(
                "Esta disputa já foi finalizada e não pode ser rejeitada novamente."
            );
            err.code = "DISPUTE_ALREADY_FINAL";
            throw err;
        }

        const [result] = await conn.query(
            `UPDATE dispute
             SET
                status         = 'rejeitada',
                resolution     = ?,
                id_resolved_by = ?,
                resolved_in    = NOW(),
                updated_in     = NOW()
             WHERE id = ?`,
            [resolution, uuid.toBin(resolvedById), id]
        );

        if (result.affectedRows === 0) return null;

        return disputeService.getDisputeById(id, resolvedById, "admin");
    }

};

module.exports = disputeService;
