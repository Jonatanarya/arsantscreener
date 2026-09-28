package analytics

import (
	"fmt"
	"math"
)

// ---- tekanan running trade ----

type TradePrint struct {
	Ts        int64
	Price     float64
	Lot       int64
	Direction string // buy | sell | unknown
}

type TradePressure struct {
	BuyLot     int64
	SellLot    int64
	UnknownLot int64
	BuyVal     float64
	SellVal    float64
	VWAP       float64
	NPrints    int
	BigPrints  int   // print dengan lot >= ambang p90
	BigLotMin  int64 // ambang lot yang dipakai
}

// AnalyzeTradePressure summarizes one day's derived prints. Direction is a
// best-effort uptick/downtick guess made by the extension — treat the
// buy/sell split as pressure indication, not exchange-accurate HAKA/HAKI.
func AnalyzeTradePressure(prints []TradePrint) TradePressure {
	var p TradePressure
	p.NPrints = len(prints)
	if len(prints) == 0 {
		return p
	}
	var valSum, lotSum float64
	lots := make([]int64, 0, len(prints))
	for _, t := range prints {
		val := t.Price * float64(t.Lot) * 100 // 1 lot = 100 lembar
		valSum += val
		lotSum += float64(t.Lot)
		lots = append(lots, t.Lot)
		switch t.Direction {
		case "buy":
			p.BuyLot += t.Lot
			p.BuyVal += val
		case "sell":
			p.SellLot += t.Lot
			p.SellVal += val
		default:
			p.UnknownLot += t.Lot
		}
	}
	if lotSum > 0 {
		p.VWAP = valSum / (lotSum * 100)
	}
	// ambang big print: persentil-90 lot (minimal 100 lot agar tidak berisik
	// di saham sepi)
	sorted := append([]int64(nil), lots...)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	p.BigLotMin = sorted[int(float64(len(sorted))*0.9)]
	if p.BigLotMin < 100 {
		p.BigLotMin = 100
	}
	for _, l := range lots {
		if l >= p.BigLotMin {
			p.BigPrints++
		}
	}
	return p
}

// ---- keputusan trading ----

type DecisionSignal struct {
	Source string
	Text   string
	Points int
}

type TradePlan struct {
	Entry      float64
	StopLoss   float64
	TakeProfit float64
	ATR        float64
	RiskReward float64
}

type DecisionInput struct {
	Outlook          Outlook
	Bars             []Bar
	SmartNetValue    float64 // net buy broker smart se-rentang (dari broker summary)
	TotalRangeValue  float64 // total nilai transaksi se-rentang
	HasBrokerData    bool
	Pressure         *TradePressure // tekanan running trade hari terakhir (nil bila tak ada)
	BullishCatalysts int
	BearishCatalysts int
	PERatio          *float64
	PriceToBook      *float64
}

type Decision struct {
	Verdict string // BELI | PANTAU | HINDARI
	Score   int
	Signals []DecisionSignal
	Plan    *TradePlan // nil bila verdict HINDARI atau data bar kurang
	Quality DecisionQuality
}

type DecisionQuality struct {
	Eligible        bool
	Reasons         []string
	AverageTurnover float64
	ActiveSessions  int
	HistoryDays     int
	Confidence      string
	DataSources     int
}

func assessDecisionQuality(in DecisionInput, plan *TradePlan) DecisionQuality {
	q := DecisionQuality{Eligible: true, HistoryDays: len(in.Bars), Confidence: "TERBATAS"}
	if len(in.Bars) > 0 {
		q.DataSources++
	}
	if in.HasBrokerData {
		q.DataSources++
	}
	if in.Pressure != nil && in.Pressure.NPrints >= 20 {
		q.DataSources++
	}
	if in.PERatio != nil || in.PriceToBook != nil {
		q.DataSources++
	}
	if in.BullishCatalysts+in.BearishCatalysts > 0 {
		q.DataSources++
	}
	fail := func(reason string) { q.Eligible = false; q.Reasons = append(q.Reasons, reason) }
	if len(in.Bars) < 30 {
		fail("Histori harga belum mencapai 30 sesi")
	}
	if len(in.Bars) == 0 {
		fail("Harga terakhir belum tersedia")
		return q
	}
	last := in.Bars[len(in.Bars)-1]
	if last.Close < 50 {
		fail("Harga berada di bawah batas perdagangan reguler")
	}
	start := len(in.Bars) - 20
	if start < 0 {
		start = 0
	}
	var turnover float64
	for i := start; i < len(in.Bars); i++ {
		turnover += in.Bars[i].Close * float64(in.Bars[i].Volume)
		if i > start && in.Bars[i].Close != in.Bars[i-1].Close && in.Bars[i].Volume > 0 {
			q.ActiveSessions++
		}
	}
	window := len(in.Bars) - start
	if window > 0 {
		q.AverageTurnover = turnover / float64(window)
	}
	if q.AverageTurnover < 1_000_000_000 {
		fail("Rata-rata nilai transaksi 20 sesi di bawah Rp1 miliar")
	}
	if q.ActiveSessions < 3 {
		fail("Harga terlalu jarang bergerak dalam 20 sesi terakhir")
	}
	if !in.HasBrokerData {
		fail("Data aliran broker belum memadai")
	}
	if plan == nil || plan.Entry <= 0 || plan.StopLoss <= 0 || plan.StopLoss >= plan.Entry || plan.TakeProfit <= plan.Entry || plan.ATR <= 0 {
		fail("Rencana risiko berbasis ATR belum valid")
	}
	if q.Eligible {
		q.Confidence = "SEDANG"
		if q.DataSources >= 4 && q.ActiveSessions >= 10 && q.AverageTurnover >= 10_000_000_000 {
			q.Confidence = "TINGGI"
		}
	}
	return q
}

