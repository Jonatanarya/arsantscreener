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
	marketEODSource  = "market_eod"
	marketEODJobType = "market_eod.sync_symbol"
)

type MarketEOD struct {
	db          *sqlx.DB
	client      *yahoofinance.Client
	symbolLimit int
	afterHour   int
	afterMinute int
	now         func() time.Time
}

type marketEODPayload struct {
	TargetDate string `json:"targetDate"`
}

func NewMarketEOD(db *sqlx.DB, client *yahoofinance.Client, symbolLimit, afterHour, afterMinute int) *MarketEOD {
	if symbolLimit < 1 || symbolLimit > 1000 {
		symbolLimit = 300
	}
	if afterHour < 0 || afterHour > 23 || afterMinute < 0 || afterMinute > 59 {
		afterHour, afterMinute = 17, 15
	}
	return &MarketEOD{
		db: db, client: client, symbolLimit: symbolLimit,
		afterHour: afterHour, afterMinute: afterMinute, now: time.Now,
	}
}

func (m *MarketEOD) Schedule(ctx context.Context) (int, error) {
	enabled, err := store.DataSourceEnabled(ctx, m.db, marketEODSource)
	if err != nil {
		return 0, err
	}
	if !enabled {
		return 0, nil
	}
	target := ExpectedMarketDate(m.now(), m.afterHour, m.afterMinute)
	symbols, err := store.ListLiquidSymbolsForEOD(ctx, m.db, m.symbolLimit)
	if err != nil {
		return 0, err
	}
	count := 0
	for index, symbol := range symbols {
		payload, _ := json.Marshal(marketEODPayload{TargetDate: target.Format("2006-01-02")})
		_, err := store.EnqueueDataJob(ctx, m.db, store.EnqueueDataJobParams{
			SourceCode:  marketEODSource,
			JobType:     marketEODJobType,
			Symbol:      symbol,
			Priority:    500 + len(symbols) - index,
			MaxAttempts: 3,
			DedupeKey:   fmt.Sprintf("%s:%s:%s", marketEODJobType, target.Format("2006-01-02"), symbol),
			Payload:     payload,
		})
		if err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func (m *MarketEOD) Handle(ctx context.Context, job store.DataJob) (store.DataRunResult, error) {
	symbol := strings.ToUpper(strings.TrimSpace(job.Symbol))
	if symbol == "" {
		return store.DataRunResult{}, fmt.Errorf("market EOD job requires a symbol")
	}
	now := m.now().UTC()
	targetDate := ExpectedMarketDate(now, m.afterHour, m.afterMinute)
	var payload marketEODPayload
	if len(job.Payload) > 0 && json.Unmarshal(job.Payload, &payload) == nil && payload.TargetDate != "" {
		if parsed, err := time.Parse("2006-01-02", payload.TargetDate); err == nil {
			targetDate = parsed
		}
	}
	latestBefore, err := store.LatestBarDate(ctx, m.db, symbol)
	if err != nil {
		return store.DataRunResult{}, err
	}
	from := now.AddDate(0, 0, -45)
	if latestBefore != nil {
		from = latestBefore.AddDate(0, 0, -7)
	}
	bars, err := m.client.FetchDailyBars(symbol, from, now)
	if err != nil {
		count, latest, _ := store.BarCoverage(ctx, m.db, symbol)
		_ = store.UpsertDataFreshness(ctx, m.db, marketEODSource, "daily_bars", symbol, "error", latest, count, err.Error())
		return store.DataRunResult{}, err
	}
	inputs := make([]store.BarInput, 0, len(bars))
	for _, bar := range bars {
		date := bar.Date.Format("2006-01-02")
		if date > targetDate.Format("2006-01-02") {
			continue
		}
		value := bar.Close * float64(bar.Volume)
		inputs = append(inputs, store.BarInput{
			Symbol: symbol, Date: date, Open: bar.Open, High: bar.High,
			Low: bar.Low, Close: bar.Close, Volume: bar.Volume,
			Value: &value, Source: "yahoo_eod",
		})
	}
	if len(inputs) == 0 {
		return store.DataRunResult{}, fmt.Errorf("market EOD returned no usable bars for %s", symbol)
	}
	if err := store.EnsureSymbol(m.db, symbol); err != nil {
		return store.DataRunResult{}, err
	}
	if err := store.UpsertBars(m.db, inputs); err != nil {
		return store.DataRunResult{}, err
	}
	rowCount, latest, err := store.BarCoverage(ctx, m.db, symbol)
	if err != nil {
		return store.DataRunResult{}, err
	}
	status := "stale"
	if latest != nil && !latest.Before(targetDate) {
		status = "fresh"
	}
	if err := store.UpsertDataFreshness(ctx, m.db, marketEODSource, "daily_bars", symbol, status, latest, rowCount, ""); err != nil {
		return store.DataRunResult{}, err
	}
	metadata, _ := json.Marshal(map[string]any{
		"from": from.Format("2006-01-02"), "targetDate": targetDate.Format("2006-01-02"),
		"latestDate": func() string {
			if latest == nil {
				return ""
			}
			return latest.Format("2006-01-02")
		}(),
		"freshness": status,
	})
	return store.DataRunResult{
		ItemsRead: uint64(len(bars)), ItemsWritten: uint64(len(inputs)), Metadata: metadata,
	}, nil
}

// ExpectedMarketDate returns the latest session that should already be final.
// Before the configured post-market time it uses the previous weekday; on a
// weekend it catches up to Friday. Exchange holidays are harmless because the
// adapter remains incremental and records the latest date actually returned.
func ExpectedMarketDate(now time.Time, afterHour, afterMinute int) time.Time {
	location, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		location = time.FixedZone("WIB", 7*60*60)
	}
	local := now.In(location)
	candidate := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	cutoff := time.Date(local.Year(), local.Month(), local.Day(), afterHour, afterMinute, 0, 0, location)
	if local.Before(cutoff) {
		candidate = candidate.AddDate(0, 0, -1)
	}
	for candidate.Weekday() == time.Saturday || candidate.Weekday() == time.Sunday {
		candidate = candidate.AddDate(0, 0, -1)
	}
	return candidate
}
