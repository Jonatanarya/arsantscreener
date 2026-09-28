// Profil satu saham dari sisi aliran dana: net asing multi-horizon, aliran
// per kategori broker, akumulator "floor", rasio net vs gross, kurva
// inventory broker, dan kekuatan relatif terhadap IHSG.
package analytics

import (
	"math"
	"sort"
)

// Kategori broker yang dipakai panel Stock Profiler. Sengaja diturunkan
// dari klasifikasi brokerDB yang sudah ada (bukan tebakan "whale/smart
// retail" tanpa dasar data) supaya setiap angka bisa ditelusuri ke kode
// broker yang membentuknya.
var flowCategories = []struct {
	Key   string
	Label string
	Types []string
}{
	{"asing", "Asing", []string{"asing"}},
	{"institusi", "Institusi Lokal", []string{"bumn", "lokal-inst"}},
	{"smart-retail", "Ritel Online", []string{"ritel-online"}},
	{"ritel", "Ritel & Lainnya", []string{"ritel", "campuran", "lain"}},
}

type CategoryDay struct {
	Date   string  `json:"date"`
	NetVal float64 `json:"netVal"`
}

type CategoryFlow struct {
	Key      string        `json:"key"`
	Label    string        `json:"label"`
	NetVal   float64       `json:"netVal"`
	GrossVal float64       `json:"grossVal"`
	Days     []CategoryDay `json:"days"`
}

type FloorAccumulator struct {
	Code       string  `json:"code"`
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	AccumDays  int     `json:"accumDays"`
	TotalDays  int     `json:"totalDays"`
	NetVal     float64 `json:"netVal"`
	NetLot     int64   `json:"netLot"`
	FloorPrice float64 `json:"floorPrice"` // harga rata-rata beli
	VsFloorPct float64 `json:"vsFloorPct"` // posisi harga terakhir vs floor
	HasFloor   bool    `json:"hasFloor"`
}

type NetVsGross struct {
	Code   string  `json:"code"`
	Name   string  `json:"name"`
	Side   string  `json:"side"` // buy | sell
	NetVal float64 `json:"netVal"`
	GrossV float64 `json:"grossVal"`
	NetPct float64 `json:"netPct"` // |net| / gross * 100 — "konviksi arah"
}

type InventoryPoint struct {
	Date   string  `json:"date"`
	CumNet float64 `json:"cumNet"`
}

type InventorySeries struct {
	Code   string           `json:"code"`
	Name   string           `json:"name"`
	Type   string           `json:"type"`
	Side   string           `json:"side"` // buy | sell
	NetVal float64          `json:"netVal"`
	Points []InventoryPoint `json:"points"`
}

type ForeignFlowWindow struct {
	Label  string  `json:"label"`
	Days   int     `json:"days"`
	NetVal float64 `json:"netVal"`
	OK     bool    `json:"ok"`
}

type RelativeStrength struct {
	StockPct  float64 `json:"stockPct"`
	IndexPct  float64 `json:"indexPct"`
	RelPct    float64 `json:"relPct"`
	Available bool    `json:"available"`
}

type StockProfile struct {
	Symbol      string              `json:"symbol"`
	From        string              `json:"from"`
	To          string              `json:"to"`
	Dates       []string            `json:"dates"`
	LastClose   float64             `json:"lastClose"`
	ForeignFlow []ForeignFlowWindow `json:"foreignFlow"`
	Categories  []CategoryFlow      `json:"categories"`
	FloorTop    []FloorAccumulator  `json:"floorTop"`
	NetVsGross  []NetVsGross        `json:"netVsGross"`
	Inventory   []InventorySeries   `json:"inventory"`
	PriceLine   []InventoryPoint    `json:"priceLine"` // Date + close (CumNet dipakai sebagai harga)
	VsIndex     RelativeStrength    `json:"vsIndex"`
	TotalValue  float64             `json:"totalValue"`
}

