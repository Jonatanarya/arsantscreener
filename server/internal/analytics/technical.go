// Indikator teknikal klasik (MA/EMA/RSI/Stochastic/ATR), Pivot Point,
// pola candlestick, dan volume surge — dihitung dari bars_daily saja.
// Tidak ada sumber eksternal di sini: panel Teknikal harus tetap hidup
// walau bridge sedang mati, selama bar harian sudah ter-backfill.
package analytics

import "math"

type Pivot struct {
	R2 float64 `json:"r2"`
	R1 float64 `json:"r1"`
	P  float64 `json:"p"`
	S1 float64 `json:"s1"`
	S2 float64 `json:"s2"`
}

type CandlePattern struct {
	Name string `json:"name"`
	Bias string `json:"bias"` // bullish | bearish | netral
	Note string `json:"note"`
}

type VolumeSurge struct {
	Volume   int64   `json:"volume"`
	Avg20    float64 `json:"avg20"`
	Ratio    float64 `json:"ratio"`
	SurgePct float64 `json:"surgePct"`
	Label    string  `json:"label"`
	Bias     string  `json:"bias"` // bullish | bearish | netral
}

type HorizonReturn struct {
	Label     string  `json:"label"`
	ChangePct float64 `json:"changePct"`
	OK        bool    `json:"ok"`
}

