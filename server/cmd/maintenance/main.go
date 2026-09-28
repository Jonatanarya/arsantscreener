package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"tradewise/server/internal/config"
	"tradewise/server/internal/maintenance"
	"tradewise/server/internal/store"
)

func main() {
	apply := flag.Bool("apply", false, "apply deletion; without this flag the command only previews")
	batchSize := flag.Int("batch-size", 2000, "maximum rows deleted per statement")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := store.NewMySQL(cfg.MySQLDSN())
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	report, err := maintenance.Run(ctx, db, maintenance.DefaultPolicy(), !*apply, *batchSize)
	if err != nil {
		log.Fatalf("maintenance: %v", err)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		fmt.Fprintf(os.Stderr, "encode report: %v\n", err)
		os.Exit(1)
	}
}
