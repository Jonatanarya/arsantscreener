package analytics

import "testing"

func flatVolBars(n int, volume int64, value float64, freq int) []VolBar {
	bars := make([]VolBar, n)
	for i := range bars {
		bars[i] = VolBar{Date: dateAt(i), Volume: volume, Value: value, Freq: freq}
	}
	return bars
}

func TestDetectLiquidityShiftNormal(t *testing.T) {
	bars := flatVolBars(40, 1_000_000, 5_000_000_000, 500)
	got := DetectLiquidityShift(bars)
	if got.Level != "normal" {
		t.Errorf("Level = %q, want normal", got.Level)
	}
}

func TestDetectLiquidityShiftTooFewBars(t *testing.T) {
	got := DetectLiquidityShift(flatVolBars(3, 1_000_000, 1, 1))
	if got.Level != "normal" {
		t.Errorf("Level = %q, want normal for insufficient history", got.Level)
	}
}

func TestDetectLiquidityShiftDailySurgeOnly(t *testing.T) {
	bars := flatVolBars(35, 1_000_000, 5_000_000_000, 500)
	// baseline historis panjang tetap flat, tapi hari terakhir melonjak —
	// tidak cukup lama untuk awakening (baseline 5-hari-terakhir hanya
	// menyentuh satu hari), harusnya cuma "surge".
	bars[len(bars)-1].Volume = 3_000_000
	got := DetectLiquidityShift(bars)
	if got.Level != "surge" {
		t.Errorf("Level = %q, want surge (ratio=%.2f)", got.Level, got.SurgeRatio)
	}
	if got.SurgeRatio < liquiditySurgeRatio {
		t.Errorf("SurgeRatio = %.2f, want >= %.1f", got.SurgeRatio, liquiditySurgeRatio)
	}
}

func TestDetectLiquidityShiftAwakeningBroadParticipation(t *testing.T) {
	// 60 hari sepi, lalu 5 hari terakhir jauh lebih ramai DAN freq ikut naik
	// proporsional -> partisipasi meluas, bukan satu block trade.
	bars := flatVolBars(60, 100_000, 200_000_000, 50)
	for i := len(bars) - liquidityRecentDays; i < len(bars); i++ {
		bars[i].Volume = 800_000
		bars[i].Value = 1_200_000_000
		bars[i].Freq = 400
	}
	got := DetectLiquidityShift(bars)
	// volume 5 hari terakhir juga jauh di atas rata-rata 20 hari (baseline-nya
	// masih flat), jadi kedua sinyal sah-sah saja kena sekaligus.
	if got.Level != "surge+awakening" {
		t.Errorf("Level = %q, want surge+awakening (baselineRatio=%.2f)", got.Level, got.BaselineRatio)
	}
	if got.FreqRatio < liquidityBroadFreqRatio {
		t.Errorf("FreqRatio = %.2f, want >= %.1f (broad participation)", got.FreqRatio, liquidityBroadFreqRatio)
	}
	found := false
	for _, r := range got.Reasons {
		if r != "" && got.FreqRatio >= liquidityBroadFreqRatio {
			found = true
		}
	}
	if !found || len(got.Reasons) == 0 {
		t.Errorf("expected reasons to be populated, got %v", got.Reasons)
	}
}

func TestDetectLiquidityShiftAwakeningSingleBlockTrade(t *testing.T) {
	// value meledak tapi freq TIDAK ikut naik -> indikasi satu block trade,
	// bukan borongan bertahap oleh banyak pihak.
	bars := flatVolBars(60, 100_000, 200_000_000, 50)
	for i := len(bars) - liquidityRecentDays; i < len(bars); i++ {
		bars[i].Volume = 800_000
		bars[i].Value = 1_200_000_000
		bars[i].Freq = 52 // nyaris tidak berubah dari baseline
	}
	got := DetectLiquidityShift(bars)
	if got.Level != "surge+awakening" {
		t.Errorf("Level = %q, want surge+awakening", got.Level)
	}
	if got.FreqRatio >= liquidityBroadFreqRatio {
		t.Errorf("FreqRatio = %.2f, want < %.1f (single block trade case)", got.FreqRatio, liquidityBroadFreqRatio)
	}
}

func TestDetectLiquidityShiftInsufficientBaselineSkipsAwakening(t *testing.T) {
	// histori kurang dari liquidityMinBaselineDays -> awakening tidak boleh
	// dinyatakan walau rasio mentahnya besar, baseline-nya belum bisa dipercaya.
	bars := flatVolBars(20, 100_000, 200_000_000, 50)
	for i := len(bars) - liquidityRecentDays; i < len(bars); i++ {
		bars[i].Volume = 900_000
		bars[i].Value = 2_000_000_000
		bars[i].Freq = 400
	}
	got := DetectLiquidityShift(bars)
	if got.BaselineRatio != 0 {
		t.Errorf("BaselineRatio = %.2f, want 0 (baseline too thin to trust)", got.BaselineRatio)
	}
}

func TestMedianEvenOdd(t *testing.T) {
	if got := median([]float64{1, 2, 3}); got != 2 {
		t.Errorf("median odd = %v, want 2", got)
	}
	if got := median([]float64{1, 2, 3, 4}); got != 2.5 {
		t.Errorf("median even = %v, want 2.5", got)
	}
	if got := median(nil); got != 0 {
		t.Errorf("median nil = %v, want 0", got)
	}
}
