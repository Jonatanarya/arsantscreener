// Analitik kepemilikan KSEI: perubahan jumlah pemegang (SID) dan porsi
// scripless antar bulan laporan, komposisi investor, dan divergensi antara
// arah kepemilikan dengan arah harga.
package analytics

import (
	"math"
	"sort"
)

// MonthTotal adalah agregat satu emiten pada satu bulan laporan KSEI.
type MonthTotal struct {
	Symbol      string
	ReportDate  string
	Investors   int
	Scrip       int64
	Scripless   int64
	TotalShares int64
	LocalShares int64
	ForeignSh   int64
}

type SIDPoint struct {
	ReportDate string `json:"reportDate"`
	Investors  int    `json:"investors"`
	// ScriplessPct = scripless / total * 100. Naiknya porsi scripless tanpa
	// tambahan total saham berarti konversi warkat, bukan pembelian baru —
	// itulah kenapa keduanya selalu ditampilkan berdampingan.
	ScriplessPct float64 `json:"scriplessPct"`
	TotalShares  int64   `json:"totalShares"`
	ForeignPct   float64 `json:"foreignPct"`
}

type SIDRow struct {
	Symbol       string     `json:"symbol"`
	ReportDate   string     `json:"reportDate"`
	Investors    int        `json:"investors"`
	Trend        []SIDPoint `json:"trend"`
	Chg1M        int        `json:"chg1m"`
	Chg3M        int        `json:"chg3m"`
	Pct1M        float64    `json:"pct1m"`
	Pct3M        float64    `json:"pct3m"`
	Has1M        bool       `json:"has1m"`
	Has3M        bool       `json:"has3m"`
	ScriplessPct float64    `json:"scriplessPct"`
	// ScriplessChg1M dalam poin persentase, bukan persen relatif.
	ScriplessChg1M float64 `json:"scriplessChg1m"`
	ForeignPct     float64 `json:"foreignPct"`
	ForeignChg1M   float64 `json:"foreignChg1m"`
	TotalShares    int64   `json:"totalShares"`
}

// BuildSIDRows menyusun tren per emiten dari agregat bulanan. Input boleh
// tidak terurut; fungsi ini yang mengurutkan per tanggal laporan.
//
// Perubahan 1M/3M dihitung dari POSISI dalam deret bulan yang tersedia,
// bukan dari selisih kalender: kalau satu bulan bolong karena crawl belum
// lengkap, "1M" berarti "laporan sebelumnya yang ada" — dan bendera
// Has1M/Has3M memberi tahu frontend kapan angka itu tidak bisa dipercaya.
func BuildSIDRows(totals []MonthTotal, maxTrend int) []SIDRow {
	if maxTrend <= 0 {
		maxTrend = 6
	}
	bySymbol := map[string][]MonthTotal{}
	for _, t := range totals {
		bySymbol[t.Symbol] = append(bySymbol[t.Symbol], t)
	}

	rows := make([]SIDRow, 0, len(bySymbol))
	for sym, list := range bySymbol {
		sort.Slice(list, func(i, j int) bool { return list[i].ReportDate < list[j].ReportDate })

		trend := make([]SIDPoint, 0, len(list))
		for _, m := range list {
			trend = append(trend, SIDPoint{
				ReportDate:   m.ReportDate,
				Investors:    m.Investors,
				ScriplessPct: pctOf(m.Scripless, m.TotalShares),
				ForeignPct:   pctOf(m.ForeignSh, m.TotalShares),
				TotalShares:  m.TotalShares,
			})
		}
		if len(trend) > maxTrend {
			trend = trend[len(trend)-maxTrend:]
		}

		last := list[len(list)-1]
		row := SIDRow{
			Symbol: sym, ReportDate: last.ReportDate, Investors: last.Investors,
			Trend: trend, TotalShares: last.TotalShares,
			ScriplessPct: pctOf(last.Scripless, last.TotalShares),
			ForeignPct:   pctOf(last.ForeignSh, last.TotalShares),
		}

		if prev, ok := nthBack(list, 1); ok {
			row.Has1M = true
			row.Chg1M = last.Investors - prev.Investors
			if prev.Investors > 0 {
				row.Pct1M = float64(row.Chg1M) / float64(prev.Investors) * 100
			}
			row.ScriplessChg1M = row.ScriplessPct - pctOf(prev.Scripless, prev.TotalShares)
			row.ForeignChg1M = row.ForeignPct - pctOf(prev.ForeignSh, prev.TotalShares)
		}
		if prev, ok := nthBack(list, 3); ok {
			row.Has3M = true
			row.Chg3M = last.Investors - prev.Investors
			if prev.Investors > 0 {
				row.Pct3M = float64(row.Chg3M) / float64(prev.Investors) * 100
			}
		}
		rows = append(rows, row)
	}

	sort.Slice(rows, func(i, j int) bool { return rows[i].Symbol < rows[j].Symbol })
	return rows
}

