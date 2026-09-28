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

var validSensitivities = map[string]bool{"rendah": true, "sedang": true, "tinggi": true}

func getPhasesHandler(db *sqlx.DB) fiber.Handler {
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
			from = toDate.AddDate(0, -3, 0).Format("2006-01-02")
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
		brokerRows, err := store.GetBrokerSummaryRange(db, symbol, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		bars := make([]analytics.Bar, len(barRows))
		for i, r := range barRows {
			bars[i] = analytics.Bar{Date: r.DateStr(), Open: r.Open, High: r.High, Low: r.Low, Close: r.Close}
		}

		brokerByDate := reshapeBrokerRows(brokerRows)

		res := analytics.DetectPhases(bars, brokerByDate, analytics.Options{
			Window:      window,
			Sensitivity: analytics.Sensitivity(sens),
		})

		phases := make([]Phase, len(res.Phases))
		for i, p := range res.Phases {
			phases[i] = toPhaseResponse(p)
		}

		return c.JSON(PhasesResponse{
			Symbol: symbol, Window: window, Sens: sens,
			Phases: phases, Error: res.Error,
		})
	}
}

// reshapeBrokerRows merges the separate buy/sell rows our schema stores into
// the per-broker-per-day {buy, sell} shape analytics.DetectPhases expects.
func reshapeBrokerRows(rows []store.BrokerSummaryRangeRow) map[string][]analytics.BrokerDayFlow {
	byDate := map[string]map[string]*analytics.BrokerDayFlow{}
	for _, r := range rows {
		date := r.DateStr()
		brokers := byDate[date]
		if brokers == nil {
			brokers = map[string]*analytics.BrokerDayFlow{}
			byDate[date] = brokers
		}
		f := brokers[r.BrokerCode]
		if f == nil {
			f = &analytics.BrokerDayFlow{Code: r.BrokerCode}
			brokers[r.BrokerCode] = f
		}
		switch r.Side {
		case "buy":
			f.BuyValue, f.BuyLot, f.BuyFreq = r.Value, r.Lot, r.Freq
		case "sell":
			f.SellValue, f.SellLot, f.SellFreq = r.Value, r.Lot, r.Freq
		}
	}

	out := make(map[string][]analytics.BrokerDayFlow, len(byDate))
	for date, brokers := range byDate {
		flows := make([]analytics.BrokerDayFlow, 0, len(brokers))
		for _, f := range brokers {
			flows = append(flows, *f)
		}
		out[date] = flows
	}
	return out
}
