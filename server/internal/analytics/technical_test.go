package analytics

import (
	"math"
	"testing"
)

func synthBars(n int, start, step float64) []Bar {
	bars := make([]Bar, n)
	price := start
	for i := 0; i < n; i++ {
		bars[i] = Bar{
			Date:   dateAt(i),
			Open:   price,
			High:   price + 2,
			Low:    price - 2,
			Close:  price + step,
			Volume: 1_000_000,
		}
		price += step
	}
	return bars
}

func dateAt(i int) string {
	// 2026-01-01 + i hari, cukup untuk urutan (bukan kalender bursa asli)
	d := 1 + i
	return "2026-01-" + pad2(d%28+1)
}

func pad2(v int) string {
	if v < 10 {
		return "0" + string(rune('0'+v))
	}
	return string(rune('0'+v/10)) + string(rune('0'+v%10))
}

func TestSmaTailAndEMA(t *testing.T) {
	vals := []float64{1, 2, 3, 4, 5}
	if got := smaTail(vals, 5); got != 3 {
		t.Errorf("smaTail = %v, want 3", got)
	}
	if got := smaTail(vals, 2); got != 4.5 {
		t.Errorf("smaTail(2) = %v, want 4.5", got)
	}
	// deret konstan: EMA harus sama dengan nilainya
	flat := []float64{7, 7, 7, 7, 7, 7, 7, 7}
	if got := ema(flat, 4); math.Abs(got-7) > 1e-9 {
		t.Errorf("ema(flat) = %v, want 7", got)
	}
	if got := ema(vals, 99); got != 0 {
		t.Errorf("ema with n > len should return 0, got %v", got)
	}
}

func TestRSIWilderExtremes(t *testing.T) {
	// naik terus -> RSI 100
	up := make([]float64, 30)
	for i := range up {
		up[i] = float64(100 + i)
	}
	if got := rsiWilder(up, 14); got != 100 {
		t.Errorf("RSI naik terus = %v, want 100", got)
	}
	// turun terus -> RSI 0
	down := make([]float64, 30)
	for i := range down {
		down[i] = float64(130 - i)
	}
	if got := rsiWilder(down, 14); got != 0 {
		t.Errorf("RSI turun terus = %v, want 0", got)
	}
	// data kurang dari periode -> 0 (bukan panik)
	if got := rsiWilder([]float64{1, 2, 3}, 14); got != 0 {
		t.Errorf("RSI data pendek = %v, want 0", got)
	}
}

func TestDetectCandlePatterns(t *testing.T) {
	tests := []struct {
		name string
		bars []Bar
		want string
		bias string
	}{
		{
			name: "doji",
			bars: []Bar{{Open: 100, High: 110, Low: 90, Close: 100.5}},
			want: "Doji", bias: "netral",
		},
		{
			name: "marubozu hijau",
			bars: []Bar{{Open: 100, High: 110, Low: 100, Close: 110}},
			want: "Marubozu Hijau", bias: "bullish",
		},
		{
			name: "hammer",
			bars: []Bar{{Open: 108, High: 110, Low: 90, Close: 109}},
			want: "Hammer", bias: "bullish",
		},
		{
			name: "shooting star",
			bars: []Bar{{Open: 91, High: 110, Low: 90, Close: 92}},
			want: "Shooting Star", bias: "bearish",
		},
		{
			name: "bullish engulfing",
			bars: []Bar{
				{Open: 105, High: 106, Low: 99, Close: 100},
				{Open: 99, High: 112, Low: 98, Close: 110},
			},
			want: "Bullish Engulfing", bias: "bullish",
		},
	}
	for _, tt := range tests {
		got := detectCandle(tt.bars)
		if got.Name != tt.want {
			t.Errorf("%s: pola = %q, want %q", tt.name, got.Name, tt.want)
		}
		if got.Bias != tt.bias {
			t.Errorf("%s: bias = %q, want %q", tt.name, got.Bias, tt.bias)
		}
	}
}

