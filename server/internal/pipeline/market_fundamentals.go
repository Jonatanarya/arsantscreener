package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
	"tradewise/server/internal/yahoofinance"
)

const (
	marketFundamentalsSource  = "market_fundamentals"
	marketFundamentalsJobType = "market_fundamentals.sync_symbol"
)

// MarketFundamentals refreshes the liquid universe once per week. Jobs are
// deliberately spread out so a slow upstream source never competes with the
// daily price and broker-summary pipelines.
type MarketFundamentals struct {
	db           *sqlx.DB
	client       *yahoofinance.Client
	symbolLimit  int
	delaySeconds int
	now          func() time.Time
}

func NewMarketFundamentals(db *sqlx.DB, client *yahoofinance.Client, symbolLimit, delaySeconds int) *MarketFundamentals {
	if client == nil {
		client = yahoofinance.NewClient()
	}
	if symbolLimit < 1 || symbolLimit > 1000 {
		symbolLimit = 300
	}
	if delaySeconds < 15 || delaySeconds > 600 {
		delaySeconds = 30
	}
	return &MarketFundamentals{db: db, client: client, symbolLimit: symbolLimit, delaySeconds: delaySeconds, now: time.Now}
}

func (m *MarketFundamentals) Schedule(ctx context.Context) (int, error) {
	enabled, err := store.DataSourceEnabled(ctx, m.db, marketFundamentalsSource)
	if err != nil {
		return 0, err
	}
	if !enabled {
		return 0, nil
	}

	location, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		location = time.FixedZone("WIB", 7*60*60)
	}
	local := m.now().In(location)
	weekStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	for weekStart.Weekday() != time.Monday {
		weekStart = weekStart.AddDate(0, 0, -1)
	}
	cutoff := weekStart.Add(18*time.Hour + 30*time.Minute)
	if local.Before(cutoff) {
		return 0, nil
	}

	symbols, err := store.ListLiquidSymbolsForEOD(ctx, m.db, m.symbolLimit)
	if err != nil {
		return 0, err
	}
	now := m.now().UTC()
	for index, symbol := range symbols {
		runAfter := now.Add(time.Duration(index*m.delaySeconds) * time.Second)
		_, err := store.EnqueueDataJob(ctx, m.db, store.EnqueueDataJobParams{
			SourceCode:   marketFundamentalsSource,
			JobType:      marketFundamentalsJobType,
			Symbol:       symbol,
			Priority:     150,
			MaxAttempts:  3,
			ScheduledFor: now,
			RunAfter:     runAfter,
			DedupeKey:    fmt.Sprintf("%s:%s:%s", marketFundamentalsJobType, weekStart.Format("2006-01-02"), symbol),
		})
		if err != nil {
			return index, err
		}
	}
	return len(symbols), nil
}

func (m *MarketFundamentals) Handle(ctx context.Context, job store.DataJob) (store.DataRunResult, error) {
	symbol := strings.ToUpper(strings.TrimSpace(job.Symbol))
	if symbol == "" {
		return store.DataRunResult{}, fmt.Errorf("fundamentals job requires a symbol")
	}
	fundamentals, err := m.client.FetchFundamentals(symbol)
	if err != nil {
		_ = store.UpsertDataFreshness(ctx, m.db, marketFundamentalsSource, "fundamentals", symbol, "error", nil, 0, err.Error())
		return store.DataRunResult{}, err
	}
	row := store.FundamentalsRow{
		Symbol: fundamentals.Symbol, MarketCap: fundamentals.MarketCap,
		PERatio: fundamentals.PERatio, ForwardPE: fundamentals.ForwardPE, PegRatio: fundamentals.PegRatio,
		PriceToBook: fundamentals.PriceToBook, PriceToSales: fundamentals.PriceToSales,
		BookValue: fundamentals.BookValue, EPSTrailing: fundamentals.EPSTrailing, EPSForward: fundamentals.EPSForward,
		DividendYield: fundamentals.DividendYield, DividendRate: fundamentals.DividendRate, PayoutRatio: fundamentals.PayoutRatio,
		RevenueTTM: fundamentals.RevenueTTM, RevenueGrowth: fundamentals.RevenueGrowth, EarningsGrowth: fundamentals.EarningsGrowth,
		ProfitMargin: fundamentals.ProfitMargin, OperatingMargin: fundamentals.OperatingMargin,
		ROE: fundamentals.ROE, ROA: fundamentals.ROA, TotalCash: fundamentals.TotalCash, TotalDebt: fundamentals.TotalDebt,
		Beta: fundamentals.Beta, SharesOutstanding: fundamentals.SharesOutstanding,
		Week52Low: fundamentals.Week52Low, Week52High: fundamentals.Week52High, Week52Change: fundamentals.Week52Change,
		TargetMeanPrice: fundamentals.TargetMeanPrice, TargetHighPrice: fundamentals.TargetHighPrice, TargetLowPrice: fundamentals.TargetLowPrice,
		NumAnalysts: fundamentals.NumAnalysts,
	}
	if fundamentals.RecommendationKey != "" {
		row.RecommendationKey = &fundamentals.RecommendationKey
	}
	if fundamentals.Currency != "" {
		row.Currency = &fundamentals.Currency
	}
	if err := store.UpsertFundamentals(m.db, row); err != nil {
		return store.DataRunResult{}, err
	}
	if err := store.UpsertDataFreshness(ctx, m.db, marketFundamentalsSource, "fundamentals", symbol, "fresh", nil, 1, ""); err != nil {
		return store.DataRunResult{}, err
	}
	metadata, _ := json.Marshal(map[string]any{"symbol": symbol, "cadence": "weekly"})
	return store.DataRunResult{ItemsRead: 1, ItemsWritten: 1, Metadata: metadata}, nil
}
