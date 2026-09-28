package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
)

type MarketMoverRow struct {
	MoverType  string    `db:"mover_type" json:"moverType"`
	Symbol     string    `db:"symbol" json:"symbol"`
	Name       string    `db:"name" json:"name"`
	Price      float64   `db:"price" json:"price"`
	ChangePct  float64   `db:"change_pct" json:"changePct"`
	Volume     int64     `db:"volume" json:"volume"`
	Value      float64   `db:"value" json:"value"`
	NetForeign float64   `db:"net_foreign" json:"netForeign"`
	UpdatedAt  time.Time `db:"updated_at" json:"updatedAt"`
}

type CalendarEventRow struct {
	ID          int64     `db:"id" json:"id"`
	EventDate   string    `db:"event_date" json:"eventDate"`
	Symbol      string    `db:"symbol" json:"symbol"`
	EventType   string    `db:"event_type" json:"eventType"`
	Title       string    `db:"title" json:"title"`
	Description string    `db:"description" json:"description"`
	UpdatedAt   time.Time `db:"updated_at" json:"updatedAt"`
}

type InsiderTxRow struct {
	ID         int64     `db:"id" json:"id"`
	Symbol     string    `db:"symbol" json:"symbol"`
	HolderName string    `db:"holder_name" json:"holderName"`
	ActionType string    `db:"action_type" json:"actionType"`
	Shares     int64     `db:"shares" json:"shares"`
	Price      float64   `db:"price" json:"price"`
	TxDate     string    `db:"tx_date" json:"txDate"`
	UpdatedAt  time.Time `db:"updated_at" json:"updatedAt"`
}

type KeyStatsRow struct {
	Symbol        string    `db:"symbol" json:"symbol"`
	PERatio       float64   `db:"pe_ratio" json:"peRatio"`
	PBVRatio      float64   `db:"pbv_ratio" json:"pbvRatio"`
	ROE           float64   `db:"roe" json:"roe"`
	ROA           float64   `db:"roa" json:"roa"`
	DER           float64   `db:"der" json:"der"`
	DividendYield float64   `db:"dividend_yield" json:"dividendYield"`
	MarketCap     float64   `db:"market_cap" json:"marketCap"`
	UpdatedAt     time.Time `db:"updated_at" json:"updatedAt"`
}

type FinancialStatementRow struct {
	ID            int64     `db:"id" json:"id"`
	Symbol        string    `db:"symbol" json:"symbol"`
	ReportType    string    `db:"report_type" json:"reportType"`
	StatementType string    `db:"statement_type" json:"statementType"`
	Period        string    `db:"period" json:"period"`
	Currency      string    `db:"currency" json:"currency"`
	ItemID        int       `db:"item_id" json:"itemId"`
	ItemName      string    `db:"item_name" json:"itemName"`
	Value         float64   `db:"value" json:"value"`
	UpdatedAt     time.Time `db:"updated_at" json:"updatedAt"`
}

type DividendRow struct {
	ID          int64     `db:"id" json:"id"`
	Symbol      string    `db:"symbol" json:"symbol"`
	CumDate     string    `db:"cum_date" json:"cumDate"`
	ExDate      string    `db:"ex_date" json:"exDate"`
	PaymentDate string    `db:"payment_date" json:"paymentDate"`
	Amount      float64   `db:"amount" json:"amount"`
	UpdatedAt   time.Time `db:"updated_at" json:"updatedAt"`
}

