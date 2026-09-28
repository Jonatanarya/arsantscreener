package api

import (
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

// getOutlookHandler reuses the same bars/broker-summary fetch + DetectPhases
// + AnalyzePVA pipeline as /phases and /pva, then synthesizes both into one
// verdict via analytics.BuildOutlook. Uses PVA's longer 6-month lookback
// since Outlook depends on it too.
func getOutlookHandler(db *sqlx.DB) fiber.Handler {
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
			from = toDate.AddDate(0, -6, 0).Format("2006-01-02")
		}
		if !validDate(from) || !validDate(to) {
			return badRequest(c, "invalid from/to date")
		}

		window := 10
		if v := c.Query("window"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 2 || n > 60 {
				return badRequest(c, "window must be an integer between 2 and 60")
			}
			window = n
		}
		sens := c.Query("sensitivity", "sedang")
		if !validSensitivities[sens] {
			return badRequest(c, "sensitivity must be one of: rendah, sedang, tinggi")
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

		var phasePtr *analytics.Phase
		if brokerRows, err := store.GetBrokerSummaryRange(db, symbol, from, to); err == nil && len(brokerRows) > 0 {
			phaseRes := analytics.DetectPhases(bars, reshapeBrokerRows(brokerRows), analytics.Options{
				Window: window, Sensitivity: analytics.Sensitivity(sens),
			})
			if len(phaseRes.Phases) > 0 {
				p := phaseRes.Phases[len(phaseRes.Phases)-1]
				phasePtr = &p
			}
		}

		pvaRes := analytics.AnalyzePVA(bars)
		outlook := analytics.BuildOutlook(phasePtr, pvaRes)

		var phaseResp *Phase
		if phasePtr != nil {
			p := toPhaseResponse(*phasePtr)
			phaseResp = &p
		}

		return c.JSON(OutlookResponse{
			Symbol: symbol, Bias: string(outlook.Bias), Score: outlook.Score,
			Bullish: toOutlookSignals(outlook.Bullish), Bearish: toOutlookSignals(outlook.Bearish),
			Phase: phaseResp, PVABias: pvaRes.Bias, PVAScore: pvaRes.Score,
			Climax: toClimaxResponse(pvaRes.Climax),
		})
	}
}

func toOutlookSignals(signals []analytics.OutlookSignal) []OutlookSignal {
	out := make([]OutlookSignal, len(signals))
	for i, s := range signals {
		out[i] = OutlookSignal{Source: s.Source, Text: s.Text, Points: s.Points}
	}
	return out
}
