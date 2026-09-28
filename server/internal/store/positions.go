package store

import (
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type PositionRow struct {
	ID         int64      `db:"id"`
	Symbol     string     `db:"symbol"`
	EntryDate  time.Time  `db:"entry_date"`
	EntryPrice float64    `db:"entry_price"`
	Lot        int64      `db:"lot"`
	StopLoss   *float64   `db:"stop_loss"`
	TakeProfit *float64   `db:"take_profit"`
	Notes      *string    `db:"notes"`
	Status     string     `db:"status"`
	ExitDate   *time.Time `db:"exit_date"`
	ExitPrice  *float64   `db:"exit_price"`
}

func (p PositionRow) EntryDateStr() string {
	return p.EntryDate.Format("2006-01-02")
}

func (p PositionRow) ExitDateStr() *string {
	if p.ExitDate == nil {
		return nil
	}
	s := p.ExitDate.Format("2006-01-02")
	return &s
}

type NewPosition struct {
	Symbol     string
	EntryDate  string
	EntryPrice float64
	Lot        int64
	StopLoss   *float64
	TakeProfit *float64
	Notes      *string
}

func CreatePosition(db *sqlx.DB, userID string, p NewPosition) (int64, error) {
	res, err := db.Exec(`
		INSERT INTO positions (user_id, symbol, entry_date, entry_price, lot, stop_loss, take_profit, notes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, userID, p.Symbol, p.EntryDate, p.EntryPrice, p.Lot, p.StopLoss, p.TakeProfit, p.Notes)
	if err != nil {
		return 0, fmt.Errorf("create position: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("create position: %w", err)
	}
	return id, nil
}

// ListPositions returns positions filtered by status ("open", "closed", or
// "" for all), most recently entered first.
func ListPositions(db *sqlx.DB, userID, status string) ([]PositionRow, error) {
	var rows []PositionRow
	query := `SELECT id, symbol, entry_date, entry_price, lot, stop_loss, take_profit, notes, status, exit_date, exit_price
	          FROM positions WHERE user_id = ?`
	args := []any{userID}
	if status != "" {
		query += ` AND status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY entry_date DESC, id DESC`
	if err := db.Select(&rows, query, args...); err != nil {
		return nil, fmt.Errorf("list positions: %w", err)
	}
	return rows, nil
}

func GetPosition(db *sqlx.DB, userID string, id int64) (*PositionRow, error) {
	var row PositionRow
	err := db.Get(&row, `
		SELECT id, symbol, entry_date, entry_price, lot, stop_loss, take_profit, notes, status, exit_date, exit_price
		FROM positions WHERE id = ? AND user_id = ?
	`, id, userID)
	if err != nil {
		return nil, fmt.Errorf("get position %d: %w", id, err)
	}
	return &row, nil
}

func ClosePosition(db *sqlx.DB, userID string, id int64, exitDate string, exitPrice float64) error {
	res, err := db.Exec(`
		UPDATE positions SET status = 'closed', exit_date = ?, exit_price = ?
		WHERE id = ? AND user_id = ? AND status = 'open'
	`, exitDate, exitPrice, id, userID)
	if err != nil {
		return fmt.Errorf("close position %d: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("close position %d: %w", id, err)
	}
	if n == 0 {
		return fmt.Errorf("position %d not found or already closed", id)
	}
	return nil
}

func DeletePosition(db *sqlx.DB, userID string, id int64) error {
	res, err := db.Exec(`DELETE FROM positions WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("delete position %d: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete position %d: %w", id, err)
	}
	if n == 0 {
		return fmt.Errorf("position %d not found", id)
	}
	return nil
}
