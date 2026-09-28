-- outlook_state menyimpan bias terakhir yang teramati per simbol, dipakai
-- watcher sebagai baseline pembanding tiap tick — tabel mutable kecil,
-- bukan deret waktu, tidak dipartisi (sama seperti `symbols`/`positions`).
CREATE TABLE outlook_state (
    symbol     VARCHAR(10)  NOT NULL PRIMARY KEY,
    bias       VARCHAR(10)  NOT NULL,
    score      INT          NOT NULL,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- outlook_alerts adalah log setiap kali bias outlook sebuah simbol berubah
-- (append-only event history, ditampilkan di panel Alerts).
CREATE TABLE outlook_alerts (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol     VARCHAR(10)  NOT NULL,
    old_bias   VARCHAR(10)      NULL,
    new_bias   VARCHAR(10)  NOT NULL,
    score      INT          NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_outlook_alerts_symbol (symbol),
    KEY idx_outlook_alerts_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
