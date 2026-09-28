package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

var ErrPipelineSourceNotFound = errors.New("pipeline source not found")

type DataSource struct {
	ID            uint64          `db:"id" json:"id"`
	Code          string          `db:"code" json:"code"`
	Name          string          `db:"name" json:"name"`
	Kind          string          `db:"kind" json:"kind"`
	Status        string          `db:"status" json:"status"`
	Enabled       bool            `db:"enabled" json:"enabled"`
	Priority      int             `db:"priority" json:"priority"`
	Config        json.RawMessage `db:"config" json:"config,omitempty"`
	LastSuccessAt *time.Time      `db:"last_success_at" json:"lastSuccessAt,omitempty"`
	LastErrorAt   *time.Time      `db:"last_error_at" json:"lastErrorAt,omitempty"`
	LastError     *string         `db:"last_error" json:"lastError,omitempty"`
	CreatedAt     time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt     time.Time       `db:"updated_at" json:"updatedAt"`
}

type DataJob struct {
	ID           uint64          `db:"id" json:"id"`
	SourceID     uint64          `db:"source_id" json:"sourceId"`
	SourceCode   string          `db:"source_code" json:"sourceCode"`
	JobType      string          `db:"job_type" json:"jobType"`
	Symbol       string          `db:"symbol" json:"symbol,omitempty"`
	Status       string          `db:"status" json:"status"`
	Priority     int             `db:"priority" json:"priority"`
	Attempts     uint            `db:"attempts" json:"attempts"`
	MaxAttempts  uint            `db:"max_attempts" json:"maxAttempts"`
	ScheduledFor time.Time       `db:"scheduled_for" json:"scheduledFor"`
	RunAfter     time.Time       `db:"run_after" json:"runAfter"`
	LockedAt     *time.Time      `db:"locked_at" json:"lockedAt,omitempty"`
	LockedBy     *string         `db:"locked_by" json:"lockedBy,omitempty"`
	FinishedAt   *time.Time      `db:"finished_at" json:"finishedAt,omitempty"`
	DedupeKey    *string         `db:"dedupe_key" json:"dedupeKey,omitempty"`
	Payload      json.RawMessage `db:"payload" json:"payload,omitempty"`
	LastError    *string         `db:"last_error" json:"lastError,omitempty"`
	CreatedAt    time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt    time.Time       `db:"updated_at" json:"updatedAt"`
}

type DataRun struct {
	ID           uint64          `db:"id" json:"id"`
	JobID        uint64          `db:"job_id" json:"jobId"`
	SourceID     uint64          `db:"source_id" json:"sourceId"`
	SourceCode   string          `db:"source_code" json:"sourceCode"`
	WorkerID     string          `db:"worker_id" json:"workerId"`
	Status       string          `db:"status" json:"status"`
	ItemsRead    uint64          `db:"items_read" json:"itemsRead"`
	ItemsWritten uint64          `db:"items_written" json:"itemsWritten"`
	ItemsSkipped uint64          `db:"items_skipped" json:"itemsSkipped"`
	StartedAt    time.Time       `db:"started_at" json:"startedAt"`
	FinishedAt   *time.Time      `db:"finished_at" json:"finishedAt,omitempty"`
	ErrorMessage *string         `db:"error_message" json:"errorMessage,omitempty"`
	Metadata     json.RawMessage `db:"metadata" json:"metadata,omitempty"`
}

type WorkerHeartbeat struct {
	WorkerID     string          `db:"worker_id" json:"workerId"`
	Version      string          `db:"version" json:"version"`
	Hostname     string          `db:"hostname" json:"hostname"`
	Status       string          `db:"status" json:"status"`
	CurrentJobID *uint64         `db:"current_job_id" json:"currentJobId,omitempty"`
	StartedAt    time.Time       `db:"started_at" json:"startedAt"`
	HeartbeatAt  time.Time       `db:"heartbeat_at" json:"heartbeatAt"`
	Metadata     json.RawMessage `db:"metadata" json:"metadata,omitempty"`
}

