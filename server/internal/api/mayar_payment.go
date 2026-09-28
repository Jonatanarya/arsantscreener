package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type routerPlan struct {
	ID, Name       string
	Amount, Tokens int64
}

// Product IDs verified against the merchant's authenticated Mayar product API.
var mayarProductPlans = map[string]routerPlan{
	"609f3164-397d-43f9-954d-de3da795576c": {"starter", "Starter", 3300, 5000000},
	"6c3761b3-ff53-459e-b415-e655ed4816a0": {"builder", "Builder", 8700, 20000000},
	"00cff173-77ce-4f64-8033-3c3ae998b933": {"popular", "Popular", 20000, 100000000},
	"57edc1bf-c3ea-485b-993c-5c5df0751c5b": {"scale", "Scale", 100000, 500000000},
}

type mayarPaidTransaction struct {
	TransactionID string `json:"paymentLinkTransactionId"`
	ProductID     string `json:"paymentLinkId"`
	Status        string `json:"status"`
	Credit        int64  `json:"credit"`
	Customer      struct {
		Email string `json:"email"`
	} `json:"customer"`
}

// Webhooks are notifications only. Financial fields always come from an
// authenticated request to Mayar, never from the public callback body.
type mayarPayments struct {
	db              *sqlx.DB
	apiKey, baseURL string
	client          *http.Client
	wake            chan struct{}
	apply           func(mayarPaidTransaction) (bool, error)
}