func nthBack(list []MonthTotal, n int) (MonthTotal, bool) {
	i := len(list) - 1 - n
	if i < 0 {
		return MonthTotal{}, false
	}
	return list[i], true
}

func pctOf(part, whole int64) float64 {
	if whole <= 0 {
		return 0
	}
	return float64(part) / float64(whole) * 100
}

// ---- komposisi investor satu emiten ----

type InvestorHolding struct {
	InvestorID     int64   `json:"investorId"`
	Name           string  `json:"name"`
	Type           string  `json:"type"`
	Location       string  `json:"location"`
	Classification string  `json:"classification"`
	Domicile       string  `json:"domicile"`
	Scrip          int64   `json:"scrip"`
	Scripless      int64   `json:"scripless"`
	TotalShares    int64   `json:"totalShares"`
	Percentage     float64 `json:"percentage"`
	// ChgShares/ChgPct membandingkan dengan bulan laporan sebelumnya;
	// IsNew menandai investor yang baru muncul (tidak ada bulan lalu).
	ChgShares int64   `json:"chgShares"`
	ChgPct    float64 `json:"chgPct"`
	IsNew     bool    `json:"isNew"`
	HasPrev   bool    `json:"hasPrev"`
}

type ClassificationSlice struct {
	Label       string  `json:"label"`
	Holders     int     `json:"holders"`
	TotalShares int64   `json:"totalShares"`
	SharePct    float64 `json:"sharePct"`
	ChgShares   int64   `json:"chgShares"`
}

// HoldingInput adalah satu baris kepemilikan mentah dari store.
type HoldingInput struct {
	ReportDate     string
	InvestorID     int64
	Name           string
	Type           string
	Location       string
	Nationality    string
	Domicile       string
	Classification string
	Scrip          int64
	Scripless      int64
	TotalShares    int64
	Percentage     float64
}

type Composition struct {
	Symbol           string                `json:"symbol"`
	ReportDate       string                `json:"reportDate"`
	PrevReportDate   string                `json:"prevReportDate,omitempty"`
	Months           []string              `json:"months"`
	Holders          []InvestorHolding     `json:"holders"`
	ByClassification []ClassificationSlice `json:"byClassification"`
	ByLocation       []ClassificationSlice `json:"byLocation"`
	Trend            []SIDPoint            `json:"trend"`
	TotalShares      int64                 `json:"totalShares"`
	ScriplessPct     float64               `json:"scriplessPct"`
	Investors        int                   `json:"investors"`
	// GoneHolders adalah investor yang ada bulan lalu tapi hilang bulan ini
	// — sinyal keluar total yang tidak terlihat kalau hanya melihat daftar
	// pemegang saat ini.
	GoneHolders []InvestorHolding `json:"goneHolders"`
}

