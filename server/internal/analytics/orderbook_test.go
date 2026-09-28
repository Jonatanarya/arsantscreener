package analytics

import "testing"

func level(price, lot float64, orders int) PriceLevel {
	return PriceLevel{Price: price, Lot: lot, Orders: orders, LotPerOrder: lot / float64(orders)}
}

func TestAnalyzeBook_Imbalance(t *testing.T) {
	snap := OrderbookSnapshot{
		Symbol: "TEST", Ts: 10000, Last: 1000,
		Bid:   []PriceLevel{level(995, 800, 40), level(990, 200, 10)},
		Offer: []PriceLevel{level(1000, 300, 15), level(1005, 100, 5)},
	}
	a := AnalyzeBook(snap, nil)
	// totBid=1000, totOffer=400 -> imbalance=(1000-400)/1400=0.4286
	if a.TotalBid != 1000 || a.TotalOffer != 400 {
		t.Fatalf("totals = %v/%v", a.TotalBid, a.TotalOffer)
	}
	want := (1000.0 - 400.0) / 1400.0
	if diff := a.Imbalance - want; diff > 1e-9 || diff < -1e-9 {
		t.Errorf("imbalance = %v, want %v", a.Imbalance, want)
	}
}

// Tembok bid tebal (lot besar, order sedikit) yang bertahan di beberapa
// snapshot terakhir SAAT pasar sepi (value/freq tidak bergerak) -> fake wall.
func TestAnalyzeBook_FakeWall(t *testing.T) {
	makeSnap := func(ts int64, value float64, freq int) OrderbookSnapshot {
		return OrderbookSnapshot{
			Symbol: "TEST", Ts: ts, Last: 1000, Value: value, Volume: 1000, Freq: freq,
			Bid: []PriceLevel{
				level(995, 5000, 2), // lot tebal, order sangat sedikit -> lotPerOrder tinggi
				level(990, 100, 20), // normal, banyak order
			},
			Offer: []PriceLevel{
				level(1000, 100, 20),
				level(1005, 100, 20),
			},
		}
	}

	// histori: value/freq TIDAK bergerak (pasar sepi), level 995 selalu ada
	hist := []OrderbookSnapshot{
		makeSnap(0, 1_000_000, 500),
		makeSnap(2000, 1_000_000, 500),
		makeSnap(5000, 1_000_000, 500),
	}
	snap := makeSnap(10000, 1_000_000, 500) // value/freq masih sama -> pasarSepi

	a := AnalyzeBook(snap, hist)
	if !a.MarketQuiet {
		t.Fatalf("expected pasarSepi=true")
	}
	found := false
	for _, f := range a.Fake {
		if f.Side == "bid" && f.Price == 995 {
			found = true
		}
	}
	if !found {
		t.Errorf("expected level 995 flagged as fake wall, got %+v", a.Fake)
	}
}

// Tembok besar di bid hilang (tanpa harga menembusnya) antar dua snapshot
// berdekatan -> terdeteksi sebagai order dicabut (spoofing).
func TestAnalyzeBook_WallPull(t *testing.T) {
	prev := OrderbookSnapshot{
		Symbol: "TEST", Ts: 1000, Last: 1000, Value: 1_000_000, Volume: 1000, Freq: 500,
		Bid:   []PriceLevel{level(995, 3000, 10), level(990, 100, 10)},
		Offer: []PriceLevel{level(1000, 100, 10)},
	}
	snap := OrderbookSnapshot{
		Symbol: "TEST", Ts: 3000, Last: 1000, Value: 1_000_000, Volume: 1000, Freq: 500,
		// level 995 hilang total, harga TIDAK turun ke/lewat 995 (last tetap 1000)
		Bid:   []PriceLevel{level(990, 100, 10)},
		Offer: []PriceLevel{level(1000, 100, 10)},
	}

	a := AnalyzeBook(snap, []OrderbookSnapshot{prev})
	if len(a.Pulls) != 1 {
		t.Fatalf("expected 1 pull, got %d: %+v", len(a.Pulls), a.Pulls)
	}
	if a.Pulls[0].Side != "bid" || a.Pulls[0].Price != 995 {
		t.Errorf("unexpected pull: %+v", a.Pulls[0])
	}
}

func TestAnalyzeBook_RealizedBuyAtOffer(t *testing.T) {
	prev := OrderbookSnapshot{
		Ts: 1000, Last: 995, Value: 1_000_000, Volume: 1000,
		Bid: []PriceLevel{level(995, 100, 5)}, Offer: []PriceLevel{level(1000, 100, 5)},
	}
	snap := OrderbookSnapshot{
		Ts: 2000, Last: 1000, Value: 1_050_000, Volume: 1050, // volume naik 50 lot
		Bid: []PriceLevel{level(995, 100, 5)}, Offer: []PriceLevel{level(1000, 90, 4)},
	}
	a := AnalyzeBook(snap, []OrderbookSnapshot{prev})
	if a.Aggressor != "BUY" {
		t.Fatalf("expected BUY aggressor, got %q", a.Aggressor)
	}
	if a.RealBuyLot != 50 {
		t.Errorf("expected realBuyLot=50, got %v", a.RealBuyLot)
	}
}

func TestAnalyzeBook_RealizedSellAtBid(t *testing.T) {
	prev := OrderbookSnapshot{
		Ts: 1000, Last: 1000, Value: 1_000_000, Volume: 1000,
		Bid: []PriceLevel{level(995, 100, 5)}, Offer: []PriceLevel{level(1000, 100, 5)},
	}
	snap := OrderbookSnapshot{
		Ts: 2000, Last: 995, Value: 1_030_000, Volume: 1030,
		Bid: []PriceLevel{level(995, 80, 4)}, Offer: []PriceLevel{level(1000, 100, 5)},
	}
	a := AnalyzeBook(snap, []OrderbookSnapshot{prev})
	if a.Aggressor != "SELL" {
		t.Fatalf("expected SELL aggressor, got %q", a.Aggressor)
	}
	if a.RealSellLot != 30 {
		t.Errorf("expected realSellLot=30, got %v", a.RealSellLot)
	}
}
