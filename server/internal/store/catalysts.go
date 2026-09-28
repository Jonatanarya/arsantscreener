package store

import (
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type CatalystRow struct {
	ID             int64     `db:"id"`
	Symbol         string    `db:"symbol"`
	Category       string    `db:"category"`
	Description    string    `db:"description"`
	Impact         string    `db:"impact"`
	ExpectedPeriod *string   `db:"expected_period"`
	Status         string    `db:"status"`
	SourceURL      *string   `db:"source_url"`
	SourceName     *string   `db:"source_name"`
	Confidence     *string   `db:"confidence"`
	AddedBy        string    `db:"added_by"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}

func ListCatalysts(db *sqlx.DB, symbol string) ([]CatalystRow, error) {
	var rows []CatalystRow
	err := db.Select(&rows, `
		SELECT * FROM catalysts WHERE symbol = ?
		ORDER BY expected_period IS NULL, expected_period ASC, created_at ASC
	`, symbol)
	if err != nil {
		return nil, fmt.Errorf("list catalysts: %w", err)
	}
	return rows, nil
}

type NewCatalyst struct {
	Symbol         string
	Category       string
	Description    string
	Impact         string
	ExpectedPeriod *string
	Status         string
	SourceURL      *string
	SourceName     *string
	Confidence     *string
	AddedBy        string
}

func CreateCatalyst(db *sqlx.DB, c NewCatalyst) (int64, error) {
	res, err := db.Exec(`
		INSERT INTO catalysts (
			symbol, category, description, impact, expected_period, status,
			source_url, source_name, confidence, added_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, c.Symbol, c.Category, c.Description, c.Impact, c.ExpectedPeriod, c.Status,
		c.SourceURL, c.SourceName, c.Confidence, c.AddedBy)
	if err != nil {
		return 0, fmt.Errorf("create catalyst: %w", err)
	}
	return res.LastInsertId()
}

type CatalystUpdate struct {
	Category       string
	Description    string
	Impact         string
	ExpectedPeriod *string
	Status         string
	SourceURL      *string
	SourceName     *string
	Confidence     *string
}

func UpdateCatalyst(db *sqlx.DB, id int64, u CatalystUpdate) error {
	res, err := db.Exec(`
		UPDATE catalysts SET
			category = ?, description = ?, impact = ?, expected_period = ?, status = ?,
			source_url = ?, source_name = ?, confidence = ?
		WHERE id = ?
	`, u.Category, u.Description, u.Impact, u.ExpectedPeriod, u.Status,
		u.SourceURL, u.SourceName, u.Confidence, id)
	if err != nil {
		return fmt.Errorf("update catalyst: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update catalyst: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("catalyst %d not found", id)
	}
	return nil
}

func DeleteCatalyst(db *sqlx.DB, id int64) error {
	_, err := db.Exec(`DELETE FROM catalysts WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete catalyst: %w", err)
	}
	return nil
}
