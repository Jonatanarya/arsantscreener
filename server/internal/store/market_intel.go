package store

import (
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

// Query lintas-simbol untuk Foreign Radar, Broker Profiler, dan Broker
// Intel. Semuanya meng-agregat di SQL, bukan di Go: satu minggu broker
// summary untuk seluruh IDX adalah ratusan ribu baris, dan menariknya
// mentah-mentah ke memori pernah jadi sumber lonjakan latensi di /scan.

// SymbolDayNetRow is one symbol's net value/lot on one date, already
// filtered to a broker subset by the caller.
type SymbolDayNetRow struct {
	Symbol string    `db:"symbol"`
	Date   time.Time `db:"date"`
	NetVal float64   `db:"net_val"`
	NetLot int64     `db:"net_lot"`
	BuyVal float64   `db:"buy_val"`
	SelVal float64   `db:"sell_val"`
}

func (r SymbolDayNetRow) DateStr() string { return r.Date.Format("2006-01-02") }

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// GetNetByBrokerGroupDaily returns per-symbol, per-day net flow restricted
// to the given broker codes (e.g. every "asing" broker for Foreign Radar).
func GetNetByBrokerGroupDaily(db *sqlx.DB, from, to string, brokerCodes []string) ([]SymbolDayNetRow, error) {
	if len(brokerCodes) == 0 {
		return nil, nil
	}
	args := []any{from, to}
	for _, c := range brokerCodes {
		args = append(args, c)
	}
	q := fmt.Sprintf(`
		SELECT symbol, date,
		       SUM(CASE WHEN side = 'buy' THEN value ELSE -value END) AS net_val,
		       SUM(CASE WHEN side = 'buy' THEN lot   ELSE -lot   END) AS net_lot,
		       SUM(CASE WHEN side = 'buy' THEN value ELSE 0 END)      AS buy_val,
		       SUM(CASE WHEN side = 'sell' THEN value ELSE 0 END)     AS sell_val
		FROM broker_summary
		WHERE date BETWEEN ? AND ? AND broker_code IN (%s)
		GROUP BY symbol, date
		ORDER BY date ASC
	`, placeholders(len(brokerCodes)))

	var rows []SymbolDayNetRow
	if err := db.Select(&rows, q, args...); err != nil {
		return nil, fmt.Errorf("net by broker group daily: %w", err)
	}
	return rows, nil
}

// CloseRow is a symbol's close on one date.
type CloseRow struct {
	Symbol string    `db:"symbol"`
	Date   time.Time `db:"date"`
	Close  float64   `db:"close"`
}

func (r CloseRow) DateStr() string { return r.Date.Format("2006-01-02") }

// GetClosesRange returns closes for every symbol in the window — used to
// attach period returns to cross-symbol rankings without N+1 queries.
func GetClosesRange(db *sqlx.DB, from, to string) ([]CloseRow, error) {
	var rows []CloseRow
	err := db.Select(&rows, `
		SELECT symbol, date, close
		FROM bars_daily
		WHERE date BETWEEN ? AND ?
		ORDER BY date ASC
	`, from, to)
	if err != nil {
		return nil, fmt.Errorf("get closes range: %w", err)
	}
	return rows, nil
}

// BrokerStockAggRow is one broker's total activity on one stock over a window.
type BrokerStockAggRow struct {
	BrokerCode string  `db:"broker_code"`
	Symbol     string  `db:"symbol"`
	BuyVal     float64 `db:"buy_val"`
	SellVal    float64 `db:"sell_val"`
	BuyLot     int64   `db:"buy_lot"`
	SellLot    int64   `db:"sell_lot"`
	NDays      int     `db:"n_days"`
}

// GetBrokerStockAgg ranks (broker, stock) pairs by absolute net value.
// side "accum" ranks net buyers, "dist" ranks net sellers. limit caps the
// result because the unbounded cross product is ~50 brokers x 900 stocks.
func GetBrokerStockAgg(db *sqlx.DB, from, to, side string, brokerCodes []string, symbol string, limit int) ([]BrokerStockAggRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"date BETWEEN ? AND ?"}
	args := []any{from, to}
	if len(brokerCodes) > 0 {
		where = append(where, "broker_code IN ("+placeholders(len(brokerCodes))+")")
		for _, c := range brokerCodes {
			args = append(args, c)
		}
	}
	if symbol != "" {
		where = append(where, "symbol = ?")
		args = append(args, symbol)
	}

	// Diurut lewat ekspresi agregat langsung, bukan kolom alias, supaya
	// net value tidak perlu ikut di SELECT hanya demi ORDER BY.
	order := "SUM(CASE WHEN side = 'buy' THEN value ELSE -value END) DESC"
	if side == "dist" {
		order = "SUM(CASE WHEN side = 'buy' THEN value ELSE -value END) ASC"
	}

	q := fmt.Sprintf(`
		SELECT broker_code, symbol,
		       SUM(CASE WHEN side = 'buy'  THEN value ELSE 0 END) AS buy_val,
		       SUM(CASE WHEN side = 'sell' THEN value ELSE 0 END) AS sell_val,
		       SUM(CASE WHEN side = 'buy'  THEN lot   ELSE 0 END) AS buy_lot,
		       SUM(CASE WHEN side = 'sell' THEN lot   ELSE 0 END) AS sell_lot,
		       COUNT(DISTINCT date) AS n_days
		FROM broker_summary
		WHERE %s
		GROUP BY broker_code, symbol
		ORDER BY %s
		LIMIT %d
	`, strings.Join(where, " AND "), order, limit)

	var rows []BrokerStockAggRow
	if err := db.Select(&rows, q, args...); err != nil {
		return nil, fmt.Errorf("broker stock agg: %w", err)
	}
	return rows, nil
}

