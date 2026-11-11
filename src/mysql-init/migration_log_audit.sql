-- Migração aditiva da tabela `log` para auditoria completa.
--
-- Aplique UMA VEZ em banco existente. O script não remove nem recria dados.
-- Não execute `RFScript.sql` em banco com dados importantes.
--
-- Mudanças:
--   * `reference_id` passa a aceitar NULL (operações sem registro único,
--     como login ou exclusões já concluídas);
--   * `id_user` identifica o autor autenticado (NULL quando anônimo);
--   * `description`, `ip` e `user_agent` completam o rastro da operação;
--   * índices para filtro por usuário/data.

ALTER TABLE log
    MODIFY COLUMN reference_id BINARY(16) NULL,
    ADD COLUMN id_user BINARY(16) NULL AFTER reference_id,
    ADD COLUMN description VARCHAR(255) NULL AFTER `table`,
    ADD COLUMN ip VARCHAR(45) NULL AFTER description,
    ADD COLUMN user_agent VARCHAR(255) NULL AFTER ip,
    ADD KEY `idx_log_user` (`id_user`),
    ADD KEY `idx_log_datetime` (`datetime`),
    ADD CONSTRAINT `fk_log_user`
        FOREIGN KEY (`id_user`)
        REFERENCES `user` (`id`)
        ON DELETE SET NULL;
