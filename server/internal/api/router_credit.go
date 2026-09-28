package api

import (
	"context"
	"database/sql"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Used by nginx auth_request on every public gateway request. No positive
// balance cache: each admission observes the recorded account-wide usage.
func routerCreditHandler(check func(string) int) fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Set("Cache-Control", "no-store")
		uri, err := url.ParseRequestURI(c.Get("X-Original-URI"))
		if err != nil {
			return c.SendStatus(401)
		}
		inference := false
		for _, prefix := range []string{"/v1", "/v1beta", "/api/v1", "/api/v1beta"} {
			if uri.Path == prefix || strings.HasPrefix(uri.Path, prefix+"/") {
				inference = true
			}
		}
		if c.Get("X-Original-Method") == "OPTIONS" {
			return c.SendStatus(204)
		}
		candidates := []string{c.Get("X-Api-Key"), c.Get("X-Goog-Api-Key"), uri.Query().Get("key"), uri.Query().Get("api_key")}
		auth := strings.Fields(c.Get("Authorization"))
		if len(auth) == 2 && strings.EqualFold(auth[0], "Bearer") {
			candidates = append(candidates, auth[1])
		}
		found := false
		for _, key := range candidates {
			key = strings.TrimSpace(key)
			if key == "" {
				continue
			}
			if !inference && !strings.HasPrefix(key, "sk-") {
				continue
			}
			found = true
			if status := check(key); status != 204 {
				return c.SendStatus(status)
			}
		}
		if inference && !found {
			return c.SendStatus(401)
		}
		return c.SendStatus(204)
	}
}

func (u *routerUsage) authorizeCredit(key string) int {
	if u == nil {
		return 503
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	var gatewayID string
	err := u.source.QueryRowContext(ctx, `SELECT id FROM apiKeys WHERE key=? AND isActive=1`, key).Scan(&gatewayID)
	if err == sql.ErrNoRows {
		return 401
	}
	if err != nil {
		return 503
	}
	// Native operator keys remain under the existing gateway policy.
	var userID string
	err = u.db.GetContext(ctx, &userID, `SELECT user_id FROM router_api_keys WHERE gateway_key_id=? AND revoked_at IS NULL`, gatewayID)
	if err == sql.ErrNoRows {
		var count int
		if err = u.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM router_key_versions WHERE key_hash=?`, usageKeyHash(key)); err != nil {
			return 503
		}
		if count > 0 {
			return 401
		}
		return 204
	}
	if err != nil {
		return 503
	}
	if err = u.syncUsage(); err != nil {
		return 503
	}
	var remaining int64
	err = u.db.GetContext(ctx, &remaining, `SELECT credit_tokens-COALESCE((SELECT SUM(prompt_tokens+completion_tokens) FROM router_usage_events WHERE user_id=?),0) FROM router_wallets WHERE user_id=?`, userID, userID)
	if err == sql.ErrNoRows {
		return 403
	}
	if err != nil {
		return 503
	}
	if remaining <= 0 {
		return 403
	}
	return 204
}
