package store

import (
	"fmt"

	"github.com/jmoiron/sqlx"
)

type BrokerRangeAggInput struct {
	// Domisili aliran dana ("Asing"/"Lokal") apa adanya dari Stockbit.
	InvestorType string
	Symbol       string
	FromDate     string
	ToDate       string
	BrokerCode   string
	Side         string
	Value        float64
	Lot          int64
	Freq         int
}

func UpsertBrokerRangeAgg(db *sqlx.DB, rows []BrokerRangeAggInput) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := db.Beginx()
	if err != nil {
		return fmt.Errorf("upsert broker range agg: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.Preparex(`
		INSERT INTO broker_range_agg (symbol, from_date, to_date, broker_code, side, value, lot, freq, investor_type)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			value = VALUES(value), lot = VALUES(lot), freq = VALUES(freq),
			investor_type = VALUES(investor_type), fetched_at = CURRENT_TIMESTAMP
	`)
	if err != nil {
		return fmt.Errorf("upsert broker range agg: %w", err)
	}
	for _, r := range rows {
		if _, err := stmt.Exec(r.Symbol, r.FromDate, r.ToDate, r.BrokerCode, r.Side, r.Value, r.Lot, r.Freq, r.InvestorType); err != nil {
			return fmt.Errorf("upsert broker range agg: %w", err)
		}
	}
	return tx.Commit()
}

type BrokerRangeAggRow struct {
	FromDate   string  `db:"from_date_s"`
	ToDate     string  `db:"to_date_s"`
	BrokerCode string  `db:"broker_code"`
	Side       string  `db:"side"`
	Value      float64 `db:"value"`
	Lot        int64   `db:"lot"`
	Freq       int     `db:"freq"`
}

// GetLatestBrokerRangeAgg returns the most recently fetched aggregate set
// for a symbol (whatever scan range produced it) — the fallback when the
// per-day broker_summary table has nothing for this symbol.
func GetLatestBrokerRangeAgg(db *sqlx.DB, symbol string) ([]BrokerRangeAggRow, error) {
	var rows []BrokerRangeAggRow
	err := db.Select(&rows, `
		SELECT DATE_FORMAT(from_date, '%Y-%m-%d') AS from_date_s,
		       DATE_FORMAT(to_date, '%Y-%m-%d') AS to_date_s,
		       broker_code, side, value, lot, freq
		FROM broker_range_agg
		WHERE symbol = ?
		  AND (from_date, to_date) = (
			SELECT from_date, to_date FROM broker_range_agg
			WHERE symbol = ? ORDER BY fetched_at DESC LIMIT 1
		  )
	`, symbol, symbol)
	if err != nil {
		return nil, fmt.Errorf("get latest broker range agg: %w", err)
	}
	return rows, nil
}
