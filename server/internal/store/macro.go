package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type MacroQuoteRow struct {
	Ticker        string    `db:"ticker"`
	Name          string    `db:"name"`
	Price         float64   `db:"price"`
	Currency      string    `db:"currency"`
	ChangePercent float64   `db:"change_percent"`
	FetchedAt     time.Time `db:"fetched_at"`
}

func GetMacroQuote(db *sqlx.DB, ticker string) (*MacroQuoteRow, error) {
	var row MacroQuoteRow
	err := db.Get(&row, `SELECT * FROM macro_quotes WHERE ticker = ?`, ticker)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get macro quote: %w", err)
	}
	return &row, nil
}

func ListMacroQuotes(db *sqlx.DB, tickers []string) ([]MacroQuoteRow, error) {
	if len(tickers) == 0 {
		return nil, nil
	}
	query, args, err := sqlx.In(`SELECT * FROM macro_quotes WHERE ticker IN (?)`, tickers)
	if err != nil {
		return nil, fmt.Errorf("list macro quotes: %w", err)
	}
	query = db.Rebind(query)
	var rows []MacroQuoteRow
	if err := db.Select(&rows, query, args...); err != nil {
		return nil, fmt.Errorf("list macro quotes: %w", err)
	}
	return rows, nil
}

func UpsertMacroQuote(db *sqlx.DB, q MacroQuoteRow) error {
	_, err := db.NamedExec(`
		INSERT INTO macro_quotes (ticker, name, price, currency, change_percent)
		VALUES (:ticker, :name, :price, :currency, :change_percent)
		ON DUPLICATE KEY UPDATE
			name = VALUES(name), price = VALUES(price), currency = VALUES(currency),
			change_percent = VALUES(change_percent), fetched_at = CURRENT_TIMESTAMP
	`, q)
	if err != nil {
		return fmt.Errorf("upsert macro quote: %w", err)
	}
	return nil
}

type MacroSensitivityRow struct {
	ID              int64     `db:"id"`
	Symbol          string    `db:"symbol"`
	Factor          string    `db:"factor"`
	ImpactDirection string    `db:"impact_direction"`
	Note            *string   `db:"note"`
	CreatedAt       time.Time `db:"created_at"`
}

func ListMacroSensitivity(db *sqlx.DB, symbol string) ([]MacroSensitivityRow, error) {
	var rows []MacroSensitivityRow
	err := db.Select(&rows, `
		SELECT * FROM macro_sensitivity WHERE symbol = ? ORDER BY created_at ASC, id ASC
	`, symbol)
	if err != nil {
		return nil, fmt.Errorf("list macro sensitivity: %w", err)
	}
	return rows, nil
}

// ListMacroSensitivityAll returns every tag across all symbols — used by the
// Macro dashboard to figure out which watchlist symbols are exposed to a
// factor that moved significantly today.
func ListMacroSensitivityAll(db *sqlx.DB) ([]MacroSensitivityRow, error) {
	var rows []MacroSensitivityRow
	if err := db.Select(&rows, `SELECT * FROM macro_sensitivity ORDER BY symbol ASC, created_at ASC`); err != nil {
		return nil, fmt.Errorf("list all macro sensitivity: %w", err)
	}
	return rows, nil
}

type NewMacroSensitivity struct {
	Symbol          string
	Factor          string
	ImpactDirection string
	Note            *string
}

func CreateMacroSensitivity(db *sqlx.DB, s NewMacroSensitivity) (int64, error) {
	res, err := db.Exec(`
		INSERT INTO macro_sensitivity (symbol, factor, impact_direction, note)
		VALUES (?, ?, ?, ?)
	`, s.Symbol, s.Factor, s.ImpactDirection, s.Note)
	if err != nil {
		return 0, fmt.Errorf("create macro sensitivity: %w", err)
	}
	return res.LastInsertId()
}

func DeleteMacroSensitivity(db *sqlx.DB, id int64) error {
	_, err := db.Exec(`DELETE FROM macro_sensitivity WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete macro sensitivity: %w", err)
	}
	return nil
}
