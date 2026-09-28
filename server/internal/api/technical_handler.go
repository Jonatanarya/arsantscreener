package api

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

// technicalLookbackDays adalah rentang bar yang selalu ditarik, terlepas
// dari periode yang dipilih di header: EMA200 dan posisi 52 minggu butuh
// ~14 bulan data, sementara periode default terminal hanya 3 bulan.
const technicalLookbackDays = 500

type TechnicalResponse struct {
	Symbol     string                      `json:"symbol"`
	Technical  analytics.TechnicalAnalysis `json:"technical"`
	Confluence analytics.Confluence        `json:"confluence"`
	Error      string                      `json:"error,omitempty"`
}

func getTechnicalHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		to := c.Query("to", time.Now().Format("2006-01-02"))
		if !validDate(to) {
			return badRequest(c, "invalid to date")
		}
		toDate, err := time.Parse("2006-01-02", to)
		if err != nil {
			return badRequest(c, "invalid to date")
		}
		from := toDate.AddDate(0, 0, -technicalLookbackDays).Format("2006-01-02")

		barRows, err := store.GetBars(db, symbol, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if len(barRows) < 2 {
			return c.JSON(TechnicalResponse{Symbol: symbol, Error: "data bar harian belum cukup untuk analisa teknikal"})
		}
		bars := make([]analytics.Bar, len(barRows))
		for i, r := range barRows {
			bars[i] = analytics.Bar{Date: r.DateStr(), Open: r.Open, High: r.High, Low: r.Low, Close: r.Close, Volume: r.Volume}
		}

		tech := analytics.AnalyzeTechnical(bars)

		// Konfluensi memakai aliran broker pada periode yang dipilih user
		// (bukan 500 hari di atas) — yang relevan untuk "bandar sedang apa
		// sekarang" adalah jendela pendek.
		flowFrom := c.Query("from", toDate.AddDate(0, -1, 0).Format("2006-01-02"))
		if !validDate(flowFrom) {
			return badRequest(c, "invalid from date")
		}
		var smartShare float64
		hasBroker := false
		if ba, err := buildBrokerAnalysis(db, symbol, flowFrom, to); err == nil && ba.Granularity != "" {
			smartShare = ba.SmartSharePct
			hasBroker = true
		}

		return c.JSON(TechnicalResponse{
			Symbol:     symbol,
			Technical:  tech,
			Confluence: analytics.BuildConfluence(tech, smartShare, hasBroker),
		})
	}
}
