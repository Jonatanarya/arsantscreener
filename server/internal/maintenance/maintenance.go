package maintenance

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
)

type Policy struct {
	CompletedJobDays int `json:"completedJobDays"`
	FailedJobDays    int `json:"failedJobDays"`
	HeartbeatDays    int `json:"heartbeatDays"`
	NewsDays         int `json:"newsDays"`
	RawIngestDays    int `json:"rawIngestDays"`
}

type Counts struct {
	CompletedJobs   int64 `json:"completedJobs" db:"completed_jobs"`
	FailedJobs      int64 `json:"failedJobs" db:"failed_jobs"`
	PipelineRuns    int64 `json:"pipelineRuns" db:"pipeline_runs"`
	WorkerHeartbeat int64 `json:"workerHeartbeats" db:"worker_heartbeats"`
	News            int64 `json:"news" db:"news"`
	RawIngest       int64 `json:"rawIngest" db:"raw_ingest"`
}

type Report struct {
	RunID      uint64    `json:"runId,omitempty"`
	DryRun     bool      `json:"dryRun"`
	Status     string    `json:"status"`
	Policy     Policy    `json:"policy"`
	Candidates Counts    `json:"candidates"`
	Deleted    Counts    `json:"deleted"`
	StartedAt  time.Time `json:"startedAt"`
	FinishedAt time.Time `json:"finishedAt"`
}

type RunRecord struct {
	ID           uint64          `db:"id" json:"id"`
	Status       string          `db:"status" json:"status"`
	DryRun       bool            `db:"dry_run" json:"dryRun"`
	Policy       json.RawMessage `db:"policy" json:"policy"`
	Candidates   json.RawMessage `db:"candidates" json:"candidates,omitempty"`
	DeletedRows  json.RawMessage `db:"deleted_rows" json:"deleted,omitempty"`
	ErrorMessage *string         `db:"error_message" json:"error,omitempty"`
	StartedAt    time.Time       `db:"started_at" json:"startedAt"`
	FinishedAt   *time.Time      `db:"finished_at" json:"finishedAt,omitempty"`
}

func DefaultPolicy() Policy {
	return Policy{
		CompletedJobDays: envDays("ARSANT_RETENTION_COMPLETED_JOB_DAYS", 30),
		FailedJobDays:    envDays("ARSANT_RETENTION_FAILED_JOB_DAYS", 90),
		HeartbeatDays:    envDays("ARSANT_RETENTION_HEARTBEAT_DAYS", 7),
		NewsDays:         envDays("ARSANT_RETENTION_NEWS_DAYS", 365),
		RawIngestDays:    envDays("ARSANT_RETENTION_RAW_INGEST_DAYS", 90),
	}
}

func envDays(name string, fallback int) int {
	raw := os.Getenv(name)
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > 3650 {
		return fallback
	}
	return value
}

func (p Policy) Validate() error {
	values := map[string]int{
		"completedJobDays": p.CompletedJobDays,
		"failedJobDays":    p.FailedJobDays,
		"heartbeatDays":    p.HeartbeatDays,
		"newsDays":         p.NewsDays,
		"rawIngestDays":    p.RawIngestDays,
	}
	for name, value := range values {
		if value < 1 || value > 3650 {
			return fmt.Errorf("%s must be between 1 and 3650", name)
		}
	}
	return nil
}

func Preview(ctx context.Context, db *sqlx.DB, policy Policy) (Counts, error) {
	if err := policy.Validate(); err != nil {
		return Counts{}, err
	}
	now := time.Now().UTC()
	completedCutoff := now.AddDate(0, 0, -policy.CompletedJobDays)
	failedCutoff := now.AddDate(0, 0, -policy.FailedJobDays)
	heartbeatCutoff := now.AddDate(0, 0, -policy.HeartbeatDays)
	newsCutoff := now.AddDate(0, 0, -policy.NewsDays)
	rawCutoff := now.AddDate(0, 0, -policy.RawIngestDays)

	var counts Counts
	if err := db.GetContext(ctx, &counts.CompletedJobs, `SELECT COUNT(*) FROM data_jobs
		WHERE status IN ('succeeded','cancelled') AND finished_at < ?`, completedCutoff); err != nil {
		return Counts{}, fmt.Errorf("count completed jobs: %w", err)
	}
	if err := db.GetContext(ctx, &counts.FailedJobs, `SELECT COUNT(*) FROM data_jobs
		WHERE status='failed' AND finished_at < ?`, failedCutoff); err != nil {
		return Counts{}, fmt.Errorf("count failed jobs: %w", err)
	}
	if err := db.GetContext(ctx, &counts.PipelineRuns, `SELECT COUNT(*) FROM data_runs r
		JOIN data_jobs j ON j.id=r.job_id WHERE
		(j.status IN ('succeeded','cancelled') AND j.finished_at < ?)
		OR (j.status='failed' AND j.finished_at < ?)`, completedCutoff, failedCutoff); err != nil {
		return Counts{}, fmt.Errorf("count pipeline runs: %w", err)
	}
	if err := db.GetContext(ctx, &counts.WorkerHeartbeat, `SELECT COUNT(*) FROM worker_heartbeats
		WHERE heartbeat_at < ?`, heartbeatCutoff); err != nil {
		return Counts{}, fmt.Errorf("count worker heartbeats: %w", err)
	}
	if err := db.GetContext(ctx, &counts.News, `SELECT COUNT(*) FROM news
		WHERE COALESCE(posted_at, created_at) < ?`, newsCutoff); err != nil {
		return Counts{}, fmt.Errorf("count news: %w", err)
	}
	if err := db.GetContext(ctx, &counts.RawIngest, `SELECT COUNT(*) FROM raw_ingest
		WHERE fetched_at < ?`, rawCutoff); err != nil {
		return Counts{}, fmt.Errorf("count raw ingest: %w", err)
	}
	return counts, nil
}

