package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type BrokerRowInput struct {
	Symbol     string
	Date       string
	BrokerCode string
	Side       string // "buy" | "sell"
	Value      float64
	Lot        int64
	Freq       int
	// Domisili ALIRAN DANA-nya, apa adanya dari Stockbit ("Asing"/"Lokal") —
	// BUKAN kebangsaan brokernya. Dua hal yang berbeda dan sering tertukar:
	// YU (CGS International) broker asing, tapi barisnya bisa bertipe "Lokal"
	// kalau yang bertransaksi lewat dia adalah investor domestik.
	InvestorType string
}

// UpsertBrokerSummary writes broker buy/sell rows inside a single transaction.
func UpsertBrokerSummary(db *sqlx.DB, rows []BrokerRowInput) error {
	if len(rows) == 0 {
		return nil
	}

	tx, err := db.Beginx()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Preparex(`
		INSERT INTO broker_summary (symbol, date, broker_code, side, lot, value, freq, investor_type)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			lot = VALUES(lot), value = VALUES(value), freq = VALUES(freq),
			investor_type = VALUES(investor_type)
	`)
	if err != nil {
		return fmt.Errorf("prepare upsert broker_summary: %w", err)
	}
	defer stmt.Close()

	for _, r := range rows {
		if _, err := stmt.Exec(
			r.Symbol, r.Date, r.BrokerCode, r.Side, r.Lot, r.Value, r.Freq, r.InvestorType,
		); err != nil {
			return fmt.Errorf("upsert broker row %s %s %s: %w", r.Symbol, r.Date, r.BrokerCode, err)
		}
	}

	return tx.Commit()
}

func BrokerSummaryCoverage(ctx context.Context, db *sqlx.DB, symbol string) (uint64, *time.Time, error) {
	var row struct {
		Count  uint64       `db:"count"`
		Latest sql.NullTime `db:"latest"`
	}
	if err := db.GetContext(ctx, &row, `SELECT COUNT(*) AS count, MAX(date) AS latest
		FROM broker_summary WHERE symbol=?`, symbol); err != nil {
		return 0, nil, fmt.Errorf("broker summary coverage %s: %w", symbol, err)
	}
	if !row.Latest.Valid {
		return row.Count, nil, nil
	}
	latest := row.Latest.Time
	return row.Count, &latest, nil
}

type BrokerRowOut struct {
	BrokerCode   string  `db:"broker_code"`
	Value        float64 `db:"value"`
	Lot          int64   `db:"lot"`
	Freq         int     `db:"freq"`
	InvestorType string  `db:"investor_type"`
}

// GetBrokerSummaryDay returns buyers and sellers separately for one
// symbol+date, ordered by value descending (biggest players first).
func GetBrokerSummaryDay(db *sqlx.DB, symbol, date string) (buyers, sellers []BrokerRowOut, err error) {
	if err = db.Select(&buyers, `
		SELECT broker_code, value, lot, freq, investor_type FROM broker_summary
		WHERE symbol = ? AND date = ? AND side = 'buy'
		ORDER BY value DESC
	`, symbol, date); err != nil {
		return nil, nil, fmt.Errorf("get buyers %s %s: %w", symbol, date, err)
	}
	if err = db.Select(&sellers, `
		SELECT broker_code, value, lot, freq, investor_type FROM broker_summary
		WHERE symbol = ? AND date = ? AND side = 'sell'
		ORDER BY value DESC
	`, symbol, date); err != nil {
		return nil, nil, fmt.Errorf("get sellers %s %s: %w", symbol, date, err)
	}
	return buyers, sellers, nil
}

type BrokerSummaryRangeRow struct {
	Date       time.Time `db:"date"`
	BrokerCode string    `db:"broker_code"`
	Side       string    `db:"side"`
	Value      float64   `db:"value"`
	Lot        int64     `db:"lot"`
	Freq       int       `db:"freq"`
}

// DateStr formats the DATE column as plain YYYY-MM-DD (same rationale as
// BarRow.DateStr — parseTime=true hands back a time.Time).
func (r BrokerSummaryRangeRow) DateStr() string {
	return r.Date.Format("2006-01-02")
}

// GetBrokerSummaryRange returns every broker_summary row for one symbol
// between from/to (inclusive), across all brokers and both sides — the raw
// material for phase detection, which needs the full per-day/per-broker
// breakdown rather than just buyers/sellers of a single day.
func GetBrokerSummaryRange(db *sqlx.DB, symbol, from, to string) ([]BrokerSummaryRangeRow, error) {
	var rows []BrokerSummaryRangeRow
	err := db.Select(&rows, `
		SELECT date, broker_code, side, value, lot, freq
		FROM broker_summary
		WHERE symbol = ? AND date BETWEEN ? AND ?
		ORDER BY date ASC
	`, symbol, from, to)
	if err != nil {
		return nil, fmt.Errorf("get broker summary range %s: %w", symbol, err)
	}
	return rows, nil
}

