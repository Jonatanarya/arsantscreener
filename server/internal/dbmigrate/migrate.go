package dbmigrate

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"tradewise/server/migrations"
)

const lockName = "arsant_schema_migrate"

var migrationNamePattern = regexp.MustCompile(`^(\d+)_([a-z0-9_]+)\.up\.sql$`)

var ErrBaselineRequired = errors.New("existing database has no Arsant migration history; baseline is required")

type Migration struct {
	Version  uint64
	Name     string
	Filename string
	SQL      string
	Checksum string
}

type AppliedMigration struct {
	Version   uint64    `db:"version" json:"version"`
	Name      string    `db:"name" json:"name"`
	Checksum  string    `db:"checksum" json:"checksum"`
	Dirty     bool      `db:"dirty" json:"dirty"`
	AppliedAt time.Time `db:"applied_at" json:"appliedAt"`
}

type Status struct {
	CurrentVersion uint64             `json:"currentVersion"`
	LatestVersion  uint64             `json:"latestVersion"`
	Pending        []MigrationStatus  `json:"pending"`
	Applied        []AppliedMigration `json:"applied"`
	BaselineNeeded bool               `json:"baselineNeeded"`
}

type MigrationStatus struct {
	Version uint64 `json:"version"`
	Name    string `json:"name"`
}

func Load() ([]Migration, error) {
	entries, err := fs.ReadDir(migrations.Files, ".")
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}
	loaded := make([]Migration, 0, len(entries)/2)
	seen := make(map[uint64]string)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		matches := migrationNamePattern.FindStringSubmatch(entry.Name())
		if matches == nil {
			continue
		}
		version, err := strconv.ParseUint(matches[1], 10, 64)
		if err != nil || version == 0 {
			return nil, fmt.Errorf("invalid migration version in %s", entry.Name())
		}
		if previous, exists := seen[version]; exists {
			return nil, fmt.Errorf("duplicate migration version %d: %s and %s", version, previous, entry.Name())
		}
		content, err := migrations.Files.ReadFile(entry.Name())
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		sum := sha256.Sum256(content)
		loaded = append(loaded, Migration{
			Version: version, Name: matches[2], Filename: entry.Name(),
			SQL: string(content), Checksum: hex.EncodeToString(sum[:]),
		})
		seen[version] = entry.Name()
	}
	sort.Slice(loaded, func(i, j int) bool { return loaded[i].Version < loaded[j].Version })
	if len(loaded) == 0 {
		return nil, errors.New("no embedded migrations found")
	}
	for index, migration := range loaded {
		expected := uint64(index + 1)
		if migration.Version != expected {
			return nil, fmt.Errorf("migration sequence has a gap: expected %d, found %d", expected, migration.Version)
		}
	}
	return loaded, nil
}

type Runner struct {
	db         *sqlx.DB
	migrations []Migration
}

func NewRunner(db *sqlx.DB) (*Runner, error) {
	loaded, err := Load()
	if err != nil {
		return nil, err
	}
	return &Runner{db: db, migrations: loaded}, nil
}

func (r *Runner) Up(ctx context.Context) (int, error) {
	release, err := r.acquireLock(ctx)
	if err != nil {
		return 0, err
	}
	defer release()
	if err := r.ensureHistoryTable(ctx); err != nil {
		return 0, err
	}
	applied, err := r.listApplied(ctx)
	if err != nil {
		return 0, err
	}
	if len(applied) == 0 {
		existing, err := r.existingApplicationTables(ctx)
		if err != nil {
			return 0, err
		}
		if existing > 0 {
			return 0, fmt.Errorf("%w (%d application tables detected)", ErrBaselineRequired, existing)
		}
	}
	byVersion := make(map[uint64]AppliedMigration, len(applied))
	for _, migration := range applied {
		if migration.Dirty {
			return 0, fmt.Errorf("migration %d (%s) is dirty; restore or repair it before continuing", migration.Version, migration.Name)
		}
		byVersion[migration.Version] = migration
	}
	appliedCount := 0
	for _, migration := range r.migrations {
		if existing, ok := byVersion[migration.Version]; ok {
			if existing.Checksum != migration.Checksum {
				return appliedCount, fmt.Errorf("migration %d checksum changed after it was applied", migration.Version)
			}
			continue
		}
		if err := r.apply(ctx, migration); err != nil {
			return appliedCount, err
		}
		appliedCount++
	}
	return appliedCount, nil
}

func (r *Runner) Baseline(ctx context.Context, version uint64) (int, error) {
	release, err := r.acquireLock(ctx)
	if err != nil {
		return 0, err
	}
	defer release()
	if err := r.ensureHistoryTable(ctx); err != nil {
		return 0, err
	}
	applied, err := r.listApplied(ctx)
	if err != nil {
		return 0, err
	}
	if len(applied) > 0 {
		return 0, errors.New("baseline refused: migration history is not empty")
	}
	existing, err := r.existingApplicationTables(ctx)
	if err != nil {
		return 0, err
	}
	if existing == 0 {
		return 0, errors.New("baseline refused: database is empty; run action up instead")
	}
	latest := r.migrations[len(r.migrations)-1].Version
	if version == 0 || version > latest {
		return 0, fmt.Errorf("baseline version must be between 1 and %d", latest)
	}
	count := 0
	for _, migration := range r.migrations {
		if migration.Version > version {
			break
		}
		if _, err := r.db.ExecContext(ctx, `INSERT INTO arsant_schema_migrations
			(version, name, checksum, dirty, applied_at) VALUES (?, ?, ?, 0, UTC_TIMESTAMP())`,
			migration.Version, migration.Name, migration.Checksum); err != nil {
			return count, fmt.Errorf("record baseline migration %d: %w", migration.Version, err)
		}
		count++
	}
	return count, nil
}

