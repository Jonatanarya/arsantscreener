// Package analytics ports the phase-detection engine (akumulasi/distribusi)
// from bridge-extension/app.js's analyze() function to Go. The sliding-window
// algorithm, thresholds, and phase-merging rules are kept numerically
// identical to the original so results match what the extension already
// draws on the Stockbit chart.
package analytics

import "sort"

// Sensitivity controls how strict the compression/flow thresholds are.
// Values and meaning match app.js's SENS presets.
type Sensitivity string

const (
	SensitivityLow    Sensitivity = "rendah"
	SensitivityMedium Sensitivity = "sedang"
	SensitivityHigh   Sensitivity = "tinggi"
)

type sensThresholds struct {
	// Compression is computed per-window (see window.Comp) for parity with
	// app.js, but — same as in app.js — it is not actually used in the
	// accumulation/distribution decision below. Kept for future use / UI
	// display, not dead-code-removed, to stay faithful to the original.
	Compression float64
	Flow        float64
	Persist     float64
	Clean       float64
}

var sensPresets = map[Sensitivity]sensThresholds{
	SensitivityLow:    {Compression: 0.07, Flow: 0.18, Persist: 0.7, Clean: 0.7},
	SensitivityMedium: {Compression: 0.10, Flow: 0.12, Persist: 0.6, Clean: 0.6},
	SensitivityHigh:   {Compression: 0.14, Flow: 0.07, Persist: 0.5, Clean: 0.5},
}

// Bar is one daily OHLC candle. Volume is unused by phase detection but
// carried here so callers can build one []Bar slice shared with PVA (pva.go).
type Bar struct {
	Date   string // YYYY-MM-DD
	Open   float64
	High   float64
	Low    float64
	Close  float64
	Volume int64
}

// BrokerDayFlow is one broker's buy+sell activity on a single day — the Go
// equivalent of app.js's merged {code, bval, blot, bfreq, sval, slot, sfreq}
// row (our MySQL schema stores buy/sell as separate rows; callers reshape
// them into this merged form before calling DetectPhases).
type BrokerDayFlow struct {
	Code      string
	BuyValue  float64
	BuyLot    int64
	BuyFreq   int
	SellValue float64
	SellLot   int64
	SellFreq  int
}

// Options mirrors app.js's `opts` (win + sens).
type Options struct {
	Window      int
	Sensitivity Sensitivity
}

type PhaseType string

const (
	Accumulation PhaseType = "AKUMULASI"
	Distribution PhaseType = "DISTRIBUSI"
)

type Actor string

const (
	SmartMoney Actor = "SMART MONEY"
	Retail     Actor = "RITEL"
)

// BrokerNet is one broker's net buy(+)/sell(-) value over a phase or window.
type BrokerNet struct {
	Code string
	Net  float64
}

// Phase is one detected accumulation/distribution episode.
type Phase struct {
	Type       PhaseType
	Actor      Actor
	AvgTrx     float64 // nilai rata-rata per transaksi broker motor (Rp)
	AvgPrice   float64 // harga rata-rata transaksi broker motor (cost bandar)
	FromDate   string
	ToDate     string
	PriceLow   float64
	PriceHigh  float64
	TopBrokers []BrokerNet
	Flow       float64 // total |net| dari broker motor (top 3)
	SmartShare float64 // 0..1, porsi flow dari broker smart-money
	Days       int
}

// Result is DetectPhases' output. Error is set (Phases empty) when there
// isn't enough data to run the sliding window at all — same guard as
// app.js's early return.
type Result struct {
	Phases []Phase
	Error  string
}

type day struct {
	Bar
	Rows     []BrokerDayFlow
	Net      map[string]float64
	TotalVal float64
}

type window struct {
	index      int
	comp       float64
	chg        float64
	accRatio   float64
	dstRatio   float64
	accFlow    float64
	dstFlow    float64
	accSmart   float64
	dstSmart   float64
	accBrokers []BrokerNet
	dstBrokers []BrokerNet
}

type brokerWindowAgg struct {
	buy, sell         float64
	buyDays, sellDays int
}