type BrokerAggRow struct {
	BrokerCode   string  `db:"broker_code"`
	Side         string  `db:"side"`
	Value        float64 `db:"value"`
	Lot          int64   `db:"lot"`
	Freq         int     `db:"freq"`
	InvestorType string  `db:"investor_type"`
}

type BrokerSummaryAvailability struct {
	DailyFrom *string `json:"dailyFrom,omitempty"`
	DailyTo   *string `json:"dailyTo,omitempty"`
	DailyRows int64   `json:"dailyRows"`
	RangeFrom *string `json:"rangeFrom,omitempty"`
	RangeTo   *string `json:"rangeTo,omitempty"`
	RangeRows int64   `json:"rangeRows"`
}

func GetBrokerSummaryAvailability(db *sqlx.DB, symbol string) (BrokerSummaryAvailability, error) {
	var out BrokerSummaryAvailability
	var dailyFrom, dailyTo, rangeFrom, rangeTo sql.NullString
	if err := db.QueryRow(`SELECT DATE_FORMAT(MIN(date),'%Y-%m-%d'), DATE_FORMAT(MAX(date),'%Y-%m-%d'), COUNT(*) FROM broker_summary WHERE symbol=?`, symbol).Scan(&dailyFrom, &dailyTo, &out.DailyRows); err != nil {
		return out, fmt.Errorf("broker daily availability %s: %w", symbol, err)
	}
	if err := db.QueryRow(`SELECT DATE_FORMAT(MIN(from_date),'%Y-%m-%d'), DATE_FORMAT(MAX(to_date),'%Y-%m-%d'), COUNT(*) FROM broker_range_agg WHERE symbol=?`, symbol).Scan(&rangeFrom, &rangeTo, &out.RangeRows); err != nil {
		return out, fmt.Errorf("broker range availability %s: %w", symbol, err)
	}
	if dailyFrom.Valid {
		out.DailyFrom = &dailyFrom.String
	}
	if dailyTo.Valid {
		out.DailyTo = &dailyTo.String
	}
	if rangeFrom.Valid {
		out.RangeFrom = &rangeFrom.String
	}
	if rangeTo.Valid {
		out.RangeTo = &rangeTo.String
	}
	return out, nil
}

// GetBrokerSummaryAggregate sums buy/sell value+lot+freq per broker across
// the whole date range in one query — the display counterpart to
// GetBrokerSummaryRange (which returns raw per-day rows for phase
// detection's sliding window). Aggregating in SQL rather than pulling every
// row into Go matters here: a full year for a liquid stock is 20k+ rows.
func GetBrokerSummaryAggregate(db *sqlx.DB, symbol, from, to string) ([]BrokerAggRow, error) {
	var rows []BrokerAggRow
	err := db.Select(&rows, `
		SELECT broker_code, side, SUM(value) AS value, SUM(lot) AS lot, SUM(freq) AS freq,
			IF(COUNT(DISTINCT NULLIF(investor_type,'')) = 1, MAX(investor_type),
			   IF(COUNT(DISTINCT NULLIF(investor_type,'')) = 0, '', 'Campuran')) AS investor_type
		FROM broker_summary
		WHERE symbol = ? AND date BETWEEN ? AND ?
		GROUP BY broker_code, side
		ORDER BY broker_code ASC
	`, symbol, from, to)
	if err != nil {
		return nil, fmt.Errorf("get broker summary aggregate %s: %w", symbol, err)
	}
	if len(rows) > 0 {
		return rows, nil
	}

	// Belum ada data HARIAN untuk rentang ini. Data Collector mengambil broker
	// summary per rentang (satu request per tahun) jauh lebih murah daripada per
	// hari, dan hasilnya mendarat di broker_range_agg. Angkanya sama-sama total
	// per broker, cuma tanpa granularitas harian — cukup untuk tampilan rentang.
	//
	// Hanya jendela yang SELURUHNYA berada di dalam [from, to] yang dipakai, agar
	// tidak ada nilai di luar rentang yang ikut terhitung. Jendela collector tidak
	// saling tumpang tindih, jadi penjumlahannya aman.
	err = db.Select(&rows, `
		SELECT broker_code, side, SUM(value) AS value, SUM(lot) AS lot, SUM(freq) AS freq,
			IF(COUNT(DISTINCT NULLIF(investor_type,'')) = 1, MAX(investor_type),
			   IF(COUNT(DISTINCT NULLIF(investor_type,'')) = 0, '', 'Campuran')) AS investor_type
		FROM broker_range_agg
		WHERE symbol = ? AND from_date >= ? AND to_date <= ?
		GROUP BY broker_code, side
		ORDER BY broker_code ASC
	`, symbol, from, to)
	if err != nil {
		return nil, fmt.Errorf("get broker range agg %s: %w", symbol, err)
	}
	return rows, nil
}
