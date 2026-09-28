package store

import (
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

// Kepemilikan saham per investor per emiten. Sumbernya endpoint
// shareholding network Stockbit, yang isinya laporan bulanan KSEI —
// karena itu kuncinya report_date (akhir bulan), bukan tanggal ingest.
// Perubahan SID/scripless dihitung sebagai selisih antar report_date.

type ShareholdingInput struct {
	ReportDate     string
	Symbol         string
	InvestorID     int64
	InvestorName   string
	InvestorType   string
	Location       string
	Nationality    string
	Domicile       string
	Classification string
	Scrip          int64
	Scripless      int64
	TotalShares    int64
	Percentage     float64
	CompanyID      int64
}

type ShareholdingRow struct {
	ReportDate     time.Time `db:"report_date"`
	Symbol         string    `db:"symbol"`
	InvestorID     int64     `db:"investor_id"`
	InvestorName   string    `db:"investor_name"`
	InvestorType   *string   `db:"investor_type"`
	Location       *string   `db:"location"`
	Nationality    *string   `db:"nationality"`
	Domicile       *string   `db:"domicile"`
	Classification *string   `db:"classification"`
	Scrip          int64     `db:"scrip"`
	Scripless      int64     `db:"scripless"`
	TotalShares    int64     `db:"total_shares"`
	Percentage     float64   `db:"percentage"`
	CompanyID      *int64    `db:"company_id"`
}

func (r ShareholdingRow) DateStr() string { return r.ReportDate.Format("2006-01-02") }

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (r ShareholdingRow) InvestorTypeStr() string   { return str(r.InvestorType) }
func (r ShareholdingRow) LocationStr() string       { return str(r.Location) }
func (r ShareholdingRow) NationalityStr() string    { return str(r.Nationality) }
func (r ShareholdingRow) DomicileStr() string       { return str(r.Domicile) }
func (r ShareholdingRow) ClassificationStr() string { return str(r.Classification) }

func EnsureShareholdingTable(db *sqlx.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS shareholding (
			report_date    DATE          NOT NULL,
			symbol         VARCHAR(10)   NOT NULL,
			investor_id    BIGINT        NOT NULL,
			investor_name  VARCHAR(180)  NOT NULL,
			investor_type  VARCHAR(30)       NULL,
			location       VARCHAR(30)       NULL,
			nationality    VARCHAR(60)       NULL,
			domicile       VARCHAR(80)       NULL,
			classification VARCHAR(60)       NULL,
			scrip          BIGINT        NOT NULL DEFAULT 0,
			scripless      BIGINT        NOT NULL DEFAULT 0,
			total_shares   BIGINT        NOT NULL DEFAULT 0,
			percentage     DECIMAL(9,4)  NOT NULL DEFAULT 0,
			company_id     BIGINT            NULL,
			updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			PRIMARY KEY (report_date, symbol, investor_id),
			KEY idx_shareholding_symbol (symbol, report_date),
			KEY idx_shareholding_investor (investor_id, report_date),
			KEY idx_shareholding_date (report_date)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
	`)
	if err != nil {
		return fmt.Errorf("ensure shareholding table: %w", err)
	}
	return nil
}

func UpsertShareholding(db *sqlx.DB, rows []ShareholdingInput) error {
	if err := EnsureShareholdingTable(db); err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	tx, err := db.Beginx()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Preparex(`
		INSERT INTO shareholding
			(report_date, symbol, investor_id, investor_name, investor_type, location,
			 nationality, domicile, classification, scrip, scripless, total_shares,
			 percentage, company_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			investor_name = VALUES(investor_name), investor_type = VALUES(investor_type),
			location = VALUES(location), nationality = VALUES(nationality),
			domicile = VALUES(domicile), classification = VALUES(classification),
			scrip = VALUES(scrip), scripless = VALUES(scripless),
			total_shares = VALUES(total_shares), percentage = VALUES(percentage),
			company_id = VALUES(company_id)
	`)
	if err != nil {
		return fmt.Errorf("prepare upsert shareholding: %w", err)
	}
	defer stmt.Close()

	for _, r := range rows {
		if _, err := stmt.Exec(
			r.ReportDate, r.Symbol, r.InvestorID, r.InvestorName, r.InvestorType,
			r.Location, r.Nationality, r.Domicile, r.Classification,
			r.Scrip, r.Scripless, r.TotalShares, r.Percentage, r.CompanyID,
		); err != nil {
			return fmt.Errorf("upsert shareholding %s %s %d: %w", r.Symbol, r.ReportDate, r.InvestorID, err)
		}
	}
	return tx.Commit()
}

// ListShareholdingReportDates returns every KSEI report month present,
// newest first — the month picker in the panel is driven by this rather
// than by a generated calendar, so it can never offer an empty month.
func ListShareholdingReportDates(db *sqlx.DB) ([]string, error) {
	if err := EnsureShareholdingTable(db); err != nil {
		return nil, err
	}
	var dates []time.Time
	if err := db.Select(&dates, `SELECT DISTINCT report_date FROM shareholding ORDER BY report_date DESC`); err != nil {
		return nil, fmt.Errorf("list shareholding report dates: %w", err)
	}
	out := make([]string, len(dates))
	for i, d := range dates {
		out[i] = d.Format("2006-01-02")
	}
	return out, nil
}

// GetShareholdingBySymbol returns every investor row for one symbol across
// all report months (ascending), so the caller can diff month over month.
func GetShareholdingBySymbol(db *sqlx.DB, symbol string) ([]ShareholdingRow, error) {
	if err := EnsureShareholdingTable(db); err != nil {
		return nil, err
	}
	var rows []ShareholdingRow
	err := db.Select(&rows, `
		SELECT report_date, symbol, investor_id, investor_name, investor_type, location,
		       nationality, domicile, classification, scrip, scripless, total_shares,
		       percentage, company_id
		FROM shareholding
		WHERE symbol = ?
		ORDER BY report_date ASC, total_shares DESC
	`, symbol)
	if err != nil {
		return nil, fmt.Errorf("get shareholding %s: %w", symbol, err)
	}
	return rows, nil
}

// SymbolMonthTotal is one symbol's aggregate for one report month.
type SymbolMonthTotal struct {
	Symbol      string    `db:"symbol"`
	ReportDate  time.Time `db:"report_date"`
	Investors   int       `db:"investors"`
	Scrip       int64     `db:"scrip"`
	Scripless   int64     `db:"scripless"`
	TotalShares int64     `db:"total_shares"`
	LocalShares int64     `db:"local_shares"`
	ForeignSh   int64     `db:"foreign_shares"`
}

func (r SymbolMonthTotal) DateStr() string { return r.ReportDate.Format("2006-01-02") }

// GetShareholdingMonthlyTotals aggregates every symbol per report month.
// Agregasi dilakukan di SQL: satu bulan penuh untuk seluruh emiten bisa
// ratusan ribu baris investor, dan panel hanya butuh totalnya.
// symbols kosong berarti seluruh emiten.
func GetShareholdingMonthlyTotals(db *sqlx.DB, symbols []string) ([]SymbolMonthTotal, error) {
	if err := EnsureShareholdingTable(db); err != nil {
		return nil, err
	}
	where := ""
	args := []any{}
	if len(symbols) > 0 {
		where = "WHERE symbol IN (" + placeholders(len(symbols)) + ")"
		for _, s := range symbols {
			args = append(args, s)
		}
	}
	// "Local"/"Foreign" mengikuti kolom location dari KSEI (L/F).
	q := fmt.Sprintf(`
		SELECT symbol, report_date,
		       COUNT(*) AS investors,
		       SUM(scrip) AS scrip,
		       SUM(scripless) AS scripless,
		       SUM(total_shares) AS total_shares,
		       SUM(CASE WHEN location = 'Local' THEN total_shares ELSE 0 END) AS local_shares,
		       SUM(CASE WHEN location = 'Foreign' THEN total_shares ELSE 0 END) AS foreign_shares
		FROM shareholding
		%s
		GROUP BY symbol, report_date
		ORDER BY symbol ASC, report_date ASC
	`, where)

	var rows []SymbolMonthTotal
	if err := db.Select(&rows, q, args...); err != nil {
		return nil, fmt.Errorf("shareholding monthly totals: %w", err)
	}
	return rows, nil
}

// GetShareholdingSymbols lists every symbol that has shareholding data.
func GetShareholdingSymbols(db *sqlx.DB) ([]string, error) {
	if err := EnsureShareholdingTable(db); err != nil {
		return nil, err
	}
	var syms []string
	if err := db.Select(&syms, `SELECT DISTINCT symbol FROM shareholding ORDER BY symbol ASC`); err != nil {
		return nil, fmt.Errorf("list shareholding symbols: %w", err)
	}
	return syms, nil
}

// ShareholdingCoverage reports what has been ingested so far — the bridge
// panel and the frontend both show it so an incomplete crawl is visible
// rather than silently looking like "no data".
type ShareholdingCoverage struct {
	Symbols    int    `db:"symbols" json:"symbols"`
	Investors  int    `db:"investors" json:"investors"`
	Rows       int    `db:"rows_total" json:"rows"`
	Months     int    `db:"months" json:"months"`
	LatestDate string `json:"latestDate,omitempty"`
}

func GetShareholdingCoverage(db *sqlx.DB) (ShareholdingCoverage, error) {
	var c ShareholdingCoverage
	if err := EnsureShareholdingTable(db); err != nil {
		return c, err
	}
	err := db.Get(&c, `
		SELECT COUNT(DISTINCT symbol) AS symbols,
		       COUNT(DISTINCT investor_id) AS investors,
		       COUNT(*) AS rows_total,
		       COUNT(DISTINCT report_date) AS months
		FROM shareholding
	`)
	if err != nil {
		return c, fmt.Errorf("shareholding coverage: %w", err)
	}
	dates, err := ListShareholdingReportDates(db)
	if err == nil && len(dates) > 0 {
		c.LatestDate = dates[0]
	}
	return c, nil
}

// ParseKSEIReportDate converts Stockbit's "30 Jun 26" report label into an
// ISO date. Formatnya dua digit tahun dan nama bulan Inggris singkat; kalau
// berubah, pemanggil menerima error alih-alih menyimpan tanggal ngawur.
func ParseKSEIReportDate(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("report date kosong")
	}
	// Coba ISO dulu — kalau Stockbit suatu saat mengirim format baku.
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t.Format("2006-01-02"), nil
	}
	t, err := time.Parse("2 Jan 06", s)
	if err != nil {
		return "", fmt.Errorf("report date %q tidak dikenali: %w", s, err)
	}
	return t.Format("2006-01-02"), nil
}
