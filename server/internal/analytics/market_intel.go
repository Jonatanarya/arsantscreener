// Analitik lintas-simbol: Foreign Radar (konsistensi akumulasi asing),
// Broker Intel (peringkat pasangan broker x saham), dan Broker Profiler
// (portofolio satu broker). Semua input di sini sudah ter-agregat di SQL —
// fungsi-fungsi ini murni menyusun peringkat, streak, dan P/L mengambang.
package analytics

import (
	"math"
	"sort"
)

// BrokerCodesByType lists every known broker code in the given categories.
// Foreign Radar memanggilnya dengan "asing" untuk membangun filter SQL;
// tanpa ini, klasifikasi broker akan tersebar di dua tempat.
func BrokerCodesByType(types ...string) []string {
	want := make(map[string]bool, len(types))
	for _, t := range types {
		want[t] = true
	}
	var out []string
	for code, v := range brokerDB {
		if want[v[1]] {
			out = append(out, code)
		}
	}
	sort.Strings(out)
	return out
}

// ---- Foreign Radar ----

type RadarCell struct {
	Date   string  `json:"date"`
	NetVal float64 `json:"netVal"`
	Rank   int     `json:"rank"` // peringkat hari itu; 0 = tidak searah filter
	Hit    bool    `json:"hit"`
}

type RadarRow struct {
	Symbol    string      `json:"symbol"`
	Sector    string      `json:"sector,omitempty"`
	Cells     []RadarCell `json:"cells"`
	Days      int         `json:"days"`      // hari yang searah (akumulasi/distribusi)
	TotalDays int         `json:"totalDays"` // hari perdagangan pada rentang
	Streak    int         `json:"streak"`    // rentetan terpanjang berturut-turut
	NetVal    float64     `json:"netVal"`
	AvgRank   float64     `json:"avgRank"`
	ReturnPct float64     `json:"returnPct"`
	HasReturn bool        `json:"hasReturn"`
}

type SectorFlow struct {
	Sector  string  `json:"sector"`
	NetVal  float64 `json:"netVal"`
	Symbols int     `json:"symbols"`
	// SharePct = porsi absolut sektor ini terhadap total aliran absolut,
	// dipakai untuk bar rotasi sektor.
	SharePct float64 `json:"sharePct"`
}

type ForeignRadar struct {
	From           string       `json:"from"`
	To             string       `json:"to"`
	Mode           string       `json:"mode"` // akumulasi | distribusi
	TradingDays    int          `json:"tradingDays"`
	Detected       int          `json:"detected"`
	MostConsistent string       `json:"mostConsistent,omitempty"`
	TopStreak      string       `json:"topStreak,omitempty"`
	Dates          []string     `json:"dates"`
	Rows           []RadarRow   `json:"rows"`
	Sectors        []SectorFlow `json:"sectors"`
}

// DayNet is one symbol's net value on one date (store row, decoupled).
type DayNet struct {
	Symbol string
	Date   string
	NetVal float64
}

// ClosePoint is one close in a symbol's price series, ordered ascending by
// the caller.
type ClosePoint struct {
	Date  string
	Close float64
}

