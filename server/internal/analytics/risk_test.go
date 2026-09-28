package analytics

import "testing"

func TestCalculatePositionSize_Standard(t *testing.T) {
	res := CalculatePositionSize(PositionSizeInput{
		Equity: 100_000_000, RiskPct: 0.02, EntryPrice: 1000, StopLoss: 950,
	})
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	// riskAmount budget = 2,000,000; perShareRisk = 50 -> maxShares = 40,000 -> 400 lot
	if res.Lots != 400 {
		t.Errorf("lots = %d, want 400", res.Lots)
	}
	if res.Shares != 40_000 {
		t.Errorf("shares = %d, want 40000", res.Shares)
	}
	if res.RiskAmount != 2_000_000 {
		t.Errorf("riskAmount = %v, want 2000000", res.RiskAmount)
	}
	if res.PositionValue != 40_000_000 {
		t.Errorf("positionValue = %v, want 40000000", res.PositionValue)
	}
}

func TestCalculatePositionSize_RoundsDownToWholeLots(t *testing.T) {
	// riskAmount budget = 1,000,000; perShareRisk = 30 -> maxShares = 33,333.33
	// -> 333 lot (33,300 shares), bukan dibulatkan ke atas
	res := CalculatePositionSize(PositionSizeInput{
		Equity: 50_000_000, RiskPct: 0.02, EntryPrice: 500, StopLoss: 470,
	})
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if res.Lots != 333 {
		t.Errorf("lots = %d, want 333", res.Lots)
	}
	if res.Shares != 33_300 {
		t.Errorf("shares = %d, want 33300", res.Shares)
	}
}

func TestCalculatePositionSize_Validation(t *testing.T) {
	cases := []PositionSizeInput{
		{Equity: 0, RiskPct: 0.02, EntryPrice: 1000, StopLoss: 950},
		{Equity: 1000, RiskPct: 0, EntryPrice: 1000, StopLoss: 950},
		{Equity: 1000, RiskPct: 1.5, EntryPrice: 1000, StopLoss: 950},
		{Equity: 1000, RiskPct: 0.02, EntryPrice: 0, StopLoss: 950},
		{Equity: 1000, RiskPct: 0.02, EntryPrice: 1000, StopLoss: 1000},
		{Equity: 1000, RiskPct: 0.02, EntryPrice: 1000, StopLoss: 1100},
	}
	for i, c := range cases {
		res := CalculatePositionSize(c)
		if res.Error == "" {
			t.Errorf("case %d: expected error, got none (%+v)", i, res)
		}
	}
}

func TestBuildPortfolioSummary_PLAndTotals(t *testing.T) {
	sl := 900.0
	positions := []Position{
		{ID: 1, Symbol: "AAA", Sector: "Perbankan", EntryPrice: 1000, Lot: 10, StopLoss: &sl, CurrentPrice: 1100}, // untung
		{ID: 2, Symbol: "BBB", Sector: "Energi", EntryPrice: 500, Lot: 20, CurrentPrice: 450},                     // rugi
	}
	s := BuildPortfolioSummary(positions)

	// AAA: cost=1000*10*100=1,000,000; market=1100*10*100=1,100,000; upl=+100,000
	// BBB: cost=500*20*100=1,000,000; market=450*20*100=900,000; upl=-100,000
	if s.TotalCostBasis != 2_000_000 {
		t.Errorf("totalCostBasis = %v, want 2000000", s.TotalCostBasis)
	}
	if s.TotalMarketValue != 2_000_000 {
		t.Errorf("totalMarketValue = %v, want 2000000", s.TotalMarketValue)
	}
	if s.TotalUnrealizedPL != 0 {
		t.Errorf("totalUnrealizedPL = %v, want 0 (gain offsets loss)", s.TotalUnrealizedPL)
	}
	if len(s.Positions) != 2 {
		t.Fatalf("expected 2 position rows, got %d", len(s.Positions))
	}
	var aaa PositionRisk
	for _, p := range s.Positions {
		if p.Symbol == "AAA" {
			aaa = p
		}
	}
	if aaa.UnrealizedPL != 100_000 {
		t.Errorf("AAA unrealizedPL = %v, want 100000", aaa.UnrealizedPL)
	}
	if aaa.RiskAmount == nil || *aaa.RiskAmount != 100_000 {
		t.Errorf("AAA riskAmount = %v, want 100000", aaa.RiskAmount)
	}
}

func TestBuildPortfolioSummary_ConcentrationWarnings(t *testing.T) {
	// AAA sendirian = 70% dari total market value -> harus melewati ambang
	// 20%/saham DAN sektornya (Perbankan) juga melewati 40%/sektor.
	positions := []Position{
		{ID: 1, Symbol: "AAA", Sector: "Perbankan", EntryPrice: 1000, Lot: 70, CurrentPrice: 1000},
		{ID: 2, Symbol: "BBB", Sector: "Energi", EntryPrice: 1000, Lot: 30, CurrentPrice: 1000},
	}
	s := BuildPortfolioSummary(positions)

	if s.StockConcentration["AAA"] < 0.69 || s.StockConcentration["AAA"] > 0.71 {
		t.Errorf("AAA concentration = %v, want ~0.70", s.StockConcentration["AAA"])
	}

	foundStock, foundSector := false, false
	for _, w := range s.Warnings {
		if w.Kind == "stock" && w.Key == "AAA" {
			foundStock = true
		}
		if w.Kind == "sector" && w.Key == "Perbankan" {
			foundSector = true
		}
	}
	if !foundStock {
		t.Errorf("expected stock concentration warning for AAA, got %+v", s.Warnings)
	}
	if !foundSector {
		t.Errorf("expected sector concentration warning for Perbankan, got %+v", s.Warnings)
	}
}

func TestBuildPortfolioSummary_NoWarningsWhenBalanced(t *testing.T) {
	positions := []Position{
		{ID: 1, Symbol: "AAA", Sector: "Perbankan", EntryPrice: 1000, Lot: 10, CurrentPrice: 1000},
		{ID: 2, Symbol: "BBB", Sector: "Energi", EntryPrice: 1000, Lot: 10, CurrentPrice: 1000},
		{ID: 3, Symbol: "CCC", Sector: "Konsumer", EntryPrice: 1000, Lot: 10, CurrentPrice: 1000},
		{ID: 4, Symbol: "DDD", Sector: "Telekomunikasi", EntryPrice: 1000, Lot: 10, CurrentPrice: 1000},
		{ID: 5, Symbol: "EEE", Sector: "Properti", EntryPrice: 1000, Lot: 10, CurrentPrice: 1000},
	}
	s := BuildPortfolioSummary(positions)
	if len(s.Warnings) != 0 {
		t.Errorf("expected no warnings for 5 equal-weight positions across sectors, got %+v", s.Warnings)
	}
}
