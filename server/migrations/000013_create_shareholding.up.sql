-- Kepemilikan saham per investor per emiten, hasil relay endpoint
-- shareholding network Stockbit (sumbernya laporan bulanan KSEI).
-- report_date adalah tanggal laporan KSEI (akhir bulan), BUKAN tanggal
-- pengambilan data — satu baris per (bulan, emiten, investor) supaya
-- perubahan SID/scripless antar bulan bisa dihitung dengan selisih.
CREATE TABLE shareholding (
    report_date     DATE          NOT NULL,
    symbol          VARCHAR(10)   NOT NULL,
    investor_id     BIGINT        NOT NULL,
    investor_name   VARCHAR(180)  NOT NULL,
    investor_type   VARCHAR(30)       NULL,
    location        VARCHAR(30)       NULL,
    nationality     VARCHAR(60)       NULL,
    domicile        VARCHAR(80)       NULL,
    classification  VARCHAR(60)       NULL,
    -- scrip + scripless = total_shares. Scripless yang naik sementara total
    -- tetap berarti konversi warkat, bukan pembelian baru.
    scrip           BIGINT        NOT NULL DEFAULT 0,
    scripless       BIGINT        NOT NULL DEFAULT 0,
    total_shares    BIGINT        NOT NULL DEFAULT 0,
    percentage      DECIMAL(9,4)  NOT NULL DEFAULT 0,
    company_id      BIGINT            NULL,
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (report_date, symbol, investor_id),
    KEY idx_shareholding_symbol (symbol, report_date),
    KEY idx_shareholding_investor (investor_id, report_date),
    KEY idx_shareholding_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