type DataFreshness struct {
	SourceID         uint64     `db:"source_id" json:"sourceId"`
	SourceCode       string     `db:"source_code" json:"sourceCode"`
	Dataset          string     `db:"dataset" json:"dataset"`
	Symbol           string     `db:"symbol" json:"symbol,omitempty"`
	Status           string     `db:"status" json:"status"`
	LatestMarketDate *time.Time `db:"latest_market_date" json:"latestMarketDate,omitempty"`
	LatestDataAt     *time.Time `db:"latest_data_at" json:"latestDataAt,omitempty"`
	LastCheckedAt    *time.Time `db:"last_checked_at" json:"lastCheckedAt,omitempty"`
	RowCount         uint64     `db:"row_count" json:"rowCount"`
	LastError        *string    `db:"last_error" json:"lastError,omitempty"`
	UpdatedAt        time.Time  `db:"updated_at" json:"updatedAt"`
}

type PipelineOverview struct {
	Paused    bool              `json:"paused"`
	Pending   int64             `json:"pending"`
	Running   int64             `json:"running"`
	Succeeded int64             `json:"succeeded"`
	Failed    int64             `json:"failed"`
	Sources   []DataSource      `json:"sources"`
	Workers   []WorkerHeartbeat `json:"workers"`
	LastRuns  []DataRun         `json:"lastRuns"`
}

type EnqueueDataJobParams struct {
	SourceCode   string
	JobType      string
	Symbol       string
	Priority     int
	MaxAttempts  uint
	ScheduledFor time.Time
	RunAfter     time.Time
	DedupeKey    string
	Payload      json.RawMessage
}

type ClaimedDataJob struct {
	Job   DataJob
	RunID uint64
}

type DataRunResult struct {
	ItemsRead    uint64
	ItemsWritten uint64
	ItemsSkipped uint64
	Metadata     json.RawMessage
}

// PipelineRetryDirective lets a handler pause a job for an external condition
// without consuming its retry budget. The worker remains generic while a
// session-backed source can wait for the user to sign in again.
type PipelineRetryDirective interface {
	PipelineRetryDelay() time.Duration
	PipelinePreserveAttempts() bool
	PipelineSourceStatus() string
}

func UpsertDataFreshness(ctx context.Context, db *sqlx.DB, sourceCode, dataset, symbol, status string, latestMarketDate *time.Time, rowCount uint64, lastError string) error {
	var sourceID uint64
	if err := db.GetContext(ctx, &sourceID, `SELECT id FROM data_sources WHERE code=?`, sourceCode); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrPipelineSourceNotFound
		}
		return fmt.Errorf("find freshness source: %w", err)
	}
	var marketDate any
	if latestMarketDate != nil {
		marketDate = latestMarketDate.Format("2006-01-02")
	}
	var errorValue any
	if strings.TrimSpace(lastError) != "" {
		errorValue = lastError
	}
	_, err := db.ExecContext(ctx, `INSERT INTO data_freshness
		(source_id, dataset, symbol, status, latest_market_date, latest_data_at, last_checked_at, row_count, last_error)
		VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?)
		ON DUPLICATE KEY UPDATE status=VALUES(status), latest_market_date=VALUES(latest_market_date),
			latest_data_at=VALUES(latest_data_at), last_checked_at=VALUES(last_checked_at),
			row_count=VALUES(row_count), last_error=VALUES(last_error)`,
		sourceID, dataset, strings.ToUpper(strings.TrimSpace(symbol)), status, marketDate, rowCount, errorValue)
	if err != nil {
		return fmt.Errorf("upsert data freshness: %w", err)
	}
	return nil
}

func DataSourceEnabled(ctx context.Context, db *sqlx.DB, code string) (bool, error) {
	var enabled bool
	if err := db.GetContext(ctx, &enabled, `SELECT enabled FROM data_sources WHERE code=?`, strings.TrimSpace(code)); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, ErrPipelineSourceNotFound
		}
		return false, fmt.Errorf("read data source state: %w", err)
	}
	return enabled, nil
}

func IsPipelinePaused(ctx context.Context, db *sqlx.DB) (bool, error) {
	var value string
	err := db.GetContext(ctx, &value, `SELECT value_text FROM pipeline_settings WHERE setting_key='worker_paused'`)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return true, fmt.Errorf("read pipeline pause setting: %w", err)
	}
	return strings.EqualFold(strings.TrimSpace(value), "true") || strings.TrimSpace(value) == "1", nil
}

func SetPipelinePaused(ctx context.Context, db *sqlx.DB, paused bool) error {
	value := "false"
	if paused {
		value = "true"
	}
	_, err := db.ExecContext(ctx, `INSERT INTO pipeline_settings (setting_key, value_text)
		VALUES ('worker_paused', ?) ON DUPLICATE KEY UPDATE value_text=VALUES(value_text)`, value)
	if err != nil {
		return fmt.Errorf("set pipeline pause: %w", err)
	}
	return nil
}

