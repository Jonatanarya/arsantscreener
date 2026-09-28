package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"tradewise/server/internal/config"
	"tradewise/server/internal/newsfeed"
	"tradewise/server/internal/pipeline"
	"tradewise/server/internal/stockbitagent"
	"tradewise/server/internal/store"
	"tradewise/server/internal/yahoofinance"
)

var version = "dev"

func main() {
	once := flag.Bool("once", false, "process at most one queued job and exit")
	noSchedule := flag.Bool("no-schedule", false, "skip automatic scheduling (for controlled checks)")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := store.NewMySQL(cfg.MySQLDSN())
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer db.Close()

	hostname, _ := os.Hostname()
	workerID := os.Getenv("ARSANT_WORKER_ID")
	if workerID == "" {
		workerID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	}
	pollEvery := 5 * time.Second
	if raw := os.Getenv("ARSANT_WORKER_POLL_SECONDS"); raw != "" {
		if seconds, err := strconv.Atoi(raw); err == nil && seconds >= 1 && seconds <= 300 {
			pollEvery = time.Duration(seconds) * time.Second
		}
	}

	worker := pipeline.NewWorker(db, workerID, version, hostname, pollEvery)
	guardPaths := os.Getenv("ARSANT_STORAGE_GUARD_PATHS")
	if guardPaths == "" && runtime.GOOS == "linux" {
		guardPaths = "/,/srv/arsant-data"
	}
	if guardPaths != "" {
		worker.SetStorageGuard(splitPaths(guardPaths), envInt("ARSANT_STORAGE_CRITICAL_PERCENT", 90, 50, 99))
	}
	symbolLimit := envInt("ARSANT_EOD_SYMBOL_LIMIT", 300, 1, 1000)
	afterHour := envInt("ARSANT_EOD_AFTER_HOUR", 17, 0, 23)
	afterMinute := envInt("ARSANT_EOD_AFTER_MINUTE", 15, 0, 59)
	yahooClient := yahoofinance.NewClient()
	marketEOD := pipeline.NewMarketEOD(db, yahooClient, symbolLimit, afterHour, afterMinute)
	worker.Register("market_eod.sync_symbol", marketEOD.Handle)
	marketFundamentals := pipeline.NewMarketFundamentals(db, yahooClient,
		envInt("ARSANT_FUNDAMENTALS_SYMBOL_LIMIT", 300, 1, 1000),
		envInt("ARSANT_FUNDAMENTALS_DELAY_SECONDS", 30, 15, 600))
	worker.Register("market_fundamentals.sync_symbol", marketFundamentals.Handle)
	marketNews := pipeline.NewMarketNews(db, newsfeed.NewClient(), pipeline.ParseNewsFeeds(os.Getenv("ARSANT_NEWS_FEEDS")))
	worker.Register("market_news.sync", marketNews.Handle)
	brokerMonitor := pipeline.NewBrokerSummaryMonitor(db, envInt("ARSANT_BROKER_SYMBOL_LIMIT", 300, 1, 1000))
	worker.Register("system.audit_broker_summary", brokerMonitor.Handle)
	brokerActivity := pipeline.NewBrokerActivity(db,
		stockbitagent.NewClient(os.Getenv("ARSANT_BROKER_AGENT_URL")),
		envInt("ARSANT_BROKER_SYMBOL_LIMIT", 300, 1, 1000))
	worker.Register("broker_activity.sync_symbol_day", brokerActivity.Handle)
	if !*noSchedule {
		worker.RegisterScheduler(marketEOD.Schedule)
		worker.RegisterScheduler(marketFundamentals.Schedule)
		worker.RegisterScheduler(marketNews.Schedule)
		worker.RegisterScheduler(brokerMonitor.Schedule)
		worker.RegisterScheduler(brokerActivity.Schedule)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if *once {
		if err := worker.RunOnce(ctx); err != nil {
			log.Fatalf("worker check failed: %v", err)
		}
		log.Printf("worker check completed")
		return
	}
	log.Printf("arsant data worker %s started as %s", version, workerID)
	if err := worker.Run(ctx); err != nil {
		log.Fatalf("worker stopped: %v", err)
	}
}

func splitPaths(raw string) []string {
	parts := strings.Split(raw, ",")
	paths := make([]string, 0, len(parts))
	for _, part := range parts {
		if path := strings.TrimSpace(part); path != "" {
			paths = append(paths, path)
		}
	}
	return paths
}

func envInt(name string, fallback, min, max int) int {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < min || value > max {
		return fallback
	}
	return value
}
