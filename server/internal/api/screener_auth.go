package api

import (
	"crypto/hmac"
	"database/sql"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"log"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const screenerCallback = "https://arsant.web.id/api/account/google/callback"
const screenerSessionCookie = "arsant_screener_session"

type screenerUser struct{ ID, Email, Name, Picture string }

func RegisterScreenerAuthRoutes(app *fiber.App, db *sqlx.DB, cfg RouterAuthConfig) {
	if err := ensureScreenerUsers(db); err != nil {
		log.Printf("screener auth schema: %v", err)
	}
	if err := ensureUserWatchlists(db); err != nil {
		log.Printf("watchlist schema: %v", err)
	}
	if err := ensureUserAlertSettings(db); err != nil {
		log.Printf("alert settings schema: %v", err)
	}
	app.Get("/account/google", screenerGoogleLogin(cfg))
	app.Get("/account/google/callback", screenerGoogleCallback(db, cfg))
	app.Get("/account/session", screenerSessionHandler(db, cfg))
	app.Post("/account/logout", screenerLogoutHandler())
}
func ensureScreenerUsers(db *sqlx.DB) error {
	_, e := db.Exec(`CREATE TABLE IF NOT EXISTS screener_users (id CHAR(36) PRIMARY KEY, google_sub VARCHAR(255) NOT NULL UNIQUE, email VARCHAR(320) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL DEFAULT '', picture MEDIUMTEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_login_at TIMESTAMP NULL DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	if e != nil {
		return e
	}
	var n int
	if e = db.Get(&n, `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='positions' AND COLUMN_NAME='user_id'`); e != nil {
		return e
	}
	if n == 0 {
		_, e = db.Exec(`ALTER TABLE positions ADD COLUMN user_id CHAR(36) NULL AFTER id, ADD KEY idx_positions_user_status(user_id,status)`)
	}
	return e
}
func screenerGoogleLogin(cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if cfg.ScreenerGoogleClientID == "" || cfg.ScreenerGoogleClientSecret == "" || cfg.SessionSecret == "" {
			return c.Status(503).JSON(fiber.Map{"error": "Google login belum dikonfigurasi"})
		}
		state, e := secureRandom(32)
		if e != nil {
			return c.SendStatus(500)
		}
		ret := safeReturnTo(c.Query("returnTo"))
		c.Cookie(&fiber.Cookie{Name: "arsant_screener_oauth", Value: signedValue(state+"|"+ret, cfg.SessionSecret), Path: "/api/account/google", HTTPOnly: true, Secure: true, SameSite: "Lax", MaxAge: 600})
		q := url.Values{"client_id": {cfg.ScreenerGoogleClientID}, "redirect_uri": {screenerCallback}, "response_type": {"code"}, "scope": {"openid email profile"}, "state": {state}, "prompt": {"select_account"}}
		return c.Redirect("https://accounts.google.com/o/oauth2/v2/auth?" + q.Encode())
	}
}
func screenerGoogleCallback(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		payload, ok := verifiedValue(c.Cookies("arsant_screener_oauth"), cfg.SessionSecret)
		parts := strings.SplitN(payload, "|", 2)
		if !ok || len(parts) != 2 || !hmac.Equal([]byte(parts[0]), []byte(c.Query("state"))) {
			return c.Status(400).JSON(fiber.Map{"error": "sesi login tidak valid"})
		}
		local := cfg
		local.GoogleClientID = cfg.ScreenerGoogleClientID
		local.GoogleClientSecret = cfg.ScreenerGoogleClientSecret
		local.GoogleRedirectURL = screenerCallback
		p, e := fetchGoogleProfile(c.Query("code"), local)
		if e != nil {
			return c.Status(502).JSON(fiber.Map{"error": "verifikasi Google gagal"})
		}
		u, e := upsertScreenerUser(db, p)
		if e != nil {
			return c.SendStatus(500)
		}
		exp := time.Now().Add(30 * 24 * time.Hour).Unix()
		c.Cookie(&fiber.Cookie{Name: screenerSessionCookie, Value: signedValue(u.ID+"|"+strconv.FormatInt(exp, 10), cfg.SessionSecret), Path: "/", HTTPOnly: true, Secure: true, SameSite: "Lax", MaxAge: 30 * 24 * 3600})
		c.ClearCookie("arsant_screener_oauth")
		return c.Redirect(safeReturnTo(parts[1]))
	}
}
func upsertScreenerUser(db *sqlx.DB, p googleProfile) (screenerUser, error) {
	var u screenerUser
	e := db.QueryRowx(`SELECT id,email,name,picture FROM screener_users WHERE google_sub=? OR email=? LIMIT 1`, p.Subject, p.Email).Scan(&u.ID, &u.Email, &u.Name, &u.Picture)
	if e == sql.ErrNoRows {
		u.ID = uuid.NewString()
		_, e = db.Exec(`INSERT INTO screener_users(id,google_sub,email,name,picture,last_login_at) VALUES(?,?,?,?,?,NOW())`, u.ID, p.Subject, p.Email, p.Name, p.Picture)
	} else if e == nil {
		_, e = db.Exec(`UPDATE screener_users SET google_sub=?,email=?,name=?,picture=?,last_login_at=NOW() WHERE id=?`, p.Subject, p.Email, p.Name, p.Picture, u.ID)
	}
	u.Email, u.Name, u.Picture = p.Email, p.Name, p.Picture
	return u, e
}
func screenerSessionHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		u, ok := screenerSessionUser(c, db, cfg.SessionSecret)
		if !ok {
			return c.JSON(fiber.Map{"authenticated": false})
		}
		return c.JSON(fiber.Map{"authenticated": true, "isAdmin": routerAdminAllowed(u.Email, cfg), "user": fiber.Map{"name": u.Name, "email": u.Email, "avatarUrl": u.Picture}})
	}
}
func screenerLogoutHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Cookie(&fiber.Cookie{Name: screenerSessionCookie, Value: "", Path: "/", HTTPOnly: true, Secure: true, SameSite: "Lax", MaxAge: -1})
		return c.SendStatus(204)
	}
}

type deleteAccountRequest struct {
	Confirmation string `json:"confirmation"`
}

func deleteScreenerAccountHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req deleteAccountRequest
		if c.BodyParser(&req) != nil || req.Confirmation != "HAPUS AKUN" {
			return badRequest(c, "konfirmasi tidak sesuai")
		}
		userID := c.Locals("screener_user_id").(string)
		if err := deleteScreenerAccount(db, userID); err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "akun belum dapat dihapus"})
		}
		c.Cookie(&fiber.Cookie{Name: screenerSessionCookie, Value: "", Path: "/", HTTPOnly: true, Secure: true, SameSite: "Lax", MaxAge: -1})
		return c.SendStatus(204)
	}
}

func deleteScreenerAccount(db *sqlx.DB, userID string) error {
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, query := range []string{
		`DELETE FROM user_watchlist_items WHERE user_id=?`,
		`DELETE FROM user_watchlists WHERE user_id=?`,
		`DELETE FROM user_alert_settings WHERE user_id=?`,
		`DELETE FROM positions WHERE user_id=?`,
		`DELETE FROM screener_users WHERE id=?`,
	} {
		if _, err = tx.Exec(query, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func screenerSessionUser(c *fiber.Ctx, db *sqlx.DB, secret string) (screenerUser, bool) {
	p, ok := verifiedValue(c.Cookies(screenerSessionCookie), secret)
	parts := strings.SplitN(p, "|", 2)
	if !ok || len(parts) != 2 {
		return screenerUser{}, false
	}
	exp, e := strconv.ParseInt(parts[1], 10, 64)
	if e != nil || time.Now().Unix() > exp {
		return screenerUser{}, false
	}
	var u screenerUser
	e = db.QueryRowx(`SELECT id,email,name,picture FROM screener_users WHERE id=?`, parts[0]).Scan(&u.ID, &u.Email, &u.Name, &u.Picture)
	return u, e == nil
}
func requireScreenerUser(db *sqlx.DB, secret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		u, ok := screenerSessionUser(c, db, secret)
		if !ok {
			return c.Status(401).JSON(fiber.Map{"error": "login diperlukan"})
		}
		c.Locals("screener_user_id", u.ID)
		return c.Next()
	}
}

func requireScreenerAdmin(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		u, ok := screenerSessionUser(c, db, cfg.SessionSecret)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "login diperlukan"})
		}
		if !routerAdminAllowed(u.Email, cfg) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "akses admin diperlukan"})
		}
		return c.Next()
	}
}
