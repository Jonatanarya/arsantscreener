package analytics

import (
	"testing"
	"time"
)

func dateSeq(n int) []string {
	out := make([]string, n)
	d := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < n; i++ {
		out[i] = d.Format("2006-01-02")
		d = d.AddDate(0, 0, 1)
	}
	return out
}

func TestDetectPhases_InsufficientData(t *testing.T) {
	dates := dateSeq(3)
	bars := []Bar{
		{Date: dates[0], Open: 100, High: 101, Low: 99, Close: 100},
		{Date: dates[1], Open: 100, High: 101, Low: 99, Close: 100},
		{Date: dates[2], Open: 100, High: 101, Low: 99, Close: 100},
	}
	res := DetectPhases(bars, map[string][]BrokerDayFlow{}, Options{Window: 10, Sensitivity: SensitivityMedium})
	if res.Error == "" {
		t.Fatalf("expected error for insufficient data, got phases=%v", res.Phases)
	}
	if len(res.Phases) != 0 {
		t.Fatalf("expected no phases, got %d", len(res.Phases))
	}
}

func TestDetectPhases_InvalidWindow(t *testing.T) {
	res := DetectPhases(nil, nil, Options{Window: 1, Sensitivity: SensitivityMedium})
	if res.Error == "" {
		t.Fatalf("expected error for window < 2")
	}
}

// Broker AK (asing, smart weight 1.0) net-buys cleanly every day while price
// stays flat, and a small ritel-online seller (YP) is on the other side —
// this should trigger exactly one AKUMULASI phase driven by smart money.
func TestDetectPhases_AccumulationBySmartMoney(t *testing.T) {
	const n = 15
	dates := dateSeq(n)

	bars := make([]Bar, n)
	brokerByDate := map[string][]BrokerDayFlow{}
	for i, d := range dates {
		price := 1000.0 // sideways: no drift, satisfies compression/chg either way
		bars[i] = Bar{Date: d, Open: price, High: price * 1.01, Low: price * 0.99, Close: price}
		brokerByDate[d] = []BrokerDayFlow{
			{Code: "AK", BuyValue: 1_000_000, BuyLot: 100, BuyFreq: 10, SellValue: 0, SellLot: 0, SellFreq: 0},
			{Code: "YP", BuyValue: 0, BuyLot: 0, BuyFreq: 0, SellValue: 500_000, SellLot: 50, SellFreq: 5},
		}
	}

	res := DetectPhases(bars, brokerByDate, Options{Window: 10, Sensitivity: SensitivityMedium})
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if len(res.Phases) != 1 {
		t.Fatalf("expected exactly 1 phase, got %d: %+v", len(res.Phases), res.Phases)
	}

	p := res.Phases[0]
	if p.Type != Accumulation {
		t.Errorf("expected AKUMULASI, got %s", p.Type)
	}
	if p.Actor != SmartMoney {
		t.Errorf("expected actor SMART MONEY, got %s (avgTrx=%.0f, smartShare=%.2f)", p.Actor, p.AvgTrx, p.SmartShare)
	}
	if len(p.TopBrokers) == 0 || p.TopBrokers[0].Code != "AK" {
		t.Errorf("expected AK as top broker, got %+v", p.TopBrokers)
	}
	if p.Flow <= 0 {
		t.Errorf("expected positive flow, got %f", p.Flow)
	}
}

// Mirror of the accumulation case: broker AK now net-sells cleanly while
// price is flat/declining — should trigger exactly one DISTRIBUSI phase.
func TestDetectPhases_Distribution(t *testing.T) {
	const n = 15
	dates := dateSeq(n)

	bars := make([]Bar, n)
	brokerByDate := map[string][]BrokerDayFlow{}
	for i, d := range dates {
		price := 1000.0
		bars[i] = Bar{Date: d, Open: price, High: price * 1.01, Low: price * 0.99, Close: price}
		brokerByDate[d] = []BrokerDayFlow{
			{Code: "AK", BuyValue: 0, BuyLot: 0, BuyFreq: 0, SellValue: 1_000_000, SellLot: 100, SellFreq: 10},
			{Code: "YP", BuyValue: 500_000, BuyLot: 50, BuyFreq: 5, SellValue: 0, SellLot: 0, SellFreq: 0},
		}
	}

	res := DetectPhases(bars, brokerByDate, Options{Window: 10, Sensitivity: SensitivityMedium})
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if len(res.Phases) != 1 {
		t.Fatalf("expected exactly 1 phase, got %d: %+v", len(res.Phases), res.Phases)
	}

	p := res.Phases[0]
	if p.Type != Distribution {
		t.Errorf("expected DISTRIBUSI, got %s", p.Type)
	}
	if p.Actor != SmartMoney {
		t.Errorf("expected actor SMART MONEY, got %s", p.Actor)
	}
	if len(p.TopBrokers) == 0 || p.TopBrokers[0].Code != "AK" {
		t.Errorf("expected AK as top broker, got %+v", p.TopBrokers)
	}
}

// Alternating small buy/sell noise with no persistent broker never crosses
// the flow/persistence/clean-buy thresholds -> no phase should be detected.
func TestDetectPhases_NoPhaseWhenNoisy(t *testing.T) {
	const n = 15
	dates := dateSeq(n)

	bars := make([]Bar, n)
	brokerByDate := map[string][]BrokerDayFlow{}
	for i, d := range dates {
		price := 1000.0
		bars[i] = Bar{Date: d, Open: price, High: price * 1.01, Low: price * 0.99, Close: price}
		if i%2 == 0 {
			brokerByDate[d] = []BrokerDayFlow{
				{Code: "AK", BuyValue: 300_000, SellValue: 300_000},
				{Code: "YP", BuyValue: 300_000, SellValue: 300_000},
			}
		} else {
			brokerByDate[d] = []BrokerDayFlow{
				{Code: "AK", BuyValue: 300_000, SellValue: 300_000},
				{Code: "YP", BuyValue: 300_000, SellValue: 300_000},
			}
		}
	}

	res := DetectPhases(bars, brokerByDate, Options{Window: 10, Sensitivity: SensitivityMedium})
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if len(res.Phases) != 0 {
		t.Fatalf("expected no phases for noisy/neutral flow, got %d: %+v", len(res.Phases), res.Phases)
	}
}

func TestBrokerType(t *testing.T) {
	cases := map[string]string{
		"AK": "asing",
		"CC": "bumn",
		"LG": "lokal-inst",
		"YP": "ritel-online",
		"GR": "ritel",
		"XA": "campuran",
		"IH": "lain",
		"ZZ": "lain", // unknown code -> default
	}
	for code, want := range cases {
		if got := BrokerType(code); got != want {
			t.Errorf("BrokerType(%q) = %q, want %q", code, got, want)
		}
	}
}

func TestBrokerName(t *testing.T) {
	if got := BrokerName("AK"); got != "UBS Sekuritas Indonesia" {
		t.Errorf("BrokerName(AK) = %q", got)
	}
	if got := BrokerName("ZZ"); got != "ZZ" {
		t.Errorf("BrokerName(unknown) should fall back to code, got %q", got)
	}
}
