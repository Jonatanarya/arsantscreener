ALTER TABLE trades
    DROP KEY uniq_trades_symbol_ext,
    DROP COLUMN ext_trade_id;
