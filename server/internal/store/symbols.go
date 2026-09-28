package store

import (
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type SymbolQuote struct {
	Code      string     `db:"code"`
	Name      string     `db:"name"`
	Sector    *string    `db:"sector"`
	Date      *time.Time `db:"date"`
	Close     *float64   `db:"close"`
	Volume    *int64     `db:"volume"`
	PrevClose *float64   `db:"prev_close"`
}

// ListSymbolQuotes obtains all symbols and their latest two closes in one
// database round-trip. This replaces one query per symbol on every watchlist load.
func ListSymbolQuotes(db *sqlx.DB) ([]SymbolQuote, error) {
	var rows []SymbolQuote
	err := db.Select(&rows, `WITH ranked AS (
		SELECT symbol,date,close,volume,ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
		FROM bars_daily
	)
	SELECT s.code,s.name,s.sector,
		MAX(CASE WHEN r.rn=1 THEN r.date END) AS date,
		MAX(CASE WHEN r.rn=1 THEN r.close END) AS close,
		MAX(CASE WHEN r.rn=1 THEN r.volume END) AS volume,
		MAX(CASE WHEN r.rn=2 THEN r.close END) AS prev_close
	FROM symbols s LEFT JOIN ranked r ON r.symbol=s.code AND r.rn<=2
	GROUP BY s.code,s.name,s.sector ORDER BY s.code`)
	if err != nil {
		return nil, fmt.Errorf("list symbol quotes: %w", err)
	}
	return rows, nil
}

// EnsureSymbol inserts a bare symbol row if it doesn't exist yet, so
// ingestion never fails just because the watchlist metadata hasn't been
// populated. Name/sector enrichment happens separately.
func EnsureSymbol(db *sqlx.DB, code string) error {
	_, err := db.Exec(
		`INSERT INTO symbols (code, name) VALUES (?, ?)
		 ON DUPLICATE KEY UPDATE code = code`,
		code, code,
	)
	return err
}

func UpsertSymbolMetadata(db *sqlx.DB, code, name, sector string) error {
	code = strings.ToUpper(strings.TrimSpace(code))
	name = strings.TrimSpace(name)
	sector = strings.TrimSpace(sector)
	if code == "" {
		return nil
	}
	if name == "" {
		name = code
	}
	_, err := db.Exec(`INSERT INTO symbols (code,name,sector) VALUES (?,?,NULLIF(?,''))
		ON DUPLICATE KEY UPDATE
		name=IF(VALUES(name)<>'' AND VALUES(name)<>VALUES(code),VALUES(name),name),
		sector=COALESCE(NULLIF(VALUES(sector),''),sector)`, code, name, sector)
	return err
}

func SearchSymbols(db *sqlx.DB, query string, limit int) ([]Symbol, error) {
	query = strings.ToUpper(strings.TrimSpace(query))
	if limit < 1 || limit > 20 {
		limit = 8
	}
	var rows []Symbol
	like := "%" + query + "%"
	prefix := query + "%"
	err := db.Select(&rows, `SELECT code,name,sector FROM symbols
		WHERE UPPER(code) LIKE ? OR UPPER(name) LIKE ?
		ORDER BY CASE WHEN UPPER(code)=? THEN 0 WHEN UPPER(code) LIKE ? THEN 1 WHEN UPPER(name) LIKE ? THEN 2 ELSE 3 END, code
		LIMIT ?`, like, like, query, prefix, prefix, limit)
	if err != nil {
		return nil, fmt.Errorf("search symbols: %w", err)
	}
	return rows, nil
}

type Symbol struct {
	Code   string  `db:"code"`
	Name   string  `db:"name"`
	Sector *string `db:"sector"`
}

func ListSymbols(db *sqlx.DB) ([]Symbol, error) {
	var rows []Symbol
	if err := db.Select(&rows, `SELECT code, name, sector FROM symbols ORDER BY code`); err != nil {
		return nil, fmt.Errorf("list symbols: %w", err)
	}
	return rows, nil
}

// GetSymbolsByCodes looks up sector/name for a specific set of symbols —
// used to enrich a portfolio's (typically small) distinct symbol list
// without pulling the entire watchlist.
func GetSymbolsByCodes(db *sqlx.DB, codes []string) ([]Symbol, error) {
	if len(codes) == 0 {
		return nil, nil
	}
	query, args, err := sqlx.In(`SELECT code, name, sector FROM symbols WHERE code IN (?)`, codes)
	if err != nil {
		return nil, fmt.Errorf("get symbols by codes: %w", err)
	}
	query = db.Rebind(query)
	var rows []Symbol
	if err := db.Select(&rows, query, args...); err != nil {
		return nil, fmt.Errorf("get symbols by codes: %w", err)
	}
	return rows, nil
}
