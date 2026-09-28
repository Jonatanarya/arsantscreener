UPDATE data_sources
SET enabled = 1, status = 'ready'
WHERE code = 'market_fundamentals' AND enabled = 0;
