-- Aditiva. Não habilita provedores nem altera preferências existentes.
CREATE TABLE IF NOT EXISTS notification_preferences (
    id_user BINARY(16) NOT NULL PRIMARY KEY,
    email BOOLEAN NOT NULL DEFAULT FALSE,
    push BOOLEAN NOT NULL DEFAULT FALSE,
    updated_in DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_notification_preferences_user FOREIGN KEY (id_user) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification_device (
    id BINARY(16) NOT NULL PRIMARY KEY,
    id_user BINARY(16) NOT NULL,
    platform ENUM('android','ios','web') NOT NULL,
    token_encrypted VARBINARY(4125) NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_in DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_in DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_notification_device_token (token_hash),
    KEY ix_notification_device_user (id_user, active),
    CONSTRAINT fk_notification_device_user FOREIGN KEY (id_user) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification_delivery (
    id BINARY(16) NOT NULL PRIMARY KEY,
    id_notification BINARY(16) NOT NULL,
    id_user BINARY(16) NOT NULL,
    channel ENUM('email','push') NOT NULL,
    target_key VARCHAR(110) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    id_device BINARY(16) NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    state ENUM('pending','processing','sent','skipped','failed') NOT NULL DEFAULT 'pending',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    lease_token BINARY(16) NULL,
    lease_until DATETIME(3) NULL,
    last_error VARCHAR(64) NULL,
    created_in DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_in DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_notification_delivery_target (id_notification, channel, target_key),
    KEY ix_notification_delivery_due (state, next_attempt_at, lease_until),
    KEY ix_notification_delivery_user (id_user, channel),
    CONSTRAINT fk_notification_delivery_user FOREIGN KEY (id_user) REFERENCES `user`(id) ON DELETE CASCADE
) ENGINE=InnoDB;
