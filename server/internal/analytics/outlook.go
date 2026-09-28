// Outlook merangkum hasil dua mesin analisa yang sudah ada — deteksi fase
// akumulasi/distribusi (phase.go) dan Price-Volume Analysis (pva.go) — jadi
// satu verdict bullish/bearish/netral per simbol, dengan daftar sinyal yang
// mendukung tiap arah agar keputusannya bisa ditelusuri, bukan kotak hitam.
package analytics

import "fmt"

type OutlookBias string

const (
	OutlookBullish OutlookBias = "BULLISH"
	OutlookBearish OutlookBias = "BEARISH"
	OutlookNeutral OutlookBias = "NETRAL"
)

// OutlookSignal is one contributing factor, with the score points it added
// (positive) or subtracted (negative) — so the UI can show exactly why the
// verdict landed where it did.
type OutlookSignal struct {
	Source string // "fase" | "pva"
	Text   string
	Points int
}

type Outlook struct {
	Bias    OutlookBias
	Score   int
	Bullish []OutlookSignal
	Bearish []OutlookSignal
}

// BuildOutlook combines the most recent/ongoing phase (nil if none detected)
// with a PVA result. Each source is normalized to a small, comparable point
// range (roughly ±3 for phase, ±4 for PVA) before summing, so neither
// analysis dominates the other just because its own internal scale happens
// to run bigger — thresholds at ±3 mirror pva.go's own ±4 bias cutoff.
func BuildOutlook(phase *Phase, pva PVAResult) Outlook {
	var o Outlook

	if phase != nil {
		pts := 2
		actor := "ritel"
		if phase.Actor == SmartMoney {
			pts = 3
			actor = "smart money"
		}
		switch phase.Type {
		case Accumulation:
			o.Score += pts
			o.Bullish = append(o.Bullish, OutlookSignal{
				Source: "fase", Points: pts,
				Text: fmt.Sprintf("Fase AKUMULASI oleh %s sejak %s (%d hari)", actor, phase.FromDate, phase.Days),
			})
		case Distribution:
			o.Score -= pts
			o.Bearish = append(o.Bearish, OutlookSignal{
				Source: "fase", Points: -pts,
				Text: fmt.Sprintf("Fase DISTRIBUSI oleh %s sejak %s (%d hari)", actor, phase.FromDate, phase.Days),
			})
		}
	}

	if pva.Error == "" {
		switch pva.Bias {
		case "BULLISH":
			o.Score += 2
			o.Bullish = append(o.Bullish, OutlookSignal{
				Source: "pva", Points: 2,
				Text: fmt.Sprintf("PVA bullish (skor %d), volume %s", pva.Score, pva.Dominance),
			})
		case "BEARISH":
			o.Score -= 2
			o.Bearish = append(o.Bearish, OutlookSignal{
				Source: "pva", Points: -2,
				Text: fmt.Sprintf("PVA bearish (skor %d), volume %s", pva.Score, pva.Dominance),
			})
		}
		switch pva.ObvSignal {
		case "bull":
			o.Score++
			o.Bullish = append(o.Bullish, OutlookSignal{Source: "pva", Points: 1, Text: "Divergensi OBV bullish — volume mengindikasikan akumulasi"})
		case "bear":
			o.Score--
			o.Bearish = append(o.Bearish, OutlookSignal{Source: "pva", Points: -1, Text: "Divergensi OBV bearish — kenaikan tidak didukung volume"})
		}
		if pva.Climax != nil {
			if pva.Climax.Type == "SELLING CLIMAX" {
				o.Score++
				o.Bullish = append(o.Bullish, OutlookSignal{Source: "pva", Points: 1, Text: "Selling climax " + pva.Climax.Date + " — sering jadi dasar"})
			} else {
				o.Score--
				o.Bearish = append(o.Bearish, OutlookSignal{Source: "pva", Points: -1, Text: "Buying climax " + pva.Climax.Date + " — rawan puncak/distribusi"})
			}
		}
	}

	switch {
	case o.Score >= 3:
		o.Bias = OutlookBullish
	case o.Score <= -3:
		o.Bias = OutlookBearish
	default:
		o.Bias = OutlookNeutral
	}

	return o
}
