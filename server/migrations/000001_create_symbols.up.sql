CREATE TABLE symbols (
    code         VARCHAR(10)  NOT NULL,
    name         VARCHAR(150) NOT NULL,
    sector       VARCHAR(100)     NULL,
    board        VARCHAR(30)      NULL,
    listed_date  DATE             NULL,
    is_active    TINYINT(1)   NOT NULL DEFAULT 1,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (code),
    KEY idx_symbols_sector (sector)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
