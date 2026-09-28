package store

import (
	"context"
	"fmt"

	"github.com/jmoiron/sqlx"
)

// Tabel yang TIDAK boleh dikosongkan. schema_migrations dipakai golang-migrate
// untuk melacak migrasi mana yang sudah jalan.
var resetProtectedTables = map[string]bool{
	"schema_migrations":        true,
	"arsant_schema_migrations": true,
	"data_sources":             true,
	"pipeline_settings":        true,
}

// ResetResult melaporkan satu tabel yang dikosongkan beserta jumlah baris yang
// terhapus — dipakai UI untuk menampilkan apa saja yang benar-benar terhapus.
type ResetResult struct {
	Table string `json:"table"`
	Rows  int64  `json:"rows"`
}

// ResetAllData mengosongkan SELURUH tabel data (struktur/skema tetap) — backend
// tombol "Reset Data" di terminal.
func ResetAllData(db *sqlx.DB) ([]ResetResult, error) {
	ctx := context.Background()
	conn, err := db.Connx(ctx)
	if err != nil {
		return nil, fmt.Errorf("reset data: get conn: %w", err)
	}
	defer conn.Close()

	var tables []string
	err = conn.SelectContext(ctx, &tables, `
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
		ORDER BY table_name
	`)
	if err != nil {
		return nil, fmt.Errorf("reset data: daftar tabel: %w", err)
	}

	if _, err := conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=0"); err != nil {
		return nil, fmt.Errorf("reset data disable fk: %w", err)
	}
	defer conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=1")

	results := make([]ResetResult, 0, len(tables))
	for _, t := range tables {
		if resetProtectedTables[t] {
			continue
		}
		var n int64
		if err := conn.GetContext(ctx, &n, "SELECT COUNT(*) FROM `"+t+"`"); err != nil {
			n = -1
		}
		// Hapus seluruh baris menggunakan DELETE FROM (paling andal dalam koneksi tunggal)
		if _, err := conn.ExecContext(ctx, "DELETE FROM `"+t+"`"); err != nil {
			if _, err2 := conn.ExecContext(ctx, "TRUNCATE TABLE `"+t+"`"); err2 != nil {
				return results, fmt.Errorf("reset table %s: %w", t, err)
			}
		}
		results = append(results, ResetResult{Table: t, Rows: n})
	}
	return results, nil
}
