package api

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

func getPVAHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}

		to := c.Query("to", time.Now().Format("2006-01-02"))
		from := c.Query("from", "")
		if from == "" {
			toDate, err := time.Parse("2006-01-02", to)
			if err != nil {
				return badRequest(c, "invalid to date")
			}
			// SMA(20) dan window klimaks 40 hari butuh histori lebih panjang
			// dari default bars/phases — 6 bulan kalender kira-kira cukup
			// untuk >100 hari bursa.
			from = toDate.AddDate(0, -6, 0).Format("2006-01-02")
		}
		if !validDate(from) || !validDate(to) {
			return badRequest(c, "invalid from/to date")
		}

		barRows, err := store.GetBars(db, symbol, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		bars := make([]analytics.Bar, len(barRows))
		for i, r := range barRows {
			bars[i] = analytics.Bar{
				Date: r.DateStr(), Open: r.Open, High: r.High, Low: r.Low, Close: r.Close,
				Volume: r.Volume,
			}
		}

		res := analytics.AnalyzePVA(bars)

		rows := make([]PVARow, len(res.Rows))
		for i, r := range res.Rows {
			rows[i] = PVARow{
				Date: r.Date, Close: r.Close, ChgPct: r.ChgPct, VolRel: r.VolRel,
				Class: r.Class, Desc: r.Desc, Score: r.Score,
			}
		}
		return c.JSON(PVAResponse{
			Symbol: symbol, Rows: rows,
			ObvText: res.ObvText, ObvSignal: res.ObvSignal,
			UpDownRatio: res.UpDownRatio, Dominance: res.Dominance,
			Climax: toClimaxResponse(res.Climax), Score: res.Score, Bias: res.Bias, Error: res.Error,
		})
	}
}
