package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/stockbitagent"
	"tradewise/server/internal/store"
)

const brokerActivityJobType = "broker_activity.sync_symbol_day"

type brokerActivityProvider interface {
	Health(context.Context) (stockbitagent.Health, error)
	FetchBrokerSummary(context.Context, string, string) (json.RawMessage, error)
}

type BrokerActivity struct {
	db          *sqlx.DB
	provider    brokerActivityProvider
	symbolLimit int
}

type brokerActivityPayload struct {
	TargetDate string `json:"targetDate"`
}

type brokerSessionRequiredError struct{ err error }

func (e *brokerSessionRequiredError) Error() string                     { return e.err.Error() }
func (e *brokerSessionRequiredError) Unwrap() error                     { return e.err }
func (e *brokerSessionRequiredError) PipelineRetryDelay() time.Duration { return 15 * time.Minute }
func (e *brokerSessionRequiredError) PipelinePreserveAttempts() bool    { return true }
func (e *brokerSessionRequiredError) PipelineSourceStatus() string      { return "authentication_required" }

func NewBrokerActivity(db *sqlx.DB, provider brokerActivityProvider, symbolLimit int) *BrokerActivity {
	if symbolLimit < 1 || symbolLimit > 1000 {
		symbolLimit = 300
	}
	return &BrokerActivity{db: db, provider: provider, symbolLimit: symbolLimit}
}

func (b *BrokerActivity) Schedule(ctx context.Context) (int, error) {
	enabled, err := store.DataSourceEnabled(ctx, b.db, "broker_activity")
	if err != nil {
		return 0, err
	}
	if !enabled {
		return 0, nil
	}
	health, err := b.provider.Health(ctx)
	if err != nil {
		_ = store.RecordDataSourceHealth(ctx, b.db, "broker_activity", "session_unavailable", err.Error())
		return 0, nil
	}
	if !health.Authenticated {
		_ = store.RecordDataSourceHealth(ctx, b.db, "broker_activity", "authentication_required", "Stockbit session requires login")
		return 0, nil
	}
	_ = store.RecordDataSourceHealth(ctx, b.db, "broker_activity", "ready", "")
	target, err := store.LatestOverallBarDate(ctx, b.db)
	if err != nil || target == nil {
		return 0, err
	}
	if _, err := store.ReviveBrokerSessionJobs(ctx, b.db, target.Format("2006-01-02")); err != nil {
		return 0, err
	}
	symbols, err := store.ListLiquidSymbolsForEOD(ctx, b.db, b.symbolLimit)
	if err != nil {
		return 0, err
	}
	count := 0
	for index, symbol := range symbols {
		payload, _ := json.Marshal(brokerActivityPayload{TargetDate: target.Format("2006-01-02")})
		_, err := store.EnqueueDataJob(ctx, b.db, store.EnqueueDataJobParams{
			SourceCode: "broker_activity", JobType: brokerActivityJobType, Symbol: symbol,
			Priority: 700 + len(symbols) - index, MaxAttempts: 3,
			DedupeKey: fmt.Sprintf("%s:%s:%s", brokerActivityJobType, target.Format("2006-01-02"), symbol),
			Payload:   payload,
		})
		if err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func (b *BrokerActivity) Handle(ctx context.Context, job store.DataJob) (store.DataRunResult, error) {
	symbol := strings.ToUpper(strings.TrimSpace(job.Symbol))
	var payload brokerActivityPayload
	if symbol == "" || json.Unmarshal(job.Payload, &payload) != nil || payload.TargetDate == "" {
		return store.DataRunResult{}, fmt.Errorf("broker activity job requires symbol and targetDate")
	}
	raw, err := b.provider.FetchBrokerSummary(ctx, symbol, payload.TargetDate)
	if err != nil {
		status := "error"
		var agentErr *stockbitagent.AgentError
		if errors.As(err, &agentErr) && (agentErr.StatusCode == 401 || agentErr.StatusCode == 403 || agentErr.StatusCode == 428) {
			status = "authentication_required"
		}
		_ = store.RecordDataSourceHealth(ctx, b.db, "broker_activity", status, err.Error())
		_ = store.UpsertDataFreshness(ctx, b.db, "broker_activity", "broker_summary", symbol, "error", nil, 0, err.Error())
		if status == "authentication_required" {
			return store.DataRunResult{}, &brokerSessionRequiredError{err: err}
		}
		return store.DataRunResult{}, err
	}
	records, err := stockbitagent.ParseBrokerSummary(raw)
	if err != nil {
		return store.DataRunResult{}, err
	}
	rows := make([]store.BrokerRowInput, 0, len(records))
	for _, record := range records {
		rows = append(rows, store.BrokerRowInput{
			Symbol: symbol, Date: payload.TargetDate, BrokerCode: record.BrokerCode,
			Side: record.Side, Value: record.Value, Lot: record.Lot,
			Freq: record.Frequency, InvestorType: record.InvestorType,
		})
	}
	if err := store.UpsertBrokerSummary(b.db, rows); err != nil {
		return store.DataRunResult{}, err
	}
	count, latest, err := store.BrokerSummaryCoverage(ctx, b.db, symbol)
	if err != nil {
		return store.DataRunResult{}, err
	}
	status := "stale"
	if latest != nil && latest.Format("2006-01-02") >= payload.TargetDate {
		status = "fresh"
	}
	if err := store.UpsertDataFreshness(ctx, b.db, "broker_activity", "broker_summary", symbol, status, latest, count, ""); err != nil {
		return store.DataRunResult{}, err
	}
	_ = store.RecordDataSourceHealth(ctx, b.db, "broker_activity", "healthy", "")
	metadata, _ := json.Marshal(map[string]any{
		"symbol": symbol, "targetDate": payload.TargetDate, "rows": len(rows), "freshness": status,
	})
	return store.DataRunResult{
		ItemsRead: uint64(len(records)), ItemsWritten: uint64(len(rows)), Metadata: metadata,
	}, nil
}
