package analytics

import "testing"

func mkBarsTrend(n int, start, step float64) []Bar {
	bars := make([]Bar, n)
	p := start
	for i := range bars {
		bars[i] = Bar{Date: "2026-01-01", Open: p, High: p + 10, Low: p - 10, Close: p + step, Volume: 1_000_000}
		p += step
	}
	return bars
}

func TestAnalyzeTradePressure_Basic(t *testing.T) {
	prints := []TradePrint{
		{Price: 1000, Lot: 50, Direction: "buy"},
		{Price: 1000, Lot: 30, Direction: "sell"},
		{Price: 1005, Lot: 500, Direction: "buy"},
		{Price: 1005, Lot: 20, Direction: "unknown"},
	}
	p := AnalyzeTradePressure(prints)
	if p.BuyLot != 550 || p.SellLot != 30 || p.UnknownLot != 20 {
		t.Fatalf("lot split salah: %+v", p)
	}
	if p.NPrints != 4 || p.BigPrints < 1 {
		t.Fatalf("print stats salah: %+v", p)
	}
	if p.VWAP < 1000 || p.VWAP > 1005 {
		t.Fatalf("VWAP di luar rentang harga: %f", p.VWAP)
	}
}

func TestBuildDecision_StrongBuyWithPlan(t *testing.T) {
	d := BuildDecision(DecisionInput{
		Outlook:          Outlook{Score: 4, Bias: OutlookBullish},
		Bars:             mkBarsTrend(30, 1000, 5),
		SmartNetValue:    10e9,
		TotalRangeValue:  100e9, // 10% smart share -> +2
		HasBrokerData:    true,
		BullishCatalysts: 2,
	})
	if d.Verdict != "BELI" {
		t.Fatalf("verdict = %s, mau BELI (skor %d)", d.Verdict, d.Score)
	}
	if d.Plan == nil {
		t.Fatal("plan nil padahal verdict BELI dan bar cukup")
	}
	if d.Plan.StopLoss >= d.Plan.Entry || d.Plan.TakeProfit <= d.Plan.Entry {
		t.Fatalf("plan tidak masuk akal: %+v", *d.Plan)
	}
}

func TestBuildDecision_AvoidHasNoPlan(t *testing.T) {
	d := BuildDecision(DecisionInput{
		Outlook:          Outlook{Score: -4, Bias: OutlookBearish},
		Bars:             mkBarsTrend(30, 1000, -5),
		SmartNetValue:    -10e9,
		TotalRangeValue:  100e9,
		HasBrokerData:    true,
		BearishCatalysts: 1,
	})
	if d.Verdict != "HINDARI" {
		t.Fatalf("verdict = %s, mau HINDARI (skor %d)", d.Verdict, d.Score)
	}
	if d.Plan != nil {
		t.Fatal("HINDARI tidak boleh punya trade plan")
	}
}

func TestBuildDecision_NeutralIsPantau(t *testing.T) {
	d := BuildDecision(DecisionInput{Outlook: Outlook{Score: 0, Bias: OutlookNeutral}})
	if d.Verdict != "PANTAU" {
		t.Fatalf("verdict = %s, mau PANTAU", d.Verdict)
	}
}

func TestBuildDecision_DowngradesIlliquidBuy(t *testing.T) {
	bars := mkBarsTrend(30, 30, 0)
	for i := range bars {
		bars[i].Volume = 100
	}
	d := BuildDecision(DecisionInput{Outlook: Outlook{Score: 5, Bias: OutlookBullish}, Bars: bars, HasBrokerData: true})
	if d.Verdict != "PANTAU" {
		t.Fatalf("verdict = %s, mau PANTAU", d.Verdict)
	}
	if d.Quality.Eligible {
		t.Fatal("saham tidak likuid tidak boleh lolos kualitas")
	}
	if len(d.Quality.Reasons) == 0 {
		t.Fatal("alasan kualitas harus tersedia")
	}
}
