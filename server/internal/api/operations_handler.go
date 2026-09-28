package api

import (
	"database/sql"
	"encoding/json"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

type operationsStatus struct {
	CollectorLastSeen *time.Time            `json:"collectorLastSeen"`
	MarketDataDate    *string               `json:"marketDataDate"`
	Symbols           int                   `json:"symbols"`
	Bars              int64                 `json:"bars"`
	Infrastructure    *infrastructureStatus `json:"infrastructure,omitempty"`
}
type infrastructureStatus struct {
	RootDiskUsedPct        int   `json:"rootDiskUsedPct"`
	RootDiskFreeBytes      int64 `json:"rootDiskFreeBytes"`
	DataDiskUsedPct        int   `json:"dataDiskUsedPct"`
	DataDiskFreeBytes      int64 `json:"dataDiskFreeBytes"`
	BackupLastUnix         int64 `json:"backupLastUnix"`
	BackupBytes            int64 `json:"backupBytes"`
	APIActive              bool  `json:"apiActive"`
	WorkerActive           bool  `json:"workerActive"`
	NginxActive            bool  `json:"nginxActive"`
	BackupTimerActive      bool  `json:"backupTimerActive"`
	MaintenanceTimerActive bool  `json:"maintenanceTimerActive"`
}

type publicServiceStatus struct {
	Status                string                     `json:"status"`
	CheckedAt             time.Time                  `json:"checkedAt"`
	MarketDataDate        *string                    `json:"marketDataDate,omitempty"`
	UpdatedAt             *time.Time                 `json:"updatedAt,omitempty"`
	Symbols               int                        `json:"symbols"`
	BrokerSummary         *store.BrokerSummaryHealth `json:"brokerSummary,omitempty"`
	LatestNewsAt          *time.Time                 `json:"latestNewsAt,omitempty"`
	FundamentalsUpdatedAt *time.Time                 `json:"fundamentalsUpdatedAt,omitempty"`
	FundamentalsSymbols   int                        `json:"fundamentalsSymbols"`
}

func serviceStatusHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		out := publicServiceStatus{Status: "operational", CheckedAt: time.Now().UTC()}
		var updated sql.NullTime
		var market sql.NullString
		if err := db.Get(&out.Symbols, `SELECT COUNT(*) FROM symbols`); err != nil {
			return c.Status(503).JSON(publicServiceStatus{Status: "degraded", CheckedAt: time.Now().UTC()})
		}
		_ = db.Get(&updated, `SELECT MAX(last_success_at) FROM data_sources WHERE enabled=1`)
		_ = db.Get(&market, `SELECT DATE_FORMAT(MAX(date),'%Y-%m-%d') FROM bars_daily`)
		var latestNews sql.NullTime
		var latestFundamentals sql.NullTime
		_ = db.Get(&latestNews, `SELECT MAX(posted_at) FROM news`)
		_ = db.Get(&latestFundamentals, `SELECT MAX(fetched_at) FROM fundamentals`)
		_ = db.Get(&out.FundamentalsSymbols, `SELECT COUNT(*) FROM fundamentals`)
		var brokerMetadata []byte
		if err := db.Get(&brokerMetadata, `SELECT r.metadata
			FROM data_runs r JOIN data_jobs j ON j.id=r.job_id
			WHERE j.job_type='system.audit_broker_summary' AND r.status='succeeded' AND r.metadata IS NOT NULL
			ORDER BY r.finished_at DESC, r.id DESC LIMIT 1`); err == nil {
			var broker store.BrokerSummaryHealth
			if json.Unmarshal(brokerMetadata, &broker) == nil && broker.TargetSymbols > 0 {
				out.BrokerSummary = &broker
			}
		}
		if updated.Valid {
			out.UpdatedAt = &updated.Time
		}
		if market.Valid {
			out.MarketDataDate = &market.String
		}
		if latestNews.Valid {
			out.LatestNewsAt = &latestNews.Time
		}
		if latestFundamentals.Valid {
			out.FundamentalsUpdatedAt = &latestFundamentals.Time
		}
		if out.Symbols == 0 || !market.Valid {
			out.Status = "degraded"
		}
		return c.JSON(out)
	}
}

func operationsStatusHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var out operationsStatus
		var collector sql.NullTime
		var market sql.NullString
		if err := db.Get(&collector, `SELECT MAX(fetched_at) FROM raw_ingest`); err != nil {
			return c.SendStatus(500)
		}
		_ = db.Get(&market, `SELECT DATE_FORMAT(MAX(date),'%Y-%m-%d') FROM bars_daily`)
		_ = db.Get(&out.Symbols, `SELECT COUNT(*) FROM symbols`)
		_ = db.Get(&out.Bars, `SELECT COUNT(*) FROM bars_daily`)
		if collector.Valid {
			out.CollectorLastSeen = &collector.Time
		}
		if market.Valid {
			out.MarketDataDate = &market.String
		}
		if raw, err := os.ReadFile("/srv/arsant-screener/ops/status.json"); err == nil {
			var infra infrastructureStatus
			if json.Unmarshal(raw, &infra) == nil {
				out.Infrastructure = &infra
			}
		}
		return c.JSON(out)
	}
}
