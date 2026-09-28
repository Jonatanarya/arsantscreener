-- Kolom broker pembeli/penjual per print — terisi hanya untuk print yang
-- berasal dari fetchRunningTrade() (data transaksi asli Stockbit, dipakai
-- saat deep-dive setelah scan), NULL untuk print dari delta tick WebSocket
-- (yang tidak membawa info broker).
ALTER TABLE trades
    ADD COLUMN buyer_broker  VARCHAR(5) NULL AFTER direction,
    ADD COLUMN seller_broker VARCHAR(5) NULL AFTER buyer_broker;
