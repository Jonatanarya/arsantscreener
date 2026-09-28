-- raw_ingest originally came from an idempotent runtime initializer. Defining
-- it here as well makes a fresh migrated database complete before the API has
-- started for the first time.
CREATE TABLE IF NOT EXISTS raw_ingest (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source      VARCHAR(32) NOT NULL DEFAULT 'stockbit_collector',
    endpoint    VARCHAR(64) NOT NULL,
    symbol      VARCHAR(16) NOT NULL DEFAULT '',
    variant     VARCHAR(96) NOT NULL DEFAULT '',
    url         VARCHAR(700) NOT NULL DEFAULT '',
    params      JSON NULL,
    payload     JSON NULL,
    fetched_at  DATETIME NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_raw (endpoint, symbol, variant),
    KEY idx_raw_symbol (symbol, endpoint),
    KEY idx_raw_fetched (fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE maintenance_runs (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    status          VARCHAR(24) NOT NULL DEFAULT 'running',
    dry_run         TINYINT(1) NOT NULL DEFAULT 1,
    policy          JSON NOT NULL,
    candidates      JSON NULL,
    deleted_rows    JSON NULL,
    error_message   TEXT NULL,
    started_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at     DATETIME NULL,
    KEY idx_maintenance_runs_started (started_at),
    KEY idx_maintenance_runs_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE data_jobs
    ADD KEY idx_data_jobs_retention (status, finished_at, id);
