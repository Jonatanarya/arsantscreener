package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type ScreenerResult struct {
	Symbol      string          `db:"symbol" json:"symbol"`
	Date        string          `db:"date" json:"date"`
	Category    string          `db:"category" json:"category"` // bluechip, second, third
	ScoreAccum  int             `db:"score_accum" json:"scoreAccum"`
	ScoreTech   int             `db:"score_tech" json:"scoreTech"`
	ScorePVA    int             `db:"score_pva" json:"scorePva"`
	ScoreLiq    int             `db:"score_liq" json:"scoreLiq"`
	FitScalp    int             `db:"fit_scalp" json:"fitScalp"`
	FitDaytrade int             `db:"fit_daytrade" json:"fitDaytrade"`
	FitSwing    int             `db:"fit_swing" json:"fitSwing"`
	Tags        json.RawMessage `db:"tags" json:"tags"`
	TopBuyers   json.RawMessage `db:"top_buyers" json:"topBuyers"`
	TopSellers  json.RawMessage `db:"top_sellers" json:"topSellers"`
	UpdatedAt   time.Time       `db:"updated_at" json:"updatedAt"`
}

func EnsureScreenerTable(db *sqlx.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS screener_results (
		symbol VARCHAR(16) PRIMARY KEY,
		date VARCHAR(10) NOT NULL,
		category VARCHAR(32) NOT NULL DEFAULT 'second',
		score_accum INT NOT NULL DEFAULT 0,
		score_tech INT NOT NULL DEFAULT 0,
		score_pva INT NOT NULL DEFAULT 0,
		score_liq INT NOT NULL DEFAULT 0,
		fit_scalp INT NOT NULL DEFAULT 0,
		fit_daytrade INT NOT NULL DEFAULT 0,
		fit_swing INT NOT NULL DEFAULT 0,
		tags JSON,
		top_buyers JSON,
		top_sellers JSON,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
	_, err := db.Exec(schema)
	return err
}

func UpsertScreenerResults(db *sqlx.DB, items []ScreenerResult) error {
	if err := EnsureScreenerTable(db); err != nil {
		return err
	}
	query := `
	INSERT INTO screener_results (
		symbol, date, category, score_accum, score_tech, score_pva, score_liq,
		fit_scalp, fit_daytrade, fit_swing, tags, top_buyers, top_sellers, updated_at
	) VALUES (
		?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()
	) ON DUPLICATE KEY UPDATE
		date=VALUES(date),
		category=VALUES(category),
		score_accum=VALUES(score_accum),
		score_tech=VALUES(score_tech),
		score_pva=VALUES(score_pva),
		score_liq=VALUES(score_liq),
		fit_scalp=VALUES(fit_scalp),
		fit_daytrade=VALUES(fit_daytrade),
		fit_swing=VALUES(fit_swing),
		tags=VALUES(tags),
		top_buyers=VALUES(top_buyers),
		top_sellers=VALUES(top_sellers),
		updated_at=NOW();`

	for _, item := range items {
		if item.Symbol == "" {
			continue
		}
		if item.Date == "" {
			item.Date = time.Now().Format("2006-01-02")
		}
		if len(item.Tags) == 0 {
			item.Tags = json.RawMessage("[]")
		}
		if len(item.TopBuyers) == 0 {
			item.TopBuyers = json.RawMessage("[]")
		}
		if len(item.TopSellers) == 0 {
			item.TopSellers = json.RawMessage("[]")
		}
		_, err := db.Exec(query,
			item.Symbol, item.Date, item.Category, item.ScoreAccum, item.ScoreTech,
			item.ScorePVA, item.ScoreLiq, item.FitScalp, item.FitDaytrade, item.FitSwing,
			item.Tags, item.TopBuyers, item.TopSellers,
		)
		if err != nil {
			return fmt.Errorf("upsert screener %s: %w", item.Symbol, err)
		}
	}
	return nil
}

func GetScreenerMap(db *sqlx.DB) (map[string]ScreenerResult, error) {
	if err := EnsureScreenerTable(db); err != nil {
		return nil, err
	}
	var rows []ScreenerResult
	err := db.Select(&rows, `SELECT symbol, date, category, score_accum, score_tech, score_pva, score_liq, fit_scalp, fit_daytrade, fit_swing, tags, top_buyers, top_sellers, updated_at FROM screener_results`)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	res := make(map[string]ScreenerResult)
	for _, r := range rows {
		res[r.Symbol] = r
	}
	return res, nil
}
