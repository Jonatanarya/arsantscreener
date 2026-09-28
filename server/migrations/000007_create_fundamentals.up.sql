-- Data fundamental/valuasi per simbol, di-cache dari Yahoo Finance (ticker
-- IDX + .JK). Satu baris per simbol, mutable, tidak dipartisi — sama
-- seperti `symbols`/`positions`. fetched_at dipakai sebagai TTL cache di
-- handler API supaya tidak membebani/melanggar rate-limit API tidak resmi
-- Yahoo Finance.
CREATE TABLE fundamentals (
    symbol             VARCHAR(10)     NOT NULL PRIMARY KEY,
    market_cap         DECIMAL(24,2)       NULL,
    pe_ratio           DECIMAL(12,4)       NULL,
    forward_pe         DECIMAL(12,4)       NULL,
    peg_ratio          DECIMAL(12,4)       NULL,
    price_to_book      DECIMAL(12,4)       NULL,
    price_to_sales     DECIMAL(12,4)       NULL,
    book_value         DECIMAL(15,2)       NULL,
    eps_trailing       DECIMAL(15,2)       NULL,
    eps_forward        DECIMAL(15,2)       NULL,
    dividend_yield     DECIMAL(8,5)        NULL,
    dividend_rate      DECIMAL(15,2)       NULL,
    payout_ratio       DECIMAL(8,5)        NULL,
    revenue_ttm        DECIMAL(24,2)       NULL,
    revenue_growth     DECIMAL(8,5)        NULL,
    earnings_growth    DECIMAL(8,5)        NULL,
    profit_margin      DECIMAL(8,5)        NULL,
    operating_margin   DECIMAL(8,5)        NULL,
    roe                DECIMAL(8,5)        NULL,
    roa                DECIMAL(8,5)        NULL,
    total_cash         DECIMAL(24,2)       NULL,
    total_debt         DECIMAL(24,2)       NULL,
    beta               DECIMAL(8,4)        NULL,
    shares_outstanding BIGINT UNSIGNED     NULL,
    week52_low         DECIMAL(15,2)       NULL,
    week52_high        DECIMAL(15,2)       NULL,
    week52_change      DECIMAL(8,5)        NULL,
    target_mean_price  DECIMAL(15,2)       NULL,
    target_high_price  DECIMAL(15,2)       NULL,
    target_low_price   DECIMAL(15,2)       NULL,
    recommendation_key VARCHAR(20)         NULL,
    num_analysts       INT                 NULL,
    currency           VARCHAR(6)          NULL,
    fetched_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