func EnsureMarketDataTables(db *sqlx.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS market_movers (
			mover_type VARCHAR(64) NOT NULL,
			symbol VARCHAR(16) NOT NULL,
			name VARCHAR(255) NOT NULL DEFAULT '',
			price DOUBLE NOT NULL DEFAULT 0,
			change_pct DOUBLE NOT NULL DEFAULT 0,
			volume BIGINT NOT NULL DEFAULT 0,
			value DOUBLE NOT NULL DEFAULT 0,
			net_foreign DOUBLE NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (mover_type, symbol)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

		`CREATE TABLE IF NOT EXISTS calendar_events (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			event_date VARCHAR(10) NOT NULL,
			symbol VARCHAR(16) NOT NULL,
			event_type VARCHAR(64) NOT NULL DEFAULT '',
			title VARCHAR(255) NOT NULL DEFAULT '',
			description TEXT,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			KEY idx_date_sym (event_date, symbol)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

		`CREATE TABLE IF NOT EXISTS insider_transactions (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			symbol VARCHAR(16) NOT NULL,
			holder_name VARCHAR(255) NOT NULL DEFAULT '',
			action_type VARCHAR(64) NOT NULL DEFAULT '',
			shares BIGINT NOT NULL DEFAULT 0,
			price DOUBLE NOT NULL DEFAULT 0,
			tx_date VARCHAR(10) NOT NULL DEFAULT '',
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			KEY idx_sym_date (symbol, tx_date)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

		`CREATE TABLE IF NOT EXISTS keystats (
			symbol VARCHAR(16) PRIMARY KEY,
			pe_ratio DOUBLE NOT NULL DEFAULT 0,
			pbv_ratio DOUBLE NOT NULL DEFAULT 0,
			roe DOUBLE NOT NULL DEFAULT 0,
			roa DOUBLE NOT NULL DEFAULT 0,
			der DOUBLE NOT NULL DEFAULT 0,
			dividend_yield DOUBLE NOT NULL DEFAULT 0,
			market_cap DOUBLE NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

		`CREATE TABLE IF NOT EXISTS dividends (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			symbol VARCHAR(16) NOT NULL,
			cum_date VARCHAR(10) NOT NULL DEFAULT '',
			ex_date VARCHAR(10) NOT NULL DEFAULT '',
			payment_date VARCHAR(10) NOT NULL DEFAULT '',
			amount DOUBLE NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uq_sym_cum (symbol, cum_date)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

		`CREATE TABLE IF NOT EXISTS financial_statements (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			symbol VARCHAR(16) NOT NULL,
			report_type VARCHAR(16) NOT NULL DEFAULT '',
			statement_type VARCHAR(16) NOT NULL DEFAULT '',
			period VARCHAR(20) NOT NULL DEFAULT '',
			currency VARCHAR(6) NOT NULL DEFAULT 'IDR',
			item_id INT NOT NULL DEFAULT 0,
			item_name VARCHAR(255) NOT NULL DEFAULT '',
			value DOUBLE NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uq_fs (symbol, report_type, statement_type, period, item_id),
			KEY idx_fs_sym (symbol)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
	}

	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("create table error: %w", err)
		}
	}
	insiderIndexOnce.Do(func() {
		ensureInsiderUniqueIndex(db)
		ensureCalendarUniqueIndex(db)
	})
	return nil
}

var insiderIndexOnce sync.Once

// calendar_events juga lahir tanpa kunci unik. Aman waktu diisi sekali sehari
// oleh polling, tapi Data Collector menarik ulang rentang tanggal yang sama
// tiap crawl — tanpa kunci unik, agendanya menggandakan diri tiap putaran.
// Perlakuannya sama dengan insider_transactions: bersihkan duplikat lalu pasang
// UNIQUE. Best-effort; kegagalan tidak boleh menghentikan ingest.
func ensureCalendarUniqueIndex(db *sqlx.DB) {
	var n int
	err := db.Get(&n, `SELECT COUNT(*) FROM information_schema.statistics
		WHERE table_schema = DATABASE() AND table_name = 'calendar_events'
		  AND index_name = 'uq_calendar'`)
	if err != nil || n > 0 {
		return
	}
	_, _ = db.Exec(`DELETE t1 FROM calendar_events t1
		INNER JOIN calendar_events t2
		WHERE t1.id > t2.id AND t1.event_date = t2.event_date AND t1.symbol = t2.symbol
		  AND t1.event_type = t2.event_type AND t1.title = t2.title`)
	_, _ = db.Exec(`ALTER TABLE calendar_events
		ADD UNIQUE KEY uq_calendar (event_date, symbol, event_type, title(120))`)
}

// insider_transactions awalnya tanpa kunci unik: tiap ingest melakukan INSERT
// polos. Itu aman waktu datanya datang dari polling sekali-sekali, tapi Data
// Collector menarik ulang jendela yang sama tiap crawl — tanpa kunci unik,
// tabelnya menggandakan diri setiap putaran.
//
// Ditangani di sini (bukan lewat file migrasi) karena tabel ini memang dibuat
// dari kode: bersihkan duplikat yang sudah terlanjur ada, lalu pasang UNIQUE.
// Best-effort — kegagalan apa pun tidak boleh menghentikan ingest, cuma berarti
// dedup-nya belum aktif.
func ensureInsiderUniqueIndex(db *sqlx.DB) {
	var n int
	err := db.Get(&n, `SELECT COUNT(*) FROM information_schema.statistics
		WHERE table_schema = DATABASE() AND table_name = 'insider_transactions'
		  AND index_name = 'uq_insider'`)
	if err != nil || n > 0 {
		return
	}
	_, _ = db.Exec(`DELETE t1 FROM insider_transactions t1
		INNER JOIN insider_transactions t2
		WHERE t1.id > t2.id AND t1.symbol = t2.symbol AND t1.tx_date = t2.tx_date
		  AND t1.holder_name = t2.holder_name AND t1.action_type = t2.action_type
		  AND t1.shares = t2.shares`)
	// prefix 100 karakter pada holder_name supaya muat di batas panjang index
	// InnoDB pada MySQL 5.7 (utf8mb4 = 4 byte/karakter).
	_, _ = db.Exec(`ALTER TABLE insider_transactions
		ADD UNIQUE KEY uq_insider (symbol, tx_date, holder_name(100), action_type, shares)`)
}

func UpsertMarketMovers(db *sqlx.DB, movers []MarketMoverRow) error {
	if err := EnsureMarketDataTables(db); err != nil {
		return err
	}
	q := `INSERT INTO market_movers (mover_type, symbol, name, price, change_pct, volume, value, net_foreign, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
	ON DUPLICATE KEY UPDATE
		name=VALUES(name), price=VALUES(price), change_pct=VALUES(change_pct),
		volume=VALUES(volume), value=VALUES(value), net_foreign=VALUES(net_foreign), updated_at=NOW();`

	for _, m := range movers {
		if m.Symbol == "" || m.MoverType == "" {
			continue
		}
		_ = UpsertSymbolMetadata(db, m.Symbol, m.Name, "")
		_, _ = db.Exec(q, m.MoverType, m.Symbol, m.Name, m.Price, m.ChangePct, m.Volume, m.Value, m.NetForeign)
	}
	return nil
}

func GetMarketMovers(db *sqlx.DB, moverType string) ([]MarketMoverRow, error) {
	if err := EnsureMarketDataTables(db); err != nil {
		return nil, err
	}
	var rows []MarketMoverRow
	var err error
	if moverType != "" {
		err = db.Select(&rows, `SELECT * FROM market_movers WHERE mover_type = ? ORDER BY value DESC, price DESC`, moverType)
	} else {
		err = db.Select(&rows, `SELECT * FROM market_movers ORDER BY value DESC LIMIT 100`)
	}
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}

func UpsertCalendarEvents(db *sqlx.DB, events []CalendarEventRow) error {
	if err := EnsureMarketDataTables(db); err != nil {
		return err
	}
	q := `INSERT INTO calendar_events (event_date, symbol, event_type, title, description, updated_at)
	VALUES (?, ?, ?, ?, ?, NOW())
	ON DUPLICATE KEY UPDATE description=VALUES(description), updated_at=NOW();`

	for _, e := range events {
		if e.Symbol == "" || e.EventDate == "" {
			continue
		}
		_ = EnsureSymbol(db, e.Symbol)
		_, _ = db.Exec(q, e.EventDate, e.Symbol, e.EventType, e.Title, e.Description)
	}
	return nil
}

func GetCalendarEvents(db *sqlx.DB, date string) ([]CalendarEventRow, error) {
	if err := EnsureMarketDataTables(db); err != nil {
		return nil, err
	}
	var rows []CalendarEventRow
	var err error
	if date != "" {
		err = db.Select(&rows, `SELECT * FROM calendar_events WHERE event_date = ? ORDER BY id DESC`, date)
	} else {
		err = db.Select(&rows, `SELECT * FROM calendar_events ORDER BY event_date DESC, id DESC LIMIT 100`)
	}
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}

func UpsertInsiderTransactions(db *sqlx.DB, txs []InsiderTxRow) error {
	if err := EnsureMarketDataTables(db); err != nil {
		return err
	}
	q := `INSERT INTO insider_transactions (symbol, holder_name, action_type, shares, price, tx_date, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, NOW())
	ON DUPLICATE KEY UPDATE price=VALUES(price), updated_at=NOW();`

	for _, t := range txs {
		if t.Symbol == "" {
			continue
		}
		_ = EnsureSymbol(db, t.Symbol)
		_, _ = db.Exec(q, t.Symbol, t.HolderName, t.ActionType, t.Shares, t.Price, t.TxDate)
	}
	return nil
}

func GetInsiderTransactions(db *sqlx.DB, symbol string) ([]InsiderTxRow, error) {
	if err := EnsureMarketDataTables(db); err != nil {
		return nil, err
	}
	var rows []InsiderTxRow
	var err error
	if symbol != "" {
		err = db.Select(&rows, `SELECT * FROM insider_transactions WHERE symbol = ? ORDER BY id DESC LIMIT 50`, symbol)
	} else {
		err = db.Select(&rows, `SELECT * FROM insider_transactions ORDER BY id DESC LIMIT 100`)
	}
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}

func UpsertKeyStats(db *sqlx.DB, k KeyStatsRow) error {
	if err := EnsureMarketDataTables(db); err != nil {
		return err
	}
	if k.Symbol == "" {
		return nil
	}
	_ = EnsureSymbol(db, k.Symbol)
	q := `INSERT INTO keystats (symbol, pe_ratio, pbv_ratio, roe, roa, der, dividend_yield, market_cap, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
	ON DUPLICATE KEY UPDATE
		pe_ratio=VALUES(pe_ratio), pbv_ratio=VALUES(pbv_ratio), roe=VALUES(roe),
		roa=VALUES(roa), der=VALUES(der), dividend_yield=VALUES(dividend_yield),
		market_cap=VALUES(market_cap), updated_at=NOW();`
	_, err := db.Exec(q, k.Symbol, k.PERatio, k.PBVRatio, k.ROE, k.ROA, k.DER, k.DividendYield, k.MarketCap)
	return err
}

func GetKeyStats(db *sqlx.DB, symbol string) (*KeyStatsRow, error) {
	if err := EnsureMarketDataTables(db); err != nil {
		return nil, err
	}
	var row KeyStatsRow
	err := db.Get(&row, `SELECT * FROM keystats WHERE symbol = ?`, symbol)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func UpsertDividends(db *sqlx.DB, divs []DividendRow) error {
	if err := EnsureMarketDataTables(db); err != nil {
		return err
	}
	q := `INSERT INTO dividends (symbol, cum_date, ex_date, payment_date, amount, updated_at)
	VALUES (?, ?, ?, ?, ?, NOW())
	ON DUPLICATE KEY UPDATE
		ex_date=VALUES(ex_date), payment_date=VALUES(payment_date), amount=VALUES(amount), updated_at=NOW();`

	for _, d := range divs {
		if d.Symbol == "" {
			continue
		}
		_ = EnsureSymbol(db, d.Symbol)
		_, _ = db.Exec(q, d.Symbol, d.CumDate, d.ExDate, d.PaymentDate, d.Amount)
	}
	return nil
}

func GetDividends(db *sqlx.DB, symbol string) ([]DividendRow, error) {
	if err := EnsureMarketDataTables(db); err != nil {
		return nil, err
	}
	var rows []DividendRow
	var err error
	if symbol != "" {
		err = db.Select(&rows, `SELECT * FROM dividends WHERE symbol = ? ORDER BY cum_date DESC`, symbol)
	} else {
		err = db.Select(&rows, `SELECT * FROM dividends ORDER BY id DESC LIMIT 100`)
	}
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}

func UpsertFinancialStatements(db *sqlx.DB, symbol string, rows []FinancialStatementRow) error {
	if err := EnsureMarketDataTables(db); err != nil {
		return err
	}
	if symbol == "" {
		return nil
	}
	_ = EnsureSymbol(db, symbol)
	q := `INSERT INTO financial_statements (symbol, report_type, statement_type, period, currency, item_id, item_name, value, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
	ON DUPLICATE KEY UPDATE
		currency=VALUES(currency), item_name=VALUES(item_name), value=VALUES(value), updated_at=NOW();`

	for _, r := range rows {
		if r.ReportType == "" || r.StatementType == "" || r.Period == "" {
			continue
		}
		_, _ = db.Exec(q, symbol, r.ReportType, r.StatementType, r.Period, r.Currency, r.ItemID, r.ItemName, r.Value)
	}
	return nil
}

func GetFinancialStatements(db *sqlx.DB, symbol, reportType, statementType string) ([]FinancialStatementRow, error) {
	if err := EnsureMarketDataTables(db); err != nil {
		return nil, err
	}
	q := `SELECT * FROM financial_statements WHERE symbol = ?`
	args := []interface{}{symbol}
	if reportType != "" {
		q += ` AND report_type = ?`
		args = append(args, reportType)
	}
	if statementType != "" {
		q += ` AND statement_type = ?`
		args = append(args, statementType)
	}
	q += ` ORDER BY period DESC, item_id ASC`

	var rows []FinancialStatementRow
	err := db.Select(&rows, q, args...)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}

// Struct for JSON payloads
type _RawJSON struct {
	Data json.RawMessage `json:"data"`
}

// ---------------------------------------------------------------------------
// Rasio KeyStats Stockbit (lengkap)
// ---------------------------------------------------------------------------

// Respons /keystats/ratio/v1/{symbol} bukan 7 field datar seperti dugaan awal,
// melainkan PULUHAN rasio bernama yang dikelompokkan ("Current Valuation",
// "Per Share", "Solvency", "Management Effectiveness", …). Tabel keystats yang
// lama hanya menampung 7 di antaranya; sisanya dulu terbuang. Di sini seluruh
// rasio disimpan apa adanya — nilai numerik untuk perhitungan, plus teks
// aslinya ("0.28%", "7,505 B") supaya penyajian tidak kehilangan satuan.
type KeyStatsRatioRow struct {
	Symbol    string    `db:"symbol" json:"symbol"`
	GroupName string    `db:"group_name" json:"group"`
	Name      string    `db:"name" json:"name"`
	Value     float64   `db:"value" json:"value"`
	RawValue  string    `db:"raw_value" json:"rawValue"`
	Unit      string    `db:"unit" json:"unit,omitempty"`
	UpdatedAt time.Time `db:"updated_at" json:"updatedAt"`
}

func EnsureKeyStatsRatioTable(db *sqlx.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS keystats_ratios (
		symbol VARCHAR(16) NOT NULL,
		group_name VARCHAR(64) NOT NULL DEFAULT '',
		name VARCHAR(160) NOT NULL,
		value DOUBLE NOT NULL DEFAULT 0,
		raw_value VARCHAR(64) NOT NULL DEFAULT '',
		unit VARCHAR(8) NOT NULL DEFAULT '',
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		PRIMARY KEY (symbol, name),
		KEY idx_ksr_symbol_group (symbol, group_name)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`)
	if err != nil {
		return fmt.Errorf("create keystats_ratios: %w", err)
	}
	return nil
}

func UpsertKeyStatsRatios(db *sqlx.DB, symbol string, rows []KeyStatsRatioRow) (int, error) {
	if err := EnsureKeyStatsRatioTable(db); err != nil {
		return 0, err
	}
	q := `INSERT INTO keystats_ratios (symbol, group_name, name, value, raw_value, unit, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, NOW())
	ON DUPLICATE KEY UPDATE
		group_name=VALUES(group_name), value=VALUES(value),
		raw_value=VALUES(raw_value), unit=VALUES(unit), updated_at=NOW();`
	n := 0
	for _, r := range rows {
		if r.Name == "" {
			continue
		}
		if _, err := db.Exec(q, symbol, r.GroupName, r.Name, r.Value, r.RawValue, r.Unit); err != nil {
			return n, fmt.Errorf("upsert keystats ratio %s/%s: %w", symbol, r.Name, err)
		}
		n++
	}
	return n, nil
}

func GetKeyStatsRatios(db *sqlx.DB, symbol string) ([]KeyStatsRatioRow, error) {
	if err := EnsureKeyStatsRatioTable(db); err != nil {
		return nil, err
	}
	var rows []KeyStatsRatioRow
	err := db.Select(&rows,
		`SELECT * FROM keystats_ratios WHERE symbol = ? ORDER BY group_name, name`, symbol)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}
