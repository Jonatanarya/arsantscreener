-- ext_trade_id = "{buyOrderNumber}-{sellOrderNumber}" dari Stockbit — id
-- transaksi asli yang unik per eksekusi, dipakai dedup saat symbol yang
-- sama di-scan/dianalisa ulang di hari yang sama (mis. deep-dive scan
-- berulang, atau Jalankan Analisa dijalankan lagi). NULL untuk print dari
-- delta tick WebSocket (yang sudah dedup sendiri lewat watermark timestamp
-- di app.js) — unique index MySQL memperlakukan tiap NULL sebagai berbeda,
-- jadi baris ber-NULL tidak pernah saling bentrok.
ALTER TABLE trades
    ADD COLUMN ext_trade_id VARCHAR(40) NULL AFTER seller_broker,
    ADD UNIQUE KEY uniq_trades_symbol_ext (symbol, ext_trade_id);
