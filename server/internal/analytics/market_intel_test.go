package analytics

import (
	"math"
	"testing"
)

func TestBrokerCodesByType(t *testing.T) {
	foreign := BrokerCodesByType("asing")
	if len(foreign) == 0 {
		t.Fatal("tidak ada broker asing terdaftar")
	}
	for _, c := range foreign {
		if BrokerType(c) != "asing" {
			t.Errorf("%s bukan asing tapi ikut terdaftar (%s)", c, BrokerType(c))
		}
	}
	// urut naik supaya query SQL deterministik
	for i := 1; i < len(foreign); i++ {
		if foreign[i-1] > foreign[i] {
			t.Fatalf("hasil tidak terurut: %v", foreign)
		}
	}
	if got := BrokerCodesByType("tidak-ada"); got != nil {
		t.Errorf("tipe tak dikenal seharusnya kosong, dapat %v", got)
	}
}

func TestBuildForeignRadarConsistencyAndRank(t *testing.T) {
	nets := []DayNet{
		// AAA akumulasi 3 hari berturut-turut, selalu terbesar
		{Symbol: "AAA", Date: "2026-07-01", NetVal: 100},
		{Symbol: "AAA", Date: "2026-07-02", NetVal: 90},
		{Symbol: "AAA", Date: "2026-07-03", NetVal: 80},
		// BBB akumulasi 2 hari, terputus di tengah
		{Symbol: "BBB", Date: "2026-07-01", NetVal: 50},
		{Symbol: "BBB", Date: "2026-07-02", NetVal: -20},
		{Symbol: "BBB", Date: "2026-07-03", NetVal: 40},
		// CCC hanya distribusi
		{Symbol: "CCC", Date: "2026-07-01", NetVal: -70},
		{Symbol: "CCC", Date: "2026-07-02", NetVal: -60},
	}
	closes := map[string][]ClosePoint{
		"AAA": {{Date: "2026-07-01", Close: 100}, {Date: "2026-07-03", Close: 110}},
	}
	sectors := map[string]string{"AAA": "Energi", "BBB": "Energi", "CCC": "Keuangan"}

	r := BuildForeignRadar(nets, closes, sectors, "akumulasi", "2026-07-01", "2026-07-03")

	if r.TradingDays != 3 {
		t.Errorf("tradingDays = %d, want 3", r.TradingDays)
	}
	// CCC tidak pernah akumulasi, jadi tidak boleh muncul di mode akumulasi
	if r.Detected != 2 {
		t.Errorf("detected = %d, want 2 (CCC harus tersaring)", r.Detected)
	}
	if r.Rows[0].Symbol != "AAA" {
		t.Fatalf("baris teratas = %s, want AAA", r.Rows[0].Symbol)
	}
	if r.Rows[0].Days != 3 || r.Rows[0].Streak != 3 {
		t.Errorf("AAA days/streak = %d/%d, want 3/3", r.Rows[0].Days, r.Rows[0].Streak)
	}
	if r.Rows[0].AvgRank != 1 {
		t.Errorf("AAA avgRank = %v, want 1 (selalu net beli terbesar)", r.Rows[0].AvgRank)
	}
	if !r.Rows[0].HasReturn || math.Abs(r.Rows[0].ReturnPct-10) > 1e-9 {
		t.Errorf("AAA return = %v (has=%v), want 10", r.Rows[0].ReturnPct, r.Rows[0].HasReturn)
	}
	bbb := r.Rows[1]
	if bbb.Symbol != "BBB" || bbb.Days != 2 || bbb.Streak != 1 {
		t.Errorf("BBB = %s days=%d streak=%d, want BBB/2/1", bbb.Symbol, bbb.Days, bbb.Streak)
	}
	if r.MostConsistent != "AAA" {
		t.Errorf("mostConsistent = %q, want AAA", r.MostConsistent)
	}

	// mode distribusi harus memunculkan CCC dan menyaring AAA
	d := BuildForeignRadar(nets, closes, sectors, "distribusi", "2026-07-01", "2026-07-03")
	if d.Rows[0].Symbol != "CCC" {
		t.Errorf("mode distribusi: baris teratas = %s, want CCC", d.Rows[0].Symbol)
	}
	for _, row := range d.Rows {
		if row.Symbol == "AAA" {
			t.Error("AAA tidak pernah distribusi tapi muncul di mode distribusi")
		}
	}

	// sektor: Energi = AAA(270) + BBB(70) = 340, Keuangan = -130
	var energi *SectorFlow
	for i := range r.Sectors {
		if r.Sectors[i].Sector == "Energi" {
			energi = &r.Sectors[i]
		}
	}
	if energi == nil {
		t.Fatal("sektor Energi tidak terhitung")
	}
	if energi.Symbols != 2 {
		t.Errorf("Energi symbols = %d, want 2", energi.Symbols)
	}
}