type TechnicalAnalysis struct {
	LastDate  string  `json:"lastDate"`
	Open      float64 `json:"open"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Close     float64 `json:"close"`
	Change    float64 `json:"change"`
	ChangePct float64 `json:"changePct"`

	MA9        float64 `json:"ma9"`
	EMA20      float64 `json:"ema20"`
	EMA200     float64 `json:"ema200"`
	TrendMA    string  `json:"trendMa"`    // Bullish | Neutral | Bearish
	TrendMajor string  `json:"trendMajor"` // vs EMA200

	RSI14    float64 `json:"rsi14"`
	RSILabel string  `json:"rsiLabel"`

	StochK     float64 `json:"stochK"`
	StochD     float64 `json:"stochD"`
	StochLabel string  `json:"stochLabel"`

	ATR14    float64 `json:"atr14"`
	ATRPct   float64 `json:"atrPct"`
	Pivot    Pivot   `json:"pivot"`
	Target   float64 `json:"target"`   // R1
	StopLoss float64 `json:"stopLoss"` // S1
	// RiskReward = (Target-Close) / (Close-StopLoss); 0 bila salah satu sisi ≤ 0.
	RiskReward  float64 `json:"riskReward"`
	DistToR1Pct float64 `json:"distToR1Pct"`
	DistToS1Pct float64 `json:"distToS1Pct"`

	Candle   CandlePattern   `json:"candle"`
	VolSurge VolumeSurge     `json:"volumeSurge"`
	Returns  []HorizonReturn `json:"returns"`

	Week52High float64 `json:"week52High"`
	Week52Low  float64 `json:"week52Low"`
	Week52Pos  float64 `json:"week52Pos"` // 0..100, posisi harga dalam rentang 52 minggu

	// Verdict/Score merangkum sisi teknikal saja (belum digabung aliran
	// broker) — penggabungan itu tugas BuildConfluence.
	Verdict string `json:"verdict"`
	Score   int    `json:"score"` // 0..100, 50 = netral
}

// smaTail is the simple mean of the last n values — the scalar
// counterpart to pva.go's rolling sma (which returns a full nil-padded
// series). Indikator di file ini hanya butuh nilai terakhir.
func smaTail(vals []float64, n int) float64 {
	if n <= 0 || len(vals) < n {
		return 0
	}
	var sum float64
	for _, v := range vals[len(vals)-n:] {
		sum += v
	}
	return sum / float64(n)
}

// ema pakai seed SMA pada n bar pertama, sama seperti konvensi TradingView.
func ema(vals []float64, n int) float64 {
	if n <= 0 || len(vals) < n {
		return 0
	}
	k := 2.0 / float64(n+1)
	e := smaTail(vals[:n], n)
	for _, v := range vals[n:] {
		e = v*k + e*(1-k)
	}
	return e
}

// rsiWilder memakai smoothing Wilder (bukan SMA sederhana) agar angkanya
// sama dengan RSI(14) di TradingView/Stockbit.
func rsiWilder(closes []float64, n int) float64 {
	if len(closes) < n+1 {
		return 0
	}
	var gain, loss float64
	for i := 1; i <= n; i++ {
		d := closes[i] - closes[i-1]
		if d > 0 {
			gain += d
		} else {
			loss -= d
		}
	}
	avgGain, avgLoss := gain/float64(n), loss/float64(n)
	for i := n + 1; i < len(closes); i++ {
		d := closes[i] - closes[i-1]
		g, l := 0.0, 0.0
		if d > 0 {
			g = d
		} else {
			l = -d
		}
		avgGain = (avgGain*float64(n-1) + g) / float64(n)
		avgLoss = (avgLoss*float64(n-1) + l) / float64(n)
	}
	if avgLoss == 0 {
		if avgGain == 0 {
			return 50
		}
		return 100
	}
	rs := avgGain / avgLoss
	return 100 - 100/(1+rs)
}

// stochastic slow (14,3,3): %K = SMA3 dari raw %K, %D = SMA3 dari %K.
func stochastic(bars []Bar, period, smoothK, smoothD int) (k, d float64) {
	if len(bars) < period+smoothK+smoothD {
		return 0, 0
	}
	raw := make([]float64, 0, len(bars)-period+1)
	for i := period - 1; i < len(bars); i++ {
		hh, ll := bars[i].High, bars[i].Low
		for j := i - period + 1; j <= i; j++ {
			hh = math.Max(hh, bars[j].High)
			ll = math.Min(ll, bars[j].Low)
		}
		if hh == ll {
			raw = append(raw, 50)
			continue
		}
		raw = append(raw, (bars[i].Close-ll)/(hh-ll)*100)
	}
	ks := make([]float64, 0, len(raw))
	for i := smoothK - 1; i < len(raw); i++ {
		ks = append(ks, smaTail(raw[:i+1], smoothK))
	}
	if len(ks) == 0 {
		return 0, 0
	}
	k = ks[len(ks)-1]
	d = smaTail(ks, smoothD)
	if d == 0 && len(ks) > 0 {
		d = k
	}
	return k, d
}

func detectCandle(bars []Bar) CandlePattern {
	if len(bars) == 0 {
		return CandlePattern{Name: "—", Bias: "netral"}
	}
	b := bars[len(bars)-1]
	rng := b.High - b.Low
	if rng <= 0 {
		return CandlePattern{Name: "Flat", Bias: "netral", Note: "Tidak ada rentang harga pada bar terakhir."}
	}
	body := math.Abs(b.Close - b.Open)
	upper := b.High - math.Max(b.Open, b.Close)
	lower := math.Min(b.Open, b.Close) - b.Low
	bullish := b.Close >= b.Open

	// Engulfing diperiksa lebih dulu: polanya butuh dua bar dan lebih
	// bermakna daripada bentuk bar tunggal.
	if len(bars) >= 2 {
		p := bars[len(bars)-2]
		pBody := math.Abs(p.Close - p.Open)
		if body > pBody && pBody > 0 {
			if bullish && p.Close < p.Open && b.Close >= p.Open && b.Open <= p.Close {
				return CandlePattern{Name: "Bullish Engulfing", Bias: "bullish", Note: "Bodi hijau menelan bodi merah sebelumnya — tekanan beli mengambil alih."}
			}
			if !bullish && p.Close > p.Open && b.Close <= p.Open && b.Open >= p.Close {
				return CandlePattern{Name: "Bearish Engulfing", Bias: "bearish", Note: "Bodi merah menelan bodi hijau sebelumnya — tekanan jual mengambil alih."}
			}
		}
	}

	// Urutan penting: Hammer/Shooting Star diperiksa SEBELUM Doji. Bodi
	// keduanya memang kecil, jadi cek "body <= 10% rentang" lebih dulu akan
	// menelan keduanya dan menyebut semuanya Doji — padahal ekor sepihak
	// yang panjang justru informasi utamanya.
	switch {
	case body >= rng*0.9 && bullish:
		return CandlePattern{Name: "Marubozu Hijau", Bias: "bullish", Note: "Bodi penuh tanpa ekor — pembeli menguasai sesi dari awal sampai akhir."}
	case body >= rng*0.9 && !bullish:
		return CandlePattern{Name: "Marubozu Merah", Bias: "bearish", Note: "Bodi penuh tanpa ekor — penjual menguasai sesi dari awal sampai akhir."}
	case lower >= rng*0.6 && upper <= rng*0.15:
		return CandlePattern{Name: "Hammer", Bias: "bullish", Note: "Ekor bawah panjang — jualan diserap, potensi pembalikan naik."}
	case upper >= rng*0.6 && lower <= rng*0.15:
		return CandlePattern{Name: "Shooting Star", Bias: "bearish", Note: "Ekor atas panjang — kenaikan ditolak, potensi pembalikan turun."}
	case body <= rng*0.1:
		return CandlePattern{Name: "Doji", Bias: "netral", Note: "Buka dan tutup hampir sama — pasar ragu, tunggu konfirmasi arah."}
	case bullish:
		return CandlePattern{Name: "Candle Hijau", Bias: "bullish", Note: "Akumulasi harga menguat."}
	default:
		return CandlePattern{Name: "Candle Merah", Bias: "bearish", Note: "Distribusi harga melemah."}
	}
}

func detectVolumeSurge(bars []Bar) VolumeSurge {
	if len(bars) == 0 {
		return VolumeSurge{Label: "—", Bias: "netral"}
	}
	last := bars[len(bars)-1]
	// rata-rata 20 hari dihitung TANPA bar terakhir supaya lonjakan hari
	// ini tidak mengencerkan pembandingnya sendiri.
	hist := bars[:len(bars)-1]
	if len(hist) > 20 {
		hist = hist[len(hist)-20:]
	}
	if len(hist) == 0 {
		return VolumeSurge{Volume: last.Volume, Label: "Data belum cukup", Bias: "netral"}
	}
	var sum float64
	for _, b := range hist {
		sum += float64(b.Volume)
	}
	avg := sum / float64(len(hist))
	vs := VolumeSurge{Volume: last.Volume, Avg20: avg}
	if avg <= 0 {
		vs.Label = "Data belum cukup"
		vs.Bias = "netral"
		return vs
	}
	vs.Ratio = float64(last.Volume) / avg
	vs.SurgePct = (vs.Ratio - 1) * 100
	bullishBar := last.Close >= last.Open
	switch {
	case vs.Ratio >= 3:
		vs.Label = "High Institutional Volume"
		if bullishBar {
			vs.Bias = "bullish"
		} else {
			vs.Bias = "bearish"
		}
	case vs.Ratio >= 1.5:
		vs.Label = "Volume Meningkat"
		if bullishBar {
			vs.Bias = "bullish"
		} else {
			vs.Bias = "bearish"
		}
	case vs.Ratio >= 0.7:
		vs.Label = "Volume Normal"
		vs.Bias = "netral"
	default:
		vs.Label = "Volume Kering"
		vs.Bias = "netral"
	}
	return vs
}

func horizonReturn(bars []Bar, label string, lookback int) HorizonReturn {
	if len(bars) < lookback+1 {
		return HorizonReturn{Label: label}
	}
	prev := bars[len(bars)-1-lookback].Close
	if prev <= 0 {
		return HorizonReturn{Label: label}
	}
	last := bars[len(bars)-1].Close
	return HorizonReturn{Label: label, ChangePct: (last - prev) / prev * 100, OK: true}
}

// AnalyzeTechnical menghitung seluruh blok teknikal dari deret bar harian
// terurut naik. Bar minimum 2; makin panjang deretnya makin banyak
// indikator yang terisi (EMA200 butuh 200 bar, Stochastic butuh ~20).
func AnalyzeTechnical(bars []Bar) TechnicalAnalysis {
	var t TechnicalAnalysis
	if len(bars) == 0 {
		return t
	}
	last := bars[len(bars)-1]
	t.LastDate, t.Open, t.High, t.Low, t.Close = last.Date, last.Open, last.High, last.Low, last.Close
	if len(bars) >= 2 {
		prev := bars[len(bars)-2].Close
		t.Change = last.Close - prev
		if prev > 0 {
			t.ChangePct = t.Change / prev * 100
		}
	}

	closes := make([]float64, len(bars))
	for i, b := range bars {
		closes[i] = b.Close
	}

	t.MA9 = smaTail(closes, 9)
	t.EMA20 = ema(closes, 20)
	t.EMA200 = ema(closes, 200)

	switch {
	case t.EMA20 > 0 && t.MA9 > 0 && last.Close > t.EMA20 && t.MA9 > t.EMA20:
		t.TrendMA = "Bullish"
	case t.EMA20 > 0 && t.MA9 > 0 && last.Close < t.EMA20 && t.MA9 < t.EMA20:
		t.TrendMA = "Bearish"
	default:
		t.TrendMA = "Neutral"
	}
	switch {
	case t.EMA200 == 0:
		t.TrendMajor = "Neutral"
	case last.Close > t.EMA200*1.02:
		t.TrendMajor = "Bullish"
	case last.Close < t.EMA200*0.98:
		t.TrendMajor = "Bearish"
	default:
		t.TrendMajor = "Neutral"
	}

	t.RSI14 = rsiWilder(closes, 14)
	switch {
	case t.RSI14 == 0:
		t.RSILabel = "—"
	case t.RSI14 >= 70:
		t.RSILabel = "Overbought"
	case t.RSI14 <= 30:
		t.RSILabel = "Oversold"
	default:
		t.RSILabel = "Netral"
	}

	t.StochK, t.StochD = stochastic(bars, 14, 3, 3)
	switch {
	case t.StochK == 0 && t.StochD == 0:
		t.StochLabel = "—"
	case t.StochK >= 80:
		t.StochLabel = "Bearish"
	case t.StochK <= 20:
		t.StochLabel = "Bullish"
	case t.StochK > t.StochD:
		t.StochLabel = "Bullish"
	default:
		t.StochLabel = "Bearish"
	}

	t.ATR14 = ATR14(bars)
	if last.Close > 0 {
		t.ATRPct = t.ATR14 / last.Close * 100
	}

	// Classic pivot dari bar terakhir — level intraday untuk sesi berikutnya.
	p := (last.High + last.Low + last.Close) / 3
	t.Pivot = Pivot{
		P:  p,
		R1: 2*p - last.Low,
		S1: 2*p - last.High,
		R2: p + (last.High - last.Low),
		S2: p - (last.High - last.Low),
	}
	t.Target, t.StopLoss = t.Pivot.R1, t.Pivot.S1
	upside, downside := t.Target-last.Close, last.Close-t.StopLoss
	if upside > 0 && downside > 0 {
		t.RiskReward = upside / downside
	}
	if last.Close > 0 {
		t.DistToR1Pct = (t.Target - last.Close) / last.Close * 100
		t.DistToS1Pct = (t.StopLoss - last.Close) / last.Close * 100
	}

	t.Candle = detectCandle(bars)
	t.VolSurge = detectVolumeSurge(bars)
	t.Returns = []HorizonReturn{
		horizonReturn(bars, "1D", 1),
		horizonReturn(bars, "1W", 5),
		horizonReturn(bars, "1M", 21),
		horizonReturn(bars, "3M", 63),
	}

	w52 := bars
	if len(w52) > 252 {
		w52 = w52[len(w52)-252:]
	}
	t.Week52High, t.Week52Low = w52[0].High, w52[0].Low
	for _, b := range w52 {
		t.Week52High = math.Max(t.Week52High, b.High)
		t.Week52Low = math.Min(t.Week52Low, b.Low)
	}
	if t.Week52High > t.Week52Low {
		t.Week52Pos = (last.Close - t.Week52Low) / (t.Week52High - t.Week52Low) * 100
	}

	t.Score, t.Verdict = scoreTechnical(t)
	return t
}

// scoreTechnical memetakan indikator ke skala 0..100 (50 = netral). Bobot
// sengaja rata: tidak ada satu indikator yang boleh mendikte verdict, dan
// verdict ini tetap hanya separuh cerita — separuh lain aliran broker.
func scoreTechnical(t TechnicalAnalysis) (int, string) {
	score := 50

	switch t.TrendMA {
	case "Bullish":
		score += 12
	case "Bearish":
		score -= 12
	}
	switch t.TrendMajor {
	case "Bullish":
		score += 8
	case "Bearish":
		score -= 8
	}

	switch {
	case t.RSI14 == 0: // indikator belum terisi
	case t.RSI14 >= 70:
		score -= 10
	case t.RSI14 >= 55:
		score += 8
	case t.RSI14 <= 30:
		score += 6 // oversold = peluang, bukan larangan
	case t.RSI14 <= 45:
		score -= 6
	}

	switch t.StochLabel {
	case "Bullish":
		score += 6
	case "Bearish":
		score -= 6
	}

	switch t.Candle.Bias {
	case "bullish":
		score += 6
	case "bearish":
		score -= 6
	}
	switch t.VolSurge.Bias {
	case "bullish":
		score += 8
	case "bearish":
		score -= 8
	}

	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	switch {
	case score >= 70:
		return score, "Bullish / Buy"
	case score >= 56:
		return score, "Akumulasi"
	case score <= 30:
		return score, "Bearish / Sell"
	case score <= 44:
		return score, "Overbought / Sell"
	default:
		return score, "Netral / Wait & See"
	}
}

// ---- konfluensi teknikal + aliran broker ----

type Confluence struct {
	Score        int    `json:"score"` // 0..100
	Label        string `json:"label"`
	Analysis     string `json:"analysis"`
	BrokerFlow   string `json:"brokerFlow"`
	TechMomentum string `json:"techMomentum"`
}

// BuildConfluence menggabungkan skor teknikal dengan porsi net smart money
// (smartSharePct dari /broker-analysis, satuan persen dari total nilai
// transaksi). Keduanya diberi bobot sama: sinyal baru disebut kuat kalau
// grafik dan bandar sepakat — persis alasan panel ini ada.
func BuildConfluence(tech TechnicalAnalysis, smartSharePct float64, hasBroker bool) Confluence {
	var c Confluence
	c.TechMomentum = tech.Verdict

	brokerScore := 50
	if hasBroker {
		// ±10% porsi smart money sudah ekstrem di data harian IDX, jadi
		// itulah yang dipetakan ke ujung skala.
		s := smartSharePct * 5
		if s > 50 {
			s = 50
		}
		if s < -50 {
			s = -50
		}
		brokerScore = 50 + int(math.Round(s))
		switch {
		case brokerScore >= 65:
			c.BrokerFlow = "Akumulasi"
		case brokerScore <= 35:
			c.BrokerFlow = "Distribusi"
		default:
			c.BrokerFlow = "Netral"
		}
	} else {
		c.BrokerFlow = "Data broker belum ada"
	}

	if hasBroker {
		c.Score = (tech.Score + brokerScore) / 2
	} else {
		c.Score = tech.Score
	}

	switch {
	case c.Score >= 70:
		c.Label = "BULLISH / AKUMULASI"
		c.Analysis = "Sinyal teknikal dan aliran broker searah menguat. Momentum mendukung entry, kelola risiko di level Support 1."
	case c.Score >= 56:
		c.Label = "CONDONG BULLISH"
		c.Analysis = "Bias positif namun belum penuh. Tunggu penembusan level Pivot/Resistance 1 dengan volume di atas rata-rata."
	case c.Score <= 30:
		c.Label = "BEARISH / DISTRIBUSI"
		c.Analysis = "Teknikal melemah dan aliran broker keluar. Hindari entry baru sampai ada penyerapan jual yang jelas."
	case c.Score <= 44:
		c.Label = "CONDONG BEARISH"
		c.Analysis = "Tekanan jual lebih dominan. Kalau sudah punya posisi, ketatkan stop di sekitar Support 1."
	default:
		c.Label = "NETRAL / WAIT & SEE"
		c.Analysis = "Sinyal teknikal dan broker flow masih seimbang. Tunggu breakout level Pivot atau konfirmasi akumulasi lebih lanjut."
	}
	return c
}
