package store

import (
	"fmt"

	"github.com/jmoiron/sqlx"
)

type TradeInput struct {
	Symbol       string
	TradeDate    string
	Ts           int64
	Price        float64
	Lot          int64
	Freq         int
	Direction    string // buy | sell | unknown
	BuyerBroker  *string
	SellerBroker *string
	ExtTradeID   *string
}

// InsertTrades upserts on (symbol, ext_trade_id): re-relaying the same
// running-trade print (e.g. re-running a scan/analisa on a symbol already
// fetched today) updates the existing row instead of duplicating it.
// ExtTradeID is NULL for WS-tick-derived prints — MySQL treats each NULL
// as distinct in the unique index, so those always insert fresh (they are
// already deduped upstream via a timestamp watermark in app.js).
func InsertTrades(db *sqlx.DB, rows []TradeInput) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := db.Beginx()
	if err != nil {
		return fmt.Errorf("insert trades: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.Preparex(`
		INSERT INTO trades (symbol, trade_date, ts, price, lot, freq, direction, buyer_broker, seller_broker, ext_trade_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			trade_date = VALUES(trade_date), ts = VALUES(ts), price = VALUES(price),
			lot = VALUES(lot), freq = VALUES(freq), direction = VALUES(direction),
			buyer_broker = VALUES(buyer_broker), seller_broker = VALUES(seller_broker)
	`)
	if err != nil {
		return fmt.Errorf("insert trades: %w", err)
	}
	for _, r := range rows {
		if _, err := stmt.Exec(r.Symbol, r.TradeDate, r.Ts, r.Price, r.Lot, r.Freq, r.Direction, r.BuyerBroker, r.SellerBroker, r.ExtTradeID); err != nil {
			return fmt.Errorf("insert trades: %w", err)
		}
	}
	return tx.Commit()
}

type TradeRow struct {
	Ts           int64   `db:"ts"`
	Price        float64 `db:"price"`
	Lot          int64   `db:"lot"`
	Freq         int     `db:"freq"`
	Direction    string  `db:"direction"`
	BuyerBroker  *string `db:"buyer_broker"`
	SellerBroker *string `db:"seller_broker"`
	ExtTradeID   *string `db:"ext_trade_id"`
}

// GetTrades returns prints for one symbol on one date, newest first,
// capped at limit (the panel shows a tape, not the whole day at once).
func GetTrades(db *sqlx.DB, symbol, date string, limit int) ([]TradeRow, error) {
	var rows []TradeRow
	var err error
	if limit > 0 {
		err = db.Select(&rows, `
			SELECT ts, price, lot, freq, direction, buyer_broker, seller_broker, COALESCE(ext_trade_id, '') AS ext_trade_id FROM trades
			WHERE symbol = ? AND trade_date = ?
			ORDER BY ts DESC LIMIT ?
		`, symbol, date, limit)
	} else {
		err = db.Select(&rows, `
			SELECT ts, price, lot, freq, direction, buyer_broker, seller_broker, COALESCE(ext_trade_id, '') AS ext_trade_id FROM trades
			WHERE symbol = ? AND trade_date = ?
			ORDER BY ts DESC
		`, symbol, date)
	}
	if err != nil {
		return nil, fmt.Errorf("get trades: %w", err)
	}
	return rows, nil
}

// GetTradesAll returns the full day ascending — the raw material for
// analysis (VWAP, pressure, big prints), separate from the display tape.
func GetTradesAll(db *sqlx.DB, symbol, date string) ([]TradeRow, error) {
	var rows []TradeRow
	err := db.Select(&rows, `
		SELECT ts, price, lot, freq, direction, buyer_broker, seller_broker, COALESCE(ext_trade_id, '') AS ext_trade_id FROM trades
		WHERE symbol = ? AND trade_date = ?
		ORDER BY ts ASC
	`, symbol, date)
	if err != nil {
		return nil, fmt.Errorf("get trades all: %w", err)
	}
	return rows, nil
}

// LatestTradeDate returns the most recent trade_date for a symbol ("" when
// none) so the panel can default to the last day that actually has data.
func LatestTradeDate(db *sqlx.DB, symbol string) (string, error) {
	var d []string
	err := db.Select(&d, `SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') FROM trades WHERE symbol = ? HAVING MAX(trade_date) IS NOT NULL`, symbol)
	if err != nil {
		return "", fmt.Errorf("latest trade date: %w", err)
	}
	if len(d) == 0 {
		return "", nil
	}
	return d[0], nil
}

// AvailableTradeDates returns distinct trade_date entries for a symbol sorted descending.
func AvailableTradeDates(db *sqlx.DB, symbol string) ([]string, error) {
	var dates []string
	err := db.Select(&dates, `
		SELECT DISTINCT DATE_FORMAT(trade_date, '%Y-%m-%d')
		FROM trades WHERE symbol = ?
		ORDER BY trade_date DESC LIMIT 60
	`, symbol)
	if err != nil {
		return nil, fmt.Errorf("available trade dates: %w", err)
	}
	return dates, nil
}

type TopBuyerSeller struct {
	Code string  `db:"code"`
	Val  float64 `db:"val"`
	N    int     `db:"n"`
}

// TopBuyers/TopSellers rank brokers by total value transacted as the
// aggressor on that side, for prints that carry broker info (only those
// from fetchRunningTrade — WS-tick-derived prints have NULL here and are
// naturally excluded).
func TopBuyers(db *sqlx.DB, symbol, date string, limit int) ([]TopBuyerSeller, error) {
	var rows []TopBuyerSeller
	err := db.Select(&rows, `
		SELECT buyer_broker AS code, SUM(price * lot * 100) AS val, COUNT(*) AS n
		FROM trades WHERE symbol = ? AND trade_date = ? AND direction = 'buy' AND buyer_broker IS NOT NULL
		GROUP BY buyer_broker ORDER BY val DESC LIMIT ?
	`, symbol, date, limit)
	if err != nil {
		return nil, fmt.Errorf("top buyers: %w", err)
	}
	return rows, nil
}

func TopSellers(db *sqlx.DB, symbol, date string, limit int) ([]TopBuyerSeller, error) {
	var rows []TopBuyerSeller
	err := db.Select(&rows, `
		SELECT seller_broker AS code, SUM(price * lot * 100) AS val, COUNT(*) AS n
		FROM trades WHERE symbol = ? AND trade_date = ? AND direction = 'sell' AND seller_broker IS NOT NULL
		GROUP BY seller_broker ORDER BY val DESC LIMIT ?
	`, symbol, date, limit)
	if err != nil {
		return nil, fmt.Errorf("top sellers: %w", err)
	}
	return rows, nil
}
