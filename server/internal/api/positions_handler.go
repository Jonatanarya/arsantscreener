package api

import (
	"strconv"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

func createPositionHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req CreatePositionRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		if !validDate(req.EntryDate) {
			return badRequest(c, "invalid entryDate")
		}
		if req.EntryPrice <= 0 {
			return badRequest(c, "entryPrice must be > 0")
		}
		if req.Lot <= 0 {
			return badRequest(c, "lot must be > 0")
		}
		if req.StopLoss != nil && *req.StopLoss >= req.EntryPrice {
			return badRequest(c, "stopLoss must be lower than entryPrice")
		}

		if err := store.EnsureSymbol(db, symbol); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		id, err := store.CreatePosition(db, c.Locals("screener_user_id").(string), store.NewPosition{
			Symbol: symbol, EntryDate: req.EntryDate, EntryPrice: req.EntryPrice, Lot: req.Lot,
			StopLoss: req.StopLoss, TakeProfit: req.TakeProfit, Notes: req.Notes,
		})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		return c.Status(fiber.StatusCreated).JSON(CreatePositionResponse{ID: id})
	}
}

func listPositionsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		status := c.Query("status", "open")
		var dbStatus string
		switch status {
		case "open", "closed":
			dbStatus = status
		case "all":
			dbStatus = ""
		default:
			return badRequest(c, "status must be one of: open, closed, all")
		}

		rows, err := store.ListPositions(db, c.Locals("screener_user_id").(string), dbStatus)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		return c.JSON(buildPositionResponses(db, rows))
	}
}

func closePositionHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id, err := strconv.ParseInt(c.Params("id"), 10, 64)
		if err != nil {
			return badRequest(c, "invalid position id")
		}
		var req ClosePositionRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		if !validDate(req.ExitDate) {
			return badRequest(c, "invalid exitDate")
		}
		if req.ExitPrice <= 0 {
			return badRequest(c, "exitPrice must be > 0")
		}
		if err := store.ClosePosition(db, c.Locals("screener_user_id").(string), id, req.ExitDate, req.ExitPrice); err != nil {
			return badRequest(c, err.Error())
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func deletePositionHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id, err := strconv.ParseInt(c.Params("id"), 10, 64)
		if err != nil {
			return badRequest(c, "invalid position id")
		}
		if err := store.DeletePosition(db, c.Locals("screener_user_id").(string), id); err != nil {
			return badRequest(c, err.Error())
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

// getPortfolioSummaryHandler covers only OPEN positions — concentration
// limits and unrealized P&L are meaningless for closed history.
func getPortfolioSummaryHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := store.ListPositions(db, c.Locals("screener_user_id").(string), "open")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		positions, sectorBySymbol := enrichPositions(db, rows)
		summary := analytics.BuildPortfolioSummary(positions)

		posResp := make([]PositionResponse, len(summary.Positions))
		for i, pr := range summary.Positions {
			posResp[i] = toPositionResponse(rows[i], pr, sectorBySymbol[pr.Symbol])
		}
		warnings := make([]ConcentrationWarning, len(summary.Warnings))
		for i, w := range summary.Warnings {
			warnings[i] = ConcentrationWarning{Kind: w.Kind, Key: w.Key, Pct: w.Pct, Limit: w.Limit}
		}

		return c.JSON(PortfolioSummaryResponse{
			Positions:      posResp,
			TotalCostBasis: summary.TotalCostBasis, TotalMarketValue: summary.TotalMarketValue,
			TotalUnrealizedPL: summary.TotalUnrealizedPL, TotalUnrealizedPLPct: summary.TotalUnrealizedPLPct,
			StockConcentration: summary.StockConcentration, SectorConcentration: summary.SectorConcentration,
			Warnings: warnings,
		})
	}
}

func positionSizeHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req PositionSizeRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		res := analytics.CalculatePositionSize(analytics.PositionSizeInput{
			Equity: req.Equity, RiskPct: req.RiskPct, EntryPrice: req.EntryPrice, StopLoss: req.StopLoss,
		})
		return c.JSON(PositionSizeResponse{
			RiskAmount: res.RiskAmount, PerShareRisk: res.PerShareRisk,
			Lots: res.Lots, Shares: res.Shares, PositionValue: res.PositionValue, Error: res.Error,
		})
	}
}

