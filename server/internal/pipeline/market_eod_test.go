package pipeline

import (
	"testing"
	"time"
)

func TestExpectedMarketDate(t *testing.T) {
	location, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		now  time.Time
		want string
	}{
		{"after close", time.Date(2026, 9, 18, 18, 0, 0, 0, location), "2026-09-18"},
		{"before close", time.Date(2026, 9, 18, 10, 0, 0, 0, location), "2026-09-17"},
		{"saturday", time.Date(2026, 9, 19, 18, 0, 0, 0, location), "2026-09-18"},
		{"sunday", time.Date(2026, 9, 20, 18, 0, 0, 0, location), "2026-09-18"},
		{"monday before close", time.Date(2026, 9, 21, 9, 0, 0, 0, location), "2026-09-18"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := ExpectedMarketDate(test.now, 17, 15).Format("2006-01-02")
			if got != test.want {
				t.Fatalf("got %s, want %s", got, test.want)
			}
		})
	}
}
