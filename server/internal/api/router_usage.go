package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite"
)

// The gateway is read-only. Our ledger keeps usage after keys or source logs
// are removed. Hashes identify keys without retaining their plaintext secrets.
type routerUsage struct {
	db     *sqlx.DB
	source *sql.DB
	mu     sync.Mutex
}

func newRouterUsage(db *sqlx.DB, path string) (*routerUsage, error) {
	if path == "" {
		return nil, fmt.Errorf("router usage database not configured")
	}
	for _, query := range []string{
		`CREATE TABLE IF NOT EXISTS router_key_versions (gateway_key_id VARCHAR(255) PRIMARY KEY, key_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, key_hash CHAR(64) NOT NULL UNIQUE, fingerprint VARCHAR(80) NOT NULL, INDEX(user_id)) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS router_usage_events (source_id BIGINT PRIMARY KEY, key_id CHAR(36) NOT NULL, user_id CHAR(36) NOT NULL, prompt_tokens BIGINT NOT NULL, completion_tokens BIGINT NOT NULL, occurred_at VARCHAR(64) NOT NULL, INDEX(user_id,key_id)) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS router_credit_reservations (id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, key_id CHAR(36) NOT NULL, token_reserve BIGINT NOT NULL, expires_at TIMESTAMP NOT NULL, INDEX(user_id,expires_at)) ENGINE=InnoDB`,
	} {
		if _, err := db.Exec(query); err != nil {
			return nil, err
		}
	}
	// Older ledgers only stored token totals. These columns let dashboards
	// explain which routed model/provider consumed the credit.
	for _, query := range []string{
		`ALTER TABLE router_usage_events ADD COLUMN model VARCHAR(255) NOT NULL DEFAULT ''`,
		`ALTER TABLE router_usage_events ADD COLUMN provider VARCHAR(255) NOT NULL DEFAULT ''`,
		`ALTER TABLE router_usage_events ADD COLUMN status VARCHAR(64) NOT NULL DEFAULT ''`,
	} {
		if _, err := db.Exec(query); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return nil, err
		}
	}
	uri := url.URL{Scheme: "file", Path: path}
	q := uri.Query()
	q.Set("mode", "ro")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "query_only(1)")
	uri.RawQuery = q.Encode()
	source, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	source.SetMaxOpenConns(1)
	if err = source.Ping(); err != nil {
		source.Close()
		return nil, err
	}
	return &routerUsage{db: db, source: source}, nil
}

func usageKeyHash(key string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(key))) }

func (u *routerUsage) remember(userID, keyID string, key routerGatewayKey) error {
	if u == nil {
		return fmt.Errorf("usage unavailable")
	}
	_, err := u.db.Exec(`INSERT INTO router_key_versions (gateway_key_id,key_id,user_id,key_hash,fingerprint) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE gateway_key_id=gateway_key_id`, key.ID, keyID, userID, usageKeyHash(key.Key), fingerprint(key.Key))
	return err
}

type usageOwner struct {
	KeyID  string `db:"key_id"`
	UserID string `db:"user_id"`
	Hash   string `db:"key_hash"`
}
type sourceUsage struct {
	ID                      int64
	Key                     string
	Input, Output           int64
	Timestamp               string
	Model, Provider, Status string
}

func readSourceUsage(ctx context.Context, source *sql.DB) ([]sourceUsage, error) {
	rows, err := source.QueryContext(ctx, `SELECT id,COALESCE(apiKey,''),COALESCE(promptTokens,0),COALESCE(completionTokens,0),timestamp,COALESCE(model,''),COALESCE(provider,''),COALESCE(status,'') FROM usageHistory ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []sourceUsage{}
	for rows.Next() {
		var e sourceUsage
		if err = rows.Scan(&e.ID, &e.Key, &e.Input, &e.Output, &e.Timestamp, &e.Model, &e.Provider, &e.Status); err != nil {
			return nil, err
		}
		if e.Input < 0 || e.Output < 0 {
			return nil, fmt.Errorf("negative gateway token count")
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (u *routerUsage) syncUsage() error {
	if u == nil {
		return fmt.Errorf("usage unavailable")
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	// Bootstrap current keys before scanning; previous versions remain in our table.
	var locals []struct {
		ID        string `db:"id"`
		UserID    string `db:"user_id"`
		GatewayID string `db:"gateway_key_id"`
	}
	if err := u.db.SelectContext(ctx, &locals, `SELECT id,user_id,gateway_key_id FROM router_api_keys`); err != nil {
		return err
	}
	for _, local := range locals {
		var key string
		err := u.source.QueryRowContext(ctx, `SELECT key FROM apiKeys WHERE id=?`, local.GatewayID).Scan(&key)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return err
		}
		if err = u.remember(local.UserID, local.ID, routerGatewayKey{ID: local.GatewayID, Key: key}); err != nil {
			return err
		}
	}
	var versions []usageOwner
	if err := u.db.SelectContext(ctx, &versions, `SELECT key_id,user_id,key_hash FROM router_key_versions`); err != nil {
		return err
	}
	owners := map[string]usageOwner{}
	for _, v := range versions {
		owners[v.Hash] = v
	}
	events, err := readSourceUsage(ctx, u.source)
	if err != nil {
		return err
	}
	tx, err := u.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, e := range events {
		owner, ok := owners[usageKeyHash(e.Key)]
		if !ok {
			continue
		}
		// A repeated sync is a no-op. Never overwrite already recorded consumption.
		_, err = tx.ExecContext(ctx, `INSERT INTO router_usage_events (source_id,key_id,user_id,prompt_tokens,completion_tokens,occurred_at,model,provider,status) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE model=VALUES(model),provider=VALUES(provider),status=VALUES(status)`, e.ID, owner.KeyID, owner.UserID, e.Input, e.Output, e.Timestamp, e.Model, e.Provider, e.Status)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (u *routerUsage) stats(userID string) (map[string]gatewayUsage, error) {
	if err := u.syncUsage(); err != nil {
		return nil, err
	}
	rows, err := u.db.Query(`SELECT key_id,SUM(prompt_tokens),SUM(completion_tokens),COUNT(*),MAX(occurred_at) FROM router_usage_events WHERE user_id=? GROUP BY key_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]gatewayUsage{}
	for rows.Next() {
		var id string
		var s gatewayUsage
		if err = rows.Scan(&id, &s.PromptTokens, &s.CompletionTokens, &s.Requests, &s.LastUsed); err != nil {
			return nil, err
		}
		out[id] = s
	}
	return out, rows.Err()
}

