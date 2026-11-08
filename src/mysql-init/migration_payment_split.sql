-- Migração aditiva de pagamentos. Não executa RFScript.sql nem altera dados existentes.
CREATE TABLE IF NOT EXISTS payment_seller_account (
    id BINARY(16) PRIMARY KEY,
    id_user BINARY(16) NOT NULL,
    environment VARCHAR(16) NOT NULL,
    application_id VARCHAR(40) NOT NULL,
    marketplace_id VARCHAR(40) NOT NULL,
    collector_id VARCHAR(40) NOT NULL,
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_in DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_in DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_payment_seller_user (id_user, environment),
    UNIQUE KEY idx_payment_seller_collector (collector_id, environment),
    CONSTRAINT fk_payment_seller_user FOREIGN KEY (id_user) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_oauth_state (
    state_hash CHAR(64) PRIMARY KEY,
    id_user BINARY(16) NOT NULL,
    environment VARCHAR(16) NOT NULL,
    application_id VARCHAR(40) NOT NULL,
    marketplace_id VARCHAR(40) NOT NULL,
    redirect_uri VARCHAR(512) NOT NULL,
    verifier_enc TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    CONSTRAINT fk_payment_oauth_user FOREIGN KEY (id_user) REFERENCES `user`(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_split (
    id_payment BINARY(16) PRIMARY KEY,
    id_seller BINARY(16) NOT NULL,
    id_account BINARY(16) NOT NULL,
    environment VARCHAR(16) NOT NULL,
    marketplace_id VARCHAR(40) NOT NULL,
    collector_id VARCHAR(40) NOT NULL,
    application_fee DECIMAL(9,2) NOT NULL,
    gross_amount DECIMAL(9,2) NOT NULL,
    CONSTRAINT fk_payment_split_payment FOREIGN KEY (id_payment) REFERENCES payment(id) ON DELETE CASCADE,
    CONSTRAINT fk_payment_split_seller FOREIGN KEY (id_seller) REFERENCES `user`(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payment_split_account FOREIGN KEY (id_account) REFERENCES payment_seller_account(id) ON DELETE RESTRICT
);