func ListDataSources(ctx context.Context, db *sqlx.DB) ([]DataSource, error) {
	var rows []DataSource
	err := db.SelectContext(ctx, &rows, `SELECT id, code, name, kind, status, enabled, priority,
		COALESCE(config, JSON_OBJECT()) AS config, last_success_at, last_error_at, last_error,
		created_at, updated_at FROM data_sources ORDER BY priority DESC, code`)
	if err != nil {
		return nil, fmt.Errorf("list data sources: %w", err)
	}
	return rows, nil
}

func SetDataSourceEnabled(ctx context.Context, db *sqlx.DB, code string, enabled bool) (bool, error) {
	status := "disabled"
	if enabled {
		status = "ready"
	}
	result, err := db.ExecContext(ctx, `UPDATE data_sources SET enabled=?, status=? WHERE code=?`,
		enabled, status, strings.TrimSpace(code))
	if err != nil {
		return false, fmt.Errorf("update data source: %w", err)
	}
	n, _ := result.RowsAffected()
	if n > 0 {
		return true, nil
	}
	var exists int
	if err := db.GetContext(ctx, &exists, `SELECT COUNT(*) FROM data_sources WHERE code=?`, strings.TrimSpace(code)); err != nil {
		return false, fmt.Errorf("check data source: %w", err)
	}
	return exists > 0, nil
}

func ListDataJobs(ctx context.Context, db *sqlx.DB, status string, limit int) ([]DataJob, error) {
	if limit < 1 || limit > 500 {
		limit = 100
	}
	query := `SELECT j.id, j.source_id, s.code AS source_code, j.job_type, j.symbol, j.status,
		j.priority, j.attempts, j.max_attempts, j.scheduled_for, j.run_after,
		j.locked_at, j.locked_by, j.finished_at, j.dedupe_key,
		COALESCE(j.payload, JSON_OBJECT()) AS payload, j.last_error, j.created_at, j.updated_at
		FROM data_jobs j JOIN data_sources s ON s.id=j.source_id`
	args := []any{}
	if strings.TrimSpace(status) != "" {
		query += ` WHERE j.status=?`
		args = append(args, strings.TrimSpace(status))
	}
	query += ` ORDER BY j.created_at DESC, j.id DESC LIMIT ?`
	args = append(args, limit)
	var rows []DataJob
	if err := db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("list data jobs: %w", err)
	}
	return rows, nil
}

func ListDataFreshness(ctx context.Context, db *sqlx.DB, dataset, symbol string, limit int) ([]DataFreshness, error) {
	if limit < 1 || limit > 1000 {
		limit = 200
	}
	query := `SELECT f.source_id, s.code AS source_code, f.dataset, f.symbol, f.status,
		f.latest_market_date, f.latest_data_at, f.last_checked_at, f.row_count,
		f.last_error, f.updated_at
		FROM data_freshness f JOIN data_sources s ON s.id=f.source_id WHERE 1=1`
	args := make([]any, 0, 3)
	if strings.TrimSpace(dataset) != "" {
		query += ` AND f.dataset=?`
		args = append(args, strings.TrimSpace(dataset))
	}
	if strings.TrimSpace(symbol) != "" {
		query += ` AND f.symbol=?`
		args = append(args, strings.ToUpper(strings.TrimSpace(symbol)))
	}
	query += ` ORDER BY f.latest_market_date ASC, f.symbol LIMIT ?`
	args = append(args, limit)
	var rows []DataFreshness
	if err := db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, fmt.Errorf("list data freshness: %w", err)
	}
	if rows == nil {
		rows = make([]DataFreshness, 0)
	}
	return rows, nil
}

