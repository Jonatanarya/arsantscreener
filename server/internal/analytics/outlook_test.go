package analytics

import "testing"

func TestBuildOutlook_StrongBullish(t *testing.T) {
	phase := &Phase{Type: Accumulation, Actor: SmartMoney, FromDate: "2026-01-01", Days: 20}
	pva := PVAResult{
		Bias: "BULLISH", Score: 6, Dominance: "demand", ObvSignal: "bull",
		Climax: &Climax{Type: "SELLING CLIMAX", Date: "2026-01-05"},
	}
	o := BuildOutlook(phase, pva)

	// fase smart money (+3) + pva bullish (+2) + obv bull (+1) + selling climax (+1) = 7
	if o.Score != 7 {
		t.Errorf("score = %d, want 7", o.Score)
	}
	if o.Bias != OutlookBullish {
		t.Errorf("bias = %s, want BULLISH", o.Bias)
	}
	if len(o.Bullish) != 4 {
		t.Errorf("expected 4 bullish signals, got %d: %+v", len(o.Bullish), o.Bullish)
	}
	if len(o.Bearish) != 0 {
		t.Errorf("expected 0 bearish signals, got %+v", o.Bearish)
	}
}

func TestBuildOutlook_StrongBearish(t *testing.T) {
	phase := &Phase{Type: Distribution, Actor: Retail, FromDate: "2026-01-01", Days: 15}
	pva := PVAResult{
		Bias: "BEARISH", Score: -5, Dominance: "supply", ObvSignal: "bear",
		Climax: &Climax{Type: "BUYING CLIMAX", Date: "2026-01-10"},
	}
	o := BuildOutlook(phase, pva)

	// fase ritel (-2) + pva bearish (-2) + obv bear (-1) + buying climax (-1) = -6
	if o.Score != -6 {
		t.Errorf("score = %d, want -6", o.Score)
	}
	if o.Bias != OutlookBearish {
		t.Errorf("bias = %s, want BEARISH", o.Bias)
	}
	if len(o.Bearish) != 4 {
		t.Errorf("expected 4 bearish signals, got %d: %+v", len(o.Bearish), o.Bearish)
	}
}

func TestBuildOutlook_ConflictingSignalsStayNeutral(t *testing.T) {
	// fase akumulasi smart money (+3) vs PVA bearish (-2) -> net +1, di bawah ambang ±3
	phase := &Phase{Type: Accumulation, Actor: SmartMoney, FromDate: "2026-01-01", Days: 10}
	pva := PVAResult{Bias: "BEARISH", Score: -3, Dominance: "supply"}
	o := BuildOutlook(phase, pva)

	if o.Score != 1 {
		t.Errorf("score = %d, want 1", o.Score)
	}
	if o.Bias != OutlookNeutral {
		t.Errorf("bias = %s, want NETRAL for conflicting signals, got score=%d", o.Bias, o.Score)
	}
	if len(o.Bullish) == 0 || len(o.Bearish) == 0 {
		t.Errorf("expected both bullish and bearish signals present, got bullish=%+v bearish=%+v", o.Bullish, o.Bearish)
	}
}

func TestBuildOutlook_NoData(t *testing.T) {
	o := BuildOutlook(nil, PVAResult{Error: "Data candle terlalu sedikit untuk analisa PVA."})
	if o.Score != 0 {
		t.Errorf("score = %d, want 0", o.Score)
	}
	if o.Bias != OutlookNeutral {
		t.Errorf("bias = %s, want NETRAL", o.Bias)
	}
	if len(o.Bullish) != 0 || len(o.Bearish) != 0 {
		t.Errorf("expected no signals, got bullish=%+v bearish=%+v", o.Bullish, o.Bearish)
	}
}

func TestBuildOutlook_BoundaryBelowThresholdStaysNeutral(t *testing.T) {
	// hanya PVA bullish murni (+2), tanpa fase/OBV/klimaks -> di bawah ambang ±3
	o := BuildOutlook(nil, PVAResult{Bias: "BULLISH", Score: 2, Dominance: "demand"})
	if o.Score != 2 {
		t.Errorf("score = %d, want 2", o.Score)
	}
	if o.Bias != OutlookNeutral {
		t.Errorf("bias = %s, want NETRAL just below threshold", o.Bias)
	}
}

func TestBuildOutlook_PhaseOnlyReachesThreshold(t *testing.T) {
	// fase akumulasi smart money sendirian (+3) sudah cukup menembus ambang
	phase := &Phase{Type: Accumulation, Actor: SmartMoney, FromDate: "2026-01-01", Days: 12}
	o := BuildOutlook(phase, PVAResult{Error: "no data"})
	if o.Score != 3 {
		t.Errorf("score = %d, want 3", o.Score)
	}
	if o.Bias != OutlookBullish {
		t.Errorf("bias = %s, want BULLISH at exactly the threshold", o.Bias)
	}
}
