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
	"tradewise/server/internal/dbmigrate"
	"tradewise/server/internal/store"
)

var version = "dev"

func main() {
	action := flag.String("action", "up", "migration action: up, status, or baseline")
	baselineVersion := flag.Uint64("version", 0, "last existing schema version for baseline")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := store.NewMySQL(cfg.MySQLMigrationDSN())
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer db.Close()

	runner, err := dbmigrate.NewRunner(db)
	if err != nil {
		log.Fatalf("load migrations: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	switch *action {
	case "up":
		count, err := runner.Up(ctx)
		if err != nil {
			if dbmigrate.IsBaselineRequired(err) {
				log.Fatalf("%v; run arsant-migrate -action baseline -version <verified-version> once", err)
			}
			log.Fatalf("migration failed: %v", err)
		}
		log.Printf("arsant schema is current; applied %d migration(s) with migrator %s", count, version)
	case "baseline":
		count, err := runner.Baseline(ctx, *baselineVersion)
		if err != nil {
			log.Fatalf("baseline failed: %v", err)
		}
		log.Printf("recorded baseline through version %d (%d migration records)", *baselineVersion, count)
	case "status":
		status, err := runner.Status(ctx)
		if err != nil {
			log.Fatalf("migration status: %v", err)
		}
		encoded, err := json.MarshalIndent(status, "", "  ")
		if err != nil {
			log.Fatalf("encode status: %v", err)
		}
		_, _ = fmt.Fprintln(os.Stdout, string(encoded))
	default:
		log.Fatalf("unknown action %q", *action)
	}
}