func (r *Runner) Status(ctx context.Context) (Status, error) {
	if err := r.ensureHistoryTable(ctx); err != nil {
		return Status{}, err
	}
	applied, err := r.listApplied(ctx)
	if err != nil {
		return Status{}, err
	}
	status := Status{Applied: applied, Pending: make([]MigrationStatus, 0)}
	status.LatestVersion = r.migrations[len(r.migrations)-1].Version
	seen := make(map[uint64]struct{}, len(applied))
	for _, migration := range applied {
		seen[migration.Version] = struct{}{}
		if migration.Version > status.CurrentVersion {
			status.CurrentVersion = migration.Version
		}
	}
	for _, migration := range r.migrations {
		if _, ok := seen[migration.Version]; !ok {
			status.Pending = append(status.Pending, MigrationStatus{Version: migration.Version, Name: migration.Name})
		}
	}
	if len(applied) == 0 {
		existing, err := r.existingApplicationTables(ctx)
		if err != nil {
			return Status{}, err
		}
		status.BaselineNeeded = existing > 0
	}
	return status, nil
}

func (r *Runner) apply(ctx context.Context, migration Migration) error {
	if _, err := r.db.ExecContext(ctx, `INSERT INTO arsant_schema_migrations
		(version, name, checksum, dirty, applied_at) VALUES (?, ?, ?, 1, UTC_TIMESTAMP())`,
		migration.Version, migration.Name, migration.Checksum); err != nil {
		return fmt.Errorf("mark migration %d dirty: %w", migration.Version, err)
	}
	if _, err := r.db.ExecContext(ctx, migration.SQL); err != nil {
		return fmt.Errorf("apply migration %d (%s): %w", migration.Version, migration.Name, err)
	}
	if _, err := r.db.ExecContext(ctx, `UPDATE arsant_schema_migrations SET dirty=0,
		applied_at=UTC_TIMESTAMP() WHERE version=?`, migration.Version); err != nil {
		return fmt.Errorf("finish migration %d: %w", migration.Version, err)
	}
	return nil
}

func (r *Runner) ensureHistoryTable(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS arsant_schema_migrations (
		version BIGINT UNSIGNED NOT NULL PRIMARY KEY,
		name VARCHAR(160) NOT NULL,
		checksum CHAR(64) NOT NULL,
		dirty TINYINT(1) NOT NULL DEFAULT 0,
		applied_at DATETIME NOT NULL,
		KEY idx_arsant_schema_dirty (dirty, version)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
	if err != nil {
		return fmt.Errorf("ensure migration history table: %w", err)
	}
	return nil
}

func (r *Runner) listApplied(ctx context.Context) ([]AppliedMigration, error) {
	rows := make([]AppliedMigration, 0)
	if err := r.db.SelectContext(ctx, &rows, `SELECT version, name, checksum, dirty, applied_at
		FROM arsant_schema_migrations ORDER BY version`); err != nil {
		return nil, fmt.Errorf("list applied migrations: %w", err)
	}
	return rows, nil
}

func (r *Runner) existingApplicationTables(ctx context.Context) (int, error) {
	var count int
	if err := r.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM information_schema.tables
		WHERE table_schema=DATABASE() AND table_type='BASE TABLE'
		AND table_name NOT IN ('arsant_schema_migrations', 'schema_migrations')`); err != nil {
		return 0, fmt.Errorf("count application tables: %w", err)
	}
	return count, nil
}

func (r *Runner) acquireLock(ctx context.Context) (func(), error) {
	conn, err := r.db.Connx(ctx)
	if err != nil {
		return nil, fmt.Errorf("open migration lock connection: %w", err)
	}
	var acquired sql.NullInt64
	if err := conn.GetContext(ctx, &acquired, `SELECT GET_LOCK(?, 30)`, lockName); err != nil {
		conn.Close()
		return nil, fmt.Errorf("acquire migration lock: %w", err)
	}
	if !acquired.Valid || acquired.Int64 != 1 {
		conn.Close()
		return nil, errors.New("migration lock was not acquired within 30 seconds")
	}
	return func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var released sql.NullInt64
		_ = conn.GetContext(releaseCtx, &released, `SELECT RELEASE_LOCK(?)`, lockName)
		_ = conn.Close()
	}, nil
}

func IsBaselineRequired(err error) bool {
	return errors.Is(err, ErrBaselineRequired) || strings.Contains(strings.ToLower(err.Error()), "baseline is required")
}
