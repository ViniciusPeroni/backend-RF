-- Executar uma vez em bancos criados antes da fila de retry de notificações.
-- Aditiva: não altera a tabela notification nem remove notificações existentes.
CREATE TABLE IF NOT EXISTS notification_retry(
    id                 BINARY(16) primary key,
    id_user            BINARY(16) NOT NULL,
    type               ENUM('reserva_solicitada','reserva_aceita',
                            'reserva_recusada','pagamento_confirmado',
                            'nova_mensagem','nova_review','disputa_aberta',
                            'disputa_resolvida','sistema') NOT NULL,
    title              VARCHAR(100) NOT NULL,
    content            TEXT NULL,
    reference_table    VARCHAR(30) NULL,
    reference_id       BINARY(16) NULL,
    persisted          BOOLEAN NOT NULL DEFAULT FALSE,
    attempts           INT NOT NULL DEFAULT 0,
    next_attempt_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error         VARCHAR(255) NULL,
    created_in         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_in         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY `idx_notification_retry_due` (`next_attempt_at`),
    CONSTRAINT `fk_notification_retry_user`
        FOREIGN KEY (id_user) REFERENCES user(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);
