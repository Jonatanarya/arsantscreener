-- catalysts adalah jurnal katalis forward-looking per simbol (proyek,
-- ekspansi, tenant, pabrik, kebijakan pemerintah, makro) yang mendasari
-- proyeksi "Future Earnings" 2 tahun ke depan -- pelengkap panel
-- Fundamental yang berbasis rasio historis (mitigasi risiko value trap).
-- Entri diisi lewat riset (added_by='riset', biasanya oleh asisten AI atas
-- permintaan user) maupun input manual user sendiri (added_by='manual').
CREATE TABLE catalysts (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    symbol          VARCHAR(10)  NOT NULL,
    category        ENUM('proyek', 'ekspansi', 'tenant', 'pabrik', 'pemerintah', 'makro', 'lainnya') NOT NULL,
    description     TEXT         NOT NULL,
    impact          ENUM('bullish', 'bearish', 'netral') NOT NULL,
    expected_period VARCHAR(20)      NULL COMMENT 'mis. "2026 Q4", "2027", "H2 2026" -- teks bebas, presisi bervariasi',
    status          ENUM('rumor', 'confirmed', 'in_progress', 'completed') NOT NULL DEFAULT 'rumor',
    source_url      VARCHAR(500)     NULL,
    source_name     VARCHAR(200)     NULL,
    confidence      ENUM('rendah', 'sedang', 'tinggi')   NULL,
    added_by        ENUM('riset', 'manual') NOT NULL DEFAULT 'manual',
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_catalysts_symbol (symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
