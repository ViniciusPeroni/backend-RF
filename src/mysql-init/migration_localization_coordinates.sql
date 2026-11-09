-- Executar uma vez em bancos criados antes das coordenadas no RFScript.sql.
-- Aditiva: endereços existentes ficam com latitude/longitude NULL.
ALTER TABLE localization
    ADD COLUMN latitude DECIMAL(10,8) NULL AFTER state,
    ADD COLUMN longitude DECIMAL(11,8) NULL AFTER latitude;