func Run(ctx context.Context, db *sqlx.DB, policy Policy, dryRun bool, batchSize int) (Report, error) {
	if err := policy.Validate(); err != nil {
		return Report{}, err
	}
	if batchSize < 100 || batchSize > 10000 {
		batchSize = 2000
	}
	report := Report{DryRun: dryRun, Status: "running", Policy: policy, StartedAt: time.Now().UTC()}
	policyJSON, _ := json.Marshal(policy)
	result, err := db.ExecContext(ctx, `INSERT INTO maintenance_runs (status, dry_run, policy)
		VALUES ('running', ?, ?)`, dryRun, policyJSON)
	if err != nil {
		return report, fmt.Errorf("start maintenance run: %w", err)
	}
	runID, _ := result.LastInsertId()
	report.RunID = uint64(runID)

	report.Candidates, err = Preview(ctx, db, policy)
	if err == nil && !dryRun {
		report.Deleted, err = apply(ctx, db, policy, batchSize)
		if err == nil {
			report.Deleted.PipelineRuns = report.Candidates.PipelineRuns
		}
	}
	report.FinishedAt = time.Now().UTC()
	if err != nil {
		report.Status = "failed"
	} else if dryRun {
		report.Status = "preview"
	} else {
		report.Status = "succeeded"
	}
	candidatesJSON, _ := json.Marshal(report.Candidates)
	deletedJSON, _ := json.Marshal(report.Deleted)
	var errorText any
	if err != nil {
		errorText = err.Error()
	}
	_, updateErr := db.ExecContext(ctx, `UPDATE maintenance_runs SET status=?, candidates=?,
		deleted_rows=?, error_message=?, finished_at=? WHERE id=?`, report.Status,
		candidatesJSON, deletedJSON, errorText, report.FinishedAt, report.RunID)
	if err != nil {
		return report, err
	}
	if updateErr != nil {
		return report, fmt.Errorf("finish maintenance run: %w", updateErr)
	}
	return report, nil
}

func apply(ctx context.Context, db *sqlx.DB, policy Policy, batchSize int) (Counts, error) {
	now := time.Now().UTC()
	completedCutoff := now.AddDate(0, 0, -policy.CompletedJobDays)
	failedCutoff := now.AddDate(0, 0, -policy.FailedJobDays)
	heartbeatCutoff := now.AddDate(0, 0, -policy.HeartbeatDays)
	newsCutoff := now.AddDate(0, 0, -policy.NewsDays)
	rawCutoff := now.AddDate(0, 0, -policy.RawIngestDays)
	var deleted Counts

	var err error
	if deleted.CompletedJobs, err = deleteBatches(ctx, db, batchSize,
		`DELETE FROM data_jobs WHERE status IN ('succeeded','cancelled') AND finished_at < ? ORDER BY id LIMIT ?`, completedCutoff); err != nil {
		return deleted, err
	}
	if deleted.FailedJobs, err = deleteBatches(ctx, db, batchSize,
		`DELETE FROM data_jobs WHERE status='failed' AND finished_at < ? ORDER BY id LIMIT ?`, failedCutoff); err != nil {
		return deleted, err
	}
	// data_runs are removed by the data_jobs foreign-key cascade. Preserve the
	// previewed count in the report so operators can see the full effect.
	deleted.PipelineRuns = 0
	if deleted.WorkerHeartbeat, err = deleteBatches(ctx, db, batchSize,
		`DELETE FROM worker_heartbeats WHERE heartbeat_at < ? ORDER BY heartbeat_at LIMIT ?`, heartbeatCutoff); err != nil {
		return deleted, err
	}
	if deleted.News, err = deleteBatches(ctx, db, batchSize,
		`DELETE FROM news WHERE COALESCE(posted_at, created_at) < ? ORDER BY id LIMIT ?`, newsCutoff); err != nil {
		return deleted, err
	}
	if deleted.RawIngest, err = deleteBatches(ctx, db, batchSize,
		`DELETE FROM raw_ingest WHERE fetched_at < ? ORDER BY id LIMIT ?`, rawCutoff); err != nil {
		return deleted, err
	}
	return deleted, nil
}

func deleteBatches(ctx context.Context, db *sqlx.DB, batchSize int, query string, cutoff time.Time) (int64, error) {
	var total int64
	for {
		result, err := db.ExecContext(ctx, query, cutoff, batchSize)
		if err != nil {
			return total, fmt.Errorf("retention delete: %w", err)
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return total, fmt.Errorf("retention rows affected: %w", err)
		}
		total += rows
		if rows < int64(batchSize) {
			return total, nil
		}
	}
}

func ListRuns(ctx context.Context, db *sqlx.DB, limit int) ([]RunRecord, error) {
	if limit < 1 || limit > 100 {
		limit = 20
	}
	rows := make([]RunRecord, 0)
	if err := db.SelectContext(ctx, &rows, `SELECT id, status, dry_run, policy,
		candidates, deleted_rows, error_message, started_at, finished_at
		FROM maintenance_runs ORDER BY id DESC LIMIT ?`, limit); err != nil {
		return nil, fmt.Errorf("list maintenance runs: %w", err)
	}
	return rows, nil
}