func registerMayarPayments(app *fiber.App, db *sqlx.DB, cfg RouterAuthConfig) *mayarPayments {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS router_orders (
		id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, plan_id VARCHAR(32) NOT NULL,
		amount BIGINT NOT NULL, credit_tokens BIGINT NOT NULL,
		mayar_payment_id VARCHAR(255) UNIQUE, payment_url TEXT,
		status VARCHAR(24) NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		paid_at TIMESTAMP NULL, INDEX(user_id), INDEX(mayar_payment_id)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	if err == nil {
		_, err = db.Exec(`CREATE TABLE IF NOT EXISTS router_payment_issues (
			payment_id VARCHAR(255) PRIMARY KEY,email VARCHAR(320) NOT NULL,product_id VARCHAR(255) NOT NULL,
			reason VARCHAR(255) NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'open',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			INDEX(status),INDEX(email)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	}
	service := &mayarPayments{db: db, apiKey: cfg.MayarAPIKey, baseURL: "https://api.mayar.id/hl/v2", client: &http.Client{Timeout: 15 * time.Second}, wake: make(chan struct{}, 1)}
	service.apply = service.creditVerifiedPayment
	if err != nil {
		log.Printf("Mayar order schema initialization failed: %v", err)
		app.Post("/payments/mayar/webhook", func(c *fiber.Ctx) error { return c.SendStatus(503) })
		return nil
	}
	app.Post("/payments/mayar/webhook", service.webhook)
	// The old invoice form has been replaced by the four hosted payment links.
	app.Post("/payments/mayar/checkout", func(c *fiber.Ctx) error {
		return c.Status(410).JSON(fiber.Map{"error": "Gunakan tombol Beli paket untuk membuka link pembayaran."})
	})
	if service.apiKey != "" {
		go service.run()
	}
	return service
}

func (s *mayarPayments) webhook(c *fiber.Ctx) error {
	if len(c.Body()) > 64*1024 {
		return c.SendStatus(413)
	}
	var body struct {
		Event string `json:"event"`
	}
	if json.Unmarshal(c.Body(), &body) != nil {
		return c.Status(400).JSON(fiber.Map{"error": "payload tidak valid"})
	}
	if body.Event == "payment.received" {
		if s.apiKey == "" {
			return c.SendStatus(503)
		}
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}
	return c.JSON(fiber.Map{"received": true})
}

func (s *mayarPayments) run() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	var lastAttempt time.Time
	for {
		// Coalesce repeated callbacks. The periodic sweep also recovers dropped
		// callbacks and purchases whose customer registered after paying.
		if time.Since(lastAttempt) >= 5*time.Second {
			lastAttempt = time.Now()
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			err := s.reconcile(ctx)
			cancel()
			if err != nil {
				log.Printf("Mayar payment reconciliation failed: %v", err)
			}
		}
		select {
		case <-ticker.C:
		case <-s.wake:
		}
	}
}

func (s *mayarPayments) reconcile(ctx context.Context) error {
	startingAfter := ""
	for requestNumber := 1; requestNumber <= 100; requestNumber++ {
		query := url.Values{}
		query.Set("limit", "50")
		if startingAfter != "" {
			query.Set("startingAfter", startingAfter)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+"/transactions?"+query.Encode(), nil)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+s.apiKey)
		res, err := s.client.Do(req)
		if err != nil {
			return err
		}
		var result struct {
			StatusCode        int                    `json:"statusCode"`
			HasMore           bool                   `json:"hasMore"`
			NextStartingAfter string                 `json:"nextStartingAfter"`
			Data              []mayarPaidTransaction `json:"data"`
		}
		err = json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&result)
		res.Body.Close()
		if res.StatusCode != 200 {
			return fmt.Errorf("Mayar transactions HTTP %d", res.StatusCode)
		}
		if err != nil {
			return fmt.Errorf("decode Mayar transactions: %w", err)
		}
		if result.StatusCode != 200 {
			return fmt.Errorf("Mayar transactions status %d", result.StatusCode)
		}
		for _, payment := range result.Data {
			if _, _, ok := eligibleMayarPayment(payment); !ok {
				continue
			}
			credited, err := s.apply(payment)
			if err != nil {
				return err
			}
			if credited {
				log.Printf("Mayar credited transaction=%s product=%s", payment.TransactionID, payment.ProductID)
			}
		}
		if !result.HasMore {
			return nil
		}
		if result.NextStartingAfter == "" {
			return fmt.Errorf("Mayar V2 pagination missing nextStartingAfter")
		}
		startingAfter = result.NextStartingAfter
	}
	return fmt.Errorf("Mayar reconciliation request limit reached")
}

func eligibleMayarPayment(payment mayarPaidTransaction) (routerPlan, string, bool) {
	plan, ok := mayarProductPlans[payment.ProductID]
	email := strings.ToLower(strings.TrimSpace(payment.Customer.Email))
	address, err := mail.ParseAddress(email)
	if !ok || uuid.Validate(payment.TransactionID) != nil || err != nil || address.Address != email || payment.Credit < plan.Amount {
		return routerPlan{}, "", false
	}
	if payment.Status != "paid" && payment.Status != "settled" {
		return routerPlan{}, "", false
	}
	return plan, email, true
}

func (s *mayarPayments) creditVerifiedPayment(payment mayarPaidTransaction) (bool, error) {
	plan, email, ok := eligibleMayarPayment(payment)
	if !ok {
		return false, nil
	}
	var userID string
	err := s.db.Get(&userID, `SELECT id FROM router_users WHERE email=?`, email)
	if err == sql.ErrNoRows {
		_, _ = s.db.Exec(`INSERT INTO router_payment_issues(payment_id,email,product_id,reason,status) VALUES(?,?,?,'Akun Google dengan email pembayaran belum ditemukan','open') ON DUPLICATE KEY UPDATE email=VALUES(email),reason=VALUES(reason),status='open'`, payment.TransactionID, email, payment.ProductID)
		return false, nil
	}
	if err != nil {
		return false, err
	}
	tx, err := s.db.Beginx()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`INSERT INTO router_orders(id,user_id,plan_id,amount,credit_tokens,mayar_payment_id,payment_url,status)
		VALUES(?,?,?,?,?,?,?,'pending') ON DUPLICATE KEY UPDATE id=id`, uuid.NewString(), userID, plan.ID, plan.Amount, plan.Tokens, payment.TransactionID, "https://arsantdigitalstore.myr.id/pl/arsant-router-"+plan.ID)
	if err != nil {
		return false, err
	}
	var order struct {
		UserID string `db:"user_id"`
		PlanID string `db:"plan_id"`
		Status string `db:"status"`
		Tokens int64  `db:"credit_tokens"`
	}
	err = tx.Get(&order, `SELECT user_id,plan_id,status,credit_tokens FROM router_orders WHERE mayar_payment_id=? FOR UPDATE`, payment.TransactionID)
	if err != nil {
		return false, err
	}
	if order.Status == "paid" {
		return false, nil
	}
	if order.UserID != userID || order.PlanID != plan.ID || order.Tokens != plan.Tokens {
		return false, fmt.Errorf("Mayar order mismatch for %s", payment.TransactionID)
	}
	_, err = tx.Exec(`INSERT INTO router_wallets(user_id,credit_tokens) VALUES(?,?)
		ON DUPLICATE KEY UPDATE credit_tokens=credit_tokens+VALUES(credit_tokens)`, userID, plan.Tokens)
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(`UPDATE router_orders SET status='paid',paid_at=NOW() WHERE mayar_payment_id=?`, payment.TransactionID)
	if err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	_, _ = s.db.Exec(`UPDATE router_payment_issues SET status='resolved' WHERE payment_id=?`, payment.TransactionID)
	return true, nil
}
