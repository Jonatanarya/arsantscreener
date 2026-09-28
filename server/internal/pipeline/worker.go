package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

type Handler func(context.Context, store.DataJob) (store.DataRunResult, error)
type Scheduler func(context.Context) (int, error)

type Worker struct {
	db           *sqlx.DB
	id           string
	version      string
	hostname     string
	startedAt    time.Time
	pollEvery    time.Duration
	handlers     map[string]Handler
	schedulers   []Scheduler
	nextSchedule time.Time
	storageGuard storageGuard

	mu           sync.RWMutex
	status       string
	currentJobID *uint64
	storageUsage []StorageUsage
}

func (w *Worker) SetStorageGuard(paths []string, criticalUsedPercent int) {
	if criticalUsedPercent < 50 || criticalUsedPercent > 99 {
		criticalUsedPercent = 90
	}
	cleanPaths := make([]string, 0, len(paths))
	seen := make(map[string]bool)
	for _, path := range paths {
		if path != "" && !seen[path] {
			cleanPaths = append(cleanPaths, path)
			seen[path] = true
		}
	}
	w.storageGuard = storageGuard{paths: cleanPaths, criticalUsedPercent: criticalUsedPercent}
}

func NewWorker(db *sqlx.DB, id, version, hostname string, pollEvery time.Duration) *Worker {
	if pollEvery < time.Second {
		pollEvery = 5 * time.Second
	}
	w := &Worker{
		db: db, id: id, version: version, hostname: hostname,
		startedAt: time.Now().UTC(), pollEvery: pollEvery,
		status: "starting", handlers: make(map[string]Handler),
	}
	w.Register("system.noop", func(_ context.Context, job store.DataJob) (store.DataRunResult, error) {
		metadata, _ := json.Marshal(map[string]any{"jobType": job.JobType, "verified": true})
		return store.DataRunResult{ItemsRead: 1, ItemsWritten: 0, Metadata: metadata}, nil
	})
	return w
}

func (w *Worker) Register(jobType string, handler Handler) {
	if jobType == "" || handler == nil {
		return
	}
	w.handlers[jobType] = handler
}

func (w *Worker) RegisterScheduler(scheduler Scheduler) {
	if scheduler != nil {
		w.schedulers = append(w.schedulers, scheduler)
	}
}

func (w *Worker) Run(ctx context.Context) error {
	if recovered, err := store.RecoverStaleDataJobs(ctx, w.db, 15*time.Minute); err != nil {
		return err
	} else if recovered > 0 {
		log.Printf("pipeline: recovered %d stale jobs", recovered)
	}
	heartbeatCtx, cancelHeartbeat := context.WithCancel(ctx)
	defer cancelHeartbeat()
	go w.heartbeatLoop(heartbeatCtx)

	for {
		if err := w.runOne(ctx); err != nil {
			log.Printf("pipeline: %v", err)
			w.setState("degraded", nil)
		}
		select {
		case <-ctx.Done():
			w.setState("stopped", nil)
			stopCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			_ = w.sendHeartbeat(stopCtx)
			cancel()
			return nil
		case <-time.After(w.pollEvery):
		}
	}
}

func (w *Worker) RunOnce(ctx context.Context) error {
	return w.runOne(ctx)
}

func (w *Worker) runOne(ctx context.Context) error {
	blocked, err := w.checkStorage()
	if err != nil {
		return fmt.Errorf("storage guard: %w", err)
	}
	if blocked {
		w.setState("storage_blocked", nil)
		return w.sendHeartbeat(ctx)
	}
	paused, err := store.IsPipelinePaused(ctx, w.db)
	if err != nil {
		return err
	}
	if paused {
		w.setState("paused", nil)
		return w.sendHeartbeat(ctx)
	}
	if err := w.runSchedulers(ctx); err != nil {
		return err
	}
	claimed, err := store.ClaimNextDataJob(ctx, w.db, w.id)
	if err != nil {
		return err
	}
	if claimed == nil {
		w.setState("idle", nil)
		return w.sendHeartbeat(ctx)
	}
	w.setState("running", &claimed.Job.ID)
	_ = w.sendHeartbeat(ctx)
	handler := w.handlers[claimed.Job.JobType]
	var result store.DataRunResult
	var runErr error
	if handler == nil {
		runErr = fmt.Errorf("no handler registered for job type %q", claimed.Job.JobType)
	} else {
		result, runErr = handler(ctx, claimed.Job)
	}
	if err := store.FinishDataJob(ctx, w.db, claimed, result, runErr); err != nil {
		return err
	}
	if runErr != nil {
		log.Printf("pipeline: job %d (%s) failed: %v", claimed.Job.ID, claimed.Job.JobType, runErr)
	} else {
		log.Printf("pipeline: job %d (%s) completed", claimed.Job.ID, claimed.Job.JobType)
	}
	w.setState("idle", nil)
	return w.sendHeartbeat(ctx)
}

func (w *Worker) checkStorage() (bool, error) {
	if len(w.storageGuard.paths) == 0 {
		return false, nil
	}
	usage := make([]StorageUsage, 0, len(w.storageGuard.paths))
	blocked := false
	for _, path := range w.storageGuard.paths {
		item, err := readStorageUsage(path)
		if err != nil {
			return false, fmt.Errorf("read %s: %w", path, err)
		}
		usage = append(usage, item)
		if item.UsedPercent >= w.storageGuard.criticalUsedPercent {
			blocked = true
		}
	}
	w.mu.Lock()
	w.storageUsage = usage
	w.mu.Unlock()
	return blocked, nil
}

func (w *Worker) runSchedulers(ctx context.Context) error {
	if len(w.schedulers) == 0 || time.Now().Before(w.nextSchedule) {
		return nil
	}
	w.nextSchedule = time.Now().Add(15 * time.Minute)
	for _, scheduler := range w.schedulers {
		count, err := scheduler(ctx)
		if err != nil {
			return fmt.Errorf("schedule jobs: %w", err)
		}
		if count > 0 {
			log.Printf("pipeline: scheduled %d jobs", count)
		}
	}
	return nil
}

func (w *Worker) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	_ = w.sendHeartbeat(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.sendHeartbeat(ctx); err != nil {
				log.Printf("pipeline heartbeat: %v", err)
			}
		}
	}
}

func (w *Worker) setState(status string, jobID *uint64) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.status = status
	w.currentJobID = jobID
}

func (w *Worker) sendHeartbeat(ctx context.Context) error {
	w.mu.RLock()
	status := w.status
	jobID := w.currentJobID
	storage := append([]StorageUsage(nil), w.storageUsage...)
	w.mu.RUnlock()
	metadata, _ := json.Marshal(map[string]any{
		"pollSeconds":                int(w.pollEvery.Seconds()),
		"storageCriticalUsedPercent": w.storageGuard.criticalUsedPercent,
		"storage":                    storage,
	})
	return store.UpsertWorkerHeartbeat(ctx, w.db, store.WorkerHeartbeat{
		WorkerID: w.id, Version: w.version, Hostname: w.hostname,
		Status: status, CurrentJobID: jobID, StartedAt: w.startedAt,
		Metadata: metadata,
	})
}