func PipelineStatus(ctx context.Context, db *sqlx.DB) (*PipelineOverview, error) {
	paused, err := IsPipelinePaused(ctx, db)
	if err != nil {
		return nil, err
	}
	out := &PipelineOverview{
		Paused:   paused,
		Sources:  make([]DataSource, 0),
		Workers:  make([]WorkerHeartbeat, 0),
		LastRuns: make([]DataRun, 0),
	}
	if err := db.QueryRowxContext(ctx, `SELECT
		COALESCE(SUM(status='pending'),0), COALESCE(SUM(status='running'),0),
		COALESCE(SUM(status='succeeded'),0), COALESCE(SUM(status='failed'),0)
		FROM data_jobs`).Scan(&out.Pending, &out.Running, &out.Succeeded, &out.Failed); err != nil {
		return nil, fmt.Errorf("count pipeline jobs: %w", err)
	}
	out.Sources, err = ListDataSources(ctx, db)
	if err != nil {
		return nil, err
	}
	if err := db.SelectContext(ctx, &out.Workers, `SELECT worker_id, version, hostname, status,
		current_job_id, started_at, heartbeat_at, COALESCE(metadata, JSON_OBJECT()) AS metadata
		FROM worker_heartbeats ORDER BY heartbeat_at DESC LIMIT 20`); err != nil {
		return nil, fmt.Errorf("list worker heartbeats: %w", err)
	}
	if err := db.SelectContext(ctx, &out.LastRuns, `SELECT r.id, r.job_id, r.source_id,
		s.code AS source_code, r.worker_id, r.status, r.items_read, r.items_written,
		r.items_skipped, r.started_at, r.finished_at, r.error_message,
		COALESCE(r.metadata, JSON_OBJECT()) AS metadata
		FROM data_runs r JOIN data_sources s ON s.id=r.source_id
		ORDER BY r.started_at DESC, r.id DESC LIMIT 20`); err != nil {
		return nil, fmt.Errorf("list pipeline runs: %w", err)
	}
	return out, nil
}

func EnqueueDataJob(ctx context.Context, db *sqlx.DB, p EnqueueDataJobParams) (uint64, error) {
	p.SourceCode = strings.TrimSpace(p.SourceCode)
	p.JobType = strings.TrimSpace(p.JobType)
	p.Symbol = strings.ToUpper(strings.TrimSpace(p.Symbol))
	if p.SourceCode == "" || p.JobType == "" {
		return 0, fmt.Errorf("source code and job type are required")
	}
	var sourceID uint64
	if err := db.GetContext(ctx, &sourceID, `SELECT id FROM data_sources WHERE code=?`, p.SourceCode); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrPipelineSourceNotFound
		}
		return 0, fmt.Errorf("find data source: %w", err)
	}
	if p.Priority == 0 {
		p.Priority = 100
	}
	if p.MaxAttempts == 0 {
		p.MaxAttempts = 3
	}
	now := time.Now().UTC()
	if p.ScheduledFor.IsZero() {
		p.ScheduledFor = now
	}
	if p.RunAfter.IsZero() {
		p.RunAfter = p.ScheduledFor
	}
	var dedupe any
	if strings.TrimSpace(p.DedupeKey) != "" {
		dedupe = strings.TrimSpace(p.DedupeKey)
	}
	var payload any
	if len(p.Payload) > 0 && json.Valid(p.Payload) {
		payload = p.Payload
	}
	result, err := db.ExecContext(ctx, `INSERT INTO data_jobs
		(source_id, job_type, symbol, priority, max_attempts, scheduled_for, run_after, dedupe_key, payload)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), priority=GREATEST(priority, VALUES(priority)),
			run_after=LEAST(run_after, VALUES(run_after)), updated_at=CURRENT_TIMESTAMP`,
		sourceID, p.JobType, p.Symbol, p.Priority, p.MaxAttempts, p.ScheduledFor, p.RunAfter, dedupe, payload)
	if err != nil {
		return 0, fmt.Errorf("enqueue data job: %w", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("read enqueued job id: %w", err)
	}
	return uint64(id), nil
}

func RetryDataJob(ctx context.Context, db *sqlx.DB, id uint64) (bool, error) {
	result, err := db.ExecContext(ctx, `UPDATE data_jobs SET status='pending', attempts=0,
		run_after=UTC_TIMESTAMP(), locked_at=NULL, locked_by=NULL, finished_at=NULL,
		last_error=NULL WHERE id=? AND status IN ('failed','cancelled','succeeded')`, id)
	if err != nil {
		return false, fmt.Errorf("retry data job: %w", err)
	}
	n, _ := result.RowsAffected()
	return n > 0, nil
}

