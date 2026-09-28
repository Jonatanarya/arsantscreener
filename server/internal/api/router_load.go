package api

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	defaultRequestsPerMinute = 30
	maxRequestsPerKey        = 2
)

type rateWindow struct {
	started          time.Time
	requests, active int
}
type routerLoadGate struct {
	mu           sync.Mutex
	keys, models map[string]*rateWindow
}
type requestPermit struct {
	gate       *routerLoadGate
	key, model string
	released   bool
}

func newRouterLoadGate() *routerLoadGate {
	return &routerLoadGate{keys: map[string]*rateWindow{}, models: map[string]*rateWindow{}}
}
func (g *routerLoadGate) acquire(key, model string) (*requestPermit, time.Duration, string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := time.Now()
	k := g.keys[key]
	if k == nil || now.Sub(k.started) >= time.Minute {
		k = &rateWindow{started: now}
		g.keys[key] = k
	}
	if k.requests >= defaultRequestsPerMinute {
		return nil, time.Until(k.started.Add(time.Minute)), "rate"
	}
	if k.active >= maxRequestsPerKey {
		return nil, 0, "key_concurrency"
	}
	m := g.models[model]
	if m == nil {
		m = &rateWindow{started: now}
		g.models[model] = m
	}
	k.requests++
	k.active++
	m.active++
	return &requestPermit{gate: g, key: key, model: model}, 0, ""
}
func (p *requestPermit) release() {
	if p == nil {
		return
	}
	p.gate.mu.Lock()
	defer p.gate.mu.Unlock()
	if p.released {
		return
	}
	p.released = true
	if k := p.gate.keys[p.key]; k != nil && k.active > 0 {
		k.active--
	}
	if m := p.gate.models[p.model]; m != nil && m.active > 0 {
		m.active--
	}
}

func (u *routerUsage) reserveCredit(ctx context.Context, key, requestID string, tokens int64) (func(), error) {
	if u == nil {
		return nil, fmt.Errorf("usage unavailable")
	}
	if tokens < 1 {
		tokens = 1
	}
	var keyID, userID string
	if err := u.db.QueryRowxContext(ctx, `SELECT key_id,user_id FROM router_key_versions WHERE key_hash=?`, usageKeyHash(key)).Scan(&keyID, &userID); err != nil {
		return nil, err
	}
	if err := u.syncUsage(); err != nil {
		return nil, err
	}
	tx, err := u.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM router_credit_reservations WHERE expires_at < NOW()`); err != nil {
		return nil, err
	}
	var available int64
	err = tx.QueryRowContext(ctx, `SELECT w.credit_tokens-COALESCE((SELECT SUM(prompt_tokens+completion_tokens) FROM router_usage_events WHERE user_id=w.user_id),0)-COALESCE((SELECT SUM(token_reserve) FROM router_credit_reservations WHERE user_id=w.user_id AND expires_at>=NOW()),0) FROM router_wallets w WHERE w.user_id=? FOR UPDATE`, userID).Scan(&available)
	if err != nil {
		return nil, err
	}
	if available < tokens {
		return nil, fmt.Errorf("credit exhausted")
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO router_credit_reservations(id,user_id,key_id,token_reserve,expires_at) VALUES(?,?,?,?,DATE_ADD(NOW(),INTERVAL 120 SECOND))`, requestID, userID, keyID, tokens); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return func() {}, nil
}
func tokenReservation(payload map[string]json.RawMessage, rawLen int) int64 {
	output := int64(4096)
	for _, f := range []string{"max_tokens", "max_completion_tokens", "max_output_tokens"} {
		var n int64
		if json.Unmarshal(payload[f], &n) == nil && n > 0 {
			output = n
			break
		}
	}
	input := int64(rawLen / 4)
	if input < 256 {
		input = 256
	}
	v := input + output
	if v < 4096 {
		v = 4096
	}
	if v > 131072 {
		v = 131072
	}
	return v
}
func newReservationID() string { return uuid.NewString() }
