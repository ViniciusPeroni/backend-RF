-- Executar uma vez após migration_payment_split.sql. Preserva vínculos históricos.
ALTER TABLE payment_seller_account
    ADD COLUMN disconnected_at DATETIME NULL,
    ADD COLUMN active_slot TINYINT
        GENERATED ALWAYS AS (CASE WHEN disconnected_at IS NULL THEN 1 ELSE NULL END) STORED,
    DROP INDEX idx_payment_seller_user,
    ADD INDEX idx_payment_seller_user (id_user, environment),
    ADD UNIQUE KEY idx_payment_seller_active (id_user, environment, active_slot);