// ReviveBrokerSessionJobs restores jobs that exhausted their retry budget only
// because the browser session was unavailable. It is called after the session
// health check succeeds, so ordinary data/parse failures remain failed.
func ReviveBrokerSessionJobs(ctx context.Context, db *sqlx.DB, targetDate string) (int64, error) {
	result, err := db.ExecContext(ctx, `UPDATE data_jobs j
		JOIN data_sources s ON s.id=j.source_id
		SET j.status='pending', j.attempts=0, j.run_after=UTC_TIMESTAMP(),
			j.locked_at=NULL, j.locked_by=NULL, j.finished_at=NULL, j.last_error=NULL
		WHERE s.code='broker_activity'
		  AND j.job_type='broker_activity.sync_symbol_day'
		  AND j.status='failed'
		  AND JSON_UNQUOTE(JSON_EXTRACT(j.payload, '$.targetDate'))=?
		  AND (j.last_error LIKE '%requires login%'
			OR j.last_error LIKE '%HTTP 401%'
			OR j.last_error LIKE '%HTTP 403%'
			OR j.last_error LIKE '%HTTP 428%'
			OR j.last_error LIKE '%session rejected%')`, targetDate)
	if err != nil {
		return 0, fmt.Errorf("revive broker session jobs: %w", err)
	}
	count, _ := result.RowsAffected()
	return count, nil
}

func ClaimNextDataJob(ctx context.Context, db *sqlx.DB, workerID string) (*ClaimedDataJob, error) {
	tx, err := db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("begin claim transaction: %w", err)
	}
	defer tx.Rollback()
	var job DataJob
	err = tx.GetContext(ctx, &job, `SELECT j.id, j.source_id, s.code AS source_code,
		j.job_type, j.symbol, j.status, j.priority, j.attempts, j.max_attempts,
		j.scheduled_for, j.run_after, j.locked_at, j.locked_by, j.finished_at,
		j.dedupe_key, COALESCE(j.payload, JSON_OBJECT()) AS payload, j.last_error,
		j.created_at, j.updated_at
		FROM data_jobs j JOIN data_sources s ON s.id=j.source_id
		WHERE j.status='pending' AND j.run_after<=UTC_TIMESTAMP() AND s.enabled=1
		  AND s.status NOT IN ('authentication_required','session_unavailable')
		ORDER BY j.priority DESC, j.scheduled_for, j.id
		LIMIT 1 FOR UPDATE SKIP LOCKED`)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("select data job: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE data_jobs SET status='running', attempts=attempts+1,
		locked_at=UTC_TIMESTAMP(), locked_by=?, last_error=NULL WHERE id=?`, workerID, job.ID); err != nil {
		return nil, fmt.Errorf("lock data job: %w", err)
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO data_runs (job_id, source_id, worker_id, status)
		VALUES (?, ?, ?, 'running')`, job.ID, job.SourceID, workerID)
	if err != nil {
		return nil, fmt.Errorf("create data run: %w", err)
	}
	runID, err := result.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("read data run id: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit claimed data job: %w", err)
	}
	job.Status = "running"
	job.Attempts++
	lockedAt := time.Now().UTC()
	job.LockedAt = &lockedAt
	job.LockedBy = &workerID
	return &ClaimedDataJob{Job: job, RunID: uint64(runID)}, nil
}

