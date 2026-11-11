const connect = require("../db/connect");
const uuid = require("../utils/uuid");
const notificationOutbox = require("./notificationOutboxService");

function buildReservationContent(buyerName, items) {
    let content;
    if (items.length === 1) {
        content = `${buyerName} solicitou ${items[0].quantity} unidade(s) de "${items[0].name}".`;
    } else {
        const details = items.map((item) => `"${item.name}" (${item.quantity})`).join(", ");
        content = `${buyerName} solicitou ${items.length} itens: ${details}.`;
    }
    if (Buffer.byteLength(content, 'utf8') <= 4096) return content;
    const suffix = '… Consulte os itens da reserva.';
    const budget = 4096 - Buffer.byteLength(suffix, 'utf8');
    let text = '', bytes = 0;
    for (const character of content) {
        const size = Buffer.byteLength(character, 'utf8');
        if (bytes + size > budget) break;
        text += character;
        bytes += size;
    }
    return text + suffix;
}

async function enqueueStatusNotifications(conn, shopping, status, actorName, reason) {
    const entries = [];
    // Prazo de pagamento vencido: avisa o comprador e a empresa.
    if (status === "cancelled" && reason === "expired") {
        const users = new Set([String(shopping.id_user).toLowerCase(), ...shopping.items.map((item) => String(item.seller_id).toLowerCase())]);
        for (const id_user of users) {
            entries.push(await notificationOutbox.enqueue(conn, {
                id_user,
                type: "sistema",
                title: "Reserva expirada",
                content: "O prazo para pagamento venceu e a reserva foi cancelada. O material voltou a ficar disponível.",
                reference_table: "shopping",
                reference_id: shopping.id
            }));
        }
        return entries;
    }
    if (["accepted", "refused"].includes(status)) {
        const accepted = status === "accepted";
        entries.push(await notificationOutbox.enqueue(conn, {
            id_user: shopping.id_user,
            type: accepted ? "reserva_aceita" : "reserva_recusada",
            title: accepted ? "Reserva aceita" : "Reserva recusada",
            content: accepted && Number(shopping.value) > 0
                ? `${actorName || "O vendedor"} aceitou a sua solicitação de reserva. Faça o pagamento para garantir o material.`
                : `${actorName || "O vendedor"} ${accepted ? "aceitou" : "recusou"} a sua solicitação de reserva.`,
            reference_table: "shopping",
            reference_id: shopping.id
        }));
    } else if (status === "cancelled") {
        const sellerIds = new Set(shopping.items.map((item) => String(item.seller_id).toLowerCase()));
        for (const id_user of sellerIds) {
            entries.push(await notificationOutbox.enqueue(conn, {
                id_user,
                type: "sistema",
                title: "Reserva cancelada",
                content: `${actorName || "O comprador"} cancelou a solicitação de reserva.`,
                reference_table: "shopping",
                reference_id: shopping.id
            }));
        }
    }
    return entries;
}

