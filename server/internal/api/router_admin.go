package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type routerAdminUser struct {
	ID          string           `db:"id" json:"id"`
	Email       string           `db:"email" json:"email"`
	Name        string           `db:"name" json:"name"`
	CreatedAt   time.Time        `db:"created_at" json:"createdAt"`
	LastLoginAt *time.Time       `db:"last_login_at" json:"lastLoginAt"`
	CreditLimit int64            `db:"credit_limit" json:"creditLimit"`
	UsageTokens int64            `db:"usage_tokens" json:"usageTokens"`
	ActiveKeys  int64            `db:"active_keys" json:"activeKeys"`
	Keys        []routerAdminKey `db:"-" json:"keys"`
}

type routerAdminKey struct {
	ID          string     `db:"id" json:"id"`
	UserID      string     `db:"user_id" json:"-"`
	Name        string     `db:"name" json:"name"`
	CreatedAt   time.Time  `db:"created_at" json:"createdAt"`
	RevokedAt   *time.Time `db:"revoked_at" json:"revokedAt"`
	UsageTokens int64      `db:"usage_tokens" json:"usageTokens"`
	Requests    int64      `db:"requests" json:"requests"`
}

type routerAdminOrder struct {
	ID           string     `db:"id" json:"id"`
	Email        string     `db:"email" json:"email"`
	PlanID       string     `db:"plan_id" json:"planId"`
	Amount       int64      `db:"amount" json:"amount"`
	CreditTokens int64      `db:"credit_tokens" json:"creditTokens"`
	Status       string     `db:"status" json:"status"`
	PaymentID    *string    `db:"mayar_payment_id" json:"paymentId"`
	PaidAt       *time.Time `db:"paid_at" json:"paidAt"`
	CreatedAt    time.Time  `db:"created_at" json:"createdAt"`
}

type routerAdminAudit struct {
	ID        string    `db:"id" json:"id"`
	Actor     string    `db:"actor_email" json:"actor"`
	Action    string    `db:"action" json:"action"`
	Target    string    `db:"target" json:"target"`
	Detail    string    `db:"detail" json:"detail"`
	CreatedAt time.Time `db:"created_at" json:"createdAt"`
}

func routerAdminAllowed(email string, cfg RouterAuthConfig) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, allowed := range strings.Split(cfg.AdminEmails, ",") {
		if email != "" && email == strings.ToLower(strings.TrimSpace(allowed)) {
			return true
		}
	}
	return false
}

func routerAdminUserFromSession(c *fiber.Ctx, db *sqlx.DB, cfg RouterAuthConfig) (routerUser, bool) {
	user, ok := routerSessionUser(c, db, cfg)
	if !ok || !routerAdminAllowed(user.Email, cfg) {
		return routerUser{}, false
	}
	payload, valid := verifiedValue(c.Cookies("arsant_router_session"), cfg.SessionSecret)
	parts := strings.SplitN(payload, "|", 2)
	expiresAt, err := strconv.ParseInt(parts[len(parts)-1], 10, 64)
	if !valid || len(parts) != 2 || err != nil || expiresAt > time.Now().Add(8*time.Hour+time.Minute).Unix() {
		return routerUser{}, false
	}
	return user, true
}

