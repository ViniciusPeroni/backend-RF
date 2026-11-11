-- Aditiva: executar após migration_notification_retry.sql, uma vez.
-- Falhas definitivas são preservadas para revisão, não excluídas.
ALTER TABLE notification_retry
    ADD COLUMN failed_in DATETIME NULL,
    ADD COLUMN lease_id BINARY(16) NULL;