const shoppingService = {

    async createShopping(userId, items, buyerName = "Um usuário") {
        let conn;
        let result;
        const entries = [];
        try {
            conn = await connect.promise().getConnection();
            await conn.beginTransaction();

            let totalValue = 0;
            const processedItems = [];
            const sellers = new Map();

            for (const item of items) {
                const productBinId = uuid.toBin(item.id_product);

                const [products] = await conn.query(
                    `SELECT
                        BIN_TO_UUID(id) AS id,
                        name,
                        price,
                        quantity,
                        status,
                        type_negotiation,
                        BIN_TO_UUID(id_user) AS id_user
                     FROM product
                     WHERE id = ? FOR UPDATE`,
                    [productBinId]
                );

                if (products.length === 0) {
                    const err = new Error(`Produto não encontrado (ID: ${item.id_product}).`);
                    err.status = 404;
                    throw err;
                }

                const product = products[0];

                if (String(product.id_user).toLowerCase() === String(userId).toLowerCase()) {
                    const err = new Error(`Você não pode comprar seu próprio produto (${product.name}).`);
                    err.status = 400;
                    throw err;
                }

                if (product.status !== "available") {
                    const err = new Error(`O produto "${product.name}" não está disponível para compra.`);
                    err.status = 400;
                    throw err;
                }

                if (product.quantity < item.quantity) {
                    const err = new Error(
                        `Estoque insuficiente para "${product.name}". Solicitado: ${item.quantity}, disponível: ${product.quantity}.`
                    );
                    err.status = 400;
                    throw err;
                }

                const unitPrice = product.type_negotiation === "donation" ? 0 : Number(product.price || 0);
                const itemTotal = Number((unitPrice * item.quantity).toFixed(2));
                totalValue += itemTotal;

                processedItems.push({
                    id_product: item.id_product,
                    product_name: product.name,
                    quantity: item.quantity,
                    unit_price: unitPrice,
                    subtotal: itemTotal,
                    current_stock: product.quantity
                });

                const sellerId = String(product.id_user).toLowerCase();
                if (!sellers.has(sellerId)) {
                    sellers.set(sellerId, []);
                }
                sellers.get(sellerId).push({
                    name: product.name,
                    quantity: item.quantity
                });
            }

            totalValue = Number(totalValue.toFixed(2));
            const shoppingId = uuid.generateId();
            const shoppingBinId = uuid.toBin(shoppingId);
            const userBinId = uuid.toBin(userId);

            // 1) Insere a compra na tabela shopping com valor calculado automaticamente
            await conn.query(
                `INSERT INTO shopping (id, value, status, id_user)
                 VALUES (?, ?, 'pending', ?)`,
                [shoppingBinId, totalValue, userBinId]
            );

            // 2) Insere os itens em shopping_product e atualiza estoque de cada produto
            for (const item of processedItems) {
                const itemId = uuid.generateId();
                const itemBinId = uuid.toBin(itemId);
                const productBinId = uuid.toBin(item.id_product);

                await conn.query(
                    `INSERT INTO shopping_product (id, value, quantity, id_product, id_shopping)
                     VALUES (?, ?, ?, ?, ?)`,
                    [itemBinId, item.subtotal, item.quantity, productBinId, shoppingBinId]
                );

                const newQuantity = item.current_stock - item.quantity;
                const newStatus = newQuantity === 0 ? "reserved" : "available";

                await conn.query(
                    `UPDATE product
                     SET quantity = ?, status = ?
                     WHERE id = ?`,
                    [newQuantity, newStatus, productBinId]
                );

                item.id = itemId;
            }

            for (const [id_user, sellerItems] of sellers) {
                entries.push(await notificationOutbox.enqueue(conn, {
                    id_user,
                    type: "reserva_solicitada",
                    title: "Nova solicitação de reserva",
                    content: buildReservationContent(buyerName, sellerItems),
                    reference_table: "shopping",
                    reference_id: shoppingId
                }));
            }
            await conn.commit();

            result = {
                shopping: {
                    id: shoppingId,
                    value: totalValue,
                    status: "pending",
                    items: processedItems.map(({ current_stock, ...rest }) => rest)
                },
                sellers: [...sellers].map(([id, items]) => ({ id, items }))
            };

        } catch (error) {
            if (conn) {
                try {
                    await conn.rollback();
                } catch (rbError) {
                    console.error("Falha no rollback de createShopping:", rbError);
                }
            }
            throw error;
        } finally {
            if (conn) conn.release();
        }
        await notificationOutbox.flush(entries);
        return result;
    },


    async getShoppings(userId, role) {
        const isAdmin = role === "admin";
        const query = `
            SELECT
                BIN_TO_UUID(s.id) AS id,
                s.datetime,
                s.value,
                s.status,
                BIN_TO_UUID(s.id_user) AS id_user,
                u.name AS user_name,
                COUNT(sp.id) AS total_items
            FROM shopping s
            INNER JOIN \`user\` u ON s.id_user = u.id
            LEFT JOIN shopping_product sp ON s.id = sp.id_shopping
            ${isAdmin ? "" : "WHERE s.id_user = ?"}
            GROUP BY s.id, s.datetime, s.value, s.status, s.id_user, u.name
            ORDER BY s.datetime DESC
        `;

        const params = isAdmin ? [] : [uuid.toBin(userId)];
        const [rows] = await connect.promise().query(query, params);

        return rows;
    },


    async getShoppingById(id, connection = connect.promise()) {
        const [shoppingRows] = await connection.query(
            `SELECT
                BIN_TO_UUID(s.id) AS id,
                s.datetime,
                s.value,
                s.status,
                BIN_TO_UUID(s.id_user) AS id_user,
                u.name AS user_name,
                u.email AS user_email,
                u.cellphone AS user_cellphone
             FROM shopping s
             INNER JOIN \`user\` u ON s.id_user = u.id
             WHERE s.id = ?`,
            [uuid.toBin(id)]
        );

        if (shoppingRows.length === 0) {
            return null;
        }

        const shopping = shoppingRows[0];

        const [itemRows] = await connection.query(
            `SELECT
                BIN_TO_UUID(sp.id) AS id,
                sp.value AS subtotal,
                sp.quantity,
                BIN_TO_UUID(sp.id_product) AS id_product,
                p.name AS product_name,
                p.category AS product_category,
                p.type_negotiation,
                p.price AS unit_price,
                BIN_TO_UUID(p.id_user) AS seller_id
             FROM shopping_product sp
             INNER JOIN product p ON sp.id_product = p.id
             WHERE sp.id_shopping = ?`,
            [uuid.toBin(id)]
        );

        shopping.items = itemRows;
        return shopping;
    },


    async updateStatus(id, newStatus, { onlyPending = false, allowedFrom = null, reason = null, notificationActorName } = {}) {
        let conn;
        let result;
        let entries = [];
        try {
            conn = await connect.promise().getConnection();
            await conn.beginTransaction();

            const [shoppingRows] = await conn.query(
                `SELECT
                    BIN_TO_UUID(id) AS id,
                    status
                 FROM shopping
                 WHERE id = ? FOR UPDATE`,
                [uuid.toBin(id)]
            );

            if (shoppingRows.length === 0) {
                await conn.rollback();
                return null;
            }

            const currentStatus = shoppingRows[0].status;

            if (onlyPending && currentStatus !== "pending") {
                const err = new Error(`Apenas compras com status "pending" podem ser canceladas. Status atual: "${currentStatus}".`);
                err.status = 400;
                throw err;
            }

            if (allowedFrom && !allowedFrom.includes(currentStatus)) {
                const err = new Error(`Esta compra não pode mais ser cancelada. Status atual: "${currentStatus}".`);
                err.status = 400;
                throw err;
            }

            if (["cancelled", "refused", "completed"].includes(currentStatus)) {
                const err = new Error(`Esta compra já foi finalizada com status "${currentStatus}" e não pode ser alterada.`);
                err.status = 400;
                throw err;
            }

            // Aceite antes do pagamento: depois de pago (ou com Pix em andamento),
            // a reserva não é mais recusada ou cancelada por aqui — o caminho é a disputa.
            if (["cancelled", "refused"].includes(newStatus)) {
                const [payments] = await conn.query(
                    "SELECT status FROM payment WHERE id_shopping = ? AND status IN ('pending', 'approved') FOR UPDATE",
                    [uuid.toBin(id)]
                );

                if (payments.some((payment) => payment.status === "approved")) {
                    const err = new Error("Esta reserva já foi paga. Para desfazer a negociação, abra uma disputa.");
                    err.status = 409;
                    throw err;
                }

                if (payments.length > 0) {
                    const err = new Error("Há um pagamento em andamento para esta reserva. Aguarde a confirmação ou o vencimento do Pix.");
                    err.status = 409;
                    throw err;
                }
            }

            // Se a compra está sendo cancelada ou recusada, devolvemos o estoque dos produtos
            if (["cancelled", "refused"].includes(newStatus) && !["cancelled", "refused"].includes(currentStatus)) {
                const [items] = await conn.query(
                    `SELECT id_product, quantity
                     FROM shopping_product
                     WHERE id_shopping = ?`,
                    [uuid.toBin(id)]
                );

                for (const item of items) {
                    await conn.query(
                        `UPDATE product
                         SET quantity = quantity + ?,
                             status = 'available'
                         WHERE id = ?`,
                        [item.quantity, item.id_product]
                    );
                }
            }

            const changed = currentStatus !== newStatus;
            if (changed) {
                // accepted_in marca o início do prazo para pagamento.
                await conn.query(
                    `UPDATE shopping
                     SET status = ?,
                         accepted_in = IF(? = 'accepted', NOW(), accepted_in)
                     WHERE id = ?`,
                    [newStatus, newStatus, uuid.toBin(id)]
                );
            }

            // A resposta pertence a esta transição, não a uma alteração posterior.
            const shopping = await shoppingService.getShoppingById(id, conn);
            if (changed) {
                entries = await enqueueStatusNotifications(conn, shopping, newStatus, notificationActorName, reason);
            }
            await conn.commit();

            result = { shopping, previousStatus: currentStatus, changed };

        } catch (error) {
            if (conn) {
                try {
                    await conn.rollback();
                } catch (rbError) {
                    console.error("Falha no rollback de updateStatus:", rbError);
                }
            }
            throw error;
        } finally {
            if (conn) conn.release();
        }
        await notificationOutbox.flush(entries);
        return result;
    },

    // Reservas aceitas e não pagas dentro do prazo voltam o material para o estoque.
    // Doações (valor zero) não têm pagamento e não expiram.
    async expireUnpaidReservations(hours = paymentDeadlineHours()) {
        const [rows] = await connect.promise().query(
            `SELECT BIN_TO_UUID(s.id) AS id
             FROM shopping s
             WHERE s.status = 'accepted'
               AND s.value > 0
               AND s.accepted_in IS NOT NULL
               AND s.accepted_in < NOW() - INTERVAL ? HOUR
               AND NOT EXISTS (
                   SELECT 1 FROM payment p
                   WHERE p.id_shopping = s.id AND p.status IN ('pending', 'approved')
               )
             LIMIT 100`,
            [hours]
        );

        let expired = 0;
        for (const row of rows) {
            try {
                const transition = await shoppingService.updateStatus(row.id, "cancelled", {
                    allowedFrom: ["accepted"],
                    reason: "expired"
                });
                if (transition && transition.changed) expired++;
            } catch (error) {
                // Pagamento iniciado no meio do caminho: a reserva continua.
                if (error.status !== 409 && error.status !== 400) throw error;
            }
        }
        return { checked: rows.length, expired };
    }

};

