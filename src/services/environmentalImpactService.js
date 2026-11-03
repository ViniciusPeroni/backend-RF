
const connect = require("../db/connect");
const uuid = require("../utils/uuid");

// =====================================================================
// FATORES AMBIENTAIS POR CATEGORIA DE MATERIAL
//
// Metodologia: "regra_fixa"
// Fontes e fundamentação teórica para o TCC Recicla Fácil / ReaproveitaFranca:
//   - CO2: emissões médias de CO2 equivalente evitadas pela não extração /
//     produção primária de matéria-prima virgem (kg CO2e por kg de material).
//     Referência: IPCC / Diretrizes de ACV (Avaliação do Ciclo de Vida)
//   - Água: volume médio de água poupado em processos de lavagem, beneficiamento
//     e produção primária (litros de água por kg de material reaproveitado).
//     Referência: CONAMA / MMA / Water Footprint Network
//   - Energia: energia elétrica e térmica economizada no processamento do resíduo
//     em relação à cadeia virgem primária (kWh por kg de material reaproveitado).
//     Referência: IEA (International Energy Agency) / CNI (Confederação Nacional da Indústria)
//
// Categorias suportadas no banco de dados (ENUM da tabela product):
//   'madeira', 'metal', 'plastico', 'papel/papelao', 'vidro',
//   'tecido', 'borracha', 'eletronicos'
//
// Categoria 'couro' mantida para compatibilidade e resíduos calçadistas específicos.
// Unidades: todos os coeficientes são por quilograma (kg) de resíduo reaproveitado.
// =====================================================================
const ENV_FACTORS = {
    //                 co2_kg (kg CO2e/kg) | water_l (L/kg) | energy_kwh (kWh/kg)
    couro:           { co2: 17.0,           water: 17000,     energy: 15.0 },
    borracha:        { co2:  2.9,           water:   200,     energy:  7.5 },
    plastico:        { co2:  2.0,           water:    60,     energy:  5.5 },
    "papel/papelao": { co2:  1.1,           water:   100,     energy:  4.0 },
    madeira:         { co2:  1.5,           water:    50,     energy:  2.5 },
    metal:           { co2:  9.0,           water:    40,     energy: 14.0 },
    vidro:           { co2:  0.6,           water:    30,     energy:  1.5 },
    tecido:          { co2:  5.5,           water: 10000,     energy:  8.0 },
    eletronicos:     { co2: 20.0,           water:   500,     energy: 20.0 }
};

// Status de compra considerados elegíveis para contabilização do impacto ambiental.
// Apenas compras concluídas consolidam o reaproveitamento efetivo dos materiais.
const ELIGIBLE_STATUS = ["completed"];

// Métodos de cálculo aceitos pelo banco de dados (ENUM da tabela environmental_impact)
const VALID_METHODS = ["regra_fixa", "ia"];

// =====================================================================
// Calcula os indicadores utilizando a regra fixa fundamentada
// Recebe array com itens agregados: [ { category, total_weight_kg }, ... ]
// Retorna objeto com valores arredondados para 2 casas decimais.
// =====================================================================
function calcularRegraFixa(itens) {
    let totalWeight = 0;
    let totalCo2    = 0;
    let totalWater  = 0;
    let totalEnergy = 0;

    for (const item of itens) {
        const factor = ENV_FACTORS[item.category] ?? null;
        if (!factor) continue;

        const w = Number(item.total_weight_kg);
        totalWeight += w;
        totalCo2    += w * factor.co2;
        totalWater  += w * factor.water;
        totalEnergy += w * factor.energy;
    }

    return {
        estimated_weight_kg: Math.round(totalWeight * 100) / 100,
        co2_saved_kg:        Math.round(totalCo2    * 100) / 100,
        water_saved_liters:  Math.round(totalWater  * 100) / 100,
        energy_saved_kwh:    Math.round(totalEnergy * 100) / 100
    };
}

// =====================================================================
// Validação de número decimal não negativo e finito
// =====================================================================
function isValidDecimal(v) {
    return typeof v === "number" && isFinite(v) && v >= 0;
}

