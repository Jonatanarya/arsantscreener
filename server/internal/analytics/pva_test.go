package analytics

import "testing"

func flatBars(n int, price float64, volume int64) []Bar {
	dates := dateSeq(n)
	bars := make([]Bar, n)
	for i, d := range dates {
		bars[i] = Bar{Date: d, Open: price, High: price + 5, Low: price - 5, Close: price, Volume: volume}
	}
	return bars
}

func TestAnalyzePVA_InsufficientData(t *testing.T) {
	res := AnalyzePVA(flatBars(1, 1000, 1_000_000))
	if res.Error == "" {
		t.Fatalf("expected error for < 2 bars")
	}
}

func TestAnalyzePVA_DemandKuat(t *testing.T) {
	bars := flatBars(25, 1000, 1_000_000)
	// hari terakhir: naik tajam dengan volume & range jauh di atas rata-rata
	last := len(bars) - 1
	bars[last-1].Close = 1000
	bars[last].Open = 1000
	bars[last].Close = 1050
	bars[last].High = 1060
	bars[last].Low = 995
	bars[last].Volume = 5_000_000 // >> SMA20 (~1,000,000)

	res := AnalyzePVA(bars)
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if len(res.Rows) == 0 {
		t.Fatalf("expected rows")
	}
	got := res.Rows[len(res.Rows)-1]
	if got.Class != "DEMAND KUAT" {
		t.Errorf("expected DEMAND KUAT, got %q (vRel=%.2f)", got.Class, got.VolRel)
	}
	if got.Score != 2 {
		t.Errorf("expected score 2, got %d", got.Score)
	}
}

func TestAnalyzePVA_NoDemand(t *testing.T) {
	bars := flatBars(25, 1000, 1_000_000)
	last := len(bars) - 1
	bars[last-1].Close = 1000
	bars[last].Close = 1010 // naik tipis
	bars[last].High = 1015
	bars[last].Low = 1005
	bars[last].Volume = 200_000 // jauh di bawah SMA20 -> vRel < 0.7

	res := AnalyzePVA(bars)
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	got := res.Rows[len(res.Rows)-1]
	if got.Class != "NO DEMAND" {
		t.Errorf("expected NO DEMAND, got %q (vRel=%.2f)", got.Class, got.VolRel)
	}
}

func TestAnalyzePVA_BullishDivergence(t *testing.T) {
	n := 25
	dates := dateSeq(n)
	bars := make([]Bar, n)
	price := 1000.0
	for i, d := range dates {
		// harga turun perlahan, TAPI volume di hari-hari naik kecil lebih besar
		// dari volume di hari-hari turun -> OBV net naik sementara harga turun
		var close float64
		var vol int64
		if i%2 == 0 {
			close = price + 2
			vol = 3_000_000
		} else {
			close = price - 5
			vol = 500_000
		}
		price = close
		bars[i] = Bar{Date: d, Open: close, High: close + 3, Low: close - 3, Close: close, Volume: vol}
	}
	// pastikan harga bersih turun >2% dari 20 hari lalu ke hari terakhir
	i := n - 1
	back := 20
	bars[i].Close = bars[i-back].Close * 0.9

	res := AnalyzePVA(bars)
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if res.ObvSignal != "bull" {
		t.Errorf("expected bullish OBV divergence, got signal=%q text=%q", res.ObvSignal, res.ObvText)
	}
}

func TestAnalyzePVA_SellingClimax(t *testing.T) {
	bars := flatBars(45, 1000, 1_000_000)
	// hari ke-10 dari belakang (dalam window 40 hari): volume ekstrem besar
	// DAN low-nya menyentuh titik terendah window
	climaxIdx := len(bars) - 10
	bars[climaxIdx].Volume = 50_000_000
	bars[climaxIdx].Low = 800
	bars[climaxIdx].Close = 820
	bars[climaxIdx].High = 830

	res := AnalyzePVA(bars)
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if res.Climax == nil {
		t.Fatalf("expected climax to be detected")
	}
	if res.Climax.Type != "SELLING CLIMAX" {
		t.Errorf("expected SELLING CLIMAX, got %s", res.Climax.Type)
	}
	if res.Climax.Date != bars[climaxIdx].Date {
		t.Errorf("expected climax date %s, got %s", bars[climaxIdx].Date, res.Climax.Date)
	}
}