// BuildForeignRadar mengubah net harian per simbol menjadi tabel
// konsistensi: berapa hari sebuah saham searah (akumulasi/distribusi),
// peringkatnya tiap hari, dan rentetan terpanjangnya. Peringkat dihitung
// per hari terhadap seluruh saham yang punya data hari itu — bukan
// terhadap kandidat yang lolos filter — supaya "#6" berarti sama di semua
// baris.
func BuildForeignRadar(nets []DayNet, closes map[string][]ClosePoint, sectors map[string]string, mode, from, to string) ForeignRadar {
	dist := mode == "distribusi"

	byDate := map[string][]DayNet{}
	for _, n := range nets {
		byDate[n.Date] = append(byDate[n.Date], n)
	}
	dates := make([]string, 0, len(byDate))
	for d := range byDate {
		dates = append(dates, d)
	}
	sort.Strings(dates)

	// rank[date][symbol] — 1 = net beli terbesar (atau net jual terbesar
	// pada mode distribusi).
	rank := map[string]map[string]int{}
	for _, d := range dates {
		day := append([]DayNet(nil), byDate[d]...)
		sort.Slice(day, func(i, j int) bool {
			if dist {
				return day[i].NetVal < day[j].NetVal
			}
			return day[i].NetVal > day[j].NetVal
		})
		m := make(map[string]int, len(day))
		for i, n := range day {
			m[n.Symbol] = i + 1
		}
		rank[d] = m
	}

	bySymbol := map[string]map[string]float64{}
	for _, n := range nets {
		if bySymbol[n.Symbol] == nil {
			bySymbol[n.Symbol] = map[string]float64{}
		}
		bySymbol[n.Symbol][n.Date] = n.NetVal
	}

	// Slice hasil selalu kosong, bukan nil — lihat catatan di BuildStockProfile.
	out := ForeignRadar{
		From: from, To: to, Mode: mode, TradingDays: len(dates), Dates: dates,
		Rows: []RadarRow{}, Sectors: []SectorFlow{},
	}
	sectorNet := map[string]float64{}
	sectorCount := map[string]map[string]bool{}

	for sym, perDate := range bySymbol {
		row := RadarRow{Symbol: sym, Sector: sectors[sym], TotalDays: len(dates), Cells: []RadarCell{}}
		var rankSum float64
		var streak, best int
		for _, d := range dates {
			v, ok := perDate[d]
			cell := RadarCell{Date: d, NetVal: v}
			hit := ok && ((dist && v < 0) || (!dist && v > 0))
			if hit {
				cell.Hit = true
				cell.Rank = rank[d][sym]
				row.Days++
				rankSum += float64(cell.Rank)
				streak++
				if streak > best {
					best = streak
				}
			} else {
				streak = 0
			}
			row.NetVal += v
			row.Cells = append(row.Cells, cell)
		}
		row.Streak = best
		if row.Days > 0 {
			row.AvgRank = rankSum / float64(row.Days)
		}
		if series, ok := closes[sym]; ok && len(series) >= 2 {
			first, last := series[0].Close, series[len(series)-1].Close
			if first > 0 {
				row.ReturnPct = (last - first) / first * 100
				row.HasReturn = true
			}
		}
		// Saham yang tak pernah searah tidak menarik bagi radar konsistensi.
		if row.Days == 0 {
			continue
		}
		out.Rows = append(out.Rows, row)

		if sec := sectors[sym]; sec != "" {
			sectorNet[sec] += row.NetVal
			if sectorCount[sec] == nil {
				sectorCount[sec] = map[string]bool{}
			}
			sectorCount[sec][sym] = true
		}
	}

	sort.Slice(out.Rows, func(i, j int) bool {
		a, b := out.Rows[i], out.Rows[j]
		if a.Days != b.Days {
			return a.Days > b.Days
		}
		if dist {
			return a.NetVal < b.NetVal
		}
		return a.NetVal > b.NetVal
	})
	out.Detected = len(out.Rows)
	if len(out.Rows) > 0 {
		out.MostConsistent = out.Rows[0].Symbol
		top := out.Rows[0]
		for _, r := range out.Rows {
			if r.Streak > top.Streak {
				top = r
			}
		}
		out.TopStreak = top.Symbol
	}

	var absTotal float64
	for _, v := range sectorNet {
		absTotal += math.Abs(v)
	}
	for sec, v := range sectorNet {
		sf := SectorFlow{Sector: sec, NetVal: v, Symbols: len(sectorCount[sec])}
		if absTotal > 0 {
			sf.SharePct = math.Abs(v) / absTotal * 100
		}
		out.Sectors = append(out.Sectors, sf)
	}
	sort.Slice(out.Sectors, func(i, j int) bool { return out.Sectors[i].NetVal > out.Sectors[j].NetVal })

	return out
}

// ---- Broker Intel / Broker Profiler ----

type HeatCell struct {
	Date   string  `json:"date"`
	NetVal float64 `json:"netVal"`
}

// BrokerStockAgg / BrokerStockDay adalah bentuk netral dari baris store,
// supaya paket analytics tidak perlu meng-import store (dan tetap bisa
// diuji tanpa database).
type BrokerStockAgg struct {
	BrokerCode string
	Symbol     string
	BuyVal     float64
	SellVal    float64
	BuyLot     int64
	SellLot    int64
	NDays      int
}

type BrokerStockDay struct {
	BrokerCode string
	Symbol     string
	Date       string
	NetVal     float64
}

type BrokerStockRow struct {
	BrokerCode string  `json:"brokerCode"`
	BrokerName string  `json:"brokerName"`
	BrokerType string  `json:"brokerType"`
	Symbol     string  `json:"symbol"`
	BuyVal     float64 `json:"buyVal"`
	SellVal    float64 `json:"sellVal"`
	NetVal     float64 `json:"netVal"`
	BuyLot     int64   `json:"buyLot"`
	SellLot    int64   `json:"sellLot"`
	NetLot     int64   `json:"netLot"`
	// AvgPrice adalah harga rata-rata pada sisi dominan: harga beli untuk
	// baris akumulasi, harga jual untuk baris distribusi.
	AvgPrice   float64    `json:"avgPrice"`
	LastClose  float64    `json:"lastClose"`
	FloatPLPct float64    `json:"floatPlPct"`
	HasPL      bool       `json:"hasPl"`
	DaysNet    int        `json:"daysNet"`
	DaysTotal  int        `json:"daysTotal"`
	Heat       []HeatCell `json:"heat"`
}