// BuildComposition menyusun komposisi pemegang saham satu emiten pada bulan
// laporan terakhir, lengkap dengan perbandingan terhadap bulan sebelumnya.
func BuildComposition(symbol string, rows []HoldingInput) Composition {
	c := Composition{
		Symbol: symbol,
		Months: []string{}, Holders: []InvestorHolding{},
		ByClassification: []ClassificationSlice{}, ByLocation: []ClassificationSlice{},
		Trend: []SIDPoint{}, GoneHolders: []InvestorHolding{},
	}
	if len(rows) == 0 {
		return c
	}

	byMonth := map[string][]HoldingInput{}
	for _, r := range rows {
		byMonth[r.ReportDate] = append(byMonth[r.ReportDate], r)
	}
	months := make([]string, 0, len(byMonth))
	for m := range byMonth {
		months = append(months, m)
	}
	sort.Strings(months)
	c.Months = months

	for _, m := range months {
		var scripless, total, foreign int64
		for _, r := range byMonth[m] {
			scripless += r.Scripless
			total += r.TotalShares
			if r.Location == "Foreign" {
				foreign += r.TotalShares
			}
		}
		c.Trend = append(c.Trend, SIDPoint{
			ReportDate: m, Investors: len(byMonth[m]),
			ScriplessPct: pctOf(scripless, total), ForeignPct: pctOf(foreign, total),
			TotalShares: total,
		})
	}

	cur := byMonth[months[len(months)-1]]
	c.ReportDate = months[len(months)-1]
	var prev []HoldingInput
	if len(months) >= 2 {
		c.PrevReportDate = months[len(months)-2]
		prev = byMonth[c.PrevReportDate]
	}
	prevByID := make(map[int64]HoldingInput, len(prev))
	for _, r := range prev {
		prevByID[r.InvestorID] = r
	}

	seen := map[int64]bool{}
	for _, r := range cur {
		seen[r.InvestorID] = true
		h := InvestorHolding{
			InvestorID: r.InvestorID, Name: r.Name, Type: r.Type,
			Location: r.Location, Classification: r.Classification, Domicile: r.Domicile,
			Scrip: r.Scrip, Scripless: r.Scripless, TotalShares: r.TotalShares,
			Percentage: r.Percentage,
		}
		if p, ok := prevByID[r.InvestorID]; ok {
			h.HasPrev = true
			h.ChgShares = r.TotalShares - p.TotalShares
			if p.TotalShares > 0 {
				h.ChgPct = float64(h.ChgShares) / float64(p.TotalShares) * 100
			}
		} else if len(prev) > 0 {
			h.IsNew = true
		}
		c.Holders = append(c.Holders, h)
		c.TotalShares += r.TotalShares
	}
	sort.Slice(c.Holders, func(i, j int) bool { return c.Holders[i].TotalShares > c.Holders[j].TotalShares })
	c.Investors = len(c.Holders)

	for _, p := range prev {
		if seen[p.InvestorID] {
			continue
		}
		c.GoneHolders = append(c.GoneHolders, InvestorHolding{
			InvestorID: p.InvestorID, Name: p.Name, Type: p.Type,
			Location: p.Location, Classification: p.Classification, Domicile: p.Domicile,
			TotalShares: 0, ChgShares: -p.TotalShares, ChgPct: -100, HasPrev: true,
		})
	}
	sort.Slice(c.GoneHolders, func(i, j int) bool { return c.GoneHolders[i].ChgShares < c.GoneHolders[j].ChgShares })

	var scripless int64
	for _, r := range cur {
		scripless += r.Scripless
	}
	c.ScriplessPct = pctOf(scripless, c.TotalShares)

	c.ByClassification = sliceBy(cur, prevByID, c.TotalShares, func(r HoldingInput) string {
		if r.Classification == "" {
			return "Tidak diketahui"
		}
		return r.Classification
	})
	c.ByLocation = sliceBy(cur, prevByID, c.TotalShares, func(r HoldingInput) string {
		if r.Location == "" {
			return "Tidak diketahui"
		}
		return r.Location
	})
	return c
}

