package newsfeed

import "testing"

func TestAnalyzeFindsTickerAndPositiveSentiment(t *testing.T) {
	analyzer := NewAnalyzer([]Company{{Symbol: "BBCA", Name: "PT Bank Central Asia Tbk"}})
	result := analyzer.Analyze("BBCA membagikan dividen tunai setelah laba naik", "Kinerja positif emiten perbankan.")
	if result.Sentiment != "POSITIF" {
		t.Fatalf("Sentiment = %q", result.Sentiment)
	}
	if result.Topic != "KORPORASI" {
		t.Fatalf("Topic = %q", result.Topic)
	}
	if len(result.Impacts) != 1 || result.Impacts[0].Symbol != "BBCA" {
		t.Fatalf("Impacts = %+v", result.Impacts)
	}
}

func TestAnalyzeFindsCompanyAliasAndNegativeSentiment(t *testing.T) {
	analyzer := NewAnalyzer([]Company{{Symbol: "TLKM", Name: "PT Telkom Indonesia (Persero) Tbk"}})
	result := analyzer.Analyze("Laba Telkom Indonesia merosot", "Pendapatan turun pada kuartal ini.")
	if result.Sentiment != "NEGATIF" {
		t.Fatalf("Sentiment = %q", result.Sentiment)
	}
	if len(result.Impacts) != 1 || result.Impacts[0].Symbol != "TLKM" {
		t.Fatalf("Impacts = %+v", result.Impacts)
	}
}

func TestAnalyzeDoesNotInventUnknownTicker(t *testing.T) {
	analyzer := NewAnalyzer([]Company{{Symbol: "BBRI", Name: "PT Bank Rakyat Indonesia Tbk"}})
	result := analyzer.Analyze("ABCD mengumumkan aksi korporasi", "")
	if len(result.Impacts) != 0 {
		t.Fatalf("Impacts = %+v", result.Impacts)
	}
}

func TestAnalyzeDoesNotTreatTitleCaseWordAsTicker(t *testing.T) {
	analyzer := NewAnalyzer([]Company{
		{Symbol: "JAWA", Name: "PT Jaya Agra Wattie Tbk"},
		{Symbol: "KOTA", Name: "PT DMS Propertindo Tbk"},
		{Symbol: "DAYA", Name: "PT Duta Intidaya Tbk"},
	})
	result := analyzer.Analyze("Pemkab di Jawa perkuat daya tarik wisata Kota Bandung", "")
	if len(result.Impacts) != 0 {
		t.Fatalf("Impacts = %+v", result.Impacts)
	}
}

func TestAnalyzeDoesNotLabelCompanyQuotedOnlyInSummary(t *testing.T) {
	analyzer := NewAnalyzer([]Company{{Symbol: "RELI", Name: "PT Reliance Sekuritas Indonesia Tbk"}})
	result := analyzer.Analyze(
		"Fundamental dinilai topang prospek Jasa Marga",
		"Direktur PT Reliance Sekuritas Indonesia Tbk (RELI) memberikan penilaian.",
	)
	if len(result.Impacts) != 0 {
		t.Fatalf("Impacts = %+v", result.Impacts)
	}
}