function paymentDeadlineHours() {
    const hours = Number(process.env.RESERVATION_PAYMENT_HOURS || 48);
    return Number.isFinite(hours) && hours > 0 ? hours : 48;
}

let expiryTimer = null;

// Confere as reservas vencidas a cada 10 minutos (mesmo padrão do worker de notificações).
function startReservationExpiryWorker(intervalMs = 10 * 60 * 1000) {
    if (expiryTimer) return expiryTimer;
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const result = await shoppingService.expireUnpaidReservations();
            if (result.expired > 0) console.log("Reservas expiradas por falta de pagamento:", result);
        } catch (error) {
            // Banco indisponível não pode derrubar o processo.
            console.error("Falha no worker de reservas:", error.code || error.message);
        } finally {
            running = false;
        }
    };
    expiryTimer = setInterval(tick, intervalMs);
    if (typeof expiryTimer.unref === "function") expiryTimer.unref();
    tick();
    return expiryTimer;
}

function stopReservationExpiryWorker() {
    if (!expiryTimer) return;
    clearInterval(expiryTimer);
    expiryTimer = null;
}

module.exports = shoppingService;
module.exports.startReservationExpiryWorker = startReservationExpiryWorker;
module.exports.stopReservationExpiryWorker = stopReservationExpiryWorker;
