-- Aceite antes do pagamento: o comprador só paga depois que a empresa aceita.
-- accepted_in guarda quando a reserva foi aceita; reservas aceitas e não pagas
-- dentro do prazo (RESERVATION_PAYMENT_HOURS, padrão 48h) são canceladas.
ALTER TABLE shopping
    ADD COLUMN accepted_in DATETIME NULL AFTER status,
    ADD KEY `idx_shopping_status_accepted` (`status`, `accepted_in`);
