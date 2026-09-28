ALTER TABLE news
    ADD COLUMN summary TEXT NULL AFTER title,
    ADD COLUMN topic VARCHAR(64) NOT NULL DEFAULT 'MARKET' AFTER source,
    ADD COLUMN sentiment VARCHAR(16) NOT NULL DEFAULT 'NETRAL' AFTER topic,
    ADD KEY idx_news_posted_at (posted_at),
    ADD KEY idx_news_topic_sentiment (topic, sentiment);

CREATE TABLE news_impacts (
    news_id     BIGINT UNSIGNED NOT NULL,
    symbol      VARCHAR(10) NOT NULL,
    sentiment   VARCHAR(16) NOT NULL DEFAULT 'NETRAL',
    confidence  DECIMAL(5,2) NOT NULL DEFAULT 0,
    reason      VARCHAR(255) NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (news_id, symbol),
    KEY idx_news_impacts_symbol (symbol, news_id),
    CONSTRAINT fk_news_impacts_news FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
