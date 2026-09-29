-- =====================================================================
-- DER LÓGICO - TCC
-- Script de criação do banco de dados (MySQL 8+)
-- Gerado a partir do diagrama enviado
-- =====================================================================
-- Observações:
-- 1) Todas as PKs são BINARY(16) (padrão para armazenar UUID).
--    Para inserir, use: UUID_TO_BIN(UUID())
--    Para ler de forma legível, use: BIN_TO_UUID(coluna)
-- 2) Há dependência circular entre `conversation` e `message`
--    (conversation.id_last_message -> message.id e
--     message.id_conversation -> conversation.id).
--    Por isso `conversation` é criada primeiro sem essas FKs, que são
--    adicionadas via ALTER TABLE ao final do script.
-- 3) Nomes que são palavras reservadas (user, table, read, etc.)
--    estão sempre entre crases.
-- =====================================================================

DROP DATABASE IF EXISTS Reaproveita_Franca;
CREATE DATABASE IF NOT EXISTS Reaproveita_Franca
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE Reaproveita_Franca;

SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- Tabela: user
-- =====================================================================
DROP TABLE IF EXISTS user;
CREATE TABLE user (
    id            BINARY(16) primary key,
    role          ENUM('user','company', 'admin') NOT NULL,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) unique NOT NULL,
    password      VARCHAR(255) NOT NULL,
    cellphone     CHAR(11) NOT NULL,
    status        ENUM('inactive','firstLogin','awaitingForEmail','active') NOT NULL DEFAULT 'awaitingForEmail',
    created_in    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    photo         LONGBLOB NULL,
    birthday      DATE NULL
);