// ATR14 computes the average true range over the last n bars (simple mean).
func ATR14(bars []Bar) float64 {
	const n = 14
	if len(bars) < 2 {
		return 0
	}
	start := len(bars) - n
	if start < 1 {
		start = 1
	}
	var sum float64
	var cnt int
	for i := start; i < len(bars); i++ {
		tr := math.Max(bars[i].High-bars[i].Low,
			math.Max(math.Abs(bars[i].High-bars[i-1].Close), math.Abs(bars[i].Low-bars[i-1].Close)))
		sum += tr
		cnt++
	}
	if cnt == 0 {
		return 0
	}
	return sum / float64(cnt)
}

// BuildDecision merangkum seluruh lensa analisa (fase+PVA lewat Outlook,
// aliran broker, tekanan running trade, katalis Future Earnings, valuasi)
// menjadi satu verdict + rencana trading. Ambang verdict: skor >= 4 BELI,
// <= -3 HINDARI, sisanya PANTAU — sengaja lebih ketat dari ambang Outlook
// (±3) karena ini rekomendasi aksi, bukan sekadar bias.
func BuildDecision(in DecisionInput) Decision {
	var d Decision
	add := func(source, text string, pts int) {
		d.Score += pts
		d.Signals = append(d.Signals, DecisionSignal{Source: source, Text: text, Points: pts})
	}

	// 1) outlook teknikal+bandarmology (fase & PVA) — bobot terbesar
	d.Score += in.Outlook.Score
	for _, s := range in.Outlook.Bullish {
		d.Signals = append(d.Signals, DecisionSignal{Source: s.Source, Text: s.Text, Points: s.Points})
	}
	for _, s := range in.Outlook.Bearish {
		d.Signals = append(d.Signals, DecisionSignal{Source: s.Source, Text: s.Text, Points: s.Points})
	}

	// 2) aliran broker smart money se-rentang
	if in.HasBrokerData && in.TotalRangeValue > 0 {
		share := in.SmartNetValue / in.TotalRangeValue
		switch {
		case share >= 0.05:
			add("broker", fmt.Sprintf("Smart money net beli %.1f%% dari nilai transaksi periode ini", share*100), 2)
		case share <= -0.05:
			add("broker", fmt.Sprintf("Smart money net jual %.1f%% dari nilai transaksi periode ini", -share*100), -2)
		}
	}

	// 3) tekanan running trade hari terakhir
	if in.Pressure != nil && in.Pressure.NPrints >= 20 {
		p := in.Pressure
		if p.BuyLot > 0 || p.SellLot > 0 {
			switch {
			case float64(p.BuyLot) >= float64(p.SellLot)*1.5:
				add("tape", "Tekanan beli dominan di running trade hari terakhir", 1)
			case float64(p.SellLot) >= float64(p.BuyLot)*1.5:
				add("tape", "Tekanan jual dominan di running trade hari terakhir", -1)
			}
		}
	}

	// 4) katalis Future Earnings
	if in.BullishCatalysts > in.BearishCatalysts {
		add("katalis", fmt.Sprintf("%d katalis bullish vs %d bearish tercatat", in.BullishCatalysts, in.BearishCatalysts), 1)
	} else if in.BearishCatalysts > in.BullishCatalysts {
		add("katalis", fmt.Sprintf("%d katalis bearish vs %d bullish tercatat", in.BearishCatalysts, in.BullishCatalysts), -1)
	}

	// 5) valuasi (dari cache fundamental — tidak wajib ada)
	if in.PERatio != nil && in.PriceToBook != nil {
		switch {
		case *in.PERatio > 0 && *in.PERatio < 10 && *in.PriceToBook < 1.5:
			add("valuasi", fmt.Sprintf("Valuasi murah (P/E %.1fx, P/BV %.2fx) — cek panel Future Earnings utk risiko value trap", *in.PERatio, *in.PriceToBook), 1)
		case *in.PERatio > 25:
			add("valuasi", fmt.Sprintf("Valuasi premium (P/E %.1fx) — butuh pertumbuhan tinggi utk dibenarkan", *in.PERatio), -1)
		}
	}

	switch {
	case d.Score >= 4:
		d.Verdict = "BELI"
	case d.Score <= -3:
		d.Verdict = "HINDARI"
	default:
		d.Verdict = "PANTAU"
	}

	// rencana trading berbasis ATR — hanya bila ada cukup bar dan bukan HINDARI
	if d.Verdict != "HINDARI" && len(in.Bars) >= 15 {
		last := in.Bars[len(in.Bars)-1]
		atr := ATR14(in.Bars)
		if atr > 0 && last.Close > 0 {
			sl := last.Close - 1.5*atr
			tp := last.Close + 3*atr
			d.Plan = &TradePlan{
				Entry: last.Close, StopLoss: math.Round(sl), TakeProfit: math.Round(tp),
				ATR: math.Round(atr*100) / 100, RiskReward: 2,
			}
		}
	}
	d.Quality = assessDecisionQuality(in, d.Plan)
	if d.Verdict == "BELI" && !d.Quality.Eligible {
		d.Verdict = "PANTAU"
	}
	return d
}
