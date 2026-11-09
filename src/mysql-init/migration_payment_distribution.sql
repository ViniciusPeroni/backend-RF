-- Planejamento da comissão; não registra comissão recebida nem transfere dinheiro.
CREATE TABLE IF NOT EXISTS payment_distribution (
    id_payment BINARY(16) PRIMARY KEY,
    plan JSON NOT NULL,
    created_in DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_distribution_payment FOREIGN KEY (id_payment) REFERENCES payment(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
