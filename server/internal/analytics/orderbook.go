// Live orderbook analysis, di-port dari analyzeBook() di bridge-extension/app.js.
// Menilai satu snapshot bid/offer terhadap histori singkat sebelumnya (jendela
// beberapa detik) untuk mendeteksi: imbalance antrean, tembok palsu (lot tebal +
// order sedikit + market sepi + level bertahan), tembok yang dicabut tanpa
// dieksekusi (spoofing terkonfirmasi), dan realisasi beli/jual per tick dari
// delta volume + klasifikasi agresor (HAKA di offer / HAKI di bid).
package analytics

import (
	"math"
	"sort"
)

// PriceLevel is one bid/offer level. Lot is in IDX lots (1 lot = 100 shares),
// matching parseOrderbook's lembar→lot conversion in app.js. JSON tags make
// this double as the live-tape wire format broadcast over WebSocket — no
// separate API-layer DTO, since the shape needs no restructuring for the
// frontend (unlike Phase/BrokerNet elsewhere in this package).
type PriceLevel struct {
	Price       float64 `json:"price"`
	Lot         float64 `json:"lot"`
	Orders      int     `json:"orders"`
	LotPerOrder float64 `json:"lotPerOrder"`
}

// OrderbookSnapshot is one polled depth snapshot for a symbol. Bid/Offer must
// be ordered best-price-first (level 1..10), matching the source API.
type OrderbookSnapshot struct {
	Symbol string       `json:"symbol"`
	Ts     int64        `json:"ts"` // unix millis
	Last   float64      `json:"last"`
	Bid    []PriceLevel `json:"bid"`
	Offer  []PriceLevel `json:"offer"`
	Value  float64      `json:"value"`  // nilai transaksi kumulatif hari itu (Rp)
	Volume float64      `json:"volume"` // volume kumulatif hari itu (lot)
	Freq   int          `json:"freq"`
}

// FakeLevel is a bid/offer level flagged as a likely fake wall.
type FakeLevel struct {
	Side        string  `json:"side"` // bid | offer
	Price       float64 `json:"price"`
	Lot         float64 `json:"lot"`
	Orders      int     `json:"orders"`
	LotPerOrder float64 `json:"lotPerOrder"`
}

// WallPull is a large level that disappeared between two snapshots without
// being executed — a confirmed spoof (order dicabut).
type WallPull struct {
	Side   string  `json:"side"`
	Price  float64 `json:"price"`
	Lot    float64 `json:"lot"`
	Orders int     `json:"orders"`
}

type BookAnalysis struct {
	TotalBid    float64     `json:"totalBid"`
	TotalOffer  float64     `json:"totalOffer"`
	Imbalance   float64     `json:"imbalance"` // -1..1, positif = bid dominan
	Fake        []FakeLevel `json:"fake"`
	Pulls       []WallPull  `json:"pulls"`
	VolMoved    float64     `json:"volMoved"`
	RealBuyLot  float64     `json:"realBuyLot"`
	RealSellLot float64     `json:"realSellLot"`
	RealBuyVal  float64     `json:"realBuyVal"`
	RealSellVal float64     `json:"realSellVal"`
	Aggressor   string      `json:"aggressor"` // BUY | SELL | ""
	MarketQuiet bool        `json:"marketQuiet"`
}

