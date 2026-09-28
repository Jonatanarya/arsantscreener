package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type OutlookStateRow struct {
	Symbol    string    `db:"symbol"`
	Bias      string    `db:"bias"`
	Score     int       `db:"score"`
	UpdatedAt time.Time `db:"updated_at"`
}

// GetOutlookState returns nil (no error) if the symbol has never been
// observed yet — the caller treats a first observation as a baseline, not
// an alert-worthy change.
func GetOutlookState(db *sqlx.DB, symbol string) (*OutlookStateRow, error) {
	var row OutlookStateRow
	err := db.Get(&row, `SELECT symbol, bias, score, updated_at FROM outlook_state WHERE symbol = ?`, symbol)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get outlook state: %w", err)
	}
	return &row, nil
}

func UpsertOutlookState(db *sqlx.DB, symbol, bias string, score int) error {
	_, err := db.Exec(`
		INSERT INTO outlook_state (symbol, bias, score) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE bias = VALUES(bias), score = VALUES(score)
	`, symbol, bias, score)
	if err != nil {
		return fmt.Errorf("upsert outlook state: %w", err)
	}
	return nil
}

type NewOutlookAlert struct {
	Symbol  string
	OldBias *string
	NewBias string
	Score   int
}

func CreateOutlookAlert(db *sqlx.DB, a NewOutlookAlert) (int64, time.Time, error) {
	res, err := db.Exec(`
		INSERT INTO outlook_alerts (symbol, old_bias, new_bias, score) VALUES (?, ?, ?, ?)
	`, a.Symbol, a.OldBias, a.NewBias, a.Score)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("create outlook alert: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("create outlook alert: %w", err)
	}
	var createdAt time.Time
	if err := db.Get(&createdAt, `SELECT created_at FROM outlook_alerts WHERE id = ?`, id); err != nil {
		return 0, time.Time{}, fmt.Errorf("create outlook alert: reload created_at: %w", err)
	}
	return id, createdAt, nil
}

type OutlookAlertRow struct {
	ID        int64     `db:"id"`
	Symbol    string    `db:"symbol"`
	OldBias   *string   `db:"old_bias"`
	NewBias   string    `db:"new_bias"`
	Score     int       `db:"score"`
	CreatedAt time.Time `db:"created_at"`
}

func ListOutlookAlerts(db *sqlx.DB, limit int) ([]OutlookAlertRow, error) {
	var rows []OutlookAlertRow
	err := db.Select(&rows, `
		SELECT id, symbol, old_bias, new_bias, score, created_at
		FROM outlook_alerts ORDER BY created_at DESC, id DESC LIMIT ?
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list outlook alerts: %w", err)
	}
	return rows, nil
}

// ListUserOutlookAlerts returns alerts only for symbols saved in any of the
// user's watchlists. EXISTS avoids duplicate alerts when a symbol appears in
// more than one named list.
func ListUserOutlookAlerts(db *sqlx.DB, userID string, limit, minScore int, bullish, bearish, netral bool) ([]OutlookAlertRow, error) {
	var rows []OutlookAlertRow
	err := db.Select(&rows, `
		SELECT a.id, a.symbol, a.old_bias, a.new_bias, a.score, a.created_at
		FROM outlook_alerts a
		WHERE EXISTS (
			SELECT 1 FROM user_watchlist_items w
			WHERE w.user_id = ? AND w.symbol = a.symbol
		)
		AND ABS(a.score) >= ?
		AND ((? AND a.new_bias='BULLISH') OR (? AND a.new_bias='BEARISH') OR (? AND a.new_bias='NETRAL'))
		ORDER BY a.created_at DESC, a.id DESC LIMIT ?
	`, userID, minScore, bullish, bearish, netral, limit)
	if err != nil {
		return nil, fmt.Errorf("list user outlook alerts: %w", err)
	}
	return rows, nil
}