const environmentalImpactService = {

    // ==================================================================
    // CRIAR IMPACTO AMBIENTAL
    // Fluxo:
    //   1. Valida existência da compra.
    //   2. Valida autorização: apenas comprador, vendedor de item da compra
    //      ou administrador podem registrar o impacto.
    //   3. Valida se o status da compra é elegível ('completed').
    //   4. Impede duplicidade (relação 1:1 entre compra e impacto).
    //   5. Trata método de cálculo:
    //      - 'regra_fixa': calcula automaticamente a partir dos pesos e
    //        categorias dos produtos associados na compra.
    //      - 'ia': método reservado para futura integração com modelo de ML/IA.
    //   6. Persiste no banco com UUID em formato BINARY(16).
    // ==================================================================
    async createImpact(data) {
        const conn = connect.promise();

        // 1. Verifica existência da compra
        const [shoppingRows] = await conn.query(
            `SELECT
                BIN_TO_UUID(s.id) AS id,
                s.status,
                BIN_TO_UUID(s.id_user) AS buyer_id
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

        // 2. Valida autorização do solicitante (Admin, Comprador ou Vendedor)
        if (data.role !== "admin") {
            const isBuyer = shopping.buyer_id === data.requestedBy;
            let isSeller = false;

            if (!isBuyer) {
                const [sellers] = await conn.query(
                    `SELECT p.id_user
                     FROM shopping_product sp
                     JOIN product p ON p.id = sp.id_product
                     WHERE sp.id_shopping = ?
                       AND p.id_user = ?
                     LIMIT 1`,
                    [uuid.toBin(data.id_shopping), uuid.toBin(data.requestedBy)]
                );
                isSeller = sellers.length > 0;
            }

            if (!isBuyer && !isSeller) {
                const err = new Error(
                    "Você não tem autorização para registrar o impacto ambiental desta compra."
                );
                err.code = "FORBIDDEN";
                throw err;
            }
        }

        // 3. Valida status elegível
        if (!ELIGIBLE_STATUS.includes(shopping.status)) {
            const err = new Error(
                `Somente compras com status '${ELIGIBLE_STATUS.join("' ou '")}' geram impacto ambiental.`
            );
            err.code = "SHOPPING_NOT_ELIGIBLE";
            throw err;
        }

        // 4. Impede duplicidade — relação de 1 impacto por compra
        const [existing] = await conn.query(
            `SELECT id FROM environmental_impact WHERE id_shopping = ? LIMIT 1`,
            [uuid.toBin(data.id_shopping)]
        );

        if (existing.length > 0) {
            const err = new Error("Esta compra já possui um registro de impacto ambiental.");
            err.code = "IMPACT_ALREADY_EXISTS";
            throw err;
        }

        // 5. Método IA: integração planejada, sem mock
        if (data.calculation_method === "ia") {
            const err = new Error(
                "O método 'ia' ainda não possui integração ativa com serviço externo. Utilize 'regra_fixa'."
            );
            err.code = "IA_NOT_IMPLEMENTED";
            throw err;
        }

        // 6. Método regra_fixa: agrega itens da compra a partir do banco de dados
        const [itens] = await conn.query(
            `SELECT
                p.category,
                SUM(p.weight * sp.quantity) AS total_weight_kg
             FROM shopping_product sp
             JOIN product p ON p.id = sp.id_product
             WHERE sp.id_shopping = ?
             GROUP BY p.category`,
            [uuid.toBin(data.id_shopping)]
        );

        if (itens.length === 0) {
            const err = new Error("A compra não possui itens com dados de peso suficientes para o cálculo.");
            err.code = "NO_ITEMS";
            throw err;
        }

        const indicadores = calcularRegraFixa(itens);

        if (indicadores.estimated_weight_kg <= 0) {
            const err = new Error("O peso total reaproveitado calculado foi zero ou inválido. Verifique os dados dos produtos.");
            err.code = "ZERO_WEIGHT";
            throw err;
        }

        const id = uuid.generateId();

        await conn.query(
            `INSERT INTO environmental_impact (
                id,
                estimated_weight_kg,
                co2_saved_kg,
                water_saved_liters,
                energy_saved_kwh,
                calculation_method,
                id_shopping
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                uuid.toBin(id),
                indicadores.estimated_weight_kg,
                indicadores.co2_saved_kg,
                indicadores.water_saved_liters,
                indicadores.energy_saved_kwh,
                data.calculation_method,
                uuid.toBin(data.id_shopping)
            ]
        );

        return {
            id,
            ...indicadores,
            calculation_method: data.calculation_method,
            id_shopping: data.id_shopping
        };
    },


    // ==================================================================
    // LISTAR IMPACTOS AMBIENTAIS
    // Administradores podem visualizar todos os registros.
    // Usuários comuns visualizam apenas impactos de compras nas quais
    // atuam como compradores ou vendedores dos produtos.
    // ==================================================================
    async getImpacts(userId, role) {
        const conn = connect.promise();

        if (role === "admin") {
            const [rows] = await conn.query(
                `SELECT
                    BIN_TO_UUID(ei.id)          AS id,
                    ei.estimated_weight_kg,
                    ei.co2_saved_kg,
                    ei.water_saved_liters,
                    ei.energy_saved_kwh,
                    ei.calculation_method,
                    ei.calculated_in,
                    BIN_TO_UUID(ei.id_shopping) AS id_shopping
                 FROM environmental_impact ei
                 ORDER BY ei.calculated_in DESC`
            );
            return rows;
        }

        // Usuário comum: apenas compras vinculadas
        const [rows] = await conn.query(
            `SELECT DISTINCT
                BIN_TO_UUID(ei.id)          AS id,
                ei.estimated_weight_kg,
                ei.co2_saved_kg,
                ei.water_saved_liters,
                ei.energy_saved_kwh,
                ei.calculation_method,
                ei.calculated_in,
                BIN_TO_UUID(ei.id_shopping) AS id_shopping
             FROM environmental_impact ei
             JOIN shopping s ON s.id = ei.id_shopping
             LEFT JOIN shopping_product sp ON sp.id_shopping = s.id
             LEFT JOIN product p ON p.id = sp.id_product
             WHERE s.id_user = ?
                OR p.id_user = ?
             ORDER BY ei.calculated_in DESC`,
            [uuid.toBin(userId), uuid.toBin(userId)]
        );

        return rows;
    },


    // ==================================================================
    // BUSCAR IMPACTO POR ID
    // Permite visualização por administradores ou compradores/vendedores
    // envolvidos na transação associada.
    // ==================================================================
    async getImpactById(id, userId, role) {
        const conn = connect.promise();

        const [rows] = await conn.query(
            `SELECT
                BIN_TO_UUID(ei.id)          AS id,
                ei.estimated_weight_kg,
                ei.co2_saved_kg,
                ei.water_saved_liters,
                ei.energy_saved_kwh,
                ei.calculation_method,
                ei.calculated_in,
                BIN_TO_UUID(ei.id_shopping) AS id_shopping
             FROM environmental_impact ei
             WHERE ei.id = ?
             LIMIT 1`,
            [id]
        );

        if (rows.length === 0) return null;

        const impact = rows[0];

        if (role === "admin") return impact;

        // Verifica se o solicitante faz parte da compra associada
        const [accessRows] = await conn.query(
            `SELECT 1
             FROM shopping s
             LEFT JOIN shopping_product sp ON sp.id_shopping = s.id
             LEFT JOIN product p ON p.id = sp.id_product
             WHERE s.id = ?
               AND (s.id_user = ? OR p.id_user = ?)
             LIMIT 1`,
            [
                uuid.toBin(impact.id_shopping),
                uuid.toBin(userId),
                uuid.toBin(userId)
            ]
        );

        if (accessRows.length === 0) {
            const err = new Error("Você não tem autorização para consultar este impacto ambiental.");
            err.code = "FORBIDDEN";
            throw err;
        }

        return impact;
    },


    // ==================================================================
    // BUSCAR IMPACTO POR COMPRA
    // Localiza o impacto ambiental associado a uma compra específica.
    // Respeita a cardinalidade 1:1 retornando o registro correspondente.
    // ==================================================================
    async getImpactByShopping(idShoppingBin, userId, role) {
        const conn = connect.promise();

        // 1. Verifica se a compra existe
        const [shoppingRows] = await conn.query(
            `SELECT BIN_TO_UUID(id_user) AS buyer_id FROM shopping WHERE id = ? LIMIT 1`,
            [idShoppingBin]
        );

        if (shoppingRows.length === 0) {
            const err = new Error("Compra não encontrada.");
            err.code = "SHOPPING_NOT_FOUND";
            throw err;
        }

        // 2. Valida autorização do usuário
        if (role !== "admin") {
            const isBuyer = shoppingRows[0].buyer_id === userId;
            let isSeller = false;

            if (!isBuyer) {
                const [sellers] = await conn.query(
                    `SELECT p.id_user
                     FROM shopping_product sp
                     JOIN product p ON p.id = sp.id_product
                     WHERE sp.id_shopping = ? AND p.id_user = ?
                     LIMIT 1`,
                    [idShoppingBin, uuid.toBin(userId)]
                );
                isSeller = sellers.length > 0;
            }

            if (!isBuyer && !isSeller) {
                const err = new Error("Você não tem autorização para consultar o impacto ambiental desta compra.");
                err.code = "FORBIDDEN";
                throw err;
            }
        }

        // 3. Consulta o registro associado
        const [rows] = await conn.query(
            `SELECT
                BIN_TO_UUID(ei.id)          AS id,
                ei.estimated_weight_kg,
                ei.co2_saved_kg,
                ei.water_saved_liters,
                ei.energy_saved_kwh,
                ei.calculation_method,
                ei.calculated_in,
                BIN_TO_UUID(ei.id_shopping) AS id_shopping
             FROM environmental_impact ei
             WHERE ei.id_shopping = ?
             LIMIT 1`,
            [idShoppingBin]
        );

        if (rows.length === 0) {
            const err = new Error("Nenhum impacto ambiental registrado para esta compra.");
            err.code = "IMPACT_NOT_FOUND";
            throw err;
        }

        return rows[0];
    },


    // ==================================================================
    // ATUALIZAR IMPACTO AMBIENTAL
    // Operação restrita a administradores.
    // Permite recalcular indicadores automaticamente a partir dos dados de
    // origem ou ajustar valores com validação estrita (não negativos).
    // O campo id_shopping é estritamente imutável para preservar a integridade.
    // ==================================================================
    async updateImpact(id, data) {
        const conn = connect.promise();

        // 1. Verifica existência
        const [rows] = await conn.query(
            `SELECT
                BIN_TO_UUID(id) AS id,
                BIN_TO_UUID(id_shopping) AS id_shopping
             FROM environmental_impact
             WHERE id = ?
             LIMIT 1`,
            [id]
        );

        if (rows.length === 0) {
            const err = new Error("Registro de impacto ambiental não encontrado.");
            err.code = "NOT_FOUND";
            throw err;
        }

        const existingRecord = rows[0];

        // 2. Se solicitada a recalculação automática a partir dos produtos da compra
        if (data.recalculate) {
            const [itens] = await conn.query(
                `SELECT
                    p.category,
                    SUM(p.weight * sp.quantity) AS total_weight_kg
                 FROM shopping_product sp
                 JOIN product p ON p.id = sp.id_product
                 WHERE sp.id_shopping = ?
                 GROUP BY p.category`,
                [uuid.toBin(existingRecord.id_shopping)]
            );

            if (itens.length === 0) {
                const err = new Error("A compra não possui itens com peso válido para recalcular.");
                err.code = "NO_ITEMS";
                throw err;
            }

            const indicadores = calcularRegraFixa(itens);

            await conn.query(
                `UPDATE environmental_impact
                 SET estimated_weight_kg = ?,
                     co2_saved_kg = ?,
                     water_saved_liters = ?,
                     energy_saved_kwh = ?,
                     calculation_method = 'regra_fixa'
                 WHERE id = ?`,
                [
                    indicadores.estimated_weight_kg,
                    indicadores.co2_saved_kg,
                    indicadores.water_saved_liters,
                    indicadores.energy_saved_kwh,
                    id
                ]
            );

            return environmentalImpactService.getImpactById(id, null, "admin");
        }

        // 3. Atualização direta controlada de campos
        const fields = [];
        const params = [];

        const numericFields = [
            "estimated_weight_kg",
            "co2_saved_kg",
            "water_saved_liters",
            "energy_saved_kwh"
        ];

        for (const field of numericFields) {
            if (data[field] !== undefined) {
                const num = Number(data[field]);
                if (!isValidDecimal(num)) {
                    const err = new Error(`Valor inválido para o campo '${field}'. Deve ser um número finito não negativo.`);
                    err.code = "INVALID_VALUE";
                    throw err;
                }
                fields.push(`${field} = ?`);
                params.push(Math.round(num * 100) / 100);
            }
        }

        if (data.calculation_method !== undefined) {
            if (!VALID_METHODS.includes(data.calculation_method)) {
                const err = new Error(`Método de cálculo inválido. Valores aceitos: ${VALID_METHODS.join(", ")}.`);
                err.code = "INVALID_METHOD";
                throw err;
            }
            fields.push("calculation_method = ?");
            params.push(data.calculation_method);
        }

        if (fields.length === 0) {
            const err = new Error("Nenhum campo válido informado para atualização.");
            err.code = "NO_FIELDS";
            throw err;
        }

        params.push(id);

        await conn.query(
            `UPDATE environmental_impact SET ${fields.join(", ")} WHERE id = ?`,
            params
        );

        return environmentalImpactService.getImpactById(id, null, "admin");
    }

};

module.exports = environmentalImpactService;