func TestDetectVolumeSurgeExcludesLastBar(t *testing.T) {
	bars := make([]Bar, 21)
	for i := range bars {
		bars[i] = Bar{Open: 100, High: 101, Low: 99, Close: 100, Volume: 1_000_000}
	}
	// bar terakhir 4x rata-rata, dan hijau
	bars[20] = Bar{Open: 100, High: 105, Low: 99, Close: 104, Volume: 4_000_000}

	vs := detectVolumeSurge(bars)
	if math.Abs(vs.Avg20-1_000_000) > 1 {
		t.Errorf("avg20 = %v, want 1jt (bar terakhir tidak boleh ikut dirata-rata)", vs.Avg20)
	}
	if math.Abs(vs.Ratio-4) > 1e-9 {
		t.Errorf("ratio = %v, want 4", vs.Ratio)
	}
	if math.Abs(vs.SurgePct-300) > 1e-9 {
		t.Errorf("surgePct = %v, want 300", vs.SurgePct)
	}
	if vs.Label != "High Institutional Volume" || vs.Bias != "bullish" {
		t.Errorf("label/bias = %q/%q", vs.Label, vs.Bias)
	}
}

func TestAnalyzeTechnicalPivotAndReturns(t *testing.T) {
	bars := synthBars(120, 1000, 5)
	tech := AnalyzeTechnical(bars)

	last := bars[len(bars)-1]
	wantP := (last.High + last.Low + last.Close) / 3
	if math.Abs(tech.Pivot.P-wantP) > 1e-9 {
		t.Errorf("pivot P = %v, want %v", tech.Pivot.P, wantP)
	}
	if !(tech.Pivot.S2 < tech.Pivot.S1 && tech.Pivot.S1 < tech.Pivot.P &&
		tech.Pivot.P < tech.Pivot.R1 && tech.Pivot.R1 < tech.Pivot.R2) {
		t.Errorf("level pivot tidak terurut: %+v", tech.Pivot)
	}
	if tech.Week52High < tech.Week52Low {
		t.Errorf("52W high %v < low %v", tech.Week52High, tech.Week52Low)
	}
	// tren naik konsisten -> skor teknikal di atas netral
	if tech.Score <= 50 {
		t.Errorf("tren naik seharusnya skor > 50, dapat %d (%s)", tech.Score, tech.Verdict)
	}
	for _, r := range tech.Returns {
		if r.OK && r.ChangePct <= 0 {
			t.Errorf("return %s = %v, seharusnya positif pada tren naik", r.Label, r.ChangePct)
		}
	}
}

func TestAnalyzeTechnicalShortSeriesDoesNotPanic(t *testing.T) {
	tech := AnalyzeTechnical(synthBars(3, 100, 1))
	if tech.EMA200 != 0 {
		t.Errorf("EMA200 seharusnya 0 pada deret pendek, dapat %v", tech.EMA200)
	}
	if tech.Score < 0 || tech.Score > 100 {
		t.Errorf("skor di luar 0..100: %d", tech.Score)
	}
}

func TestBuildConfluence(t *testing.T) {
	tech := TechnicalAnalysis{Score: 80, Verdict: "Bullish / Buy"}

	// tanpa data broker, skor konfluensi = skor teknikal apa adanya
	c := BuildConfluence(tech, 0, false)
	if c.Score != 80 {
		t.Errorf("tanpa broker: skor = %d, want 80", c.Score)
	}
	if c.BrokerFlow != "Data broker belum ada" {
		t.Errorf("brokerFlow = %q", c.BrokerFlow)
	}

	// smart money kuat -> label akumulasi, skor naik dari 50
	c = BuildConfluence(TechnicalAnalysis{Score: 50}, 8, true)
	if c.BrokerFlow != "Akumulasi" {
		t.Errorf("smart share 8%%: brokerFlow = %q, want Akumulasi", c.BrokerFlow)
	}
	if c.Score <= 50 {
		t.Errorf("smart share positif seharusnya menaikkan skor, dapat %d", c.Score)
	}

	// distribusi berat -> label distribusi
	c = BuildConfluence(TechnicalAnalysis{Score: 50}, -9, true)
	if c.BrokerFlow != "Distribusi" {
		t.Errorf("smart share -9%%: brokerFlow = %q, want Distribusi", c.BrokerFlow)
	}
	if c.Score >= 50 {
		t.Errorf("smart share negatif seharusnya menurunkan skor, dapat %d", c.Score)
	}
}