type routerPublicModelUsage struct {
	Model    string `db:"model" json:"model"`
	Tokens   int64  `db:"tokens" json:"tokens"`
	Requests int64  `db:"requests" json:"requests"`
}

// publicModelStats keeps provider internals out of the customer dashboard.
// 9Router records the concrete fallback target that handled a request, while
// customers should only see the stable combo name they selected.
func (u *routerUsage) publicModelStats(userID string) ([]routerPublicModelUsage, error) {
	if u == nil || u.source == nil {
		return nil, fmt.Errorf("usage unavailable")
	}
	rows, err := u.db.Query(`SELECT model,provider,SUM(prompt_tokens+completion_tokens),COUNT(*) FROM router_usage_events WHERE user_id=? GROUP BY model,provider`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type rawUsage struct {
		Model, Provider  string
		Tokens, Requests int64
	}
	raw := []rawUsage{}
	for rows.Next() {
		var item rawUsage
		if err = rows.Scan(&item.Model, &item.Provider, &item.Tokens, &item.Requests); err != nil {
			return nil, err
		}
		raw = append(raw, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	labels, err := u.publicModelLabels()
	if err != nil {
		return nil, err
	}
	aggregated := map[string]*routerPublicModelUsage{}
	for _, item := range raw {
		label := publicModelLabel(item.Model, item.Provider, labels)
		// Historical or upstream-only identifiers must never be shown on the
		// customer dashboard. Only names from the current combo catalog qualify.
		if label == "" {
			continue
		}
		stat := aggregated[label]
		if stat == nil {
			stat = &routerPublicModelUsage{Model: label}
			aggregated[label] = stat
		}
		stat.Tokens += item.Tokens
		stat.Requests += item.Requests
	}
	out := make([]routerPublicModelUsage, 0, len(aggregated))
	for _, stat := range aggregated {
		out = append(out, *stat)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Tokens == out[j].Tokens {
			return out[i].Model < out[j].Model
		}
		return out[i].Tokens > out[j].Tokens
	})
	return out, nil
}

func (u *routerUsage) publicModelLabels() (map[string]string, error) {
	public := customerModelIDs()
	labels := make(map[string]string, len(public))
	for _, name := range public {
		for _, variant := range usageModelVariants(name) {
			if labels[variant] == "" {
				labels[variant] = name
			}
		}
	}
	rows, err := u.source.Query(`SELECT name,models FROM combos ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	combos := map[string][]string{}
	for rows.Next() {
		var name, raw string
		if err = rows.Scan(&name, &raw); err != nil {
			return nil, err
		}
		var targets []string
		if json.Unmarshal([]byte(raw), &targets) == nil {
			combos[name] = targets
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	var leaves func(string, map[string]bool) []string
	leaves = func(name string, seen map[string]bool) []string {
		if seen[name] {
			return nil
		}
		seen[name] = true
		defer delete(seen, name)
		targets, ok := combos[name]
		if !ok {
			return []string{name}
		}
		out := []string{}
		for _, target := range targets {
			out = append(out, leaves(target, seen)...)
		}
		return out
	}
	for _, name := range public {
		for _, target := range leaves(name, map[string]bool{}) {
			for _, variant := range usageModelVariants(target) {
				// A direct public combo match wins over a fallback target that
				// happens to share the same text.
				if labels[variant] == "" {
					labels[variant] = name
				}
			}
		}
	}
	return labels, nil
}

func publicModelLabel(model, provider string, labels map[string]string) string {
	for _, candidate := range []string{model, provider + "/" + model} {
		for _, variant := range usageModelVariants(candidate) {
			if label := labels[variant]; label != "" {
				return label
			}
		}
	}
	// Never expose an upstream provider/model identifier to customers if a
	// historical row cannot be mapped to the current public combo catalog.
	return ""
}

func usageModelKey(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(value, "/")))
}

func usageModelVariants(value string) []string {
	key := usageModelKey(value)
	if key == "" {
		return nil
	}
	variants := []string{key}
	if index := strings.LastIndex(key, "/"); index >= 0 && index+1 < len(key) {
		variants = append(variants, key[index+1:])
	}
	seen := map[string]bool{}
	out := []string{}
	for _, variant := range variants {
		for _, candidate := range []string{variant, strings.TrimSuffix(variant, ":free"), strings.TrimSuffix(variant, "-free")} {
			if candidate != "" && !seen[candidate] {
				seen[candidate] = true
				out = append(out, candidate)
			}
		}
	}
	return out
}

func (u *routerUsage) run() {
	for {
		if err := u.syncUsage(); err != nil {
			log.Printf("router usage sync: %v", err)
		}
		time.Sleep(10 * time.Second)
	}
}
