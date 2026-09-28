package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type routerGatewayKey struct {
	ID        string `json:"id"`
	Key       string `json:"key"`
	Name      string `json:"name"`
	IsActive  bool   `json:"isActive"`
	CreatedAt string `json:"createdAt"`
}
type gatewayUsage struct {
	APIKeyKey        string `json:"apiKeyKey"`
	PromptTokens     int64  `json:"promptTokens"`
	CompletionTokens int64  `json:"completionTokens"`
	CachedTokens     int64  `json:"cachedTokens"`
	Requests         int64  `json:"requests"`
	LastUsed         string `json:"lastUsed"`
}
type gatewayUsageResponse struct {
	ByAPIKey map[string]gatewayUsage `json:"byApiKey"`
}
type routerKeyRecord struct {
	ID           string     `db:"id"`
	GatewayKeyID string     `db:"gateway_key_id"`
	Name         string     `db:"name"`
	CreatedAt    time.Time  `db:"created_at"`
	RevokedAt    *time.Time `db:"revoked_at"`
}
type routerOrderRecord struct {
	PlanID       string     `db:"plan_id"`
	Amount       int64      `db:"amount"`
	CreditTokens int64      `db:"credit_tokens"`
	Status       string     `db:"status"`
	PaidAt       *time.Time `db:"paid_at"`
	CreatedAt    time.Time  `db:"created_at"`
}

func ensureRouterDashboardTables(db *sqlx.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS router_wallets (
		user_id CHAR(36) NOT NULL PRIMARY KEY, credit_tokens BIGINT NOT NULL DEFAULT 0,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		CONSTRAINT router_wallet_user FOREIGN KEY (user_id) REFERENCES router_users(id) ON DELETE CASCADE
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS router_api_keys (
		id CHAR(36) NOT NULL PRIMARY KEY, user_id CHAR(36) NOT NULL, gateway_key_id VARCHAR(255) NOT NULL UNIQUE,
		name VARCHAR(80) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TIMESTAMP NULL,
		INDEX router_api_keys_user (user_id), CONSTRAINT router_api_keys_user FOREIGN KEY (user_id) REFERENCES router_users(id) ON DELETE CASCADE
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	return err
}

func routerDashboardHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := routerSessionUser(c, db, cfg)
		if !ok {
			return c.Status(401).JSON(fiber.Map{"error": "login diperlukan"})
		}
		c.Set("Cache-Control", "no-store")
		if _, err := db.Exec(`INSERT IGNORE INTO router_wallets (user_id) VALUES (?)`, user.ID); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "saldo belum dapat dimuat"})
		}
		var credits int64
		if err := db.Get(&credits, `SELECT credit_tokens FROM router_wallets WHERE user_id=?`, user.ID); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "saldo belum dapat dimuat"})
		}
		var records []routerKeyRecord
		if err := db.Select(&records, `SELECT id,gateway_key_id,name,created_at,revoked_at FROM router_api_keys WHERE user_id=? ORDER BY created_at DESC`, user.ID); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "gagal memuat key"})
		}
		keys, _ := gatewayKeys(cfg)
		byID := map[string]routerGatewayKey{}
		for _, key := range keys {
			byID[key.ID] = key
		}
		usage, err := cfg.Usage.stats(user.ID)
		if err != nil {
			return c.Status(503).JSON(fiber.Map{"error": "Usage belum dapat disinkronkan. Coba lagi sebentar."})
		}
		var used int64
		items := make([]fiber.Map, 0, len(records))
		for _, record := range records {
			key, exists := byID[record.GatewayKeyID]
			stat := usage[record.ID]
			tokens := stat.PromptTokens + stat.CompletionTokens
			used += tokens
			items = append(items, fiber.Map{"id": record.ID, "name": record.Name, "active": record.RevokedAt == nil && exists && key.IsActive, "createdAt": record.CreatedAt, "fingerprint": fingerprint(key.Key), "usageTokens": tokens, "requests": stat.Requests, "lastUsed": stat.LastUsed})
		}
		remaining := credits - used
		if remaining < 0 {
			remaining = 0
		}
		var orders []routerOrderRecord
		if err := db.Select(&orders, `SELECT plan_id,amount,credit_tokens,status,paid_at,created_at FROM router_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20`, user.ID); err != nil {
			// Payment history is supplementary; do not make the dashboard unavailable
			// when an older installation has not initialized the order ledger yet.
			orders = nil
		}
		orderItems := make([]fiber.Map, 0, len(orders))
		for _, order := range orders {
			orderItems = append(orderItems, fiber.Map{"planId": order.PlanID, "amount": order.Amount, "creditTokens": order.CreditTokens, "status": order.Status, "paidAt": order.PaidAt, "createdAt": order.CreatedAt})
		}
		var daily []struct {
			Day      string `db:"day" json:"day"`
			Tokens   int64  `db:"tokens" json:"tokens"`
			Requests int64  `db:"requests" json:"requests"`
		}
		_ = db.Select(&daily, `SELECT LEFT(occurred_at,10) day,SUM(prompt_tokens+completion_tokens) tokens,COUNT(*) requests FROM router_usage_events WHERE user_id=? AND occurred_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY LEFT(occurred_at,10) ORDER BY day`, user.ID)
		byModel, err := cfg.Usage.publicModelStats(user.ID)
		if err != nil {
			return c.Status(503).JSON(fiber.Map{"error": "Rincian model belum dapat dimuat. Coba lagi sebentar."})
		}
		return c.JSON(fiber.Map{"user": fiber.Map{"name": user.Name, "email": user.Email}, "creditRemaining": remaining, "creditLimit": credits, "usageTokens": used, "keys": items, "orders": orderItems, "usageDaily": daily, "usageByModel": byModel, "canCreateKey": remaining > 0, "creditExhausted": remaining <= 0, "paymentStatus": "Pembayaran Mayar disinkronkan otomatis"})
	}
}

func routerCreateKeyHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := routerSessionUser(c, db, cfg)
		if !ok {
			return c.Status(401).JSON(fiber.Map{"error": "login diperlukan"})
		}
		var balance int64
		_ = db.Get(&balance, `SELECT credit_tokens FROM router_wallets WHERE user_id=?`, user.ID)
		stats, err := cfg.Usage.stats(user.ID)
		if err != nil {
			return c.Status(503).JSON(fiber.Map{"error": "Usage belum dapat disinkronkan"})
		}
		for _, stat := range stats {
			balance -= stat.PromptTokens + stat.CompletionTokens
		}
		if balance <= 0 {
			return c.Status(402).JSON(fiber.Map{"error": "Limit credit habis. Beli paket untuk menggunakan API kembali."})
		}
		var body struct {
			Name string `json:"name"`
		}
		if err := c.BodyParser(&body); err != nil || len(strings.TrimSpace(body.Name)) < 2 {
			return c.Status(400).JSON(fiber.Map{"error": "Nama aplikasi minimal 2 karakter"})
		}
		body.Name = strings.TrimSpace(body.Name)
		if len(body.Name) > 60 {
			body.Name = body.Name[:60]
		}
		key, err := createGatewayKey(cfg, gatewayKeyName(user.ID, body.Name))
		if err != nil {
			return c.Status(502).JSON(fiber.Map{"error": "gateway tidak dapat membuat API key"})
		}
		record := routerKeyRecord{ID: uuid.NewString(), GatewayKeyID: key.ID, Name: body.Name}
		if _, err = db.Exec(`INSERT INTO router_api_keys (id,user_id,gateway_key_id,name) VALUES (?,?,?,?)`, record.ID, user.ID, record.GatewayKeyID, record.Name); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "key gagal disimpan"})
		}
		if err = cfg.Usage.remember(user.ID, record.ID, key); err != nil {
			_ = gatewayDeleteKey(cfg, key.ID)
			return c.Status(500).JSON(fiber.Map{"error": "pencatatan key gagal; coba buat kembali"})
		}
		return c.Status(201).JSON(fiber.Map{"id": record.ID, "name": record.Name, "key": key.Key, "createdAt": time.Now()})
	}
}

func routerRotateKeyHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := routerSessionUser(c, db, cfg)
		if !ok {
			return c.Status(401).JSON(fiber.Map{"error": "login diperlukan"})
		}
		var record routerKeyRecord
		if err := db.Get(&record, `SELECT id,gateway_key_id,name,created_at,revoked_at FROM router_api_keys WHERE id=? AND user_id=? AND revoked_at IS NULL`, c.Params("id"), user.ID); err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "API key tidak ditemukan"})
		}
		if err := cfg.Usage.syncUsage(); err != nil {
			return c.Status(503).JSON(fiber.Map{"error": "Usage belum dapat disinkronkan"})
		}
		key, err := createGatewayKey(cfg, gatewayKeyName(user.ID, record.Name))
		if err != nil {
			return c.Status(502).JSON(fiber.Map{"error": "gateway tidak dapat merotasi key"})
		}
		if err = cfg.Usage.remember(user.ID, record.ID, key); err != nil {
			_ = gatewayDeleteKey(cfg, key.ID)
			return c.Status(500).JSON(fiber.Map{"error": "pencatatan key gagal"})
		}
		if err = gatewayDeleteKey(cfg, record.GatewayKeyID); err != nil {
			return c.Status(502).JSON(fiber.Map{"error": "key baru dibuat, namun key lama belum dapat dicabut"})
		}
		_, err = db.Exec(`UPDATE router_api_keys SET gateway_key_id=? WHERE id=?`, key.ID, record.ID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "key baru gagal disimpan"})
		}
		return c.JSON(fiber.Map{"id": record.ID, "name": record.Name, "key": key.Key})
	}
}

func routerRevokeKeyHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := routerSessionUser(c, db, cfg)
		if !ok {
			return c.Status(401).JSON(fiber.Map{"error": "login diperlukan"})
		}
		var record routerKeyRecord
		if err := db.Get(&record, `SELECT id,gateway_key_id,name,created_at,revoked_at FROM router_api_keys WHERE id=? AND user_id=?`, c.Params("id"), user.ID); err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "API key tidak ditemukan"})
		}
		if err := cfg.Usage.syncUsage(); err != nil {
			return c.Status(503).JSON(fiber.Map{"error": "Usage belum dapat disinkronkan"})
		}
		if err := gatewayDeleteKey(cfg, record.GatewayKeyID); err != nil {
			return c.Status(502).JSON(fiber.Map{"error": "gateway tidak dapat mencabut key"})
		}
		_, _ = db.Exec(`UPDATE router_api_keys SET revoked_at=NOW() WHERE id=?`, record.ID)
		return c.SendStatus(204)
	}
}

func gatewayClient(cfg RouterAuthConfig) (*http.Client, error) {
	if cfg.GatewayPassword == "" {
		return nil, fmt.Errorf("gateway password missing")
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 10 * time.Second}
	payload, _ := json.Marshal(fiber.Map{"password": cfg.GatewayPassword})
	response, err := client.Post(strings.TrimRight(cfg.GatewayURL, "/")+"/api/auth/login", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	response.Body.Close()
	if response.StatusCode/100 != 2 {
		return nil, fmt.Errorf("gateway auth status %d", response.StatusCode)
	}
	return client, nil
}
func gatewayKeys(cfg RouterAuthConfig) ([]routerGatewayKey, error) {
	client, err := gatewayClient(cfg)
	if err != nil {
		return nil, err
	}
	response, err := client.Get(strings.TrimRight(cfg.GatewayURL, "/") + "/api/keys")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var out struct {
		Keys []routerGatewayKey `json:"keys"`
	}
	err = json.NewDecoder(response.Body).Decode(&out)
	return out.Keys, err
}
func createGatewayKey(cfg RouterAuthConfig, name string) (routerGatewayKey, error) {
	client, err := gatewayClient(cfg)
	if err != nil {
		return routerGatewayKey{}, err
	}
	raw, _ := json.Marshal(fiber.Map{"name": name})
	response, err := client.Post(strings.TrimRight(cfg.GatewayURL, "/")+"/api/keys", "application/json", bytes.NewReader(raw))
	if err != nil {
		return routerGatewayKey{}, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return routerGatewayKey{}, fmt.Errorf("create status %d", response.StatusCode)
	}
	keys, err := gatewayKeys(cfg)
	if err != nil {
		return routerGatewayKey{}, err
	}
	for _, key := range keys {
		if key.Name == name {
			return key, nil
		}
	}
	return routerGatewayKey{}, fmt.Errorf("created key missing")
}
func gatewayDeleteKey(cfg RouterAuthConfig, id string) error {
	client, err := gatewayClient(cfg)
	if err != nil {
		return err
	}
	request, err := http.NewRequest(http.MethodDelete, strings.TrimRight(cfg.GatewayURL, "/")+"/api/keys/"+id, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return fmt.Errorf("delete status %d", response.StatusCode)
	}
	return nil
}

func gatewayUsageByKey(cfg RouterAuthConfig) (map[string]gatewayUsage, error) {
	client, err := gatewayClient(cfg)
	if err != nil {
		return nil, err
	}
	response, err := client.Get(strings.TrimRight(cfg.GatewayURL, "/") + "/api/usage/history")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var out gatewayUsageResponse
	if err = json.NewDecoder(response.Body).Decode(&out); err != nil {
		return nil, err
	}
	result := map[string]gatewayUsage{}
	for _, item := range out.ByAPIKey {
		result[item.APIKeyKey] = item
	}
	return result, nil
}
func gatewayKeyName(userID, name string) string {
	return "Arsant · " + userID[:8] + " · " + name + " · " + uuid.NewString()[:8]
}
func fingerprint(value string) string {
	if len(value) < 9 {
		return "—"
	}
	return value[:4] + "••••" + value[len(value)-4:]
}
