package analytics

import (
	"math"
	"testing"
)

func TestBuildSIDRowsChanges(t *testing.T) {
	totals := []MonthTotal{
		// sengaja tidak terurut — BuildSIDRows yang harus mengurutkan
		{Symbol: "AAA", ReportDate: "2026-04-30", Investors: 1000, Scripless: 50, TotalShares: 100, ForeignSh: 20},
		{Symbol: "AAA", ReportDate: "2026-06-30", Investors: 1200, Scripless: 80, TotalShares: 100, ForeignSh: 40},
		{Symbol: "AAA", ReportDate: "2026-03-31", Investors: 900, Scripless: 40, TotalShares: 100, ForeignSh: 10},
		{Symbol: "AAA", ReportDate: "2026-05-31", Investors: 1100, Scripless: 60, TotalShares: 100, ForeignSh: 30},
		// BBB hanya punya satu bulan -> tidak ada pembanding
		{Symbol: "BBB", ReportDate: "2026-06-30", Investors: 500, Scripless: 25, TotalShares: 50},
	}

	rows := BuildSIDRows(totals, 6)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}

	var aaa, bbb SIDRow
	for _, r := range rows {
		if r.Symbol == "AAA" {
			aaa = r
		}
		if r.Symbol == "BBB" {
			bbb = r
		}
	}

	if aaa.ReportDate != "2026-06-30" {
		t.Errorf("AAA reportDate = %q, want bulan terbaru 2026-06-30", aaa.ReportDate)
	}
	if aaa.Investors != 1200 {
		t.Errorf("AAA investors = %d, want 1200", aaa.Investors)
	}
	// 1M = Juni vs Mei
	if !aaa.Has1M || aaa.Chg1M != 100 {
		t.Errorf("AAA chg1m = %d (has=%v), want 100", aaa.Chg1M, aaa.Has1M)
	}
	// 3M = Juni vs Maret
	if !aaa.Has3M || aaa.Chg3M != 300 {
		t.Errorf("AAA chg3m = %d (has=%v), want 300", aaa.Chg3M, aaa.Has3M)
	}
	if math.Abs(aaa.Pct1M-(100.0/1100*100)) > 1e-9 {
		t.Errorf("AAA pct1m = %v", aaa.Pct1M)
	}
	// scripless 80/100 = 80%, bulan lalu 60/100 = 60% -> +20 poin persentase
	if math.Abs(aaa.ScriplessPct-80) > 1e-9 {
		t.Errorf("AAA scriplessPct = %v, want 80", aaa.ScriplessPct)
	}
	if math.Abs(aaa.ScriplessChg1M-20) > 1e-9 {
		t.Errorf("AAA scriplessChg1m = %v, want +20 pp", aaa.ScriplessChg1M)
	}
	if math.Abs(aaa.ForeignChg1M-10) > 1e-9 {
		t.Errorf("AAA foreignChg1m = %v, want +10 pp", aaa.ForeignChg1M)
	}
	if len(aaa.Trend) != 4 {
		t.Errorf("AAA trend = %d titik, want 4", len(aaa.Trend))
	}
	// tren harus menaik menurut tanggal
	for i := 1; i < len(aaa.Trend); i++ {
		if aaa.Trend[i-1].ReportDate >= aaa.Trend[i].ReportDate {
			t.Fatalf("tren tidak terurut: %+v", aaa.Trend)
		}
	}

	if bbb.Has1M || bbb.Has3M {
		t.Errorf("BBB hanya punya satu bulan, has1m/has3m harus false: %+v", bbb)
	}
	if bbb.Chg1M != 0 {
		t.Errorf("BBB chg1m = %d, want 0", bbb.Chg1M)
	}
}

func TestBuildSIDRowsTrimsTrend(t *testing.T) {
	var totals []MonthTotal
	for i := 1; i <= 10; i++ {
		totals = append(totals, MonthTotal{
			Symbol: "AAA", ReportDate: "2026-" + pad2(i) + "-28",
			Investors: 100 * i, Scripless: 10, TotalShares: 100,
		})
	}
	rows := BuildSIDRows(totals, 6)
	if len(rows[0].Trend) != 6 {
		t.Errorf("trend = %d, want dipotong ke 6", len(rows[0].Trend))
	}
	if rows[0].Trend[len(rows[0].Trend)-1].ReportDate != "2026-10-28" {
		t.Errorf("trend harus menyisakan bulan TERBARU, dapat %q", rows[0].Trend[len(rows[0].Trend)-1].ReportDate)
	}
}

