package api

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

type IngestMarketMoversRequest struct {
	MoverType string                 `json:"moverType"`
	Movers    []store.MarketMoverRow `json:"movers"`
}

type IngestSymbolMetadataRequest struct {
	Symbol string `json:"symbol"`
	Name   string `json:"name"`
	Sector string `json:"sector"`
}

func ingestSymbolMetadataHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestSymbolMetadataRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		if strings.TrimSpace(req.Symbol) == "" {
			return badRequest(c, "symbol is required")
		}
		if err := store.UpsertSymbolMetadata(db, req.Symbol, req.Name, req.Sector); err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"status": "ok"})
	}
}

func ingestMarketMoversHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestMarketMoversRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		for i := range req.Movers {
			if req.Movers[i].MoverType == "" {
				req.Movers[i].MoverType = req.MoverType
			}
		}
		if err := store.UpsertMarketMovers(db, req.Movers); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"status": "ok", "ingested": len(req.Movers)})
	}
}

func getMarketMoversHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		moverType := strings.TrimSpace(c.Query("moverType"))
		rows, err := store.GetMarketMovers(db, moverType)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}

type IngestCalendarEventsRequest struct {
	Events []store.CalendarEventRow `json:"events"`
}

func ingestCalendarEventsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestCalendarEventsRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		if err := store.UpsertCalendarEvents(db, req.Events); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"status": "ok", "ingested": len(req.Events)})
	}
}

func getCalendarEventsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		date := strings.TrimSpace(c.Query("date"))
		rows, err := store.GetCalendarEvents(db, date)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}

type IngestInsiderTxRequest struct {
	Transactions []store.InsiderTxRow `json:"transactions"`
}

func ingestInsiderTransactionsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestInsiderTxRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		if err := store.UpsertInsiderTransactions(db, req.Transactions); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"status": "ok", "ingested": len(req.Transactions)})
	}
}

func getInsiderTransactionsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Query("symbol")))
		rows, err := store.GetInsiderTransactions(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}

// Payload keystats membawa 7 rasio ringkas (kolom tabel `keystats`) PLUS
// seluruh rasio bernama dari Stockbit. Yang kedua disimpan terpisah di
// `keystats_ratios` supaya tidak ada yang terbuang — respons aslinya memuat
// puluhan rasio bergrup, jauh lebih banyak daripada 7 kolom itu.
type IngestKeyStatsRequest struct {
	store.KeyStatsRow
	Ratios []store.KeyStatsRatioRow `json:"ratios"`
}

func ingestKeyStatsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestKeyStatsRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		if err := store.UpsertKeyStats(db, req.KeyStatsRow); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		n := 0
		if len(req.Ratios) > 0 {
			var err error
			if n, err = store.UpsertKeyStatsRatios(db, req.Symbol, req.Ratios); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
			}
		}
		return c.JSON(fiber.Map{"status": "ok", "ratios": n})
	}
}

func getKeyStatsRatiosHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		rows, err := store.GetKeyStatsRatios(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}

func getKeyStatsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		row, err := store.GetKeyStats(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if row == nil {
			return c.JSON(fiber.Map{"symbol": symbol})
		}
		return c.JSON(row)
	}
}

type IngestDividendsRequest struct {
	Dividends []store.DividendRow `json:"dividends"`
}

func ingestDividendsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestDividendsRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		if err := store.UpsertDividends(db, req.Dividends); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"status": "ok", "ingested": len(req.Dividends)})
	}
}

func getDividendsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		rows, err := store.GetDividends(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}

type IngestFinancialStatementsRequest struct {
	Symbol     string                        `json:"symbol"`
	Statements []store.FinancialStatementRow `json:"statements"`
}

func ingestFinancialStatementsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestFinancialStatementsRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		if err := store.UpsertFinancialStatements(db, symbol, req.Statements); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"status": "ok", "ingested": len(req.Statements)})
	}
}

func getFinancialStatementsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		reportType := strings.TrimSpace(c.Query("reportType"))
		statementType := strings.TrimSpace(c.Query("statementType"))
		rows, err := store.GetFinancialStatements(db, symbol, reportType, statementType)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}
