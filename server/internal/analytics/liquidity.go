// Deteksi anomali volume/likuiditas lintas-simbol: dua sinyal murah yang
// dihitung dari bars_daily saja (tanpa running trade), dipakai sebagai
// gerbang sebelum crawl running trade/broker summary harian dijalankan ke
// simbol tertentu — bukan menariknya untuk seluruh universe.
//
//  1. Surge harian: volume hari ini vs rata-rata 20 hari SEBELUMNYA (baseline
//     sengaja tidak ikut memasukkan hari ini, supaya lonjakannya sendiri
//     tidak mengencerkan pembandingnya) — sinyal "mulai ada yang ngumpulin
//     hari ini", cermin dari detectVolumeSurge di technical.go.
//  2. Liquidity awakening: rata-rata 5 hari terakhir vs median baseline
//     historis (di luar 5 hari itu) — sinyal "saham yang tadinya sepi tiba-
//     tiba ramai berhari-hari", bukan cuma satu hari aneh.
//
// Freq (jumlah transaksi) dipakai buat membedakan partisipasi luas (banyak
// transaksi kecil, indikasi akumulasi bertahap) dari satu block trade
// tunggal yang mengerek volume tapi bukan borongan beneran.
package analytics

import (
	"fmt"
	"sort"
)

// VolBar adalah satu hari volume/value/freq, dilepas dari OHLC — detektor
// ini cuma peduli partisipasi transaksi, bukan pergerakan harga.
type VolBar struct {
	Date   string
	Volume int64
	Value  float64
	Freq   int
}

// LiquidityShift adalah hasil deteksi satu simbol pada satu titik waktu.
type LiquidityShift struct {
	Level         string   `json:"level"` // normal | surge | awakening | surge+awakening
	Score         int      `json:"score"`
	Reasons       []string `json:"reasons"`
	SurgeRatio    float64  `json:"surgeRatio"`    // volume hari ini vs avg20 (exclude hari ini)
	BaselineRatio float64  `json:"baselineRatio"` // rata-rata value 5 hari terakhir vs median baseline
	FreqRatio     float64  `json:"freqRatio"`     // rata-rata freq 5 hari terakhir vs median baseline
}

const (
	liquiditySurgeRatio      = 2.0 // hari ini vs rata-rata 20 hari
	liquidityAwakenRatio     = 3.0 // 5 hari terakhir vs median baseline historis
	liquidityBroadFreqRatio  = 1.3 // freq ikut naik -> partisipasi meluas, bukan block trade tunggal
	liquidityRecentDays      = 5
	liquidityMinBaselineDays = 30 // di bawah ini baseline terlalu tipis untuk dipercaya
)

// DetectLiquidityShift menerima bar terurut TANGGAL NAIK (paling lama duluan,
// sama seperti store.GetBars/analytics.Bar di tempat lain pada paket ini).
func DetectLiquidityShift(bars []VolBar) LiquidityShift {
	if len(bars) < liquidityRecentDays+1 {
		return LiquidityShift{Level: "normal"}
	}

	last := bars[len(bars)-1]
	hist := bars[:len(bars)-1]

	surgeWindow := hist
	if len(surgeWindow) > 20 {
		surgeWindow = surgeWindow[len(surgeWindow)-20:]
	}
	var volSum float64
	for _, b := range surgeWindow {
		volSum += float64(b.Volume)
	}
	var surgeRatio float64
	if avg20 := volSum / float64(len(surgeWindow)); avg20 > 0 {
		surgeRatio = float64(last.Volume) / avg20
	}

	recent := bars[len(bars)-liquidityRecentDays:]
	baseline := bars[:len(bars)-liquidityRecentDays]

	var baselineRatio, freqRatio float64
	if len(baseline) >= liquidityMinBaselineDays {
		if baseVal := medianValue(baseline); baseVal > 0 {
			baselineRatio = avgValue(recent) / baseVal
		}
		if baseFreq := medianFreq(baseline); baseFreq > 0 {
			freqRatio = avgFreq(recent) / baseFreq
		}
	}

	var reasons []string
	score := 0
	isSurge := surgeRatio >= liquiditySurgeRatio
	isAwaken := baselineRatio >= liquidityAwakenRatio

	if isSurge {
		score += 40
		reasons = append(reasons, fmt.Sprintf("Volume hari ini %.1fx rata-rata 20 hari", surgeRatio))
	}
	if isAwaken {
		score += 40
		reasons = append(reasons, fmt.Sprintf("Rata-rata transaksi %d hari terakhir %.1fx baseline historis", liquidityRecentDays, baselineRatio))
		if freqRatio >= liquidityBroadFreqRatio {
			score += 20
			reasons = append(reasons, fmt.Sprintf("Frekuensi transaksi ikut naik %.1fx — partisipasi meluas, bukan satu block trade", freqRatio))
		} else {
			reasons = append(reasons, "Lonjakan tidak diikuti kenaikan frekuensi transaksi — indikasi block trade tunggal")
		}
	}

	level := "normal"
	switch {
	case isSurge && isAwaken:
		level = "surge+awakening"
	case isAwaken:
		level = "awakening"
	case isSurge:
		level = "surge"
	}

	return LiquidityShift{
		Level: level, Score: score, Reasons: reasons,
		SurgeRatio: surgeRatio, BaselineRatio: baselineRatio, FreqRatio: freqRatio,
	}
}

func avgValue(bars []VolBar) float64 {
	if len(bars) == 0 {
		return 0
	}
	var sum float64
	for _, b := range bars {
		sum += b.Value
	}
	return sum / float64(len(bars))
}

func avgFreq(bars []VolBar) float64 {
	if len(bars) == 0 {
		return 0
	}
	var sum float64
	for _, b := range bars {
		sum += float64(b.Freq)
	}
	return sum / float64(len(bars))
}

func medianValue(bars []VolBar) float64 {
	vals := make([]float64, len(bars))
	for i, b := range bars {
		vals[i] = b.Value
	}
	return median(vals)
}

func medianFreq(bars []VolBar) float64 {
	vals := make([]float64, len(bars))
	for i, b := range bars {
		vals[i] = float64(b.Freq)
	}
	return median(vals)
}

func median(vals []float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	sorted := append([]float64(nil), vals...)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return sorted[mid]
	}
	return (sorted[mid-1] + sorted[mid]) / 2
}