// BuildBrokerStockRows menyusun baris broker x saham lengkap dengan heatmap
// harian, konsistensi (hari searah / hari aktif), dan P/L mengambang
// terhadap harga penutupan terakhir. daily boleh kosong — heatmap dan
// konsistensi sekadar tidak terisi, baris tetap muncul.
func BuildBrokerStockRows(
	agg []BrokerStockAgg,
	daily []BrokerStockDay,
	lastClose map[string]float64,
	dates []string,
) []BrokerStockRow {
	type key struct{ b, s string }
	dailyByPair := map[key]map[string]float64{}
	for _, d := range daily {
		k := key{d.BrokerCode, d.Symbol}
		if dailyByPair[k] == nil {
			dailyByPair[k] = map[string]float64{}
		}
		dailyByPair[k][d.Date] = d.NetVal
	}

	rows := make([]BrokerStockRow, 0, len(agg))
	for _, a := range agg {
		r := BrokerStockRow{
			BrokerCode: a.BrokerCode,
			BrokerName: BrokerName(a.BrokerCode),
			BrokerType: BrokerType(a.BrokerCode),
			Symbol:     a.Symbol,
			BuyVal:     a.BuyVal,
			SellVal:    a.SellVal,
			NetVal:     a.BuyVal - a.SellVal,
			BuyLot:     a.BuyLot,
			SellLot:    a.SellLot,
			NetLot:     a.BuyLot - a.SellLot,
			DaysTotal:  a.NDays,
			Heat:       []HeatCell{},
		}
		// 1 lot IDX = 100 lembar.
		if r.NetVal >= 0 && a.BuyLot > 0 {
			r.AvgPrice = a.BuyVal / (float64(a.BuyLot) * 100)
		} else if r.NetVal < 0 && a.SellLot > 0 {
			r.AvgPrice = a.SellVal / (float64(a.SellLot) * 100)
		}
		r.LastClose = lastClose[a.Symbol]
		if r.AvgPrice > 0 && r.LastClose > 0 {
			r.HasPL = true
			if r.NetVal >= 0 {
				r.FloatPLPct = (r.LastClose - r.AvgPrice) / r.AvgPrice * 100
			} else {
				// posisi jual: untung kalau harga sekarang lebih rendah
				r.FloatPLPct = (r.AvgPrice - r.LastClose) / r.AvgPrice * 100
			}
		}

		perDate := dailyByPair[key{a.BrokerCode, a.Symbol}]
		for _, d := range dates {
			v := perDate[d]
			r.Heat = append(r.Heat, HeatCell{Date: d, NetVal: v})
			if (r.NetVal >= 0 && v > 0) || (r.NetVal < 0 && v < 0) {
				r.DaysNet++
			}
		}
		if len(dates) > 0 {
			r.DaysTotal = len(dates)
		}
		rows = append(rows, r)
	}
	return rows
}

// PortfolioPoint is one date on a broker's cumulative net curve for a stock.
type PortfolioPoint struct {
	Date   string  `json:"date"`
	CumNet float64 `json:"cumNet"`
}

type PortfolioSeries struct {
	Symbol string           `json:"symbol"`
	NetVal float64          `json:"netVal"`
	Points []PortfolioPoint `json:"points"`
}

// BuildPortfolioFlow membangun kurva net kumulatif per saham untuk broker
// terpilih — bentuk yang sama dipakai grafik inventory: yang dibaca trader
// adalah arah dan kemiringan garis, bukan angka satu hari.
func BuildPortfolioFlow(daily []BrokerStockDay, dates []string, topN int) []PortfolioSeries {
	bySymbol := map[string]map[string]float64{}
	for _, d := range daily {
		if bySymbol[d.Symbol] == nil {
			bySymbol[d.Symbol] = map[string]float64{}
		}
		bySymbol[d.Symbol][d.Date] += d.NetVal
	}

	series := make([]PortfolioSeries, 0, len(bySymbol))
	for sym, perDate := range bySymbol {
		s := PortfolioSeries{Symbol: sym, Points: []PortfolioPoint{}}
		var cum float64
		for _, d := range dates {
			cum += perDate[d]
			s.Points = append(s.Points, PortfolioPoint{Date: d, CumNet: cum})
		}
		s.NetVal = cum
		series = append(series, s)
	}
	// Urut berdasar besar mutlak: saham dengan distribusi terbesar sama
	// pentingnya dengan akumulasi terbesar.
	sort.Slice(series, func(i, j int) bool {
		return math.Abs(series[i].NetVal) > math.Abs(series[j].NetVal)
	})
	if topN > 0 && len(series) > topN {
		series = series[:topN]
	}
	return series
}
