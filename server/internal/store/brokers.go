package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

// Master broker IDX, diisi Data Collector dari
// GET /findata-view/marketdetectors/brokers. Menggantikan daftar hardcoded
// sebagai sumber NAMA dan golongan Asing/Lokal.
//
// Catatan penting: Stockbit hanya menyediakan `group` = "Asing"/"Lokal".
// Klasifikasi yang lebih halus (bumn / lokal-inst / ritel / ritel-online) yang
// dipakai mesin smart-money TIDAK ada di data Stockbit, jadi tetap berasal dari
// tabel klasifikasi di internal/analytics — DB dipakai untuk melengkapi dan
// mengoreksi, bukan menggantikannya sepenuhnya.
type BrokerRowMaster struct {
	Code           string    `db:"code" json:"code"`
	Name           string    `db:"name" json:"name"`
	Group          string    `db:"group_name" json:"group"`
	Color          string    `db:"color" json:"color,omitempty"`
	Permission     string    `db:"permission" json:"permission,omitempty"`
	MembershipType string    `db:"membership_type" json:"membershipType,omitempty"`
	UpdatedAt      time.Time `db:"updated_at" json:"updatedAt"`
}

func EnsureBrokersTable(db *sqlx.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS brokers (
		code VARCHAR(5) NOT NULL PRIMARY KEY,
		name VARCHAR(255) NOT NULL DEFAULT '',
		group_name VARCHAR(32) NOT NULL DEFAULT '',
		color VARCHAR(16) NOT NULL DEFAULT '',
		permission VARCHAR(255) NOT NULL DEFAULT '',
		membership_type VARCHAR(64) NOT NULL DEFAULT '',
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		KEY idx_brokers_group (group_name)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`)
	if err != nil {
		return fmt.Errorf("create brokers table: %w", err)
	}
	return nil
}

// Kolom investor_type menyusul belakangan (dulu domisili aliran dana dibuang
// oleh collector). Ditambahkan idempoten di sini, bukan lewat file migrasi,
// karena harus ikut menyentuh broker_range_agg yang tabelnya lahir dari
// migrasi lama — dan agar database yang sudah terlanjur jalan ikut terurus
// tanpa langkah manual.
func EnsureBrokerInvestorTypeColumn(db *sqlx.DB) error {
	for _, t := range []string{"broker_summary", "broker_range_agg"} {
		var n int
		err := db.Get(&n, `SELECT COUNT(*) FROM information_schema.columns
			WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'investor_type'`, t)
		if err != nil {
			return fmt.Errorf("cek kolom investor_type %s: %w", t, err)
		}
		if n > 0 {
			continue
		}
		if _, err := db.Exec("ALTER TABLE `" + t + "` ADD COLUMN investor_type VARCHAR(16) NOT NULL DEFAULT ''"); err != nil {
			return fmt.Errorf("tambah kolom investor_type ke %s: %w", t, err)
		}
	}
	return nil
}

func UpsertBrokers(db *sqlx.DB, rows []BrokerRowMaster) (int, error) {
	if err := EnsureBrokersTable(db); err != nil {
		return 0, err
	}
	q := `INSERT INTO brokers (code, name, group_name, color, permission, membership_type, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, NOW())
	ON DUPLICATE KEY UPDATE
		name=VALUES(name), group_name=VALUES(group_name), color=VALUES(color),
		permission=VALUES(permission), membership_type=VALUES(membership_type), updated_at=NOW();`

	n := 0
	for _, b := range rows {
		if b.Code == "" {
			continue
		}
		if _, err := db.Exec(q, b.Code, b.Name, b.Group, b.Color, b.Permission, b.MembershipType); err != nil {
			return n, fmt.Errorf("upsert broker %s: %w", b.Code, err)
		}
		n++
	}
	return n, nil
}

func ListBrokers(db *sqlx.DB) ([]BrokerRowMaster, error) {
	if err := EnsureBrokersTable(db); err != nil {
		return nil, err
	}
	var rows []BrokerRowMaster
	err := db.Select(&rows, `SELECT * FROM brokers ORDER BY code`)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}
