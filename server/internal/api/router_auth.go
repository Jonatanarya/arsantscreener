package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// RouterAuthConfig is deliberately separate from 9Router credentials. Customer
// identity is owned by Arsant and is never delegated to the upstream gateway.
type RouterAuthConfig struct {
	GoogleClientID             string
	GoogleClientSecret         string
	GoogleRedirectURL          string
	ScreenerGoogleClientID     string
	ScreenerGoogleClientSecret string
	SessionSecret              string
	GatewayURL                 string
	GatewayPassword            string
	MayarAPIKey                string
	GatewayDBPath              string
	Usage                      *routerUsage
	LoadGate                   *routerLoadGate
	AdminEmails                string
}

type routerUser struct {
	ID      string `db:"id"`
	Email   string `db:"email"`
	Name    string `db:"name"`
	Picture string `db:"picture"`
}

type googleTokenResponse struct {
	AccessToken string `json:"access_token"`
}

type googleProfile struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

func RegisterRouterAuthRoutes(app *fiber.App, db *sqlx.DB, cfg RouterAuthConfig) {
	// The table is independent from screener data and safe to create repeatedly.
	if err := ensureRouterUsersTable(db); err != nil {
		log.Printf("router users schema initialization failed: %v", err)
	}
	_ = ensureRouterDashboardTables(db)
	if err := ensureCustomerModelCatalog(db); err != nil {
		log.Printf("customer model catalog initialization failed: %v", err)
	}
	usage, err := newRouterUsage(db, cfg.GatewayDBPath)
	if err != nil {
		log.Printf("router usage initialization: %v", err)
	} else {
		cfg.Usage = usage
		go usage.run()
		if err := syncCustomerModelCatalog(db, usage.source); err != nil {
			log.Printf("customer model catalog sync: %v", err)
		}
		go runCustomerModelCatalogSync(db, usage.source)
	}
	cfg.LoadGate = newRouterLoadGate()

	app.Get("/router/credit-check", routerCreditHandler(cfg.Usage.authorizeCredit))
	app.Get("/router/models", newModelTracker(cfg).handler)
	startCustomerModelProxy(cfg)
	app.Get("/auth/google", googleLoginHandler(cfg))
	app.Get("/auth/google/callback", googleCallbackHandler(db, cfg))
	app.Get("/auth/session", routerSessionHandler(db, cfg))
	app.Post("/auth/logout", routerLogoutHandler())
	app.Get("/router/dashboard", routerDashboardHandler(db, cfg))
	app.Post("/router/keys", routerCreateKeyHandler(db, cfg))
	app.Post("/router/keys/:id/rotate", routerRotateKeyHandler(db, cfg))
	app.Delete("/router/keys/:id", routerRevokeKeyHandler(db, cfg))
	payments := registerMayarPayments(app, db, cfg)
	registerRouterAdminRoutes(app, db, cfg, payments)
}

func ensureRouterUsersTable(db *sqlx.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS router_users (
		id CHAR(36) NOT NULL PRIMARY KEY,
		google_sub VARCHAR(255) NOT NULL UNIQUE,
		email VARCHAR(320) NOT NULL,
		name VARCHAR(255) NOT NULL DEFAULT '',
		picture MEDIUMTEXT NOT NULL,
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		last_login_at TIMESTAMP NULL DEFAULT NULL,
		UNIQUE KEY router_users_email_unique (email)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	if err != nil {
		return err
	}
	// Google can return avatar URLs longer than 1,024 characters. Upgrade
	// existing installations as CREATE TABLE IF NOT EXISTS preserves their schema.
	var pictureType string
	if err := db.Get(&pictureType, `SELECT DATA_TYPE FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'router_users' AND COLUMN_NAME = 'picture'`); err != nil {
		return err
	}
	if pictureType != "mediumtext" && pictureType != "longtext" {
		_, err = db.Exec(`ALTER TABLE router_users MODIFY COLUMN picture MEDIUMTEXT NOT NULL`)
	}
	return err
}

func googleLoginHandler(cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if !routerAuthConfigured(cfg) {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "Google login belum dikonfigurasi"})
		}

		state, err := secureRandom(32)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "tidak dapat memulai login"})
		}
		returnTo := safeReturnTo(c.Query("returnTo"))
		c.Cookie(&fiber.Cookie{
			Name:     "arsant_router_oauth",
			Value:    signedValue(state+"|"+returnTo, cfg.SessionSecret),
			Path:     "/api/auth/google",
			HTTPOnly: true,
			Secure:   true,
			SameSite: "Lax",
			MaxAge:   600,
		})

		query := url.Values{
			"client_id":     {cfg.GoogleClientID},
			"redirect_uri":  {cfg.GoogleRedirectURL},
			"response_type": {"code"},
			"scope":         {"openid email profile"},
			"state":         {state},
			"prompt":        {"select_account"},
		}
		return c.Redirect("https://accounts.google.com/o/oauth2/v2/auth?" + query.Encode())
	}
}

func googleCallbackHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if !routerAuthConfigured(cfg) {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "Google login belum dikonfigurasi"})
		}
		payload, ok := verifiedValue(c.Cookies("arsant_router_oauth"), cfg.SessionSecret)
		parts := strings.SplitN(payload, "|", 2)
		if !ok || len(parts) != 2 || !hmac.Equal([]byte(parts[0]), []byte(c.Query("state"))) || c.Query("code") == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "sesi login tidak valid atau telah kedaluwarsa"})
		}

		profile, err := fetchGoogleProfile(c.Query("code"), cfg)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "verifikasi Google gagal"})
		}
		if profile.Subject == "" || profile.Email == "" {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "profil Google tidak lengkap"})
		}
		user, err := upsertRouterUser(db, profile)
		if err != nil {
			log.Printf("router Google user upsert failed: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "akun tidak dapat disimpan"})
		}

		sessionDuration := 30 * 24 * time.Hour
		if routerAdminAllowed(user.Email, cfg) {
			sessionDuration = 8 * time.Hour
		}
		expiresAt := time.Now().Add(sessionDuration).Unix()
		c.Cookie(&fiber.Cookie{
			Name:     "arsant_router_session",
			Value:    signedValue(user.ID+"|"+strconv.FormatInt(expiresAt, 10), cfg.SessionSecret),
			Path:     "/",
			HTTPOnly: true,
			Secure:   true,
			SameSite: "Lax",
			MaxAge:   int(sessionDuration.Seconds()),
		})
		c.ClearCookie("arsant_router_oauth")
		return c.Redirect(safeReturnTo(parts[1]))
	}
}

func routerSessionHandler(db *sqlx.DB, cfg RouterAuthConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := routerSessionUser(c, db, cfg)
		if !ok {
			return c.JSON(fiber.Map{"authenticated": false})
		}
		return c.JSON(fiber.Map{"authenticated": true, "isAdmin": routerAdminAllowed(user.Email, cfg), "user": fiber.Map{
			"name": user.Name, "email": user.Email, "avatarUrl": user.Picture,
		}})
	}
}

func routerLogoutHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Cookie(&fiber.Cookie{
			Name:     "arsant_router_session",
			Value:    "",
			Path:     "/",
			HTTPOnly: true,
			Secure:   true,
			SameSite: "Lax",
			MaxAge:   -1,
		})
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func routerSessionUser(c *fiber.Ctx, db *sqlx.DB, cfg RouterAuthConfig) (routerUser, bool) {
	if cfg.SessionSecret == "" {
		return routerUser{}, false
	}
	payload, ok := verifiedValue(c.Cookies("arsant_router_session"), cfg.SessionSecret)
	parts := strings.SplitN(payload, "|", 2)
	if !ok || len(parts) != 2 {
		return routerUser{}, false
	}
	expiresAt, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || time.Now().Unix() > expiresAt {
		return routerUser{}, false
	}
	var user routerUser
	if err := db.Get(&user, `SELECT id, email, name, picture FROM router_users WHERE id = ?`, parts[0]); err != nil {
		return routerUser{}, false
	}
	return user, true
}

func fetchGoogleProfile(code string, cfg RouterAuthConfig) (googleProfile, error) {
	form := url.Values{
		"code":          {code},
		"client_id":     {cfg.GoogleClientID},
		"client_secret": {cfg.GoogleClientSecret},
		"redirect_uri":  {cfg.GoogleRedirectURL},
		"grant_type":    {"authorization_code"},
	}
	response, err := http.Post("https://oauth2.googleapis.com/token", "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		return googleProfile{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return googleProfile{}, fmt.Errorf("token exchange returned %d", response.StatusCode)
	}
	var token googleTokenResponse
	if err := json.NewDecoder(response.Body).Decode(&token); err != nil || token.AccessToken == "" {
		return googleProfile{}, fmt.Errorf("invalid token response")
	}

	request, err := http.NewRequest(http.MethodGet, "https://openidconnect.googleapis.com/v1/userinfo", nil)
	if err != nil {
		return googleProfile{}, err
	}
	request.Header.Set("Authorization", "Bearer "+token.AccessToken)
	profileResponse, err := http.DefaultClient.Do(request)
	if err != nil {
		return googleProfile{}, err
	}
	defer profileResponse.Body.Close()
	if profileResponse.StatusCode < 200 || profileResponse.StatusCode > 299 {
		return googleProfile{}, fmt.Errorf("userinfo returned %d", profileResponse.StatusCode)
	}
	var profile googleProfile
	if err := json.NewDecoder(io.LimitReader(profileResponse.Body, 1<<20)).Decode(&profile); err != nil {
		return googleProfile{}, err
	}
	return profile, nil
}

func upsertRouterUser(db *sqlx.DB, profile googleProfile) (routerUser, error) {
	var user routerUser
	err := db.Get(&user, `SELECT id, email, name, picture FROM router_users WHERE google_sub = ? OR email = ? LIMIT 1`, profile.Subject, profile.Email)
	if err != nil && err != sql.ErrNoRows {
		return routerUser{}, err
	}
	if err == sql.ErrNoRows {
		user.ID = uuid.NewString()
		_, err = db.Exec(`INSERT INTO router_users (id, google_sub, email, name, picture, last_login_at) VALUES (?, ?, ?, ?, ?, NOW())`, user.ID, profile.Subject, profile.Email, profile.Name, profile.Picture)
		if err != nil {
			return routerUser{}, err
		}
	} else {
		_, err = db.Exec(`UPDATE router_users SET google_sub = ?, email = ?, name = ?, picture = ?, last_login_at = NOW() WHERE id = ?`, profile.Subject, profile.Email, profile.Name, profile.Picture, user.ID)
		if err != nil {
			return routerUser{}, err
		}
	}
	user.Email, user.Name, user.Picture = profile.Email, profile.Name, profile.Picture
	return user, nil
}

func routerAuthConfigured(cfg RouterAuthConfig) bool {
	return cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "" && cfg.GoogleRedirectURL != "" && cfg.SessionSecret != ""
}

func secureRandom(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func signedValue(payload, secret string) string {
	encoded := base64.RawURLEncoding.EncodeToString([]byte(payload))
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifiedValue(value, secret string) (string, bool) {
	parts := strings.SplitN(value, ".", 2)
	if len(parts) != 2 || secret == "" {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0]))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return "", false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	return string(bytes.TrimSpace(payload)), true
}

func safeReturnTo(value string) string {
	if strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") {
		return value
	}
	return "/dashboard"
}