func ensureRouterAdminTables(db *sqlx.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS router_admin_audit (
		id CHAR(36) PRIMARY KEY, actor_email VARCHAR(320) NOT NULL, action VARCHAR(64) NOT NULL,
		target VARCHAR(320) NOT NULL, detail VARCHAR(1000) NOT NULL DEFAULT '',
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX(created_at), INDEX(target)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	return err
}

func registerRouterAdminRoutes(app *fiber.App, db *sqlx.DB, cfg RouterAuthConfig, payments *mayarPayments) {
	_ = ensureRouterAdminTables(db)
	app.Get("/router/admin/overview", routerAdminOverviewHandler(db, cfg))
	app.Post("/router/admin/users/:id/credit", routerAdminCreditHandler(db, cfg))
	app.Post("/router/admin/keys/:id/revoke", routerAdminRevokeKeyHandler(db, cfg))
	app.Post("/router/admin/models", routerAdminModelsHandler(db, cfg))
	app.Post("/router/admin/payments/reconcile", routerAdminReconcileHandler(db, cfg, payments))
}

func ensureCustomerModelCatalog(db *sqlx.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS router_customer_models (
		model_id VARCHAR(255) PRIMARY KEY, position INT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	if err != nil {
		return err
	}
	var count int
	if err = db.Get(&count, `SELECT COUNT(*) FROM router_customer_models`); err != nil {
		return err
	}
	if count == 0 {
		for position, model := range defaultCustomerModels {
			if _, err = db.Exec(`INSERT INTO router_customer_models(model_id,position) VALUES(?,?)`, model, position); err != nil {
				return err
			}
		}
	}
	var models []string
	if err = db.Select(&models, `SELECT model_id FROM router_customer_models ORDER BY position,model_id`); err != nil {
		return err
	}
	if len(models) == 0 {
		return fmt.Errorf("customer model catalog cannot be empty")
	}
	setCustomerModelIDs(models)
	return nil
}

// syncCustomerModelCatalog keeps the customer allowlist aligned with the
// gateway's combo catalog. New combos are additive and receive the next
// position; existing entries are never removed or reordered, so active API
// keys continue to see the same model names during a catalog update.
func syncCustomerModelCatalog(db *sqlx.DB, source *sql.DB) error {
	if source == nil {
		return fmt.Errorf("gateway database unavailable")
	}
	combos, err := gatewayComboNames(source)
	if err != nil {
		return err
	}
	if len(combos) == 0 {
		return fmt.Errorf("gateway combo catalog is empty")
	}
	if _, err = db.Exec(`CREATE TABLE IF NOT EXISTS router_customer_model_sync_seen (
		model_id VARCHAR(255) PRIMARY KEY, first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	var models []string
	if err = db.Select(&models, `SELECT model_id FROM router_customer_models ORDER BY position,model_id`); err != nil {
		return err
	}
	var seenCount int
	if err = db.Get(&seenCount, `SELECT COUNT(*) FROM router_customer_model_sync_seen`); err != nil {
		return err
	}
	if seenCount == 0 {
		tx, err := db.Beginx()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		for _, combo := range combos {
			if _, err = tx.Exec(`INSERT IGNORE INTO router_customer_model_sync_seen(model_id) VALUES(?)`, combo); err != nil {
				return err
			}
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		setCustomerModelIDs(models)
		return nil
	}
	present := make(map[string]bool, len(models))
	for _, model := range models {
		present[model] = true
	}
	nextPosition := len(models)
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, combo := range combos {
		var seen int
		if err = tx.Get(&seen, `SELECT COUNT(*) FROM router_customer_model_sync_seen WHERE model_id=?`, combo); err != nil {
			return err
		}
		if seen > 0 {
			continue
		}
		if _, err = tx.Exec(`INSERT INTO router_customer_model_sync_seen(model_id) VALUES(?)`, combo); err != nil {
			return err
		}
		if present[combo] {
			continue
		}
		if _, err = tx.Exec(`INSERT INTO router_customer_models(model_id,position) VALUES(?,?)`, combo, nextPosition); err != nil {
			return err
		}
		models = append(models, combo)
		present[combo] = true
		nextPosition++
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	setCustomerModelIDs(models)
	return nil
}

func runCustomerModelCatalogSync(db *sqlx.DB, source *sql.DB) {
	for {
		if err := syncCustomerModelCatalog(db, source); err != nil {
			fmt.Printf("customer model catalog sync: %v\n", err)
		}
		time.Sleep(30 * time.Second)
	}
}

func routerAdminOverviewHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if _, ok := routerAdminUserFromSession(c, db, cfg); !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "akses admin diperlukan"})
		}
		c.Set("Cache-Control", "no-store")
		var users []routerAdminUser
		err := db.Select(&users, `SELECT u.id,u.email,u.name,u.created_at,u.last_login_at,
			COALESCE(w.credit_tokens,0) credit_limit,COALESCE(x.used,0) usage_tokens,COALESCE(k.active_keys,0) active_keys
			FROM router_users u LEFT JOIN router_wallets w ON w.user_id=u.id
			LEFT JOIN (SELECT user_id,SUM(prompt_tokens+completion_tokens) used FROM router_usage_events GROUP BY user_id) x ON x.user_id=u.id
			LEFT JOIN (SELECT user_id,COUNT(*) active_keys FROM router_api_keys WHERE revoked_at IS NULL GROUP BY user_id) k ON k.user_id=u.id
			ORDER BY u.created_at DESC LIMIT 500`)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "data pelanggan belum dapat dimuat"})
		}
		keysByUser := map[string][]routerAdminKey{}
		var keyRows []routerAdminKey
		_ = db.Select(&keyRows, `SELECT k.id,k.user_id,k.name,k.created_at,k.revoked_at,
			COALESCE(SUM(e.prompt_tokens+e.completion_tokens),0) usage_tokens,COUNT(e.source_id) requests
			FROM router_api_keys k LEFT JOIN router_usage_events e ON e.key_id=k.id GROUP BY k.id,k.user_id,k.name,k.created_at,k.revoked_at ORDER BY k.created_at DESC`)
		for _, key := range keyRows {
			keysByUser[key.UserID] = append(keysByUser[key.UserID], key)
		}
		for i := range users {
			users[i].Keys = keysByUser[users[i].ID]
		}
		var orders []routerAdminOrder
		_ = db.Select(&orders, `SELECT o.id,u.email,o.plan_id,o.amount,o.credit_tokens,o.status,o.mayar_payment_id,o.paid_at,o.created_at
			FROM router_orders o JOIN router_users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 200`)
		var audit []routerAdminAudit
		_ = db.Select(&audit, `SELECT id,actor_email,action,target,detail,created_at FROM router_admin_audit ORDER BY created_at DESC LIMIT 100`)
		var paidRevenue, paidOrders int64
		_ = db.Get(&paidRevenue, `SELECT COALESCE(SUM(amount),0) FROM router_orders WHERE status='paid'`)
		_ = db.Get(&paidOrders, `SELECT COUNT(*) FROM router_orders WHERE status='paid'`)
		var totalUsage, activeKeys int64
		_ = db.Get(&totalUsage, `SELECT COALESCE(SUM(prompt_tokens+completion_tokens),0) FROM router_usage_events`)
		_ = db.Get(&activeKeys, `SELECT COUNT(*) FROM router_api_keys WHERE revoked_at IS NULL`)
		var daily []struct {
			Day      string `db:"day" json:"day"`
			Tokens   int64  `db:"tokens" json:"tokens"`
			Requests int64  `db:"requests" json:"requests"`
		}
		_ = db.Select(&daily, `SELECT LEFT(occurred_at,10) day,SUM(prompt_tokens+completion_tokens) tokens,COUNT(*) requests FROM router_usage_events WHERE occurred_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY LEFT(occurred_at,10) ORDER BY day`)
		var byModel []struct {
			Model    string `db:"model" json:"model"`
			Provider string `db:"provider" json:"provider"`
			Tokens   int64  `db:"tokens" json:"tokens"`
			Requests int64  `db:"requests" json:"requests"`
			Errors   int64  `db:"errors" json:"errors"`
		}
		_ = db.Select(&byModel, `SELECT IF(model='','Tidak diketahui',model) model,IF(provider='','—',provider) provider,SUM(prompt_tokens+completion_tokens) tokens,COUNT(*) requests,SUM(status NOT IN ('success','completed','200','')) errors FROM router_usage_events GROUP BY model,provider ORDER BY tokens DESC LIMIT 30`)
		var paymentIssues []struct {
			PaymentID string    `db:"payment_id" json:"paymentId"`
			Email     string    `db:"email" json:"email"`
			Reason    string    `db:"reason" json:"reason"`
			Status    string    `db:"status" json:"status"`
			UpdatedAt time.Time `db:"updated_at" json:"updatedAt"`
		}
		_ = db.Select(&paymentIssues, `SELECT payment_id,email,reason,status,updated_at FROM router_payment_issues WHERE status='open' ORDER BY updated_at DESC LIMIT 100`)
		allModels := []string{}
		if cfg.Usage != nil && cfg.Usage.source != nil {
			allModels, _ = gatewayComboNames(cfg.Usage.source)
		}
		return c.JSON(fiber.Map{"summary": fiber.Map{"users": len(users), "activeKeys": activeKeys, "paidOrders": paidOrders, "revenue": paidRevenue, "usageTokens": totalUsage}, "users": users, "orders": orders, "audit": audit, "allowedModels": customerModelIDs(), "allModels": allModels, "usageDaily": daily, "usageByModel": byModel, "paymentIssues": paymentIssues})
	}
}

func routerAdminModelsHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		actor, ok := routerAdminUserFromSession(c, db, cfg)
		if !ok {
			return c.Status(403).JSON(fiber.Map{"error": "akses admin diperlukan"})
		}
		var body struct {
			Models []string `json:"models"`
		}
		if c.BodyParser(&body) != nil || len(body.Models) == 0 || len(body.Models) > 30 {
			return c.Status(400).JSON(fiber.Map{"error": "pilih minimal satu model"})
		}
		available := map[string]bool{}
		if cfg.Usage == nil || cfg.Usage.source == nil {
			return c.Status(503).JSON(fiber.Map{"error": "database gateway belum tersedia"})
		}
		combos, err := gatewayComboNames(cfg.Usage.source)
		if err != nil {
			return c.Status(503).JSON(fiber.Map{"error": "katalog combo belum tersedia"})
		}
		for _, model := range combos {
			available[model] = true
		}
		unique := map[string]bool{}
		models := make([]string, 0, len(body.Models))
		for _, model := range body.Models {
			model = strings.TrimSpace(model)
			if !available[model] {
				return c.Status(400).JSON(fiber.Map{"error": "combo tidak ditemukan: " + model})
			}
			if !unique[model] {
				unique[model] = true
				models = append(models, model)
			}
		}
		sort.Strings(models)
		tx, err := db.Beginx()
		if err != nil {
			return c.SendStatus(500)
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`DELETE FROM router_customer_models`); err == nil {
			for position, model := range models {
				_, err = tx.Exec(`INSERT INTO router_customer_models(model_id,position) VALUES(?,?)`, model, position)
				if err != nil {
					break
				}
			}
		}
		detail, _ := json.Marshal(models)
		if err == nil {
			_, err = tx.Exec(`INSERT INTO router_admin_audit(id,actor_email,action,target,detail) VALUES(?,?,?,?,?)`, uuid.NewString(), actor.Email, "models.update", "customer-catalog", string(detail))
		}
		if err != nil || tx.Commit() != nil {
			return c.Status(500).JSON(fiber.Map{"error": "katalog model belum dapat disimpan"})
		}
		setCustomerModelIDs(models)
		return c.JSON(fiber.Map{"models": models})
	}
}

func gatewayComboNames(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`SELECT name FROM combos ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	models := []string{}
	for rows.Next() {
		var model string
		if err = rows.Scan(&model); err != nil {
			return nil, err
		}
		models = append(models, model)
	}
	return models, rows.Err()
}

func routerAdminReconcileHandler(db *sqlx.DB, cfg RouterAuthConfig, payments *mayarPayments) fiber.Handler {
	return func(c *fiber.Ctx) error {
		actor, ok := routerAdminUserFromSession(c, db, cfg)
		if !ok {
			return c.Status(403).JSON(fiber.Map{"error": "akses admin diperlukan"})
		}
		if payments == nil || payments.apiKey == "" {
			return c.Status(503).JSON(fiber.Map{"error": "Mayar belum dikonfigurasi"})
		}
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := payments.reconcile(ctx); err != nil {
			return c.Status(502).JSON(fiber.Map{"error": "sinkronisasi Mayar gagal"})
		}
		_, _ = db.Exec(`INSERT INTO router_admin_audit(id,actor_email,action,target,detail) VALUES(?,?,?,?,?)`, uuid.NewString(), actor.Email, "payments.reconcile", "Mayar", "Sinkronisasi transaksi manual berhasil")
		return c.JSON(fiber.Map{"ok": true})
	}
}

func routerAdminCreditHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		actor, ok := routerAdminUserFromSession(c, db, cfg)
		if !ok {
			return c.Status(403).JSON(fiber.Map{"error": "akses admin diperlukan"})
		}
		var body struct {
			Delta  int64  `json:"delta"`
			Reason string `json:"reason"`
		}
		if c.BodyParser(&body) != nil || body.Delta == 0 || body.Delta > 1_000_000_000_000 || body.Delta < -1_000_000_000_000 || len(strings.TrimSpace(body.Reason)) < 3 {
			return c.Status(400).JSON(fiber.Map{"error": "jumlah dan alasan wajib diisi"})
		}
		tx, err := db.Beginx()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "perubahan belum dapat disimpan"})
		}
		defer tx.Rollback()
		var email string
		if err = tx.Get(&email, `SELECT email FROM router_users WHERE id=? FOR UPDATE`, c.Params("id")); err != nil {
			return c.Status(404).JSON(fiber.Map{"error": "pelanggan tidak ditemukan"})
		}
		_, err = tx.Exec(`INSERT IGNORE INTO router_wallets(user_id,credit_tokens) VALUES(?,0)`, c.Params("id"))
		var current int64
		if err == nil {
			err = tx.Get(&current, `SELECT credit_tokens FROM router_wallets WHERE user_id=? FOR UPDATE`, c.Params("id"))
		}
		if err != nil || current+body.Delta < 0 {
			return c.Status(400).JSON(fiber.Map{"error": "saldo tidak boleh menjadi negatif"})
		}
		_, err = tx.Exec(`UPDATE router_wallets SET credit_tokens=credit_tokens+? WHERE user_id=?`, body.Delta, c.Params("id"))
		if err == nil {
			_, err = tx.Exec(`INSERT INTO router_admin_audit(id,actor_email,action,target,detail) VALUES(?,?,?,?,?)`, uuid.NewString(), actor.Email, "credit.adjust", email, fmt.Sprintf("%+d token · %s", body.Delta, strings.TrimSpace(body.Reason)))
		}
		if err != nil || tx.Commit() != nil {
			return c.Status(500).JSON(fiber.Map{"error": "perubahan belum dapat disimpan"})
		}
		return c.JSON(fiber.Map{"creditLimit": current + body.Delta})
	}
}

func routerAdminRevokeKeyHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		actor, ok := routerAdminUserFromSession(c, db, cfg)
		if !ok {
			return c.Status(403).JSON(fiber.Map{"error": "akses admin diperlukan"})
		}
		var record struct {
			GatewayKeyID string `db:"gateway_key_id"`
			Email        string `db:"email"`
		}
		err := db.Get(&record, `SELECT k.gateway_key_id,u.email FROM router_api_keys k JOIN router_users u ON u.id=k.user_id WHERE k.id=? AND k.revoked_at IS NULL`, c.Params("id"))
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "API key aktif tidak ditemukan"})
		}
		if err != nil || gatewayDeleteKey(cfg, record.GatewayKeyID) != nil {
			return c.Status(502).JSON(fiber.Map{"error": "API key belum dapat dicabut"})
		}
		tx, err := db.Beginx()
		if err != nil {
			return c.SendStatus(500)
		}
		defer tx.Rollback()
		_, err = tx.Exec(`UPDATE router_api_keys SET revoked_at=NOW() WHERE id=?`, c.Params("id"))
		if err == nil {
			_, err = tx.Exec(`INSERT INTO router_admin_audit(id,actor_email,action,target,detail) VALUES(?,?,?,?,?)`, uuid.NewString(), actor.Email, "key.revoke", record.Email, "API key dicabut oleh admin")
		}
		if err != nil || tx.Commit() != nil {
			return c.SendStatus(500)
		}
		return c.SendStatus(204)
	}
}
