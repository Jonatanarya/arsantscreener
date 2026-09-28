DROP TABLE IF EXISTS news_impacts;
ALTER TABLE news
    DROP KEY idx_news_topic_sentiment,
    DROP KEY idx_news_posted_at,
    DROP COLUMN sentiment,
    DROP COLUMN topic,
    DROP COLUMN summary;
