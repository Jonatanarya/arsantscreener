package api

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

func listSymbolsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbols, err := store.ListSymbolQuotes(db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		items := make([]WatchlistItem, len(symbols))
		for i, s := range symbols {
			items[i] = WatchlistItem{Symbol: s.Code, Name: s.Name, Sector: s.Sector, Close: s.Close, Volume: s.Volume, PrevClose: s.PrevClose}
			if s.Date != nil {
				date := s.Date.Format("2006-01-02")
				items[i].Date = &date
			}
			if s.Close != nil && s.PrevClose != nil && *s.PrevClose != 0 {
				pct := (*s.Close - *s.PrevClose) / *s.PrevClose * 100
				items[i].ChangePct = &pct
			}
		}

		return c.JSON(items)
	}
}

func searchSymbolsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		query := strings.TrimSpace(c.Query("q"))
		if query == "" {
			return c.JSON([]WatchlistItem{})
		}
		rows, err := store.SearchSymbols(db, query, 8)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		items := make([]WatchlistItem, len(rows))
		for i, row := range rows {
			items[i] = WatchlistItem{Symbol: row.Code, Name: row.Name, Sector: row.Sector}
		}
		return c.JSON(items)
	}
}

func symbolCatalogHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := store.ListSymbols(db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		items := make([]WatchlistItem, len(rows))
		for i, row := range rows {
			items[i] = WatchlistItem{Symbol: row.Code, Name: row.Name, Sector: row.Sector}
		}
		return c.JSON(items)
	}
}

func getBarsHandler(db *sqlx.DB) fiber.Handler {
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

		rows, err := store.GetBars(db, symbol, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		bars := make([]DailyBar, len(rows))
		for i, r := range rows {
			bars[i] = DailyBar{
				Date: r.DateStr(), Open: r.Open, High: r.High, Low: r.Low, Close: r.Close,
				Volume: r.Volume, Value: r.Value, Freq: r.Freq,
				ForeignBuy: r.ForeignBuy, ForeignSell: r.ForeignSell, ForeignFlow: r.ForeignFlow,
			}
		}
		return c.JSON(bars)
	}
}

func getBrokerSummaryHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		date := c.Query("date")
		if !validDate(date) {
			return badRequest(c, "date query param is required (YYYY-MM-DD)")
		}

		buyers, sellers, err := store.GetBrokerSummaryDay(db, symbol, date)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		toRows := func(rows []store.BrokerRowOut) []BrokerRow {
			out := make([]BrokerRow, len(rows))
			for i, r := range rows {
				out[i] = BrokerRow{BrokerCode: r.BrokerCode, Value: r.Value, Lot: r.Lot,
					Freq: r.Freq, InvestorType: r.InvestorType}
			}
			return out
		}

		return c.JSON(BrokerSummaryDay{
			Symbol: symbol, Date: date,
			Buyers: toRows(buyers), Sellers: toRows(sellers),
		})
	}
}

func getBrokerSummaryRangeHandler(db *sqlx.DB) fiber.Handler {
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

		rows, err := store.GetBrokerSummaryAggregate(db, symbol, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		var buyers, sellers []BrokerRow
		for _, r := range rows {
			row := BrokerRow{BrokerCode: r.BrokerCode, Value: r.Value, Lot: r.Lot,
				Freq: r.Freq, InvestorType: r.InvestorType}
			if r.Side == "buy" {
				buyers = append(buyers, row)
			} else {
				sellers = append(sellers, row)
			}
		}

		return c.JSON(BrokerSummaryRangeResponse{
			Symbol: symbol, From: from, To: to,
			Buyers: buyers, Sellers: sellers,
		})
	}
}

func getBrokerSummaryAvailabilityHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		availability, err := store.GetBrokerSummaryAvailability(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(availability)
	}
}

func getBrokerDistributionHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}

		var payload json.RawMessage
		err := db.Get(&payload, `
			SELECT payload FROM raw_ingest
			WHERE (endpoint = 'broker_distribution' OR endpoint LIKE '%distribution%') AND symbol = ?
			ORDER BY fetched_at DESC LIMIT 1
		`, symbol)

		if err == nil && len(payload) > 0 && string(payload) != "null" {
			c.Set("Content-Type", "application/json")
			return c.Send(payload)
		}

		// Fallback jika belum ada di raw_ingest: gunakan broker_summary
		to := c.Query("to", time.Now().Format("2006-01-02"))
		from := c.Query("from", "")
		if from == "" {
			if toDate, err2 := time.Parse("2006-01-02", to); err2 == nil {
				from = toDate.AddDate(0, 0, -7).Format("2006-01-02")
			} else {
				from = to
			}
		}

		rows, err := store.GetBrokerSummaryAggregate(db, symbol, from, to)
		if err != nil || len(rows) == 0 {
			return c.JSON(fiber.Map{"data": nil, "symbol": symbol})
		}

		var buyItems []fiber.Map
		var sellItems []fiber.Map

		for _, r := range rows {
			item := fiber.Map{
				"detail": fiber.Map{
					"code":   r.BrokerCode,
					"type":   r.InvestorType,
					"amount": r.Value,
				},
				"distribute_to": []fiber.Map{},
			}
			if r.Side == "buy" {
				buyItems = append(buyItems, item)
			} else {
				sellItems = append(sellItems, item)
			}
		}

		return c.JSON(fiber.Map{
			"data": fiber.Map{
				"by_value": fiber.Map{
					"top_broker_buy":  buyItems,
					"top_broker_sell": sellItems,
				},
				"by_volume": fiber.Map{
					"top_broker_buy":  buyItems,
					"top_broker_sell": sellItems,
				},
			},
		})
	}
}

func getHistoricalSummaryHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol parameter is required")
		}
		period := strings.TrimSpace(c.Query("period"))
		limit, _ := strconv.Atoi(c.Query("limit"))
		rows, err := store.GetHistoricalSummary(db, symbol, period, limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}