func sliceBy(cur []HoldingInput, prevByID map[int64]HoldingInput, total int64, key func(HoldingInput) string) []ClassificationSlice {
	type acc struct {
		holders int
		shares  int64
		chg     int64
	}
	m := map[string]*acc{}
	for _, r := range cur {
		k := key(r)
		a := m[k]
		if a == nil {
			a = &acc{}
			m[k] = a
		}
		a.holders++
		a.shares += r.TotalShares
		if p, ok := prevByID[r.InvestorID]; ok {
			a.chg += r.TotalShares - p.TotalShares
		} else {
			a.chg += r.TotalShares
		}
	}
	out := make([]ClassificationSlice, 0, len(m))
	for k, a := range m {
		out = append(out, ClassificationSlice{
			Label: k, Holders: a.holders, TotalShares: a.shares,
			SharePct: pctOf(a.shares, total), ChgShares: a.chg,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TotalShares > out[j].TotalShares })
	return out
}

// ---- divergensi kepemilikan vs harga ----

type DivergenceRow struct {
	Symbol     string `json:"symbol"`
	ReportDate string `json:"reportDate"`
	// HolderChgPct = perubahan jumlah pemegang bulan terakhir (%).
	HolderChgPct float64 `json:"holderChgPct"`
	// PriceChgPct = perubahan harga pada rentang bulan laporan yang sama.
	PriceChgPct float64 `json:"priceChgPct"`
	Gap         float64 `json:"gap"`
	Signal      string  `json:"signal"`
	Note        string  `json:"note"`
	Investors   int     `json:"investors"`
	HasPrice    bool    `json:"hasPrice"`
}

// BuildDivergence memasangkan arah jumlah pemegang dengan arah harga pada
// periode yang sama. Logikanya bandarmologi klasik: jumlah pemegang NAIK
// sementara harga TURUN berarti barang berpindah dari sedikit tangan besar
// ke banyak tangan kecil (distribusi ritel); sebaliknya jumlah pemegang
// TURUN sementara harga NAIK berarti barang mengumpul (akumulasi).
//
// priceChange dipetakan simbol -> perubahan harga persen pada rentang yang
// sama; simbol tanpa data harga tetap dikembalikan dengan HasPrice=false
// supaya frontend bisa membedakan "netral" dari "tidak diketahui".
func BuildDivergence(rows []SIDRow, priceChange map[string]float64) []DivergenceRow {
	out := make([]DivergenceRow, 0, len(rows))
	for _, r := range rows {
		if !r.Has1M {
			continue
		}
		d := DivergenceRow{
			Symbol: r.Symbol, ReportDate: r.ReportDate,
			HolderChgPct: r.Pct1M, Investors: r.Investors,
		}
		p, ok := priceChange[r.Symbol]
		if !ok {
			d.Signal = "TIDAK DIKETAHUI"
			d.Note = "Bar harian pada rentang bulan laporan belum tersedia."
			out = append(out, d)
			continue
		}
		d.HasPrice = true
		d.PriceChgPct = p
		d.Gap = r.Pct1M - p

		const flat = 1.0 // di bawah 1% dianggap datar, bukan arah
		switch {
		case r.Pct1M > flat && p < -flat:
			d.Signal = "DISTRIBUSI KE RITEL"
			d.Note = "Jumlah pemegang bertambah saat harga turun — barang berpindah ke banyak tangan kecil."
		case r.Pct1M < -flat && p > flat:
			d.Signal = "AKUMULASI"
			d.Note = "Jumlah pemegang menyusut saat harga naik — barang mengumpul di sedikit tangan."
		case r.Pct1M > flat && p > flat:
			d.Signal = "PARTISIPASI LUAS"
			d.Note = "Pemegang dan harga sama-sama naik — kenaikan didukung minat luas."
		case r.Pct1M < -flat && p < -flat:
			d.Signal = "KAPITULASI"
			d.Note = "Pemegang dan harga sama-sama turun — pemegang kecil menyerah."
		default:
			d.Signal = "NETRAL"
			d.Note = "Perubahan pemegang maupun harga belum cukup berarti."
		}
		out = append(out, d)
	}

	// Urut dari divergensi paling ekstrem: itu yang layak diperiksa dulu.
	sort.Slice(out, func(i, j int) bool { return math.Abs(out[i].Gap) > math.Abs(out[j].Gap) })
	return out
}
