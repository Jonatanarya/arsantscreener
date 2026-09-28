package store

import "testing"

// Format tanggal laporan Stockbit ("30 Jun 26") adalah satu-satunya bagian
// pipeline KSEI yang bergantung pada string bebas dari pihak ketiga, jadi
// perilakunya dikunci di sini — termasuk kegagalannya.
func TestParseKSEIReportDate(t *testing.T) {
	ok := map[string]string{
		"30 Jun 26":    "2026-06-30",
		"31 Dec 25":    "2025-12-31",
		"1 Jan 26":     "2026-01-01",
		"  30 Jun 26 ": "2026-06-30",
		"2026-06-30":   "2026-06-30", // sudah ISO -> diteruskan apa adanya
	}
	for in, want := range ok {
		got, err := ParseKSEIReportDate(in)
		if err != nil {
			t.Errorf("ParseKSEIReportDate(%q) error: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("ParseKSEIReportDate(%q) = %q, want %q", in, got, want)
		}
	}

	for _, bad := range []string{"", "   ", "Juni 2026", "30/06/2026", "30 Junix 26"} {
		if _, err := ParseKSEIReportDate(bad); err == nil {
			t.Errorf("ParseKSEIReportDate(%q) seharusnya error, bukan tanggal diam-diam salah", bad)
		}
	}
}
