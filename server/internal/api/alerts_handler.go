package api

import (
	"database/sql"
	"errors"
	"math"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/alerts"
	"tradewise/server/internal/store"
	tapehub "tradewise/server/internal/ws"
)

func toAlertResponse(r store.OutlookAlertRow) AlertResponse {
	old := ""
	if r.OldBias != nil {
		old = *r.OldBias
	}
	return AlertResponse{
		ID: r.ID, Symbol: r.Symbol, OldBias: old, NewBias: r.NewBias,
		Score: r.Score, CreatedAt: r.CreatedAt.Format(time.RFC3339),
	}
}

// listAlertsHandler returns the most recent bias-change events, newest
// first, for the notification feed's initial (pre-WebSocket) history.
func listAlertsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit := 50
		if v := c.Query("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > 200 {
				return badRequest(c, "limit must be an integer between 1 and 200")
			}
			limit = n
		}

		rows, err := store.ListOutlookAlerts(db, limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		out := make([]AlertResponse, len(rows))
		for i, r := range rows {
			out[i] = toAlertResponse(r)
		}
		return c.JSON(out)
	}
}

func listUserAlertsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit := 50
		if v := c.Query("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > 200 {
				return badRequest(c, "limit must be an integer between 1 and 200")
			}
			limit = n
		}

		userID := c.Locals("screener_user_id").(string)
		settings, err := loadUserAlertSettings(db, userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		rows, err := store.ListUserOutlookAlerts(db, userID, limit, settings.MinScore, settings.Bullish, settings.Bearish, settings.Netral)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		out := make([]AlertResponse, len(rows))
		for i, r := range rows {
			out[i] = toAlertResponse(r)
		}
		return c.JSON(out)
	}
}

type userAlertSettings struct {
	MinScore int  `json:"minScore" db:"min_score"`
	Bullish  bool `json:"bullish" db:"bullish"`
	Bearish  bool `json:"bearish" db:"bearish"`
	Netral   bool `json:"netral" db:"netral"`
}

func ensureUserAlertSettings(db *sqlx.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS user_alert_settings (
		user_id CHAR(36) PRIMARY KEY,
		min_score INT NOT NULL DEFAULT 0,
		bullish BOOLEAN NOT NULL DEFAULT TRUE,
		bearish BOOLEAN NOT NULL DEFAULT TRUE,
		netral BOOLEAN NOT NULL DEFAULT TRUE,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
	return err
}

func loadUserAlertSettings(db *sqlx.DB, userID string) (userAlertSettings, error) {
	settings := userAlertSettings{Bullish: true, Bearish: true, Netral: true}
	err := db.Get(&settings, `SELECT min_score,bullish,bearish,netral FROM user_alert_settings WHERE user_id=?`, userID)
	if err == nil {
		return settings, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return settings, nil
	}
	return settings, err
}

func getUserAlertSettingsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		settings, err := loadUserAlertSettings(db, c.Locals("screener_user_id").(string))
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(settings)
	}
}

func updateUserAlertSettingsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var settings userAlertSettings
		if err := c.BodyParser(&settings); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		settings.MinScore = int(math.Abs(float64(settings.MinScore)))
		if settings.MinScore > 100 {
			return badRequest(c, "minScore must be between 0 and 100")
		}
		if !settings.Bullish && !settings.Bearish && !settings.Netral {
			return badRequest(c, "pilih minimal satu arah sinyal")
		}
		_, err := db.Exec(`INSERT INTO user_alert_settings(user_id,min_score,bullish,bearish,netral) VALUES(?,?,?,?,?)
			ON DUPLICATE KEY UPDATE min_score=VALUES(min_score),bullish=VALUES(bullish),bearish=VALUES(bearish),netral=VALUES(netral)`,
			c.Locals("screener_user_id"), settings.MinScore, settings.Bullish, settings.Bearish, settings.Netral)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(settings)
	}
}

// alertsWSHandler upgrades to a WebSocket and streams every subsequent
// bias-change alert as the background watcher detects it. Terminal-wide,
// not scoped to a symbol — no history replay on connect, same contract as
// /ws/tape/:symbol.
func alertsWSHandler(hub *alerts.Hub) fiber.Handler {
	return websocket.New(func(conn *websocket.Conn) {
		client := tapehub.NewClient(conn)
		hub.Subscribe(client)
		defer hub.Unsubscribe(client)
		defer client.Close()

		go client.WritePump()
		client.ReadPump()
	})
}
