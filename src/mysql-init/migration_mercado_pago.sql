-- Migration aditiva: aplique uma vez em bancos existentes antes de habilitar o checkout.
ALTER TABLE payment
    MODIFY COLUMN method ENUM('pix','debit_card','credit_card','account_money') NOT NULL,
    ADD COLUMN mp_preference_id VARCHAR(100) NULL,
    ADD UNIQUE KEY `idx_payment_mp_preference` (`mp_preference_id`);
