package store

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type BrokerSummaryHealth struct {
	Status              string    `json:"status"`
	TargetDate          string    `json:"targetDate"`
	LatestAvailableDate string    `json:"latestAvailableDate,omitempty"`
	TargetSymbols       int       `json:"targetSymbols"`
	FreshSymbols        int       `json:"freshSymbols"`
	StaleSymbols        int       `json:"staleSymbols"`
	MissingSymbols      int       `json:"missingSymbols"`
	CoveragePercent     float64   `json:"coveragePercent"`
	RowsOnTargetDate    uint64    `json:"rowsOnTargetDate"`
	Stale               []string  `json:"stale"`
	Missing             []string  `json:"missing"`
	CheckedAt           time.Time `json:"checkedAt"`
}

type brokerSymbolHealthRow struct {
	Symbol     string       `db:"symbol"`
	LatestDate sql.NullTime `db:"latest_date"`
	TargetRows uint64       `db:"target_rows"`
}

func LatestOverallBarDate(ctx context.Context, db *sqlx.DB) (*time.Time, error) {
	var latest sql.NullTime
	if err := db.GetContext(ctx, &latest, `SELECT MAX(date) FROM bars_daily`); err != nil {
		return nil, fmt.Errorf("latest overall bar date: %w", err)
	}
	if !latest.Valid {
		return nil, nil
	}
	value := latest.Time
	return &value, nil
}

func ReadBrokerSummaryHealth(ctx context.Context, db *sqlx.DB, targetDate time.Time, symbolLimit int) (BrokerSummaryHealth, error) {
	health := BrokerSummaryHealth{
		TargetDate: targetDate.Format("2006-01-02"), CheckedAt: time.Now().UTC(),
		Stale: make([]string, 0), Missing: make([]string, 0),
	}
	symbols, err := ListLiquidSymbolsForEOD(ctx, db, symbolLimit)
	if err != nil {
		return health, err
	}
	health.TargetSymbols = len(symbols)
	if len(symbols) == 0 {
		health.Status = "critical"
		return health, nil
	}

	query, args, err := sqlx.In(`SELECT symbol, MAX(date) AS latest_date,
		SUM(date=?) AS target_rows FROM broker_summary
		WHERE symbol IN (?) GROUP BY symbol`, health.TargetDate, symbols)
	if err != nil {
		return health, fmt.Errorf("broker summary health query: %w", err)
	}
	var rows []brokerSymbolHealthRow
	if err := db.SelectContext(ctx, &rows, db.Rebind(query), args...); err != nil {
		return health, fmt.Errorf("read broker summary health: %w", err)
	}
	bySymbol := make(map[string]brokerSymbolHealthRow, len(rows))
	var latest time.Time
	for _, row := range rows {
		bySymbol[row.Symbol] = row
		if row.LatestDate.Valid && row.LatestDate.Time.After(latest) {
			latest = row.LatestDate.Time
		}
	}
	if !latest.IsZero() {
		health.LatestAvailableDate = latest.Format("2006-01-02")
	}
	for _, symbol := range symbols {
		row, ok := bySymbol[symbol]
		if !ok || !row.LatestDate.Valid {
			health.Missing = append(health.Missing, symbol)
			continue
		}
		if row.TargetRows == 0 {
			health.Stale = append(health.Stale, symbol)
			continue
		}
		health.FreshSymbols++
		health.RowsOnTargetDate += row.TargetRows
	}
	sort.Strings(health.Stale)
	sort.Strings(health.Missing)
	health.StaleSymbols = len(health.Stale)
	health.MissingSymbols = len(health.Missing)
	health.CoveragePercent = float64(health.FreshSymbols) * 100 / float64(health.TargetSymbols)
	health.Status = brokerHealthStatus(health.FreshSymbols, health.TargetSymbols)
	return health, nil
}

func brokerHealthStatus(fresh, total int) string {
	if total > 0 && fresh == total {
		return "healthy"
	}
	if total > 0 && float64(fresh)/float64(total) >= 0.95 {
		return "degraded"
	}
	return "critical"
}

func RecordDataSourceHealth(ctx context.Context, db *sqlx.DB, code, status, message string) error {
	status = strings.TrimSpace(status)
	if status == "healthy" {
		_, err := db.ExecContext(ctx, `UPDATE data_sources SET status='ready',
			last_success_at=UTC_TIMESTAMP(), last_error_at=NULL, last_error=NULL WHERE code=?`, code)
		return err
	}
	if len(message) > 1000 {
		message = message[:1000]
	}
	_, err := db.ExecContext(ctx, `UPDATE data_sources SET status=?, last_error_at=UTC_TIMESTAMP(),
		last_error=? WHERE code=?`, status, message, code)
	return err
}