// DetectPhases scans bars+brokerByDate with a sliding window of Options.Window
// days and returns every accumulation/distribution phase found, using the
// sensitivity preset's compression/flow/persistence/clean-buy thresholds.
//
// bars must be sorted ascending by date. brokerByDate keys are "YYYY-MM-DD"
// dates matching Bar.Date.
func DetectPhases(bars []Bar, brokerByDate map[string][]BrokerDayFlow, opts Options) Result {
	th, ok := sensPresets[opts.Sensitivity]
	if !ok {
		th = sensPresets[SensitivityMedium]
	}
	w := opts.Window
	if w < 2 {
		return Result{Error: "window terlalu kecil"}
	}

	days := buildDays(bars, brokerByDate)
	if len(days) < w+2 {
		if len(days) == 0 {
			return Result{Error: "Tidak ada data broker summary pada rentang ini."}
		}
		return Result{Error: "Data terlalu sedikit untuk deteksi fase."}
	}

	wins := scanWindows(days, w, th)
	marks := classifyWindows(wins, th)
	phases := mergeAdjacent(marks)
	result := make([]Phase, 0, len(phases))
	for _, p := range phases {
		result = append(result, buildPhase(days, p, w))
	}

	return Result{Phases: result}
}

func buildDays(bars []Bar, brokerByDate map[string][]BrokerDayFlow) []day {
	days := make([]day, 0, len(bars))
	for _, b := range bars {
		rows := brokerByDate[b.Date]
		if len(rows) == 0 {
			continue
		}
		var totalBuy, totalSell float64
		net := make(map[string]float64, len(rows))
		for _, r := range rows {
			totalBuy += r.BuyValue
			totalSell += r.SellValue
			net[r.Code] += r.BuyValue - r.SellValue
		}
		totalVal := totalBuy
		if totalSell > totalVal {
			totalVal = totalSell
		}
		days = append(days, day{Bar: b, Rows: rows, Net: net, TotalVal: totalVal})
	}
	return days
}

func scanWindows(days []day, w int, th sensThresholds) []window {
	wins := make([]window, 0, len(days)-w+1)
	for i := 0; i+w <= len(days); i++ {
		seg := days[i : i+w]

		hi, lo := seg[0].High, seg[0].Low
		var sumC float64
		for _, d := range seg {
			if d.High > hi {
				hi = d.High
			}
			if d.Low < lo {
				lo = d.Low
			}
			sumC += d.Close
		}
		avgC := sumC / float64(w)
		comp := 0.0
		if avgC != 0 {
			comp = (hi - lo) / avgC
		}
		chg := 0.0
		if seg[0].Close != 0 {
			chg = seg[w-1].Close/seg[0].Close - 1
		}

		var totalVal float64
		for _, d := range seg {
			totalVal += d.TotalVal
		}
		if totalVal == 0 {
			totalVal = 1
		}

		agg := map[string]*brokerWindowAgg{}
		for _, d := range seg {
			for _, r := range d.Rows {
				a := agg[r.Code]
				if a == nil {
					a = &brokerWindowAgg{}
					agg[r.Code] = a
				}
				a.buy += r.BuyValue
				a.sell += r.SellValue
				n := r.BuyValue - r.SellValue
				if n > 0 {
					a.buyDays++
				} else if n < 0 {
					a.sellDays++
				}
			}
		}

		var accFlow, dstFlow, accSmart, dstSmart float64
		var accBrokers, dstBrokers []BrokerNet
		for code, a := range agg {
			n := a.buy - a.sell
			sw := brokerSmartWeight(code)
			if n > 0 && float64(a.buyDays) >= th.Persist*float64(w) && a.buy > 0 && n/a.buy >= th.Clean {
				accFlow += n
				accSmart += n * sw
				accBrokers = append(accBrokers, BrokerNet{Code: code, Net: n})
			}
			if n < 0 && float64(a.sellDays) >= th.Persist*float64(w) && a.sell > 0 && -n/a.sell >= th.Clean {
				dstFlow += -n
				dstSmart += -n * sw
				dstBrokers = append(dstBrokers, BrokerNet{Code: code, Net: n})
			}
		}
		sort.Slice(accBrokers, func(i, j int) bool { return accBrokers[i].Net > accBrokers[j].Net })
		sort.Slice(dstBrokers, func(i, j int) bool { return dstBrokers[i].Net < dstBrokers[j].Net })

		wins = append(wins, window{
			index: i, comp: comp, chg: chg,
			accRatio: accFlow / totalVal, dstRatio: dstFlow / totalVal,
			accFlow: accFlow, dstFlow: dstFlow, accSmart: accSmart, dstSmart: dstSmart,
			accBrokers: accBrokers, dstBrokers: dstBrokers,
		})
	}
	return wins
}

type mark byte

const (
	markNone mark = 0
	markAcc  mark = 'A'
	markDst  mark = 'D'
)

