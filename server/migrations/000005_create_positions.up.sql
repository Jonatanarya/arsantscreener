-- Posisi trading milik user sendiri (bukan data pasar) — tabel mutable
-- kecil seperti `symbols`, tidak dipartisi.
CREATE TABLE positions (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol       VARCHAR(10)     NOT NULL,
    entry_date   DATE            NOT NULL,
    entry_price  DECIMAL(15,2)   NOT NULL,
    lot          BIGINT UNSIGNED NOT NULL,
    stop_loss    DECIMAL(15,2)       NULL,
    take_profit  DECIMAL(15,2)       NULL,
    notes        VARCHAR(255)        NULL,
    status       ENUM('open','closed') NOT NULL DEFAULT 'open',
    exit_date    DATE                NULL,
    exit_price   DECIMAL(15,2)       NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_positions_symbol (symbol),
    KEY idx_positions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