func TestBuildBrokerStockRowsFloatPL(t *testing.T) {
	dates := []string{"2026-07-01", "2026-07-02"}
	agg := []BrokerStockAgg{
		// akumulasi: beli 1000 lot @ rata-rata 1000 -> nilai 100jt
		{BrokerCode: "AK", Symbol: "AAA", BuyVal: 100_000_000, BuyLot: 1000, NDays: 2},
		// distribusi: jual 500 lot @ rata-rata 2000 -> nilai 100jt
		{BrokerCode: "YP", Symbol: "BBB", SellVal: 100_000_000, SellLot: 500, NDays: 2},
	}
	daily := []BrokerStockDay{
		{BrokerCode: "AK", Symbol: "AAA", Date: "2026-07-01", NetVal: 60_000_000},
		{BrokerCode: "AK", Symbol: "AAA", Date: "2026-07-02", NetVal: 40_000_000},
		{BrokerCode: "YP", Symbol: "BBB", Date: "2026-07-01", NetVal: -100_000_000},
	}
	lastClose := map[string]float64{"AAA": 1100, "BBB": 1800}

	rows := BuildBrokerStockRows(agg, daily, lastClose, dates)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}

	ak := rows[0]
	if math.Abs(ak.AvgPrice-1000) > 1e-9 {
		t.Errorf("AK avgPrice = %v, want 1000", ak.AvgPrice)
	}
	if !ak.HasPL || math.Abs(ak.FloatPLPct-10) > 1e-9 {
		t.Errorf("AK floatPL = %v, want +10%%", ak.FloatPLPct)
	}
	if ak.DaysNet != 2 || ak.DaysTotal != 2 {
		t.Errorf("AK konsistensi = %d/%d, want 2/2", ak.DaysNet, ak.DaysTotal)
	}
	if ak.BrokerType != "asing" {
		t.Errorf("AK type = %q, want asing", ak.BrokerType)
	}

	yp := rows[1]
	if math.Abs(yp.AvgPrice-2000) > 1e-9 {
		t.Errorf("YP avgPrice = %v, want 2000", yp.AvgPrice)
	}
	// posisi jual @2000, harga sekarang 1800 -> untung 10%
	if math.Abs(yp.FloatPLPct-10) > 1e-9 {
		t.Errorf("YP floatPL = %v, want +10%% (posisi jual untung saat harga turun)", yp.FloatPLPct)
	}
	if yp.DaysNet != 1 {
		t.Errorf("YP daysNet = %d, want 1", yp.DaysNet)
	}
	if len(yp.Heat) != len(dates) {
		t.Errorf("heat = %d sel, want %d (satu per tanggal)", len(yp.Heat), len(dates))
	}
}

func TestBuildPortfolioFlowCumulative(t *testing.T) {
	dates := []string{"2026-07-01", "2026-07-02", "2026-07-03"}
	daily := []BrokerStockDay{
		{BrokerCode: "MG", Symbol: "AAA", Date: "2026-07-01", NetVal: 10},
		{BrokerCode: "MG", Symbol: "AAA", Date: "2026-07-03", NetVal: 5},
		{BrokerCode: "MG", Symbol: "BBB", Date: "2026-07-02", NetVal: -30},
	}
	flow := BuildPortfolioFlow(daily, dates, 10)
	if len(flow) != 2 {
		t.Fatalf("series = %d, want 2", len(flow))
	}
	// diurut berdasar |net|: BBB (-30) lebih besar dari AAA (+15)
	if flow[0].Symbol != "BBB" {
		t.Errorf("urutan pertama = %s, want BBB (nilai mutlak terbesar)", flow[0].Symbol)
	}
	var aaa PortfolioSeries
	for _, s := range flow {
		if s.Symbol == "AAA" {
			aaa = s
		}
	}
	want := []float64{10, 10, 15}
	if len(aaa.Points) != 3 {
		t.Fatalf("AAA points = %d, want 3 (satu per tanggal)", len(aaa.Points))
	}
	for i, p := range aaa.Points {
		if p.CumNet != want[i] {
			t.Errorf("AAA cumNet[%d] = %v, want %v", i, p.CumNet, want[i])
		}
	}
	if aaa.NetVal != 15 {
		t.Errorf("AAA netVal = %v, want 15", aaa.NetVal)
	}

	if got := BuildPortfolioFlow(daily, dates, 1); len(got) != 1 {
		t.Errorf("topN=1 seharusnya memotong ke 1 deret, dapat %d", len(got))
	}
}

