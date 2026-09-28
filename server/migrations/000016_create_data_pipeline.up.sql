-- Pusat kendali pipeline data Arsant. Tabel-tabel ini memisahkan pekerjaan
-- pengambilan data dari proses API sehingga kegagalan satu sumber tidak
-- mengganggu website.

CREATE TABLE IF NOT EXISTS data_sources (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code            VARCHAR(64)  NOT NULL,
    name            VARCHAR(120) NOT NULL,
    kind            VARCHAR(32)  NOT NULL DEFAULT 'http',
    status          VARCHAR(24)  NOT NULL DEFAULT 'planned',
    enabled         TINYINT(1)   NOT NULL DEFAULT 0,
    priority        INT          NOT NULL DEFAULT 100,
    config          JSON             NULL,
    last_success_at DATETIME         NULL,
    last_error_at   DATETIME         NULL,
    last_error      TEXT             NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_data_sources_code (code),
    KEY idx_data_sources_enabled (enabled, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pipeline_settings (
    setting_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
    value_text    VARCHAR(255) NOT NULL,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_jobs (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_id      BIGINT UNSIGNED NOT NULL,
    job_type       VARCHAR(64)  NOT NULL,
    symbol         VARCHAR(16)  NOT NULL DEFAULT '',
    status         VARCHAR(24)  NOT NULL DEFAULT 'pending',
    priority       INT          NOT NULL DEFAULT 100,
    attempts       INT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts   INT UNSIGNED NOT NULL DEFAULT 3,
    scheduled_for  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    run_after      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at      DATETIME         NULL,
    locked_by      VARCHAR(128)     NULL,
    finished_at    DATETIME         NULL,
    dedupe_key     VARCHAR(191)     NULL,
    payload        JSON             NULL,
    last_error     TEXT             NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_data_jobs_source FOREIGN KEY (source_id) REFERENCES data_sources(id),
    UNIQUE KEY uq_data_jobs_dedupe (dedupe_key),
    KEY idx_data_jobs_claim (status, run_after, priority, id),
    KEY idx_data_jobs_source (source_id, status),
    KEY idx_data_jobs_symbol (symbol, job_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_runs (
    id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id         BIGINT UNSIGNED NOT NULL,
    source_id      BIGINT UNSIGNED NOT NULL,
    worker_id      VARCHAR(128) NOT NULL,
    status         VARCHAR(24)  NOT NULL DEFAULT 'running',
    items_read     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    items_written  BIGINT UNSIGNED NOT NULL DEFAULT 0,
    items_skipped  BIGINT UNSIGNED NOT NULL DEFAULT 0,
    started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at    DATETIME     NULL,
    error_message  TEXT         NULL,
    metadata       JSON         NULL,
    CONSTRAINT fk_data_runs_job FOREIGN KEY (job_id) REFERENCES data_jobs(id) ON DELETE CASCADE,
    CONSTRAINT fk_data_runs_source FOREIGN KEY (source_id) REFERENCES data_sources(id),
    KEY idx_data_runs_job (job_id, started_at),
    KEY idx_data_runs_source (source_id, started_at),
    KEY idx_data_runs_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_freshness (
    source_id          BIGINT UNSIGNED NOT NULL,
    dataset            VARCHAR(64) NOT NULL,
    symbol             VARCHAR(16) NOT NULL DEFAULT '',
    status             VARCHAR(24) NOT NULL DEFAULT 'unknown',
    latest_market_date DATE            NULL,
    latest_data_at     DATETIME        NULL,
    last_checked_at    DATETIME        NULL,
    row_count          BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_error         TEXT            NULL,
    updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (source_id, dataset, symbol),
    CONSTRAINT fk_data_freshness_source FOREIGN KEY (source_id) REFERENCES data_sources(id),
    KEY idx_data_freshness_dataset (dataset, latest_market_date),
    KEY idx_data_freshness_status (status, last_checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS worker_heartbeats (
    worker_id       VARCHAR(128) NOT NULL PRIMARY KEY,
    version         VARCHAR(32)  NOT NULL,
    hostname        VARCHAR(128) NOT NULL,
    status          VARCHAR(24)  NOT NULL DEFAULT 'starting',
    current_job_id  BIGINT UNSIGNED NULL,
    started_at      DATETIME NOT NULL,
    heartbeat_at    DATETIME NOT NULL,
    metadata        JSON         NULL,
    KEY idx_worker_heartbeats_seen (heartbeat_at),
    CONSTRAINT fk_worker_heartbeat_job FOREIGN KEY (current_job_id) REFERENCES data_jobs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pipeline_settings (setting_key, value_text)
VALUES ('worker_paused', 'true')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);

INSERT INTO data_sources (code, name, kind, status, enabled, priority) VALUES
    ('system', 'Arsant System', 'internal', 'ready', 1, 1000),
    ('market_eod', 'Market EOD', 'http', 'planned', 0, 400),
    ('market_news', 'Market News', 'http', 'planned', 0, 300),
    ('market_fundamentals', 'Market Fundamentals', 'http', 'planned', 0, 200),
    ('broker_activity', 'Broker Activity', 'session', 'planned', 0, 100)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    kind = VALUES(kind),
    priority = VALUES(priority);