// BrokerStockDayRow is one broker's net on one stock on one date.
type BrokerStockDayRow struct {
	BrokerCode string    `db:"broker_code"`
	Symbol     string    `db:"symbol"`
	Date       time.Time `db:"date"`
	NetVal     float64   `db:"net_val"`
	NetLot     int64     `db:"net_lot"`
	BuyVal     float64   `db:"buy_val"`
	SellVal    float64   `db:"sell_val"`
	BuyLot     int64     `db:"buy_lot"`
	SellLot    int64     `db:"sell_lot"`
}

func (r BrokerStockDayRow) DateStr() string { return r.Date.Format("2006-01-02") }

// GetBrokerStockDaily returns the per-day breakdown for a bounded set of
// brokers and (optionally) symbols — the second step after
// GetBrokerStockAgg has narrowed the field down to what is displayed.
func GetBrokerStockDaily(db *sqlx.DB, from, to string, brokerCodes, symbols []string) ([]BrokerStockDayRow, error) {
	if len(brokerCodes) == 0 {
		return nil, nil
	}
	where := []string{"date BETWEEN ? AND ?", "broker_code IN (" + placeholders(len(brokerCodes)) + ")"}
	args := []any{from, to}
	for _, c := range brokerCodes {
		args = append(args, c)
	}
	if len(symbols) > 0 {
		where = append(where, "symbol IN ("+placeholders(len(symbols))+")")
		for _, s := range symbols {
			args = append(args, s)
		}
	}

	q := fmt.Sprintf(`
		SELECT broker_code, symbol, date,
		       SUM(CASE WHEN side = 'buy' THEN value ELSE -value END) AS net_val,
		       SUM(CASE WHEN side = 'buy' THEN lot   ELSE -lot   END) AS net_lot,
		       SUM(CASE WHEN side = 'buy'  THEN value ELSE 0 END) AS buy_val,
		       SUM(CASE WHEN side = 'sell' THEN value ELSE 0 END) AS sell_val,
		       SUM(CASE WHEN side = 'buy'  THEN lot   ELSE 0 END) AS buy_lot,
		       SUM(CASE WHEN side = 'sell' THEN lot   ELSE 0 END) AS sell_lot
		FROM broker_summary
		WHERE %s
		GROUP BY broker_code, symbol, date
		ORDER BY date ASC
	`, strings.Join(where, " AND "))

	var rows []BrokerStockDayRow
	if err := db.Select(&rows, q, args...); err != nil {
		return nil, fmt.Errorf("broker stock daily: %w", err)
	}
	return rows, nil
}

// GetSectors maps symbol -> sector for the symbols that have one recorded.
func GetSectors(db *sqlx.DB) (map[string]string, error) {
	var rows []struct {
		Code   string  `db:"code"`
		Sector *string `db:"sector"`
	}
	if err := db.Select(&rows, `SELECT code, sector FROM symbols`); err != nil {
		return nil, fmt.Errorf("get sectors: %w", err)
	}
	out := make(map[string]string, len(rows))
	for _, r := range rows {
		if r.Sector != nil && *r.Sector != "" {
			out[r.Code] = *r.Sector
		}
	}
	return out, nil
}

// LatestBrokerSummaryDate is the most recent date with any broker summary
// row — the anchor for "last N trading days" windows, since calendar days
// would silently include weekends and holidays.
func LatestBrokerSummaryDate(db *sqlx.DB) (string, error) {
	var d *time.Time
	if err := db.Get(&d, `SELECT MAX(date) FROM broker_summary`); err != nil {
		return "", fmt.Errorf("latest broker summary date: %w", err)
	}
	if d == nil {
		return "", nil
	}
	return d.Format("2006-01-02"), nil
}