func TestBuildComposition(t *testing.T) {
	rows := []HoldingInput{
		// Mei
		{ReportDate: "2026-05-31", InvestorID: 1, Name: "PT ALPHA", Classification: "Corporate", Location: "Local", TotalShares: 600, Scripless: 300, Percentage: 60},
		{ReportDate: "2026-05-31", InvestorID: 2, Name: "FUND BETA", Classification: "Mutual Fund", Location: "Foreign", TotalShares: 300, Scripless: 300, Percentage: 30},
		{ReportDate: "2026-05-31", InvestorID: 3, Name: "KELUAR CO", Classification: "Corporate", Location: "Local", TotalShares: 100, Percentage: 10},
		// Juni: ALPHA nambah, BETA berkurang, KELUAR CO hilang, GAMMA baru
		{ReportDate: "2026-06-30", InvestorID: 1, Name: "PT ALPHA", Classification: "Corporate", Location: "Local", TotalShares: 700, Scripless: 350, Percentage: 70},
		{ReportDate: "2026-06-30", InvestorID: 2, Name: "FUND BETA", Classification: "Mutual Fund", Location: "Foreign", TotalShares: 200, Scripless: 200, Percentage: 20},
		{ReportDate: "2026-06-30", InvestorID: 4, Name: "GAMMA LLC", Classification: "Corporate", Location: "Foreign", TotalShares: 100, Scripless: 100, Percentage: 10},
	}

	c := BuildComposition("AAA", rows)

	if c.ReportDate != "2026-06-30" || c.PrevReportDate != "2026-05-31" {
		t.Fatalf("bulan = %q / prev %q", c.ReportDate, c.PrevReportDate)
	}
	if c.Investors != 3 || c.TotalShares != 1000 {
		t.Errorf("investors=%d totalShares=%d, want 3/1000", c.Investors, c.TotalShares)
	}
	// scripless 350+200+100 = 650 dari 1000
	if math.Abs(c.ScriplessPct-65) > 1e-9 {
		t.Errorf("scriplessPct = %v, want 65", c.ScriplessPct)
	}
	// diurut kepemilikan terbesar
	if c.Holders[0].Name != "PT ALPHA" {
		t.Errorf("holder teratas = %q, want PT ALPHA", c.Holders[0].Name)
	}
	if c.Holders[0].ChgShares != 100 || !c.Holders[0].HasPrev {
		t.Errorf("ALPHA chg = %d (hasPrev=%v), want +100", c.Holders[0].ChgShares, c.Holders[0].HasPrev)
	}
	var gamma InvestorHolding
	for _, h := range c.Holders {
		if h.Name == "GAMMA LLC" {
			gamma = h
		}
	}
	if !gamma.IsNew {
		t.Error("GAMMA LLC seharusnya ditandai baru")
	}
	if len(c.GoneHolders) != 1 || c.GoneHolders[0].Name != "KELUAR CO" {
		t.Fatalf("goneHolders = %+v, want KELUAR CO", c.GoneHolders)
	}
	if c.GoneHolders[0].ChgShares != -100 {
		t.Errorf("KELUAR CO chg = %d, want -100", c.GoneHolders[0].ChgShares)
	}

	// lokasi: Local 700 (70%), Foreign 300 (30%)
	var local *ClassificationSlice
	for i := range c.ByLocation {
		if c.ByLocation[i].Label == "Local" {
			local = &c.ByLocation[i]
		}
	}
	if local == nil || math.Abs(local.SharePct-70) > 1e-9 {
		t.Errorf("porsi Local = %+v, want 70%%", local)
	}
	if len(c.Trend) != 2 {
		t.Errorf("trend = %d bulan, want 2", len(c.Trend))
	}
}

func TestBuildCompositionEmpty(t *testing.T) {
	c := BuildComposition("KOSONG", nil)
	if c.Holders == nil || c.ByLocation == nil || c.ByClassification == nil ||
		c.Trend == nil || c.Months == nil || c.GoneHolders == nil {
		t.Errorf("slice nil pada input kosong: %+v", c)
	}
	if c.Investors != 0 {
		t.Errorf("investors = %d, want 0", c.Investors)
	}
}

func TestBuildDivergenceSignals(t *testing.T) {
	rows := []SIDRow{
		{Symbol: "DIST", ReportDate: "2026-06-30", Pct1M: 12, Has1M: true, Investors: 1000},
		{Symbol: "AKUM", ReportDate: "2026-06-30", Pct1M: -8, Has1M: true, Investors: 500},
		{Symbol: "LUAS", ReportDate: "2026-06-30", Pct1M: 6, Has1M: true, Investors: 700},
		{Symbol: "KAPIT", ReportDate: "2026-06-30", Pct1M: -5, Has1M: true, Investors: 300},
		{Symbol: "DATAR", ReportDate: "2026-06-30", Pct1M: 0.2, Has1M: true, Investors: 200},
		{Symbol: "NOPRICE", ReportDate: "2026-06-30", Pct1M: 20, Has1M: true, Investors: 100},
		// tanpa pembanding bulan -> harus tersaring keluar
		{Symbol: "SKIP", ReportDate: "2026-06-30", Has1M: false},
	}
	prices := map[string]float64{
		"DIST": -9, "AKUM": 11, "LUAS": 7, "KAPIT": -6, "DATAR": 0.3,
	}

	out := BuildDivergence(rows, prices)

	want := map[string]string{
		"DIST":    "DISTRIBUSI KE RITEL",
		"AKUM":    "AKUMULASI",
		"LUAS":    "PARTISIPASI LUAS",
		"KAPIT":   "KAPITULASI",
		"DATAR":   "NETRAL",
		"NOPRICE": "TIDAK DIKETAHUI",
	}
	got := map[string]string{}
	for _, d := range out {
		got[d.Symbol] = d.Signal
		if d.Symbol == "SKIP" {
			t.Error("baris tanpa pembanding bulan seharusnya tersaring")
		}
	}
	for sym, sig := range want {
		if got[sym] != sig {
			t.Errorf("%s: signal = %q, want %q", sym, got[sym], sig)
		}
	}

	for _, d := range out {
		if d.Symbol == "NOPRICE" && d.HasPrice {
			t.Error("NOPRICE seharusnya hasPrice=false")
		}
		if d.Symbol == "DIST" && math.Abs(d.Gap-21) > 1e-9 {
			t.Errorf("DIST gap = %v, want 21", d.Gap)
		}
	}

	// diurut dari |gap| terbesar
	for i := 1; i < len(out); i++ {
		if math.Abs(out[i-1].Gap) < math.Abs(out[i].Gap) {
			t.Fatalf("hasil tidak terurut dari gap terbesar: %+v", out)
		}
	}
}
