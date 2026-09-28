package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type LiquidityStateRow struct {
	Symbol    string    `db:"symbol"`
	Level     string    `db:"level"`
	Score     int       `db:"score"`
	UpdatedAt time.Time `db:"updated_at"`
}

// GetLiquidityState returns nil (no error) if the symbol has never been
// observed yet — the caller treats a first observation as a baseline, not
// an alert-worthy change (same contract as GetOutlookState).
func GetLiquidityState(db *sqlx.DB, symbol string) (*LiquidityStateRow, error) {
	var row LiquidityStateRow
	err := db.Get(&row, `SELECT symbol, level, score, updated_at FROM liquidity_alert_state WHERE symbol = ?`, symbol)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get liquidity state: %w", err)
	}
	return &row, nil
}

func UpsertLiquidityState(db *sqlx.DB, symbol, level string, score int) error {
	_, err := db.Exec(`
		INSERT INTO liquidity_alert_state (symbol, level, score) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE level = VALUES(level), score = VALUES(score)
	`, symbol, level, score)
	if err != nil {
		return fmt.Errorf("upsert liquidity state: %w", err)
	}
	return nil
}

type NewLiquidityAlert struct {
	Symbol   string
	OldLevel *string
	NewLevel string
	Score    int
	Reasons  []string
}

func CreateLiquidityAlert(db *sqlx.DB, a NewLiquidityAlert) (int64, time.Time, error) {
	reasons, err := json.Marshal(a.Reasons)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("create liquidity alert: marshal reasons: %w", err)
	}
	res, err := db.Exec(`
		INSERT INTO liquidity_alerts (symbol, old_level, new_level, score, reasons) VALUES (?, ?, ?, ?, ?)
	`, a.Symbol, a.OldLevel, a.NewLevel, a.Score, nullableJSON(reasons))
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("create liquidity alert: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("create liquidity alert: %w", err)
	}
	var createdAt time.Time
	if err := db.Get(&createdAt, `SELECT created_at FROM liquidity_alerts WHERE id = ?`, id); err != nil {
		return 0, time.Time{}, fmt.Errorf("create liquidity alert: reload created_at: %w", err)
	}
	return id, createdAt, nil
}

type LiquidityAlertRow struct {
	ID        int64           `db:"id"`
	Symbol    string          `db:"symbol"`
	OldLevel  *string         `db:"old_level"`
	NewLevel  string          `db:"new_level"`
	Score     int             `db:"score"`
	Reasons   json.RawMessage `db:"reasons"`
	CreatedAt time.Time       `db:"created_at"`
}

func ListLiquidityAlerts(db *sqlx.DB, limit int) ([]LiquidityAlertRow, error) {
	var rows []LiquidityAlertRow
	err := db.Select(&rows, `
		SELECT id, symbol, old_level, new_level, score,
		       COALESCE(reasons, CAST('null' AS JSON)) AS reasons, created_at
		FROM liquidity_alerts ORDER BY created_at DESC, id DESC LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list liquidity alerts: %w", err)
	}
	return rows, nil
}

// LiquidityCandidateRow is a symbol currently sitting in a non-normal
// level — the "who should get running trade / broker summary daily today"
// screener list, cheaper than paging through liquidity_alerts history.
type LiquidityCandidateRow struct {
	Symbol    string    `db:"symbol"`
	Level     string    `db:"level"`
	Score     int       `db:"score"`
	UpdatedAt time.Time `db:"updated_at"`
}

// ListLiquidityCandidates returns symbols whose latest observed level isn't
// "normal", newest change first — the gate the bridge extension (or a human
// picking a custom crawl list) checks before spending running-trade budget
// on a symbol.
func ListLiquidityCandidates(db *sqlx.DB, limit int) ([]LiquidityCandidateRow, error) {
	var rows []LiquidityCandidateRow
	err := db.Select(&rows, `
		SELECT symbol, level, score, updated_at
		FROM liquidity_alert_state
		WHERE level <> 'normal'
		ORDER BY updated_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list liquidity candidates: %w", err)
	}
	return rows, nil
}
