package api

import (
	"sort"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

// Relay kepemilikan KSEI dari bridge (endpoint shareholding network
// Stockbit). Bridge mengirim graf mentah yang sudah diratakan jadi baris
// investor x emiten; normalisasi tanggal laporan dikerjakan di sini supaya
// aturan formatnya hidup di satu tempat.

type ShareholdingEdgeRequest struct {
	Symbol         string  `json:"symbol"`
	CompanyID      int64   `json:"companyId"`
	InvestorID     int64   `json:"investorId"`
	InvestorName   string  `json:"investorName"`
	InvestorType   string  `json:"investorType"`
	Location       string  `json:"location"`
	Nationality    string  `json:"nationality"`
	Domicile       string  `json:"domicile"`
	Classification string  `json:"classification"`
	Scrip          int64   `json:"scrip"`
	Scripless      int64   `json:"scripless"`
	TotalShares    int64   `json:"totalShares"`
	Percentage     float64 `json:"percentage"`
}

type IngestShareholdingRequest struct {
	// ReportDate menerima label mentah Stockbit ("30 Jun 26") maupun ISO.
	ReportDate string                    `json:"reportDate"`
	Holdings   []ShareholdingEdgeRequest `json:"holdings"`
}

func ingestShareholdingHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestShareholdingRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		reportDate, err := store.ParseKSEIReportDate(req.ReportDate)
		if err != nil {
			return badRequest(c, err.Error())
		}
		if len(req.Holdings) == 0 {
			return c.JSON(fiber.Map{"inserted": 0, "reportDate": reportDate})
		}

		rows := make([]store.ShareholdingInput, 0, len(req.Holdings))
		for _, h := range req.Holdings {
			symbol := strings.ToUpper(strings.TrimSpace(h.Symbol))
			if symbol == "" || h.InvestorID == 0 {
				continue
			}
			_ = store.EnsureSymbol(db, symbol)
			rows = append(rows, store.ShareholdingInput{
				ReportDate: reportDate, Symbol: symbol,
				InvestorID: h.InvestorID, InvestorName: h.InvestorName,
				InvestorType: h.InvestorType, Location: h.Location,
				Nationality: h.Nationality, Domicile: h.Domicile,
				Classification: h.Classification,
				Scrip:          h.Scrip, Scripless: h.Scripless,
				TotalShares: h.TotalShares, Percentage: h.Percentage,
				CompanyID: h.CompanyID,
			})
		}
		if err := store.UpsertShareholding(db, rows); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"inserted": len(rows), "reportDate": reportDate})
	}
}

// ---- SID & Scripless ----

type SIDResponse struct {
	Months   []string                   `json:"months"`
	Rows     []analytics.SIDRow         `json:"rows"`
	Coverage store.ShareholdingCoverage `json:"coverage"`
}

func getSIDHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		totals, err := store.GetShareholdingMonthlyTotals(db, nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		months, err := store.ListShareholdingReportDates(db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		coverage, err := store.GetShareholdingCoverage(db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		in := make([]analytics.MonthTotal, len(totals))
		for i, t := range totals {
			in[i] = analytics.MonthTotal{
				Symbol: t.Symbol, ReportDate: t.DateStr(), Investors: t.Investors,
				Scrip: t.Scrip, Scripless: t.Scripless, TotalShares: t.TotalShares,
				LocalShares: t.LocalShares, ForeignSh: t.ForeignSh,
			}
		}
		rows := analytics.BuildSIDRows(in, 6)

		// Filter bulan: hanya emiten yang punya laporan pada bulan itu.
		if month := c.Query("month"); month != "" {
			if !validDate(month) {
				return badRequest(c, "month harus format YYYY-MM-DD")
			}
			filtered := rows[:0:0]
			for _, r := range rows {
				if r.ReportDate == month {
					filtered = append(filtered, r)
				}
			}
			rows = filtered
		}
		if q := strings.ToUpper(strings.TrimSpace(c.Query("symbol"))); q != "" {
			filtered := rows[:0:0]
			for _, r := range rows {
				if strings.Contains(r.Symbol, q) {
					filtered = append(filtered, r)
				}
			}
			rows = filtered
		}

		switch c.Query("sort") {
		case "chg1m":
			sort.SliceStable(rows, func(i, j int) bool { return rows[i].Chg1M > rows[j].Chg1M })
		case "chg1m_asc":
			sort.SliceStable(rows, func(i, j int) bool { return rows[i].Chg1M < rows[j].Chg1M })
		case "scripless":
			sort.SliceStable(rows, func(i, j int) bool { return rows[i].ScriplessPct > rows[j].ScriplessPct })
		case "holders":
			sort.SliceStable(rows, func(i, j int) bool { return rows[i].Investors > rows[j].Investors })
		}

		if limit := queryInt(c, "limit", 200); limit > 0 && len(rows) > limit {
			rows = rows[:limit]
		}
		if rows == nil {
			rows = []analytics.SIDRow{}
		}
		if months == nil {
			months = []string{}
		}
		return c.JSON(SIDResponse{Months: months, Rows: rows, Coverage: coverage})
	}
}

func getShareholdingCompositionHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		rows, err := store.GetShareholdingBySymbol(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		in := make([]analytics.HoldingInput, len(rows))
		for i, r := range rows {
			in[i] = analytics.HoldingInput{
				ReportDate: r.DateStr(), InvestorID: r.InvestorID, Name: r.InvestorName,
				Type: r.InvestorTypeStr(), Location: r.LocationStr(),
				Nationality: r.NationalityStr(), Domicile: r.DomicileStr(),
				Classification: r.ClassificationStr(),
				Scrip:          r.Scrip, Scripless: r.Scripless,
				TotalShares: r.TotalShares, Percentage: r.Percentage,
			}
		}
		return c.JSON(analytics.BuildComposition(symbol, in))
	}
}

