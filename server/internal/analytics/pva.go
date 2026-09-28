// Price-Volume Analysis (VSA sederhana + OBV), di-port dari pvaAnalysis() di
// bridge-extension/app.js. Prinsip VSA: bandingkan effort (volume) dengan
// result (pergerakan harga) untuk menilai validitas sebuah pergerakan.
package analytics

type PVARow struct {
	Date   string
	Close  float64
	ChgPct float64 // perubahan close vs hari sebelumnya, dalam persen
	VolRel float64 // volume hari itu relatif terhadap SMA(volume,20) hari sebelumnya
	Class  string
	Desc   string
	Score  int
}

type Climax struct {
	Type string // "SELLING CLIMAX" | "BUYING CLIMAX"
	Desc string
	Date string
}

type PVAResult struct {
	Rows        []PVARow
	ObvText     string
	ObvSignal   string // "bull" | "bear" | ""
	UpDownRatio float64
	Dominance   string // "demand" | "supply" | "seimbang"
	Climax      *Climax
	Score       int
	Bias        string // "BULLISH" | "BEARISH" | "NETRAL"
	Error       string
}

// sma is a rolling simple moving average; entries before the window fills
// are nil, matching app.js's calcSMA (fills with null until index n-1).
func sma(vals []float64, n int) []*float64 {
	out := make([]*float64, len(vals))
	sum := 0.0
	for i := range vals {
		sum += vals[i]
		if i >= n {
			sum -= vals[i-n]
		}
		if i >= n-1 {
			v := sum / float64(n)
			out[i] = &v
		}
	}
	return out
}

func classifyCandle(bars []Bar, vma, rma []*float64, i int) *PVARow {
	if i < 1 || vma[i-1] == nil || rma[i-1] == nil {
		return nil
	}
	naik := bars[i].Close >= bars[i-1].Close
	vRel := float64(bars[i].Volume) / *vma[i-1]
	rRel := (bars[i].High - bars[i].Low) / *rma[i-1]

	var class, desc string
	var score int
	switch {
	case naik && vRel >= 1.5 && rRel >= 1:
		class, desc, score = "DEMAND KUAT", "naik + volume & range besar — pergerakan valid", 2
	case naik && vRel >= 1.5 && rRel < 0.7:
		class, desc, score = "ABSORPSI SUPPLY", "volume besar tapi range sempit — ada yang jualan di atas, effort > result", -1
	case naik && vRel < 0.7:
		class, desc, score = "NO DEMAND", "naik tanpa volume — kenaikan rapuh", -1
	case naik:
		class, desc, score = "naik normal", "", 1
	case vRel >= 1.5 && rRel >= 1:
		class, desc, score = "SUPPLY KUAT", "turun + volume & range besar — tekanan jual nyata", -2
	case vRel >= 1.5 && rRel < 0.7:
		class, desc, score = "ABSORPSI DEMAND", "turun ditahan volume besar — ada yang menampung", 1
	case vRel < 0.7:
		class, desc, score = "NO SUPPLY", "turun tanpa volume — koreksi sehat", 1
	default:
		class, desc, score = "turun normal", "", -1
	}

	chgPct := (bars[i].Close/bars[i-1].Close - 1) * 100
	return &PVARow{
		Date: bars[i].Date, Close: bars[i].Close, ChgPct: chgPct, VolRel: vRel,
		Class: class, Desc: desc, Score: score,
	}
}

