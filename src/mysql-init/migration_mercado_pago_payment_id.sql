-- Migration aditiva: aplique uma vez depois de migration_mercado_pago.sql.
ALTER TABLE payment
    ADD COLUMN mp_payment_id VARCHAR(100) NULL,
    ADD UNIQUE KEY `idx_payment_mp_payment` (`mp_payment_id`);
