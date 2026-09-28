package yahoofinance

import "testing"

func TestTickerFor(t *testing.T) {
	tests := map[string]string{
		"BBCA":    "BBCA.JK",
		"bbri":    "BBRI.JK",
		"TLKM.JK": "TLKM.JK",
		"IHSG":    "^JKSE",
		"^JKSE":   "^JKSE",
	}
	for input, want := range tests {
		if got := tickerFor(input); got != want {
			t.Fatalf("tickerFor(%q)=%q, want %q", input, got, want)
		}
	}
}
