-- liquidity_alert_state menyimpan level anomali volume/likuiditas terakhir
-- yang teramati per simbol, dipakai watcher sebagai baseline pembanding tiap
-- tick — sama seperti outlook_state, tabel mutable kecil, bukan deret waktu.
CREATE TABLE liquidity_alert_state (
    symbol     VARCHAR(10)  NOT NULL PRIMARY KEY,
    level      VARCHAR(20)  NOT NULL,
    score      INT          NOT NULL,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- liquidity_alerts adalah log setiap kali level anomali volume/likuiditas
-- sebuah simbol berubah (append-only event history) — deteksi "saham yang
-- tiba-tiba diborong" / "illiquid jadi liquid" dari bars_daily saja, tanpa
-- perlu running trade penuh.
CREATE TABLE liquidity_alerts (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol     VARCHAR(10)  NOT NULL,
    old_level  VARCHAR(20)      NULL,
    new_level  VARCHAR(20)  NOT NULL,
    score      INT          NOT NULL,
    reasons    JSON             NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_liquidity_alerts_symbol (symbol),
    KEY idx_liquidity_alerts_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