// buildPositionResponses handles any status mix. Open rows get live
// unrealized P&L against the latest market price; closed rows get realized
// P&L against their recorded exit price — no market data lookup needed.
func buildPositionResponses(db *sqlx.DB, rows []store.PositionRow) []PositionResponse {
	var openRows, closedRows []store.PositionRow
	for _, r := range rows {
		if r.Status == "open" {
			openRows = append(openRows, r)
		} else {
			closedRows = append(closedRows, r)
		}
	}

	out := make(map[int64]PositionResponse, len(rows))
	if len(openRows) > 0 {
		positions, sectorBySymbol := enrichPositions(db, openRows)
		summary := analytics.BuildPortfolioSummary(positions)
		for i, pr := range summary.Positions {
			out[openRows[i].ID] = toPositionResponse(openRows[i], pr, sectorBySymbol[pr.Symbol])
		}
	}
	for _, r := range closedRows {
		costBasis := r.EntryPrice * float64(r.Lot) * 100
		var exitPrice float64
		if r.ExitPrice != nil {
			exitPrice = *r.ExitPrice
		}
		marketValue := exitPrice * float64(r.Lot) * 100
		pl := marketValue - costBasis
		plPct := 0.0
		if costBasis > 0 {
			plPct = pl / costBasis * 100
		}
		resp := PositionResponse{
			ID: r.ID, Symbol: r.Symbol, EntryDate: r.EntryDateStr(), EntryPrice: r.EntryPrice, Lot: r.Lot,
			StopLoss: r.StopLoss, TakeProfit: r.TakeProfit, Notes: r.Notes, Status: r.Status,
			ExitDate: r.ExitDateStr(), ExitPrice: r.ExitPrice,
			CostBasis: costBasis, MarketValue: marketValue, UnrealizedPL: pl, UnrealizedPLPct: plPct,
		}
		out[r.ID] = resp
	}

	ordered := make([]PositionResponse, 0, len(rows))
	for _, r := range rows {
		ordered = append(ordered, out[r.ID])
	}
	return ordered
}

// enrichPositions fetches the latest close price + sector for the distinct
// symbols in rows (concurrently, matching the pattern in listSymbolsHandler)
// and converts to analytics.Position for risk calculation.
func enrichPositions(db *sqlx.DB, rows []store.PositionRow) ([]analytics.Position, map[string]*string) {
	symbolSet := map[string]bool{}
	for _, r := range rows {
		symbolSet[r.Symbol] = true
	}
	symbols := make([]string, 0, len(symbolSet))
	for s := range symbolSet {
		symbols = append(symbols, s)
	}

	prices := make(map[string]float64, len(symbols))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, sym := range symbols {
		wg.Add(1)
		go func(sym string) {
			defer wg.Done()
			bars, err := store.LatestTwoBars(db, sym)
			if err != nil || len(bars) == 0 {
				return
			}
			mu.Lock()
			prices[sym] = bars[0].Close
			mu.Unlock()
		}(sym)
	}
	wg.Wait()

	sectorBySymbol := make(map[string]*string, len(symbols))
	if symbolRows, err := store.GetSymbolsByCodes(db, symbols); err == nil {
		for _, s := range symbolRows {
			sectorBySymbol[s.Code] = s.Sector
		}
	}

	positions := make([]analytics.Position, len(rows))
	for i, r := range rows {
		sector := ""
		if s := sectorBySymbol[r.Symbol]; s != nil {
			sector = *s
		}
		positions[i] = analytics.Position{
			ID: r.ID, Symbol: r.Symbol, Sector: sector,
			EntryPrice: r.EntryPrice, Lot: r.Lot, StopLoss: r.StopLoss,
			CurrentPrice: prices[r.Symbol],
		}
	}
	return positions, sectorBySymbol
}

func toPositionResponse(row store.PositionRow, pr analytics.PositionRisk, sector *string) PositionResponse {
	var currentPrice *float64
	if pr.CurrentPrice > 0 {
		cp := pr.CurrentPrice
		currentPrice = &cp
	}
	return PositionResponse{
		ID: row.ID, Symbol: row.Symbol, Sector: sector, EntryDate: row.EntryDateStr(),
		EntryPrice: row.EntryPrice, Lot: row.Lot, StopLoss: row.StopLoss, TakeProfit: row.TakeProfit,
		Notes: row.Notes, Status: row.Status, ExitDate: row.ExitDateStr(), ExitPrice: row.ExitPrice,
		CurrentPrice: currentPrice, CostBasis: pr.CostBasis, MarketValue: pr.MarketValue,
		UnrealizedPL: pr.UnrealizedPL, UnrealizedPLPct: pr.UnrealizedPLPct, RiskAmount: pr.RiskAmount,
	}
}