// AnalyzePVA requires at least 2 bars sorted ascending by date; results get
// more meaningful the closer bars is to app.js's usual 120-bar window (SMA
// windows and the 40-bar climax lookback need history to be useful).
func AnalyzePVA(bars []Bar) PVAResult {
	if len(bars) < 2 {
		return PVAResult{Error: "Data candle terlalu sedikit untuk analisa PVA."}
	}

	volumes := make([]float64, len(bars))
	ranges := make([]float64, len(bars))
	for i, b := range bars {
		volumes[i] = float64(b.Volume)
		ranges[i] = b.High - b.Low
	}
	vma := sma(volumes, 20)
	rma := sma(ranges, 20)

	// OBV (On-Balance Volume)
	obv := make([]float64, len(bars))
	for i := 1; i < len(bars); i++ {
		switch {
		case bars[i].Close > bars[i-1].Close:
			obv[i] = obv[i-1] + float64(bars[i].Volume)
		case bars[i].Close < bars[i-1].Close:
			obv[i] = obv[i-1] - float64(bars[i].Volume)
		default:
			obv[i] = obv[i-1]
		}
	}

	i := len(bars) - 1
	back := 20
	if i < back {
		back = i
	}
	obvChg := obv[i] - obv[i-back]
	priceChg := bars[i].Close/bars[i-back].Close - 1

	obvDir := "TURUN"
	if obvChg >= 0 {
		obvDir = "NAIK"
	}
	obvText := "OBV 20 hari " + obvDir
	obvSignal := ""
	switch {
	case obvChg > 0 && priceChg < -0.02:
		obvText += " sementara harga turun — divergensi bullish: volume mengindikasikan akumulasi"
		obvSignal = "bull"
	case obvChg < 0 && priceChg > 0.02:
		obvText += " sementara harga naik — divergensi bearish: kenaikan tidak didukung volume"
		obvSignal = "bear"
	}

	// rasio volume hari naik vs turun
	var vUp, vDn float64
	for j := i - back + 1; j <= i; j++ {
		if bars[j].Close >= bars[j-1].Close {
			vUp += float64(bars[j].Volume)
		} else {
			vDn += float64(bars[j].Volume)
		}
	}
	upDownRatio := 99.0
	if vDn > 0 {
		upDownRatio = vUp / vDn
	}
	dominance := "seimbang"
	switch {
	case upDownRatio >= 1.3:
		dominance = "demand"
	case upDownRatio <= 0.75:
		dominance = "supply"
	}

	// klimaks volume: volume terbesar 40 hari terakhir di dekat low/high ekstrem
	start := len(bars) - 40
	if start < 0 {
		start = 0
	}
	w40 := bars[start:]
	iMaxV := 0
	for k, b := range w40 {
		if b.Volume > w40[iMaxV].Volume {
			iMaxV = k
		}
	}
	loMin, hiMax := w40[0].Low, w40[0].High
	for _, b := range w40 {
		if b.Low < loMin {
			loMin = b.Low
		}
		if b.High > hiMax {
			hiMax = b.High
		}
	}
	var climax *Climax
	switch {
	case w40[iMaxV].Low <= loMin*1.03:
		climax = &Climax{Type: "SELLING CLIMAX", Desc: "volume terbesar terjadi di area low — panic selling, sering jadi dasar", Date: w40[iMaxV].Date}
	case w40[iMaxV].High >= hiMax*0.97:
		climax = &Climax{Type: "BUYING CLIMAX", Desc: "volume terbesar di area high — euforia, rawan puncak/distribusi", Date: w40[iMaxV].Date}
	}

	// baris 7 hari terakhir + skor (hari terbaru berbobot lebih)
	rows := make([]PVARow, 0, 8)
	score := 0
	jStart := i - 7
	if jStart < 1 {
		jStart = 1
	}
	for j := jStart; j <= i; j++ {
		row := classifyCandle(bars, vma, rma, j)
		if row == nil {
			continue
		}
		weight := 1
		if j > i-4 {
			weight = 2
		}
		score += row.Score * weight
		rows = append(rows, *row)
	}

	bias := "NETRAL"
	switch {
	case score >= 4:
		bias = "BULLISH"
	case score <= -4:
		bias = "BEARISH"
	}

	return PVAResult{
		Rows: rows, ObvText: obvText, ObvSignal: obvSignal,
		UpDownRatio: upDownRatio, Dominance: dominance,
		Climax: climax, Score: score, Bias: bias,
	}
}
