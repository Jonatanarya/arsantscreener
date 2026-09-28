UPDATE data_sources
SET enabled = 0, status = 'disabled'
WHERE code = 'market_fundamentals';