// BuildStockProfile menyusun seluruh blok Stock Profiler dari broker
// summary harian satu saham (byDate: tanggal -> flow per broker, bentuk
// yang sama dipakai DetectPhases) plus deret bar harian saham dan indeks.
// IHSG boleh nil — bagian kekuatan relatif tinggal ditandai unavailable.
func BuildStockProfile(symbol string, byDate map[string][]BrokerDayFlow, bars []Bar, indexBars []Bar, from, to string) StockProfile {
	// Setiap slice diinisialisasi kosong, bukan dibiarkan nil: encoding/json
	// menulis nil slice sebagai `null`, dan panel yang mem-`map` hasilnya
	// akan crash untuk saham yang belum punya data broker sama sekali.
	p := StockProfile{
		Symbol: symbol, From: from, To: to,
		Dates:       []string{},
		ForeignFlow: []ForeignFlowWindow{},
		Categories:  []CategoryFlow{},
		FloorTop:    []FloorAccumulator{},
		NetVsGross:  []NetVsGross{},
		Inventory:   []InventorySeries{},
		PriceLine:   []InventoryPoint{},
	}

	dates := make([]string, 0, len(byDate))
	for d := range byDate {
		dates = append(dates, d)
	}
	sort.Strings(dates)
	p.Dates = dates

	if len(bars) > 0 {
		p.LastClose = bars[len(bars)-1].Close
	}
	for _, b := range bars {
		p.PriceLine = append(p.PriceLine, InventoryPoint{Date: b.Date, CumNet: b.Close})
	}

	// ---- aliran per kategori broker ----
	typeToCat := map[string]int{}
	for i, c := range flowCategories {
		for _, t := range c.Types {
			typeToCat[t] = i
		}
	}
	cats := make([]CategoryFlow, len(flowCategories))
	for i, c := range flowCategories {
		cats[i] = CategoryFlow{Key: c.Key, Label: c.Label, Days: []CategoryDay{}}
	}

	// ---- akumulasi per broker sepanjang rentang ----
	type brokerAcc struct {
		buyVal, sellVal float64
		buyLot, sellLot int64
		accumDays       int
		cum             float64
		points          []InventoryPoint
	}
	brokers := map[string]*brokerAcc{}
	newAcc := func() *brokerAcc { return &brokerAcc{points: []InventoryPoint{}} }
	// Semua broker didaftarkan lebih dulu supaya tiap kurva inventory punya
	// satu titik per tanggal — garis dengan panjang berbeda tidak bisa
	// ditumpuk pada sumbu x yang sama di frontend.
	for _, flows := range byDate {
		for _, f := range flows {
			if brokers[f.Code] == nil {
				brokers[f.Code] = newAcc()
			}
		}
	}

	// net asing harian, untuk jendela 20D / seluruh periode
	foreignDaily := make([]CategoryDay, 0, len(dates))

	for _, d := range dates {
		catNet := make([]float64, len(flowCategories))
		var foreignNet float64
		for _, f := range byDate[d] {
			net := f.BuyValue - f.SellValue
			p.TotalValue += f.BuyValue + f.SellValue

			bt := BrokerType(f.Code)
			if ci, ok := typeToCat[bt]; ok {
				catNet[ci] += net
				cats[ci].NetVal += net
				cats[ci].GrossVal += f.BuyValue + f.SellValue
			}
			if bt == "asing" {
				foreignNet += net
			}

			b := brokers[f.Code]
			b.buyVal += f.BuyValue
			b.sellVal += f.SellValue
			b.buyLot += f.BuyLot
			b.sellLot += f.SellLot
			if net > 0 {
				b.accumDays++
			}
		}
		for i := range cats {
			cats[i].Days = append(cats[i].Days, CategoryDay{Date: d, NetVal: catNet[i]})
		}
		foreignDaily = append(foreignDaily, CategoryDay{Date: d, NetVal: foreignNet})

		// kurva inventory: kumulatif per broker, tetap terisi 0 pada hari
		// broker tidak transaksi supaya seluruh garis punya sumbu x sama
		for code, b := range brokers {
			var todayNet float64
			for _, f := range byDate[d] {
				if f.Code == code {
					todayNet = f.BuyValue - f.SellValue
					break
				}
			}
			b.cum += todayNet
			b.points = append(b.points, InventoryPoint{Date: d, CumNet: b.cum})
		}
	}
	p.Categories = cats

	// ---- net asing multi-horizon ----
	sumLast := func(n int) (float64, bool) {
		if len(foreignDaily) == 0 {
			return 0, false
		}
		start := len(foreignDaily) - n
		if start < 0 {
			start = 0
		}
		var s float64
		for _, d := range foreignDaily[start:] {
			s += d.NetVal
		}
		return s, true
	}
	for _, w := range []struct {
		label string
		n     int
	}{{"5D", 5}, {"20D", 20}, {"Periode", len(foreignDaily)}} {
		v, ok := sumLast(w.n)
		p.ForeignFlow = append(p.ForeignFlow, ForeignFlowWindow{Label: w.label, Days: w.n, NetVal: v, OK: ok})
	}

	// ---- floor accumulator + net vs gross + inventory ----
	type entry struct {
		code string
		acc  *brokerAcc
	}
	list := make([]entry, 0, len(brokers))
	for code, b := range brokers {
		list = append(list, entry{code, b})
	}
	sort.Slice(list, func(i, j int) bool {
		return math.Abs(list[i].acc.buyVal-list[i].acc.sellVal) > math.Abs(list[j].acc.buyVal-list[j].acc.sellVal)
	})

	for _, e := range list {
		net := e.acc.buyVal - e.acc.sellVal
		side := "buy"
		if net < 0 {
			side = "sell"
		}
		gross := e.acc.buyVal + e.acc.sellVal
		if gross > 0 && len(p.NetVsGross) < 8 {
			p.NetVsGross = append(p.NetVsGross, NetVsGross{
				Code: e.code, Name: BrokerName(e.code), Side: side,
				NetVal: net, GrossV: gross, NetPct: math.Abs(net) / gross * 100,
			})
		}
		if len(p.Inventory) < 100 {
			p.Inventory = append(p.Inventory, InventorySeries{
				Code: e.code, Name: BrokerName(e.code), Type: BrokerType(e.code),
				Side: side, NetVal: net, Points: e.acc.points,
			})
		}
	}

	floors := make([]FloorAccumulator, 0, len(list))
	for _, e := range list {
		net := e.acc.buyVal - e.acc.sellVal
		if net <= 0 {
			continue
		}
		fa := FloorAccumulator{
			Code: e.code, Name: BrokerName(e.code), Type: BrokerType(e.code),
			AccumDays: e.acc.accumDays, TotalDays: len(dates),
			NetVal: net, NetLot: e.acc.buyLot - e.acc.sellLot,
		}
		if e.acc.buyLot > 0 {
			fa.FloorPrice = e.acc.buyVal / (float64(e.acc.buyLot) * 100)
			fa.HasFloor = true
			if p.LastClose > 0 && fa.FloorPrice > 0 {
				fa.VsFloorPct = (p.LastClose - fa.FloorPrice) / fa.FloorPrice * 100
			}
		}
		floors = append(floors, fa)
	}
	sort.Slice(floors, func(i, j int) bool {
		if floors[i].AccumDays != floors[j].AccumDays {
			return floors[i].AccumDays > floors[j].AccumDays
		}
		return floors[i].NetVal > floors[j].NetVal
	})
	if len(floors) > 6 {
		floors = floors[:6]
	}
	p.FloorTop = floors

	p.VsIndex = relativeStrength(bars, indexBars)
	return p
}

func pctChange(bars []Bar) (float64, bool) {
	if len(bars) < 2 {
		return 0, false
	}
	first, last := bars[0].Close, bars[len(bars)-1].Close
	if first <= 0 {
		return 0, false
	}
	return (last - first) / first * 100, true
}

func relativeStrength(bars, indexBars []Bar) RelativeStrength {
	s, okS := pctChange(bars)
	i, okI := pctChange(indexBars)
	if !okS || !okI {
		return RelativeStrength{StockPct: s, IndexPct: i}
	}
	return RelativeStrength{StockPct: s, IndexPct: i, RelPct: s - i, Available: true}
}
