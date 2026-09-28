-- trades: cetakan running trade per emiten, diturunkan bridge-extension dari
-- delta volume/freq antar tick WebSocket Stockbit (bukan feed per-transaksi
-- resmi — arah buy/sell ditebak dari uptick/downtick + posisi vs bid/offer).
-- Volume bisa besar (ribuan print per simbol per hari) tapi masih wajar
-- untuk tabel berindeks; dipisah per trade_date agar query harian cepat.
CREATE TABLE trades (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol     VARCHAR(10)   NOT NULL,
    trade_date DATE          NOT NULL,
    ts         BIGINT        NOT NULL COMMENT 'unix millis',
    price      DECIMAL(15,2) NOT NULL,
    lot        BIGINT        NOT NULL,
    freq       INT           NOT NULL DEFAULT 0 COMMENT 'jumlah transaksi dalam print ini (delta freq)',
    direction  ENUM('buy','sell','unknown') NOT NULL DEFAULT 'unknown',
    KEY idx_trades_symbol_date_ts (symbol, trade_date, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- broker_range_agg: total buy/sell per broker se-rentang, hasil 1 request
-- agregat dari Scan Akumulasi/Screener extension (yang sengaja tidak
-- mengambil rincian harian demi anti-spam). Jadi fallback tampilan broker
-- summary/analysis untuk simbol yang belum pernah di-Analisa-1-Saham.
CREATE TABLE broker_range_agg (
    symbol      VARCHAR(10)   NOT NULL,
    from_date   DATE          NOT NULL,
    to_date     DATE          NOT NULL,
    broker_code VARCHAR(5)    NOT NULL,
    side        ENUM('buy','sell') NOT NULL,
    value       DECIMAL(20,2) NOT NULL DEFAULT 0,
    lot         BIGINT UNSIGNED NOT NULL DEFAULT 0,
    freq        INT UNSIGNED  NOT NULL DEFAULT 0,
    fetched_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (symbol, from_date, to_date, broker_code, side),
    KEY idx_bra_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- news: berita/post stream Stockbit yang tertangkap pasif oleh interceptor
-- saat user browsing. ext_id = id item dari Stockbit bila ada (dedup);
-- fallback dedup pakai hash URL/judul yang dibuat extension.
CREATE TABLE news (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ext_id     VARCHAR(64)   NOT NULL,
    symbol     VARCHAR(10)       NULL,
    title      TEXT          NOT NULL,
    url        VARCHAR(500)      NULL,
    source     VARCHAR(100)      NULL,
    posted_at  DATETIME          NULL,
    created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_news_ext (ext_id),
    KEY idx_news_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