func FinishDataJob(ctx context.Context, db *sqlx.DB, claimed *ClaimedDataJob, result DataRunResult, runErr error) error {
	if claimed == nil {
		return fmt.Errorf("claimed job is required")
	}
	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin finish transaction: %w", err)
	}
	defer tx.Rollback()
	metadata := any(nil)
	if len(result.Metadata) > 0 && json.Valid(result.Metadata) {
		metadata = result.Metadata
	}
	if runErr == nil {
		if _, err := tx.ExecContext(ctx, `UPDATE data_jobs SET status='succeeded', finished_at=UTC_TIMESTAMP(),
			locked_at=NULL, locked_by=NULL, last_error=NULL WHERE id=?`, claimed.Job.ID); err != nil {
			return fmt.Errorf("finish data job: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE data_runs SET status='succeeded', finished_at=UTC_TIMESTAMP(),
			items_read=?, items_written=?, items_skipped=?, metadata=? WHERE id=?`,
			result.ItemsRead, result.ItemsWritten, result.ItemsSkipped, metadata, claimed.RunID); err != nil {
			return fmt.Errorf("finish data run: %w", err)
		}
		_, _ = tx.ExecContext(ctx, `UPDATE data_sources SET status='ready', last_success_at=UTC_TIMESTAMP(),
			last_error_at=NULL, last_error=NULL WHERE id=?`, claimed.Job.SourceID)
	} else {
		errorText := runErr.Error()
		status := "failed"
		var retryAt any
		preserveAttempts := false
		sourceStatus := "degraded"
		var directive PipelineRetryDirective
		if errors.As(runErr, &directive) {
			preserveAttempts = directive.PipelinePreserveAttempts()
			sourceStatus = strings.TrimSpace(directive.PipelineSourceStatus())
			if sourceStatus == "" {
				sourceStatus = "degraded"
			}
			if preserveAttempts {
				status = "pending"
				delay := directive.PipelineRetryDelay()
				if delay < time.Minute {
					delay = time.Minute
				}
				retryAt = time.Now().UTC().Add(delay)
			}
		}
		if status != "pending" && claimed.Job.Attempts < claimed.Job.MaxAttempts {
			status = "pending"
			delay := time.Duration(claimed.Job.Attempts*claimed.Job.Attempts) * time.Minute
			if delay > time.Hour {
				delay = time.Hour
			}
			retryAt = time.Now().UTC().Add(delay)
		}
		if status == "pending" {
			if preserveAttempts {
				_, err = tx.ExecContext(ctx, `UPDATE data_jobs SET status='pending',
					attempts=IF(attempts>0,attempts-1,0), run_after=?, locked_at=NULL,
					locked_by=NULL, last_error=? WHERE id=?`, retryAt, errorText, claimed.Job.ID)
			} else {
				_, err = tx.ExecContext(ctx, `UPDATE data_jobs SET status='pending', run_after=?, locked_at=NULL,
					locked_by=NULL, last_error=? WHERE id=?`, retryAt, errorText, claimed.Job.ID)
			}
		} else {
			_, err = tx.ExecContext(ctx, `UPDATE data_jobs SET status='failed', finished_at=UTC_TIMESTAMP(),
				locked_at=NULL, locked_by=NULL, last_error=? WHERE id=?`, errorText, claimed.Job.ID)
		}
		if err != nil {
			return fmt.Errorf("fail data job: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE data_runs SET status='failed', finished_at=UTC_TIMESTAMP(),
			items_read=?, items_written=?, items_skipped=?, error_message=?, metadata=? WHERE id=?`,
			result.ItemsRead, result.ItemsWritten, result.ItemsSkipped, errorText, metadata, claimed.RunID); err != nil {
			return fmt.Errorf("fail data run: %w", err)
		}
		_, _ = tx.ExecContext(ctx, `UPDATE data_sources SET status=?, last_error_at=UTC_TIMESTAMP(),
			last_error=? WHERE id=?`, sourceStatus, errorText, claimed.Job.SourceID)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit finished data job: %w", err)
	}
	return nil
}

func UpsertWorkerHeartbeat(ctx context.Context, db *sqlx.DB, heartbeat WorkerHeartbeat) error {
	metadata := any(nil)
	if len(heartbeat.Metadata) > 0 && json.Valid(heartbeat.Metadata) {
		metadata = heartbeat.Metadata
	}
	_, err := db.ExecContext(ctx, `INSERT INTO worker_heartbeats
		(worker_id, version, hostname, status, current_job_id, started_at, heartbeat_at, metadata)
		VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?)
		ON DUPLICATE KEY UPDATE version=VALUES(version), hostname=VALUES(hostname),
			status=VALUES(status), current_job_id=VALUES(current_job_id),
			heartbeat_at=VALUES(heartbeat_at), metadata=VALUES(metadata)`,
		heartbeat.WorkerID, heartbeat.Version, heartbeat.Hostname, heartbeat.Status,
		heartbeat.CurrentJobID, heartbeat.StartedAt, metadata)
	if err != nil {
		return fmt.Errorf("upsert worker heartbeat: %w", err)
	}
	return nil
}

func RecoverStaleDataJobs(ctx context.Context, db *sqlx.DB, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().UTC().Add(-olderThan)
	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin stale recovery: %w", err)
	}
	defer tx.Rollback()
	_, _ = tx.ExecContext(ctx, `UPDATE data_runs r JOIN data_jobs j ON j.id=r.job_id
		SET r.status='failed', r.finished_at=UTC_TIMESTAMP(), r.error_message='worker heartbeat expired'
		WHERE r.status='running' AND j.status='running' AND j.locked_at<?`, cutoff)
	result, err := tx.ExecContext(ctx, `UPDATE data_jobs SET status='pending', run_after=UTC_TIMESTAMP(),
		locked_at=NULL, locked_by=NULL, last_error='worker heartbeat expired'
		WHERE status='running' AND locked_at<?`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("recover stale data jobs: %w", err)
	}
	n, _ := result.RowsAffected()
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit stale recovery: %w", err)
	}
	return n, nil
}
