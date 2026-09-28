package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

const brokerSummaryAuditJobType = "system.audit_broker_summary"

type BrokerSummaryMonitor struct {
	db          *sqlx.DB
	symbolLimit int
	now         func() time.Time
}

type brokerSummaryAuditPayload struct {
	TargetDate string `json:"targetDate"`
}

func NewBrokerSummaryMonitor(db *sqlx.DB, symbolLimit int) *BrokerSummaryMonitor {
	if symbolLimit < 1 || symbolLimit > 1000 {
		symbolLimit = 300
	}
	return &BrokerSummaryMonitor{db: db, symbolLimit: symbolLimit, now: time.Now}
}

func (m *BrokerSummaryMonitor) Schedule(ctx context.Context) (int, error) {
	target, err := store.LatestOverallBarDate(ctx, m.db)
	if err != nil {
		return 0, err
	}
	if target == nil {
		return 0, nil
	}
	bucket := m.now().UTC().Truncate(15 * time.Minute)
	payload, _ := json.Marshal(brokerSummaryAuditPayload{TargetDate: target.Format("2006-01-02")})
	_, err = store.EnqueueDataJob(ctx, m.db, store.EnqueueDataJobParams{
		SourceCode: "system", JobType: brokerSummaryAuditJobType, Priority: 900,
		MaxAttempts: 2, ScheduledFor: bucket,
		DedupeKey: fmt.Sprintf("%s:%s", brokerSummaryAuditJobType, bucket.Format("20060102T1504")),
		Payload:   payload,
	})
	if err != nil {
		return 0, err
	}
	return 1, nil
}

func (m *BrokerSummaryMonitor) Handle(ctx context.Context, job store.DataJob) (store.DataRunResult, error) {
	var payload brokerSummaryAuditPayload
	_ = json.Unmarshal(job.Payload, &payload)
	target, err := time.Parse("2006-01-02", payload.TargetDate)
	if err != nil {
		latest, latestErr := store.LatestOverallBarDate(ctx, m.db)
		if latestErr != nil {
			return store.DataRunResult{}, latestErr
		}
		if latest == nil {
			return store.DataRunResult{}, fmt.Errorf("broker summary audit has no market date")
		}
		target = *latest
	}
	health, err := store.ReadBrokerSummaryHealth(ctx, m.db, target, m.symbolLimit)
	if err != nil {
		_ = store.UpsertDataFreshness(ctx, m.db, "broker_activity", "broker_summary", "", "error", nil, 0, err.Error())
		_ = store.RecordDataSourceHealth(ctx, m.db, "broker_activity", "error", err.Error())
		return store.DataRunResult{}, err
	}
	var latest *time.Time
	if health.LatestAvailableDate != "" {
		if value, parseErr := time.Parse("2006-01-02", health.LatestAvailableDate); parseErr == nil {
			latest = &value
		}
	}
	freshnessStatus := "stale"
	message := fmt.Sprintf("broker summary %d/%d fresh for %s", health.FreshSymbols, health.TargetSymbols, health.TargetDate)
	if health.Status == "healthy" {
		freshnessStatus = "fresh"
		message = ""
	} else if len(health.Missing) > 0 {
		message += "; missing: " + strings.Join(health.Missing, ",")
	}
	if err := store.UpsertDataFreshness(ctx, m.db, "broker_activity", "broker_summary", "",
		freshnessStatus, latest, uint64(health.FreshSymbols), message); err != nil {
		return store.DataRunResult{}, err
	}
	if err := store.RecordDataSourceHealth(ctx, m.db, "broker_activity", health.Status, message); err != nil {
		return store.DataRunResult{}, err
	}
	metadata, _ := json.Marshal(health)
	return store.DataRunResult{
		ItemsRead: uint64(health.TargetSymbols), ItemsWritten: 1,
		ItemsSkipped: uint64(health.StaleSymbols + health.MissingSymbols), Metadata: metadata,
	}, nil
}
