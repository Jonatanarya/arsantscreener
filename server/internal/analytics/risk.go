// Position sizing (aturan risiko 2%) dan ringkasan risiko portofolio
// (unrealized P&L, konsentrasi per saham/sektor), mengikuti pola dari
// referensi stockai: max 20%/saham, max 40%/sektor.
package analytics

import "sort"

const (
	MaxStockConcentration  = 0.20 // 20% dari total nilai portofolio per saham
	MaxSectorConcentration = 0.40 // 40% dari total nilai portofolio per sektor
)

type PositionSizeInput struct {
	Equity     float64 // modal/akun trading (Rp)
	RiskPct    float64 // 0..1, mis. 0.02 untuk aturan 2%
	EntryPrice float64
	StopLoss   float64
}

type PositionSizeResult struct {
	RiskAmount    float64 // Rp yang benar-benar dipertaruhkan pada jumlah lot yang disarankan
	PerShareRisk  float64 // entryPrice - stopLoss
	Lots          int64
	Shares        int64 // lots * 100
	PositionValue float64
	Error         string
}

// CalculatePositionSize menghitung jumlah lot maksimal yang boleh dibeli
// tanpa mempertaruhkan lebih dari RiskPct dari Equity, seandainya harga
// menyentuh StopLoss. 1 lot IDX = 100 lembar.
func CalculatePositionSize(in PositionSizeInput) PositionSizeResult {
	switch {
	case in.Equity <= 0:
		return PositionSizeResult{Error: "equity harus lebih besar dari 0"}
	case in.RiskPct <= 0 || in.RiskPct > 1:
		return PositionSizeResult{Error: "riskPct harus di antara 0 dan 1"}
	case in.EntryPrice <= 0:
		return PositionSizeResult{Error: "entryPrice harus lebih besar dari 0"}
	case in.StopLoss <= 0 || in.StopLoss >= in.EntryPrice:
		return PositionSizeResult{Error: "stopLoss harus lebih rendah dari entryPrice"}
	}

	riskAmount := in.Equity * in.RiskPct
	perShareRisk := in.EntryPrice - in.StopLoss
	maxShares := riskAmount / perShareRisk
	lots := int64(maxShares / 100)
	shares := lots * 100

	return PositionSizeResult{
		RiskAmount:    float64(shares) * perShareRisk,
		PerShareRisk:  perShareRisk,
		Lots:          lots,
		Shares:        shares,
		PositionValue: float64(shares) * in.EntryPrice,
	}
}

// Position is one open holding, enriched by the caller with the latest
// market price (from bars_daily) and sector (from symbols) before being
// passed to BuildPortfolioSummary.
type Position struct {
	ID           int64
	Symbol       string
	Sector       string // kosong bila belum ada data sektor untuk simbol ini
	EntryPrice   float64
	Lot          int64
	StopLoss     *float64
	CurrentPrice float64 // 0 bila belum ada data harga terkini
}

type PositionRisk struct {
	Position
	CostBasis       float64
	MarketValue     float64
	UnrealizedPL    float64
	UnrealizedPLPct float64
	RiskAmount      *float64 // nil bila posisi tidak punya stop loss
}

type ConcentrationWarning struct {
	Kind  string // "stock" | "sector"
	Key   string
	Pct   float64
	Limit float64
}

type PortfolioSummary struct {
	Positions            []PositionRisk
	TotalCostBasis       float64
	TotalMarketValue     float64
	TotalUnrealizedPL    float64
	TotalUnrealizedPLPct float64
	StockConcentration   map[string]float64
	SectorConcentration  map[string]float64
	Warnings             []ConcentrationWarning
}

// BuildPortfolioSummary computes per-position unrealized P&L and flags any
// stock/sector whose share of total market value exceeds the concentration
// limits. Concentration is measured against current market value (today's
// actual capital allocation), not cost basis.
func BuildPortfolioSummary(positions []Position) PortfolioSummary {
	summary := PortfolioSummary{
		StockConcentration:  map[string]float64{},
		SectorConcentration: map[string]float64{},
	}

	posRisks := make([]PositionRisk, 0, len(positions))
	for _, p := range positions {
		costBasis := p.EntryPrice * float64(p.Lot) * 100
		marketValue := p.CurrentPrice * float64(p.Lot) * 100
		upl := marketValue - costBasis
		uplPct := 0.0
		if costBasis > 0 {
			uplPct = upl / costBasis * 100
		}
		var riskAmount *float64
		if p.StopLoss != nil {
			ra := (p.EntryPrice - *p.StopLoss) * float64(p.Lot) * 100
			riskAmount = &ra
		}

		posRisks = append(posRisks, PositionRisk{
			Position: p, CostBasis: costBasis, MarketValue: marketValue,
			UnrealizedPL: upl, UnrealizedPLPct: uplPct, RiskAmount: riskAmount,
		})
		summary.TotalCostBasis += costBasis
		summary.TotalMarketValue += marketValue
	}
	summary.Positions = posRisks

	summary.TotalUnrealizedPL = summary.TotalMarketValue - summary.TotalCostBasis
	if summary.TotalCostBasis > 0 {
		summary.TotalUnrealizedPLPct = summary.TotalUnrealizedPL / summary.TotalCostBasis * 100
	}

	if summary.TotalMarketValue <= 0 {
		return summary
	}

	stockValue := map[string]float64{}
	sectorValue := map[string]float64{}
	for _, pr := range posRisks {
		stockValue[pr.Symbol] += pr.MarketValue
		if pr.Sector != "" {
			sectorValue[pr.Sector] += pr.MarketValue
		}
	}
	for sym, v := range stockValue {
		pct := v / summary.TotalMarketValue
		summary.StockConcentration[sym] = pct
		if pct > MaxStockConcentration {
			summary.Warnings = append(summary.Warnings, ConcentrationWarning{Kind: "stock", Key: sym, Pct: pct, Limit: MaxStockConcentration})
		}
	}
	for sec, v := range sectorValue {
		pct := v / summary.TotalMarketValue
		summary.SectorConcentration[sec] = pct
		if pct > MaxSectorConcentration {
			summary.Warnings = append(summary.Warnings, ConcentrationWarning{Kind: "sector", Key: sec, Pct: pct, Limit: MaxSectorConcentration})
		}
	}
	sort.Slice(summary.Warnings, func(i, j int) bool {
		if summary.Warnings[i].Kind != summary.Warnings[j].Kind {
			return summary.Warnings[i].Kind < summary.Warnings[j].Kind
		}
		return summary.Warnings[i].Key < summary.Warnings[j].Key
	})

	return summary
}
