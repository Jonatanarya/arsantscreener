package api

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

func badRequest(c *fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: msg})
}

func validDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

func ingestBarsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestBarsRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}

		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		if len(req.Bars) == 0 {
			return badRequest(c, "bars must not be empty")
		}
		source := req.Source
		if source == "" {
			source = "bridge"
		}

		inputs := make([]store.BarInput, 0, len(req.Bars))
		for _, b := range req.Bars {
			if !validDate(b.Date) {
				return badRequest(c, "invalid bar date: "+b.Date)
			}
			inputs = append(inputs, store.BarInput{
				Symbol: symbol, Date: b.Date,
				Open: b.Open, High: b.High, Low: b.Low, Close: b.Close,
				Volume: int64(b.Volume), Value: b.Value, Freq: flexIntPtr(b.Freq),
				ForeignBuy: flexInt64Ptr(b.ForeignBuy), ForeignSell: flexInt64Ptr(b.ForeignSell), ForeignFlow: flexInt64Ptr(b.ForeignFlow),
				Source: source,
			})
		}

		if err := store.EnsureSymbol(db, symbol); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if err := store.UpsertBars(db, inputs); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		return c.SendStatus(fiber.StatusNoContent)
	}
}

func ingestBrokerSummaryHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestBrokerSummaryRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}

		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		if !validDate(req.Date) {
			return badRequest(c, "invalid date: "+req.Date)
		}

		rows := make([]store.BrokerRowInput, 0, len(req.Buyers)+len(req.Sellers))
		for _, b := range req.Buyers {
			rows = append(rows, store.BrokerRowInput{
				Symbol: symbol, Date: req.Date, BrokerCode: b.BrokerCode,
				Side: "buy", Value: b.Value, Lot: int64(b.Lot), Freq: int(b.Freq),
				InvestorType: b.InvestorType,
			})
		}
		for _, s := range req.Sellers {
			rows = append(rows, store.BrokerRowInput{
				Symbol: symbol, Date: req.Date, BrokerCode: s.BrokerCode,
				Side: "sell", Value: s.Value, Lot: int64(s.Lot), Freq: int(s.Freq),
				InvestorType: s.InvestorType,
			})
		}

		if err := store.EnsureSymbol(db, symbol); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if err := store.UpsertBrokerSummary(db, rows); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		return c.SendStatus(fiber.StatusNoContent)
	}
}