-- =====================================================================
-- Tabela: localization
-- =====================================================================
DROP TABLE IF EXISTS localization;
CREATE TABLE localization (
    id             BINARY(16) primary key,
    zip_code       CHAR(8) NOT NULL,
    street         VARCHAR(150) NOT NULL,
    neighborhood   VARCHAR(80) NOT NULL,
    number         VARCHAR(6) NOT NULL,
    city           VARCHAR(100) NOT NULL,
    state        CHAR(2) NOT NULL, -- sigla do estado (ex: SP)
    id_user        BINARY(16) NOT NULL,
    KEY `idx_localization_user` (`id_user`),
    CONSTRAINT `fk_localization_user`   
        FOREIGN KEY (id_user) REFERENCES user(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: document
-- =====================================================================
DROP TABLE IF EXISTS document;
CREATE TABLE document (
    id         BINARY(16) primary key NOT NULL,
    id_user    BINARY(16) NOT NULL,
    doc_type   ENUM('CPF','CNPJ') NOT NULL,
    doc_hmac   CHAR(64) unique NOT NULL,
    doc_enc    TEXT NOT NULL,
    doc_iv     CHAR(24) NOT NULL,
    doc_tag    CHAR(32) NOT NULL,
    KEY `idx_document_user` (`id_user`),
    CONSTRAINT `fk_document_user`
        FOREIGN KEY (id_user) REFERENCES user(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: card
-- =====================================================================
DROP TABLE IF EXISTS card;
CREATE TABLE card(
    id                BINARY(16) primary key,
    holder_name       VARCHAR(100) NOT NULL,
    brand             VARCHAR(50) NOT NULL,
    last_digits       CHAR(4) NOT NULL,
    type              ENUM('credit','debit') NOT NULL,
    expiration_month  TINYINT UNSIGNED NOT NULL,
    expiration_year   SMALLINT UNSIGNED NOT NULL,
    payment_token     VARCHAR(255) NOT NULL,
    id_user           BINARY(16) NOT NULL,
    KEY `idx_card_user` (`id_user`),
    CONSTRAINT `chk_card_month` CHECK (`expiration_month` BETWEEN 1 AND 12),
    CONSTRAINT `fk_card_user`
        FOREIGN KEY (id_user) REFERENCES user(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: shopping
-- =====================================================================
DROP TABLE IF EXISTS shopping;
CREATE TABLE shopping(
    id           BINARY(16) primary key NOT NULL,
    datetime     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    value        DECIMAL(9,2) NOT NULL,
    status       ENUM('pending','accepted','refused','cancelled','completed') NOT NULL DEFAULT 'pending',
    id_user      BINARY(16) NOT NULL,
    KEY `idx_shopping_user` (`id_user`),
    CONSTRAINT `fk_shopping_user`
        FOREIGN KEY (id_user) REFERENCES user(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: conversation
-- (id_last_message / read_by_a_until / read_by_b_until adicionados
--  depois, via ALTER TABLE, pois dependem de `message`)
-- =====================================================================
DROP TABLE IF EXISTS conversation;
CREATE TABLE conversation(
    id                  BINARY(16) primary key,
    created_in          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_in          DATETIME NULL,
    read_by_a_until     BINARY(16) NULL,
    read_by_b_until     BINARY(16) NULL,
    id_user_a           BINARY(16) NOT NULL,
    id_user_b           BINARY(16) NOT NULL,
    id_last_message     BINARY(16) NULL,
    UNIQUE KEY `uq_conversation_user_pair` (`id_user_a`, `id_user_b`),
    KEY `idx_conversation_user_a` (`id_user_a`),
    KEY `idx_conversation_user_b` (`id_user_b`),
    CONSTRAINT `fk_conversation_user_a`
        FOREIGN KEY (id_user_a) REFERENCES user(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_conversation_user_b`
        FOREIGN KEY (id_user_b) REFERENCES user(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: message
-- (id_answer referencia a própria tabela - auto-relacionamento)
-- =====================================================================
DROP TABLE IF EXISTS message;
CREATE TABLE message(
    id                  BINARY(16) primary key,
    type                ENUM('texto','imagem','audio','arquivo') NOT NULL,
    content             TEXT NULL,
    media               LONGBLOB NULL,
    created_in          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    edited_in           DATETIME NULL,
    deleted_in          DATETIME NULL,
    id_user             BINARY(16) NOT NULL,
    id_conversation     BINARY(16) NOT NULL,
    id_answer           BINARY(16) NULL,
    KEY `idx_message_user` (`id_user`),
    KEY `idx_message_conversation` (`id_conversation`),
    KEY `idx_message_answer` (`id_answer`),
    CONSTRAINT `fk_message_user`
        FOREIGN KEY (id_user) REFERENCES user(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_message_conversation`
        FOREIGN KEY (id_conversation) REFERENCES conversation(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_message_answer`
        FOREIGN KEY (id_answer) REFERENCES message(id)
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: product
-- =====================================================================
DROP TABLE IF EXISTS product;
CREATE TABLE product (
    id                   BINARY(16) primary key,
    name                 VARCHAR(100) NOT NULL,
    description          TEXT NULL,
    price                DECIMAL(8,2) NULL,
    priority             TINYINT NOT NULL DEFAULT 0,
    quantity             INT NOT NULL DEFAULT 1,
    status               ENUM('available','reserved','unavailable') NOT NULL DEFAULT 'available',
    category             ENUM('madeira','metal','plastico','papel/papelao','vidro','tecido','borracha','eletronicos') NOT NULL,
    type_negotiation     ENUM('sale','donation') NOT NULL,
    weight               DECIMAL(10,2) NOT NULL,
    conservation_state   ENUM('new','good','regular','poor') NOT NULL,
    id_user              BINARY(16) NOT NULL,
    id_localization      BINARY(16) NOT NULL,
    KEY `idx_product_user` (`id_user`),
    KEY `idx_product_localization` (`id_localization`),
    CONSTRAINT `fk_product_user`
        FOREIGN KEY (id_user) REFERENCES user(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_product_localization`
        FOREIGN KEY (id_localization) REFERENCES localization (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `chk_product_price_negotiation` CHECK (
    (type_negotiation = 'sale' AND price IS NOT NULL) OR
    (type_negotiation = 'donation' AND price IS NULL)
    )
);

-- =====================================================================
-- Tabela: shopping_product
-- =====================================================================
DROP TABLE IF EXISTS shopping_product;
CREATE TABLE shopping_product(
    id            BINARY(16) primary key,
    value         DECIMAL(9,2) NOT NULL,
    quantity      INT NOT NULL,
    id_product    BINARY(16) NOT NULL,
    id_shopping   BINARY(16) NOT NULL,
    KEY `idx_shopping_product_product` (`id_product`),
    KEY `idx_shopping_product_shopping` (`id_shopping`),
    CONSTRAINT `fk_shopping_product_product`
        FOREIGN KEY (id_product) REFERENCES product(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_shopping_product_shopping`
        FOREIGN KEY (id_shopping) REFERENCES shopping(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: payment
-- =====================================================================
DROP TABLE IF EXISTS payment;
CREATE TABLE payment (
    id          BINARY(16) primary key,
    value       DECIMAL(9,2) NOT NULL,
    method      ENUM('pix','debit_card','credit_card') NOT NULL,
    status      ENUM('pending','approved','refused','refunded')
                  NOT NULL DEFAULT 'pending',
    datetime    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_shopping BINARY(16) NOT NULL,
    id_card     BINARY(16) NULL,
    KEY `idx_payment_shopping` (`id_shopping`),
    KEY `idx_payment_card` (`id_card`),
    CONSTRAINT `fk_payment_shopping`
        FOREIGN KEY (id_shopping) REFERENCES shopping(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_payment_card`
        FOREIGN KEY (id_card) REFERENCES card(id)
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: commission
-- =====================================================================
DROP TABLE IF EXISTS commission;
CREATE TABLE commission(
    id              BINARY(16) primary key,
    percentage      DECIMAL(5,2) NOT NULL,
    value           DECIMAL(10,2) NOT NULL,
    id_payment      BINARY(16) NOT NULL,
    UNIQUE KEY `idx_commission_payment` (`id_payment`),
    CONSTRAINT `fk_commission_payment`
        FOREIGN KEY (id_payment) REFERENCES payment(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: dispute
-- =====================================================================
DROP TABLE IF EXISTS dispute;
CREATE TABLE dispute(
    id                BINARY(16) primary key,
    type              ENUM('material_incompativel','nao_retirado','nao_comparecimento','comportamento_inadequado',
                           'item_danificado','outro') NOT NULL,
    description       TEXT NOT NULL,
    status            ENUM('aberta','em_analise','resolvida','rejeitada') NOT NULL DEFAULT 'aberta',
    resolution        TEXT NULL,
    created_in        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_in        DATETIME NULL,
    resolved_in       DATETIME NULL,
    id_shopping       BINARY(16) NOT NULL,
    id_resolved_by    BINARY(16) NULL,
    id_opened_by      BINARY(16) NOT NULL,
    KEY `idx_dispute_shopping` (`id_shopping`),
    KEY `idx_dispute_resolved_by` (`id_resolved_by`),
    KEY `idx_dispute_opened_by` (`id_opened_by`),
    CONSTRAINT `fk_dispute_shopping`
        FOREIGN KEY (id_shopping) REFERENCES shopping(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_dispute_resolved_by`
        FOREIGN KEY (id_resolved_by) REFERENCES user(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_dispute_opened_by`
        FOREIGN KEY (id_opened_by) REFERENCES user(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: review
-- =====================================================================
DROP TABLE IF EXISTS review;
CREATE TABLE review(
    id             BINARY(16) primary key,
    rating         TINYINT NOT NULL,
    comment        TEXT NULL,
    created_in     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_shopping    BINARY(16) NOT NULL,
    id_reviewer    BINARY(16) NOT NULL,
    id_reviewed    BINARY(16) NOT NULL,
    UNIQUE KEY `uq_review_shopping_reviewer` (`id_shopping`, `id_reviewer`),
    KEY `idx_review_reviewer` (`id_reviewer`),
    KEY `idx_review_reviewed` (`id_reviewed`),
    CONSTRAINT `chk_review_rating` CHECK (`rating` BETWEEN 1 AND 5),
    CONSTRAINT `fk_review_shopping`
        FOREIGN KEY (id_shopping) REFERENCES shopping(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_review_reviewer`
        FOREIGN KEY (id_reviewer) REFERENCES user(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_review_reviewed`
        FOREIGN KEY (id_reviewed) REFERENCES user(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: product_photo
-- =====================================================================
DROP TABLE IF EXISTS product_photo;
CREATE TABLE product_photo(
    id            BINARY(16) primary key,
    photo         LONGBLOB NOT NULL,
    id_product    BINARY(16) NOT NULL,
    KEY `idx_product_photo_product` (`id_product`),
    CONSTRAINT `fk_product_photo_product`
        FOREIGN KEY (id_product) REFERENCES product(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: environmental_impact
-- =====================================================================
DROP TABLE IF EXISTS environmental_impact;
CREATE TABLE environmental_impact(
    id                      BINARY(16) primary key,
    estimated_weight_kg     DECIMAL(10,2) NOT NULL,
    co2_saved_kg            DECIMAL(10,2) NOT NULL,
    water_saved_liters      DECIMAL(10,2) NOT NULL,
    energy_saved_kwh        DECIMAL(10,2) NOT NULL,
    calculation_method      ENUM('regra_fixa','ia') NOT NULL,
    calculated_in           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_shopping             BINARY(16) NOT NULL,
    KEY `idx_environmental_impact_shopping` (`id_shopping`),
    CONSTRAINT `fk_environmental_impact_shopping`
        FOREIGN KEY (id_shopping) REFERENCES shopping(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- =====================================================================
-- Tabela: notification
-- =====================================================================
DROP TABLE IF EXISTS notification;
CREATE TABLE notification(
    id                 BINARY(16) primary key,
    type               ENUM('reserva_solicitada','reserva_aceita',
                            'reserva_recusada','pagamento_confirmado',
                            'nova_mensagem','nova_review','disputa_aberta',
                            'disputa_resolvida','sistema') NOT NULL,
    title              VARCHAR(100) NOT NULL,
    content            TEXT NULL,
    reference_table    VARCHAR(30) NULL,
    reference_id       BINARY(16) NULL,
    `read`             ENUM('sim','nao') NOT NULL DEFAULT 'nao',
    created_in         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_in            DATETIME NULL,
    id_user            BINARY(16) NOT NULL,
    KEY `idx_notification_user` (`id_user`),
    CONSTRAINT `fk_notification_user`
        FOREIGN KEY (id_user) REFERENCES user(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);


-- =====================================================================
-- Tabela: otp
-- =====================================================================
DROP TABLE IF EXISTS otp;
CREATE TABLE otp (
    id          BINARY(16) PRIMARY KEY,
    user_id     BINARY(16) NOT NULL,
    code        CHAR(6) NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    used        TINYINT(1) NOT NULL DEFAULT 0,

    KEY idx_otp_user (user_id),

    CONSTRAINT fk_otp_user
        FOREIGN KEY (user_id)
        REFERENCES user(id)
        ON DELETE CASCADE
);


-- =====================================================================
-- Tabela: log
-- (tabela genérica de auditoria; `reference_id`/`table` apontam para
--  registros de outras tabelas de forma polimórfica, por isso não
--  possui chave estrangeira)
-- =====================================================================
DROP TABLE IF EXISTS log;
CREATE TABLE log(
    id            BINARY(16) primary key,
    reference_id  BINARY(16) NOT NULL,
    status        VARCHAR(50) NOT NULL,
    operation     VARCHAR(20) NOT NULL,
    `table`       VARCHAR(20) NOT NULL,
    datetime      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY `idx_log_reference` (`reference_id`),
    KEY `idx_log_table` (`table`)
);

-- =====================================================================
-- Ajustes finais em `conversation` (FKs que dependem de `message`)
-- =====================================================================
ALTER TABLE conversation
    ADD CONSTRAINT `fk_conversation_read_by_a_until`
        FOREIGN KEY (read_by_a_until) REFERENCES message(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_conversation_read_by_b_until`
        FOREIGN KEY (read_by_b_until) REFERENCES message(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_conversation_last_message`
        FOREIGN KEY (id_last_message) REFERENCES message(id)
        ON DELETE SET NULL ON UPDATE CASCADE;




SET FOREIGN_KEY_CHECKS = 1;

-- ==========================   ===========================================
-- Fim do script
-- =====================================================================