package api

import (
	"encoding/json"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

func toLiquidityAlertResponse(r store.LiquidityAlertRow) LiquidityAlertResponse {
	old := ""
	if r.OldLevel != nil {
		old = *r.OldLevel
	}
	var reasons []string
	_ = json.Unmarshal(r.Reasons, &reasons)
	return LiquidityAlertResponse{
		ID: r.ID, Symbol: r.Symbol, OldLevel: old, NewLevel: r.NewLevel,
		Score: r.Score, Reasons: reasons, CreatedAt: r.CreatedAt.Format(time.RFC3339),
	}
}

// listLiquidityAlertsHandler returns the most recent volume/liquidity level
// changes, newest first — the history feed for the watcher's
// analytics.DetectLiquidityShift, analogous to GET /alerts for Outlook bias.
func listLiquidityAlertsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit := 50
		if v := c.Query("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > 200 {
				return badRequest(c, "limit must be an integer between 1 and 200")
			}
			limit = n
		}

		rows, err := store.ListLiquidityAlerts(db, limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		out := make([]LiquidityAlertResponse, len(rows))
		for i, r := range rows {
			out[i] = toLiquidityAlertResponse(r)
		}
		return c.JSON(out)
	}
}

// listLiquidityCandidatesHandler returns symbols currently sitting in a
// non-normal level (surge / awakening / surge+awakening) — the screener list
// meant to decide which symbols are worth spending running-trade / broker
// summary daily crawl budget on today, instead of pulling that for the
// entire ~900-symbol universe.
func listLiquidityCandidatesHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit := 100
		if v := c.Query("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > 900 {
				return badRequest(c, "limit must be an integer between 1 and 900")
			}
			limit = n
		}

		rows, err := store.ListLiquidityCandidates(db, limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		out := make([]LiquidityCandidateResponse, len(rows))
		for i, r := range rows {
			out[i] = LiquidityCandidateResponse{
				Symbol: r.Symbol, Level: r.Level, Score: r.Score,
				UpdatedAt: r.UpdatedAt.Format(time.RFC3339),
			}
		}
		return c.JSON(out)
	}
}
