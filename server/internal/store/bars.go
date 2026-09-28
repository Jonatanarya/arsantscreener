package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

func LatestBarDate(ctx context.Context, db *sqlx.DB, symbol string) (*time.Time, error) {
	var latest sql.NullTime
	if err := db.GetContext(ctx, &latest, `SELECT MAX(date) FROM bars_daily WHERE symbol=?`, symbol); err != nil {
		return nil, fmt.Errorf("latest bar date %s: %w", symbol, err)
	}
	if !latest.Valid {
		return nil, nil
	}
	value := latest.Time
	return &value, nil
}

func BarCoverage(ctx context.Context, db *sqlx.DB, symbol string) (uint64, *time.Time, error) {
	var row struct {
		Count  uint64       `db:"count"`
		Latest sql.NullTime `db:"latest"`
	}
	if err := db.GetContext(ctx, &row, `SELECT COUNT(*) AS count, MAX(date) AS latest
		FROM bars_daily WHERE symbol=?`, symbol); err != nil {
		return 0, nil, fmt.Errorf("bar coverage %s: %w", symbol, err)
	}
	if !row.Latest.Valid {
		return row.Count, nil, nil
	}
	latest := row.Latest.Time
	return row.Count, &latest, nil
}

// ListLiquidSymbolsForEOD prioritizes equities by average daily transaction
// value over the recent market window. It avoids spending the daily request
// budget on inactive listings while keeping the limit configurable.
func ListLiquidSymbolsForEOD(ctx context.Context, db *sqlx.DB, limit int) ([]string, error) {
	if limit < 1 || limit > 1000 {
		limit = 300
	}
	var symbols []string
	err := db.SelectContext(ctx, &symbols, `SELECT s.code
		FROM symbols s
		JOIN bars_daily b ON b.symbol=s.code
		WHERE s.is_active=1
		  AND s.code <> 'IHSG'
		  AND b.date >= DATE_SUB((SELECT MAX(date) FROM bars_daily), INTERVAL 45 DAY)
		GROUP BY s.code
		HAVING SUM(b.volume) > 0
		ORDER BY AVG(COALESCE(NULLIF(b.value,0), b.close*b.volume)) DESC, s.code
		LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list liquid EOD symbols: %w", err)
	}
	return symbols, nil
}

type BarInput struct {
	Symbol      string
	Date        string
	Open        float64
	High        float64
	Low         float64
	Close       float64
	Volume      int64
	Value       *float64
	Freq        *int
	ForeignBuy  *int64
	ForeignSell *int64
	ForeignFlow *int64
	Source      string
}

// UpsertBars writes daily candles inside a single transaction so a partial
// batch failure doesn't leave the table half-written.
func UpsertBars(db *sqlx.DB, bars []BarInput) error {
	if len(bars) == 0 {
		return nil
	}

	tx, err := db.Beginx()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Preparex(`
		INSERT INTO bars_daily
			(symbol, date, open, high, low, close, volume, value, freq,
			 foreign_buy, foreign_sell, foreign_flow, source)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			open = VALUES(open), high = VALUES(high), low = VALUES(low),
			close = VALUES(close), volume = VALUES(volume), value = VALUES(value),
			freq = VALUES(freq), foreign_buy = VALUES(foreign_buy),
			foreign_sell = VALUES(foreign_sell), foreign_flow = VALUES(foreign_flow),
			source = VALUES(source)
	`)
	if err != nil {
		return fmt.Errorf("prepare upsert bars: %w", err)
	}
	defer stmt.Close()

	for _, b := range bars {
		if _, err := stmt.Exec(
			b.Symbol, b.Date, b.Open, b.High, b.Low, b.Close, b.Volume,
			b.Value, b.Freq, b.ForeignBuy, b.ForeignSell, b.ForeignFlow, b.Source,
		); err != nil {
			return fmt.Errorf("upsert bar %s %s: %w", b.Symbol, b.Date, err)
		}
	}

	return tx.Commit()
}

type BarRow struct {
	Symbol      string    `db:"symbol"`
	Date        time.Time `db:"date"`
	Open        float64   `db:"open"`
	High        float64   `db:"high"`
	Low         float64   `db:"low"`
	Close       float64   `db:"close"`
	Volume      int64     `db:"volume"`
	Value       *float64  `db:"value"`
	Freq        *int      `db:"freq"`
	ForeignBuy  *int64    `db:"foreign_buy"`
	ForeignSell *int64    `db:"foreign_sell"`
	ForeignFlow *int64    `db:"foreign_flow"`
}

// DateStr formats the DATE column as plain YYYY-MM-DD — the MySQL driver
// (parseTime=true) hands back a time.Time, and without this, encoding/json
// would render it as RFC3339 with a UTC offset instead of a bare date.
func (b BarRow) DateStr() string {
	return b.Date.Format("2006-01-02")
}

// GetBars returns daily candles for one symbol between from/to (inclusive),
// ordered ascending by date — ready to feed straight into a chart.
func GetBars(db *sqlx.DB, symbol, from, to string) ([]BarRow, error) {
	var rows []BarRow
	err := db.Select(&rows, `
		SELECT symbol, date, open, high, low, close, volume, value, freq,
		       foreign_buy, foreign_sell, foreign_flow
		FROM bars_daily
		WHERE symbol = ? AND date BETWEEN ? AND ?
		ORDER BY date ASC
	`, symbol, from, to)
	if err != nil {
		return nil, fmt.Errorf("get bars %s: %w", symbol, err)
	}
	return rows, nil
}

// LatestTwoBars returns the most recent bar and the one before it (for
// change% on the watchlist), most-recent first. Relies on the (symbol, date)
// primary key for an index-only lookup — cheap even with monthly partitions.
func LatestTwoBars(db *sqlx.DB, symbol string) ([]BarRow, error) {
	var rows []BarRow
	err := db.Select(&rows, `
		SELECT symbol, date, open, high, low, close, volume, value, freq,
		       foreign_buy, foreign_sell, foreign_flow
		FROM bars_daily
		WHERE symbol = ?
		ORDER BY date DESC
		LIMIT 2
	`, symbol)
	if err != nil {
		return nil, fmt.Errorf("get latest bars %s: %w", symbol, err)
	}
	return rows, nil
}