func classifyWindows(wins []window, th sensThresholds) []mark {
	marks := make([]mark, len(wins))
	for i, w := range wins {
		isAcc := w.accRatio >= th.Flow && w.accSmart > w.dstSmart && w.chg <= 0.12
		isDst := w.dstRatio >= th.Flow && w.dstSmart > w.accSmart && w.chg >= -0.12
		switch {
		case isAcc:
			marks[i] = markAcc
		case isDst:
			marks[i] = markDst
		default:
			marks[i] = markNone
		}
	}
	return marks
}

type candidatePhase struct {
	mark              mark
	firstWin, lastWin int
}

// mergeAdjacent merges same-type windows that overlap or sit within a
// 2-window gap of each other (i <= cur.lastWin+3), mirroring app.js exactly.
func mergeAdjacent(marks []mark) []candidatePhase {
	var phases []candidatePhase
	var cur *candidatePhase
	for i, t := range marks {
		if t != markNone && cur != nil && cur.mark == t && i <= cur.lastWin+3 {
			cur.lastWin = i
		} else if t != markNone {
			if cur != nil {
				phases = append(phases, *cur)
			}
			cur = &candidatePhase{mark: t, firstWin: i, lastWin: i}
		}
	}
	if cur != nil {
		phases = append(phases, *cur)
	}
	return phases
}

func buildPhase(days []day, p candidatePhase, w int) Phase {
	i1, i2 := p.firstWin, p.lastWin+w-1
	seg := days[i1 : i2+1]

	agg := map[string]float64{}
	for _, d := range seg {
		for c, n := range d.Net {
			agg[c] += n
		}
	}

	type entry struct {
		code string
		net  float64
	}
	sorted := make([]entry, 0, len(agg))
	for c, n := range agg {
		sorted = append(sorted, entry{c, n})
	}
	isAcc := p.mark == markAcc
	sort.Slice(sorted, func(i, j int) bool {
		if isAcc {
			return sorted[i].net > sorted[j].net
		}
		return sorted[i].net < sorted[j].net
	})

	var top []BrokerNet
	for _, e := range sorted {
		if (isAcc && e.net <= 0) || (!isAcc && e.net >= 0) {
			continue
		}
		top = append(top, BrokerNet{Code: e.code, Net: e.net})
		if len(top) == 3 {
			break
		}
	}

	var flow float64
	for _, b := range top {
		if b.Net < 0 {
			flow += -b.Net
		} else {
			flow += b.Net
		}
	}

	var smart, all float64
	for _, e := range sorted {
		rel := 0.0
		if isAcc {
			if e.net > 0 {
				rel = e.net
			}
		} else if e.net < 0 {
			rel = -e.net
		}
		all += rel
		if brokerSmartWeight(e.code) >= 0.45 {
			smart += rel
		}
	}

	topCodes := make(map[string]bool, len(top))
	for _, b := range top {
		topCodes[b.Code] = true
	}
	var sumVal, sumFreq float64
	var sumLot int64
	for _, d := range seg {
		for _, r := range d.Rows {
			if !topCodes[r.Code] {
				continue
			}
			if isAcc {
				sumVal += r.BuyValue
				sumLot += r.BuyLot
				sumFreq += float64(r.BuyFreq)
			} else {
				sumVal += r.SellValue
				sumLot += r.SellLot
				sumFreq += float64(r.SellFreq)
			}
		}
	}
	avgPrice := 0.0
	if sumLot > 0 {
		// lot = 100 lembar saham (standar IDX)
		avgPrice = sumVal / (float64(sumLot) * 100)
	}
	avgTrx := 0.0
	if sumFreq > 0 {
		avgTrx = sumVal / sumFreq
	}
	smartShare := 0.0
	if all > 0 {
		smartShare = smart / all
	}
	actor := Retail
	if smartShare >= 0.55 || avgTrx >= 15e6 {
		actor = SmartMoney
	}

	phaseType := Distribution
	if isAcc {
		phaseType = Accumulation
	}

	lo, hi := seg[0].Low, seg[0].High
	for _, d := range seg {
		if d.Low < lo {
			lo = d.Low
		}
		if d.High > hi {
			hi = d.High
		}
	}

	return Phase{
		Type: phaseType, Actor: actor,
		AvgTrx: avgTrx, AvgPrice: avgPrice,
		FromDate: seg[0].Date, ToDate: seg[len(seg)-1].Date,
		PriceLow: lo * 0.995, PriceHigh: hi * 1.005,
		TopBrokers: top, Flow: flow, SmartShare: smartShare,
		Days: len(seg),
	}
}
