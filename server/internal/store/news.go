package store

import (
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type NewsInput struct {
	ExtID     string
	Symbol    *string
	Title     string
	Summary   *string
	URL       *string
	Source    *string
	Topic     string
	Sentiment string
	PostedAt  *time.Time
	Impacts   []NewsImpactInput
}

type NewsImpactInput struct {
	Symbol     string
	Sentiment  string
	Confidence float64
	Reason     string
}

// UpsertNews inserts captured items, silently skipping ones already stored
// (ext_id unique key) — the extension re-sends whatever it sees on screen.
func UpsertNews(db *sqlx.DB, rows []NewsInput) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := db.Beginx()
	if err != nil {
		return fmt.Errorf("upsert news: %w", err)
	}
	defer tx.Rollback()
	stmt, err := tx.Preparex(`
		INSERT INTO news (ext_id, symbol, title, summary, url, source, topic, sentiment, posted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), symbol=VALUES(symbol),
			title=VALUES(title), summary=VALUES(summary), url=VALUES(url),
			source=VALUES(source), topic=VALUES(topic), sentiment=VALUES(sentiment),
			posted_at=VALUES(posted_at)
	`)
	if err != nil {
		return fmt.Errorf("upsert news: %w", err)
	}
	defer stmt.Close()
	for _, r := range rows {
		topic := r.Topic
		if topic == "" {
			topic = "MARKET"
		}
		sentiment := r.Sentiment
		if sentiment == "" {
			sentiment = "NETRAL"
		}
		result, err := stmt.Exec(r.ExtID, r.Symbol, r.Title, r.Summary, r.URL, r.Source, topic, sentiment, r.PostedAt)
		if err != nil {
			return fmt.Errorf("upsert news: %w", err)
		}
		newsID, err := result.LastInsertId()
		if err != nil {
			return fmt.Errorf("upsert news id: %w", err)
		}
		if _, err := tx.Exec(`DELETE FROM news_impacts WHERE news_id=?`, newsID); err != nil {
			return fmt.Errorf("reset news impacts: %w", err)
		}
		for _, impact := range r.Impacts {
			if _, err := tx.Exec(`INSERT INTO news_impacts
				(news_id, symbol, sentiment, confidence, reason) VALUES (?, ?, ?, ?, ?)`,
				newsID, impact.Symbol, impact.Sentiment, impact.Confidence, impact.Reason); err != nil {
				return fmt.Errorf("upsert news impact: %w", err)
			}
		}
	}
	return tx.Commit()
}

type NewsRow struct {
	ID        int64        `db:"id"`
	Symbol    *string      `db:"symbol"`
	Title     string       `db:"title"`
	Summary   *string      `db:"summary"`
	URL       *string      `db:"url"`
	Source    *string      `db:"source"`
	Topic     string       `db:"topic"`
	Sentiment string       `db:"sentiment"`
	PostedAt  *time.Time   `db:"posted_at"`
	CreatedAt time.Time    `db:"created_at"`
	Impacts   []NewsImpact `db:"-"`
}

type NewsImpact struct {
	Symbol     string  `db:"symbol" json:"symbol"`
	Sentiment  string  `db:"sentiment" json:"sentiment"`
	Confidence float64 `db:"confidence" json:"confidence"`
	Reason     *string `db:"reason" json:"reason,omitempty"`
}

func ListNews(db *sqlx.DB, symbol string, limit int) ([]NewsRow, error) {
	var rows []NewsRow
	var err error
	if symbol != "" {
		err = db.Select(&rows, `
			SELECT DISTINCT n.id, n.symbol, n.title, n.summary, n.url, n.source,
				n.topic, n.sentiment, n.posted_at, n.created_at
			FROM news n LEFT JOIN news_impacts i ON i.news_id=n.id
			WHERE n.symbol=? OR i.symbol=?
			ORDER BY COALESCE(n.posted_at, n.created_at) DESC LIMIT ?
		`, symbol, symbol, limit)
	} else {
		err = db.Select(&rows, `
			SELECT id, symbol, title, summary, url, source, topic, sentiment, posted_at, created_at FROM news
			ORDER BY COALESCE(posted_at, created_at) DESC LIMIT ?
		`, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("list news: %w", err)
	}
	if len(rows) == 0 {
		return rows, nil
	}
	ids := make([]int64, len(rows))
	rowIndex := make(map[int64]int, len(rows))
	for i := range rows {
		ids[i] = rows[i].ID
		rowIndex[rows[i].ID] = i
		rows[i].Impacts = make([]NewsImpact, 0)
	}
	query, args, err := sqlx.In(`SELECT news_id, symbol, sentiment, confidence, reason
		FROM news_impacts WHERE news_id IN (?) ORDER BY news_id, confidence DESC, symbol`, ids)
	if err != nil {
		return nil, fmt.Errorf("list news impacts query: %w", err)
	}
	var impacts []struct {
		NewsID uint64 `db:"news_id"`
		NewsImpact
	}
	if err := db.Select(&impacts, db.Rebind(query), args...); err != nil {
		return nil, fmt.Errorf("list news impacts: %w", err)
	}
	for _, impact := range impacts {
		if index, ok := rowIndex[int64(impact.NewsID)]; ok {
			rows[index].Impacts = append(rows[index].Impacts, impact.NewsImpact)
		}
	}
	return rows, nil
}

func NewsCoverage(db *sqlx.DB) (uint64, *time.Time, error) {
	var row struct {
		Count  uint64     `db:"count"`
		Latest *time.Time `db:"latest"`
	}
	if err := db.Get(&row, `SELECT COUNT(*) AS count, MAX(posted_at) AS latest FROM news`); err != nil {
		return 0, nil, fmt.Errorf("news coverage: %w", err)
	}
	return row.Count, row.Latest, nil
}
