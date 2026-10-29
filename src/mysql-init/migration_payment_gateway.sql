-- Migração aditiva. Execute somente este arquivo, nunca RFScript.sql em banco existente.
CREATE TABLE IF NOT EXISTS payment_gateway (
    id_payment BINARY(16) PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,
    environment VARCHAR(16) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    order_id VARCHAR(64) NULL,
    transaction_id VARCHAR(64) NULL,
    provider_status VARCHAR(40) NULL,
    status_detail VARCHAR(80) NULL,
    checkout JSON NULL,
    updated_in DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_gateway_order (provider, environment, order_id),
    CONSTRAINT fk_gateway_payment FOREIGN KEY (id_payment) REFERENCES payment(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