// AnalyzeBook compares snap against hist (oldest first, matching app.js's
// push/shift ring buffer) to produce imbalance, fake-wall, wall-pull, and
// realized-flow signals for one tick.
func AnalyzeBook(snap OrderbookSnapshot, hist []OrderbookSnapshot) BookAnalysis {
	var totBid, totOffer float64
	for _, l := range snap.Bid {
		totBid += l.Lot
	}
	for _, l := range snap.Offer {
		totOffer += l.Lot
	}
	imbalance := 0.0
	if totBid+totOffer > 0 {
		imbalance = (totBid - totOffer) / (totBid + totOffer)
	}

	ratios := make([]float64, 0, len(snap.Bid)+len(snap.Offer))
	for _, l := range snap.Bid {
		ratios = append(ratios, l.LotPerOrder)
	}
	for _, l := range snap.Offer {
		ratios = append(ratios, l.LotPerOrder)
	}
	sort.Float64s(ratios)
	median := 0.0
	if len(ratios) > 0 {
		median = ratios[len(ratios)/2]
	}
	thick := median * 4

	// ref = entri hist ter-baru yang sudah berjarak >=4dtk dari snap
	var ref *OrderbookSnapshot
	for i := len(hist) - 1; i >= 0; i-- {
		if snap.Ts-hist[i].Ts >= 4000 {
			ref = &hist[i]
			break
		}
	}
	pasarSepi := false
	if ref != nil {
		valMoved := snap.Value - ref.Value
		freqMoved := float64(snap.Freq - ref.Freq)
		pasarSepi = valMoved <= 0 && freqMoved <= 0
	}

	persist := func(price float64, side string) float64 {
		var recent []OrderbookSnapshot
		for _, h := range hist {
			if snap.Ts-h.Ts <= 8000 {
				recent = append(recent, h)
			}
		}
		if len(recent) < 2 {
			return 0
		}
		seen := 0
		for _, h := range recent {
			levels := h.Bid
			if side == "offer" {
				levels = h.Offer
			}
			for _, x := range levels {
				if x.Price == price {
					seen++
					break
				}
			}
		}
		return float64(seen) / float64(len(recent))
	}

	// NB: cek "lot >= totBid*0.05" memang memakai totBid untuk KEDUA sisi
	// (bid maupun offer) — perilaku asli app.js, dipertahankan apa adanya.
	flagSide := func(levels []PriceLevel, side string) []FakeLevel {
		out := []FakeLevel{}
		for _, l := range levels {
			tebal := l.LotPerOrder >= thick && l.Orders <= 10 && l.Lot >= totBid*0.05
			if tebal && pasarSepi && persist(l.Price, side) >= 0.6 {
				out = append(out, FakeLevel{Side: side, Price: l.Price, Lot: l.Lot, Orders: l.Orders, LotPerOrder: l.LotPerOrder})
			}
		}
		return out
	}
	fake := append(flagSide(snap.Bid, "bid"), flagSide(snap.Offer, "offer")...)

	var realBuyLot, realSellLot, realBuyVal, realSellVal, volMoved float64
	aggressor := ""
	pulls := []WallPull{}

	if len(hist) > 0 {
		prev := hist[len(hist)-1]

		dVol := snap.Volume - prev.Volume
		dVal := math.Max(snap.Value-prev.Value, 0)
		volMoved = dVol
		if dVol > 0 {
			bestBid := 0.0
			if len(snap.Bid) > 0 {
				bestBid = snap.Bid[0].Price
			}
			bestOffer := math.Inf(1)
			if len(snap.Offer) > 0 {
				bestOffer = snap.Offer[0].Price
			}
			var isBuy bool
			switch {
			case snap.Last >= bestOffer:
				isBuy = true
			case snap.Last <= bestBid:
				isBuy = false
			case prev.Last != 0:
				isBuy = snap.Last >= prev.Last
			default:
				isBuy = true
			}
			if isBuy {
				realBuyLot, realBuyVal, aggressor = dVol, dVal, "BUY"
			} else {
				realSellLot, realSellVal, aggressor = dVol, dVal, "SELL"
			}
		}

		if snap.Ts-prev.Ts < 4000 {
			bigWall := math.Max(totBid, totOffer) * 0.06
			check := func(prevLevels, curLevels []PriceLevel, side string) {
				curLot := make(map[float64]float64, len(curLevels))
				for _, l := range curLevels {
					curLot[l.Price] = l.Lot
				}
				for _, pl := range prevLevels {
					if pl.Lot < bigWall || pl.Lot < 200 {
						continue
					}
					nowLot := curLot[pl.Price]
					if nowLot >= pl.Lot*0.3 {
						continue
					}
					var executed bool
					if side == "bid" {
						executed = snap.Last <= pl.Price
					} else {
						executed = snap.Last >= pl.Price
					}
					if executed {
						continue
					}
					pulls = append(pulls, WallPull{Side: side, Price: pl.Price, Lot: pl.Lot - nowLot, Orders: pl.Orders})
				}
			}
			check(prev.Bid, snap.Bid, "bid")
			check(prev.Offer, snap.Offer, "offer")
		}
	}

	return BookAnalysis{
		TotalBid: totBid, TotalOffer: totOffer, Imbalance: imbalance,
		Fake: fake, Pulls: pulls, VolMoved: volMoved,
		RealBuyLot: realBuyLot, RealSellLot: realSellLot,
		RealBuyVal: realBuyVal, RealSellVal: realSellVal,
		Aggressor: aggressor, MarketQuiet: pasarSepi,
	}
}