type DivergenceResponse struct {
	Rows []analytics.DivergenceRow `json:"rows"`
}

func getShareholdingDivergenceHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		totals, err := store.GetShareholdingMonthlyTotals(db, nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		in := make([]analytics.MonthTotal, len(totals))
		for i, t := range totals {
			in[i] = analytics.MonthTotal{
				Symbol: t.Symbol, ReportDate: t.DateStr(), Investors: t.Investors,
				Scrip: t.Scrip, Scripless: t.Scripless, TotalShares: t.TotalShares,
				LocalShares: t.LocalShares, ForeignSh: t.ForeignSh,
			}
		}
		rows := analytics.BuildSIDRows(in, 6)

		// Harga dibandingkan pada rentang bulan laporan yang sama dengan
		// perubahan pemegang, bukan rentang tetap — kalau tidak, sinyalnya
		// membandingkan dua periode yang berbeda.
		priceChange, err := monthlyPriceChange(db, in)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		out := analytics.BuildDivergence(rows, priceChange)
		if limit := queryInt(c, "limit", 100); limit > 0 && len(out) > limit {
			out = out[:limit]
		}
		if out == nil {
			out = []analytics.DivergenceRow{}
		}
		return c.JSON(DivergenceResponse{Rows: out})
	}
}

// monthlyPriceChange menghitung perubahan harga tiap emiten antara bulan
// laporan terakhir dan bulan sebelumnya, memakai penutupan terdekat pada
// atau sebelum masing-masing tanggal laporan.
func monthlyPriceChange(db *sqlx.DB, totals []analytics.MonthTotal) (map[string]float64, error) {
	bySymbol := map[string][]string{}
	for _, t := range totals {
		bySymbol[t.Symbol] = append(bySymbol[t.Symbol], t.ReportDate)
	}
	var minDate, maxDate string
	for _, dates := range bySymbol {
		for _, d := range dates {
			if minDate == "" || d < minDate {
				minDate = d
			}
			if d > maxDate {
				maxDate = d
			}
		}
	}
	if minDate == "" {
		return map[string]float64{}, nil
	}
	// Jendela ditarik mundur sebulan supaya penutupan pada/sebelum tanggal
	// laporan tertua tetap terjangkau (akhir bulan sering hari libur).
	if t, err := time.Parse("2006-01-02", minDate); err == nil {
		minDate = t.AddDate(0, -1, 0).Format("2006-01-02")
	}

	closeRows, err := store.GetClosesRange(db, minDate, maxDate)
	if err != nil {
		return nil, err
	}
	series := map[string][]store.CloseRow{}
	for _, r := range closeRows {
		series[r.Symbol] = append(series[r.Symbol], r)
	}

	closeAtOrBefore := func(sym, date string) (float64, bool) {
		list := series[sym]
		var last float64
		var found bool
		for _, r := range list { // GetClosesRange sudah terurut menaik
			if r.DateStr() > date {
				break
			}
			last, found = r.Close, true
		}
		return last, found
	}

	out := map[string]float64{}
	for sym, dates := range bySymbol {
		if len(dates) < 2 {
			continue
		}
		sort.Strings(dates)
		cur, okCur := closeAtOrBefore(sym, dates[len(dates)-1])
		prev, okPrev := closeAtOrBefore(sym, dates[len(dates)-2])
		if !okCur || !okPrev || prev <= 0 {
			continue
		}
		out[sym] = (cur - prev) / prev * 100
	}
	return out, nil
}
