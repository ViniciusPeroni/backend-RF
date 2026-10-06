-- =====================================================================
-- Migration: login social (Google + LinkedIn)
-- Aplica em bancos já criados pelo RFScript.sql anterior.
-- Sem photo_url (decisão do projeto: ignora foto do provedor).
-- =====================================================================

ALTER TABLE `user`
    MODIFY COLUMN password VARCHAR(255) NULL,
    MODIFY COLUMN cellphone CHAR(11) NULL;

ALTER TABLE `user`
    ADD COLUMN google_id VARCHAR(255) NULL UNIQUE,
    ADD COLUMN linkedin_id VARCHAR(255) NULL UNIQUE;
