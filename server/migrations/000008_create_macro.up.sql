-- macro_quotes caches the fixed set of live macro instruments shown on the
-- Macro dashboard (USDIDR, oil, gold, copper, IHSG). Small, mutable,
-- not partitioned — same pattern as `fundamentals`.
CREATE TABLE macro_quotes (
    ticker         VARCHAR(20)   NOT NULL PRIMARY KEY,
    name           VARCHAR(100)  NOT NULL,
    price          DECIMAL(20,4) NOT NULL,
    currency       VARCHAR(6)    NOT NULL,
    change_percent DECIMAL(8,4)  NOT NULL,
    fetched_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- macro_sensitivity is a manual per-symbol tagging of which macro factors
-- matter for that stock (e.g. ANTM -> nickel, an exporter -> usdidr) and
-- which direction the exposure runs. factor is a free string rather than a
-- DB enum since some tagged factors (nickel, coal, bi_rate, fed_rate) have
-- no corresponding live quote in macro_quotes but are still meaningful
-- classifications for the user.
CREATE TABLE macro_sensitivity (
    id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol           VARCHAR(10)  NOT NULL,
    factor           VARCHAR(20)  NOT NULL,
    impact_direction ENUM('diuntungkan', 'dirugikan') NOT NULL,
    note             VARCHAR(255)     NULL,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_macro_sensitivity_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
