package api

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
	"tradewise/server/internal/yahoofinance"
)

// fundamentalsCacheTTL bounds how often we hit Yahoo Finance's unofficial
// API per symbol. Fundamentals move slowly (quarterly earnings, daily
// price-derived ratios) and the API itself has shown real rate-limiting in
// practice, so a full day of cache is the right trade — freshness isn't
// worth the fragility.
const fundamentalsCacheTTL = 24 * time.Hour

func getFundamentalsHandler(db *sqlx.DB, yf *yahoofinance.Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		forceRefresh := c.Query("refresh") == "true"

		cached, err := store.GetFundamentals(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		fresh := cached != nil && time.Since(cached.FetchedAt) < fundamentalsCacheTTL
		if fresh && !forceRefresh {
			return c.JSON(toFundamentalsResponse(*cached, false, ""))
		}

		f, err := yf.FetchFundamentals(symbol)
		if err != nil {
			if cached != nil {
				return c.JSON(toFundamentalsResponse(*cached, true,
					"gagal ambil data terbaru dari Yahoo Finance, menampilkan cache: "+err.Error()))
			}
			return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
				Error: "gagal ambil data fundamental dari Yahoo Finance: " + err.Error(),
			})
		}

		row := fundamentalsToRow(f)
		if err := store.UpsertFundamentals(db, row); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		reloaded, err := store.GetFundamentals(db, symbol)
		if err != nil || reloaded == nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "reload fundamentals after upsert failed"})
		}
		return c.JSON(toFundamentalsResponse(*reloaded, false, ""))
	}
}

func fundamentalsToRow(f yahoofinance.Fundamentals) store.FundamentalsRow {
	row := store.FundamentalsRow{
		Symbol:            f.Symbol,
		MarketCap:         f.MarketCap,
		PERatio:           f.PERatio,
		ForwardPE:         f.ForwardPE,
		PegRatio:          f.PegRatio,
		PriceToBook:       f.PriceToBook,
		PriceToSales:      f.PriceToSales,
		BookValue:         f.BookValue,
		EPSTrailing:       f.EPSTrailing,
		EPSForward:        f.EPSForward,
		DividendYield:     f.DividendYield,
		DividendRate:      f.DividendRate,
		PayoutRatio:       f.PayoutRatio,
		RevenueTTM:        f.RevenueTTM,
		RevenueGrowth:     f.RevenueGrowth,
		EarningsGrowth:    f.EarningsGrowth,
		ProfitMargin:      f.ProfitMargin,
		OperatingMargin:   f.OperatingMargin,
		ROE:               f.ROE,
		ROA:               f.ROA,
		TotalCash:         f.TotalCash,
		TotalDebt:         f.TotalDebt,
		Beta:              f.Beta,
		SharesOutstanding: f.SharesOutstanding,
		Week52Low:         f.Week52Low,
		Week52High:        f.Week52High,
		Week52Change:      f.Week52Change,
		TargetMeanPrice:   f.TargetMeanPrice,
		TargetHighPrice:   f.TargetHighPrice,
		TargetLowPrice:    f.TargetLowPrice,
		NumAnalysts:       f.NumAnalysts,
	}
	if f.RecommendationKey != "" {
		row.RecommendationKey = &f.RecommendationKey
	}
	if f.Currency != "" {
		row.Currency = &f.Currency
	}
	return row
}

func toFundamentalsResponse(r store.FundamentalsRow, stale bool, errMsg string) FundamentalsResponse {
	resp := FundamentalsResponse{
		Symbol:            r.Symbol,
		MarketCap:         r.MarketCap,
		PERatio:           r.PERatio,
		ForwardPE:         r.ForwardPE,
		PegRatio:          r.PegRatio,
		PriceToBook:       r.PriceToBook,
		PriceToSales:      r.PriceToSales,
		BookValue:         r.BookValue,
		EPSTrailing:       r.EPSTrailing,
		EPSForward:        r.EPSForward,
		DividendYield:     r.DividendYield,
		DividendRate:      r.DividendRate,
		PayoutRatio:       r.PayoutRatio,
		RevenueTTM:        r.RevenueTTM,
		RevenueGrowth:     r.RevenueGrowth,
		EarningsGrowth:    r.EarningsGrowth,
		ProfitMargin:      r.ProfitMargin,
		OperatingMargin:   r.OperatingMargin,
		ROE:               r.ROE,
		ROA:               r.ROA,
		TotalCash:         r.TotalCash,
		TotalDebt:         r.TotalDebt,
		Beta:              r.Beta,
		SharesOutstanding: r.SharesOutstanding,
		Week52Low:         r.Week52Low,
		Week52High:        r.Week52High,
		Week52Change:      r.Week52Change,
		TargetMeanPrice:   r.TargetMeanPrice,
		TargetHighPrice:   r.TargetHighPrice,
		TargetLowPrice:    r.TargetLowPrice,
		NumAnalysts:       r.NumAnalysts,
		FetchedAt:         r.FetchedAt.Format(time.RFC3339),
		Stale:             stale,
		Error:             errMsg,
	}
	if r.RecommendationKey != nil {
		resp.RecommendationKey = *r.RecommendationKey
	}
	if r.Currency != nil {
		resp.Currency = *r.Currency
	}
	return resp
}