func TestBuildStockProfile(t *testing.T) {
	byDate := map[string][]BrokerDayFlow{
		"2026-07-01": {
			{Code: "AK", BuyValue: 100, BuyLot: 10}, // asing
			{Code: "YP", SellValue: 100, SellLot: 10},
		},
		"2026-07-02": {
			{Code: "AK", BuyValue: 60, BuyLot: 6},
			{Code: "YP", SellValue: 60, SellLot: 6},
		},
	}
	bars := []Bar{
		{Date: "2026-07-01", Open: 100, High: 105, Low: 95, Close: 100, Volume: 1000},
		{Date: "2026-07-02", Open: 100, High: 112, Low: 99, Close: 110, Volume: 1500},
	}
	index := []Bar{
		{Date: "2026-07-01", Close: 7000},
		{Date: "2026-07-02", Close: 7070},
	}

	p := BuildStockProfile("AAA", byDate, bars, index, "2026-07-01", "2026-07-02")

	if len(p.Dates) != 2 {
		t.Fatalf("dates = %v", p.Dates)
	}
	if p.LastClose != 110 {
		t.Errorf("lastClose = %v, want 110", p.LastClose)
	}
	// setiap kurva inventory harus punya satu titik per tanggal
	for _, inv := range p.Inventory {
		if len(inv.Points) != len(p.Dates) {
			t.Errorf("inventory %s: %d titik, want %d", inv.Code, len(inv.Points), len(p.Dates))
		}
	}
	// AK asing, net +160 sepanjang periode
	var asing *CategoryFlow
	for i := range p.Categories {
		if p.Categories[i].Key == "asing" {
			asing = &p.Categories[i]
		}
	}
	if asing == nil || asing.NetVal != 160 {
		t.Errorf("kategori asing netVal = %+v, want 160", asing)
	}
	// jendela "Periode" = total net asing
	last := p.ForeignFlow[len(p.ForeignFlow)-1]
	if last.Label != "Periode" || last.NetVal != 160 {
		t.Errorf("foreignFlow periode = %+v, want 160", last)
	}
	if len(p.FloorTop) == 0 || p.FloorTop[0].Code != "AK" {
		t.Fatalf("floorTop = %+v, want AK di puncak", p.FloorTop)
	}
	// floor = 160 / (16 lot * 100 lembar) = 0.1
	if math.Abs(p.FloorTop[0].FloorPrice-0.1) > 1e-9 {
		t.Errorf("floorPrice = %v, want 0.1", p.FloorTop[0].FloorPrice)
	}
	// saham +10%, indeks +1% -> relatif +9%
	if !p.VsIndex.Available {
		t.Fatal("vsIndex seharusnya tersedia")
	}
	if math.Abs(p.VsIndex.RelPct-9) > 1e-9 {
		t.Errorf("relPct = %v, want 9", p.VsIndex.RelPct)
	}

	// tanpa data indeks, sisanya tetap terisi
	noIdx := BuildStockProfile("AAA", byDate, bars, nil, "2026-07-01", "2026-07-02")
	if noIdx.VsIndex.Available {
		t.Error("vsIndex seharusnya unavailable tanpa bar indeks")
	}
	if len(noIdx.Categories) == 0 {
		t.Error("kategori seharusnya tetap terisi tanpa bar indeks")
	}
}

// Saham/broker tanpa data sama sekali harus tetap mengembalikan slice
// kosong, bukan nil: encoding/json menulis nil slice sebagai `null` dan
// panel yang mem-`map` hasilnya akan crash.
func TestEmptyInputsReturnEmptySlicesNotNil(t *testing.T) {
	p := BuildStockProfile("KOSONG", map[string][]BrokerDayFlow{}, nil, nil, "2026-07-01", "2026-07-02")
	if p.Dates == nil || p.Categories == nil || p.FloorTop == nil ||
		p.NetVsGross == nil || p.Inventory == nil || p.PriceLine == nil || p.ForeignFlow == nil {
		t.Errorf("StockProfile punya slice nil: %+v", p)
	}

	r := BuildForeignRadar(nil, nil, nil, "akumulasi", "2026-07-01", "2026-07-02")
	if r.Rows == nil || r.Sectors == nil || r.Dates == nil {
		t.Errorf("ForeignRadar punya slice nil: %+v", r)
	}

	rows := BuildBrokerStockRows([]BrokerStockAgg{{BrokerCode: "AK", Symbol: "AAA"}}, nil, nil, nil)
	if len(rows) != 1 || rows[0].Heat == nil {
		t.Errorf("BrokerStockRow.Heat nil: %+v", rows)
	}

	flow := BuildPortfolioFlow([]BrokerStockDay{{BrokerCode: "AK", Symbol: "AAA", Date: "2026-07-01"}}, nil, 5)
	if len(flow) != 1 || flow[0].Points == nil {
		t.Errorf("PortfolioSeries.Points nil: %+v", flow)
	}
}
