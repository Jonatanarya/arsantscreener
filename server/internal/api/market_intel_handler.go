package api

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

// defaultIntelWindowDays adalah lebar jendela bawaan untuk endpoint
// lintas-simbol. 10 hari kalender ≈ 7 hari bursa — cukup panjang untuk
// melihat rentetan akumulasi, cukup pendek supaya query tetap ringan.
const defaultIntelWindowDays = 10

// intelRange resolves from/to, defaulting `to` to the latest date that
// actually has broker data (bukan hari ini): kalau bridge belum jalan hari
// ini, memakai tanggal hari ini akan mengembalikan tabel kosong.
func intelRange(c *fiber.Ctx, db *sqlx.DB, defaultDays int) (from, to string, err error) {
	to = c.Query("to")
	if to == "" {
		latest, e := store.LatestBrokerSummaryDate(db)
		if e != nil {
			return "", "", e
		}
		if latest == "" {
			latest = time.Now().Format("2006-01-02")
		}
		to = latest
	}
	if !validDate(to) {
		return "", "", fiber.NewError(fiber.StatusBadRequest, "invalid to date")
	}
	from = c.Query("from")
	if from == "" {
		toDate, e := time.Parse("2006-01-02", to)
		if e != nil {
			return "", "", fiber.NewError(fiber.StatusBadRequest, "invalid to date")
		}
		from = toDate.AddDate(0, 0, -defaultDays).Format("2006-01-02")
	}
	if !validDate(from) {
		return "", "", fiber.NewError(fiber.StatusBadRequest, "invalid from date")
	}
	return from, to, nil
}

// ---- Foreign Radar ----

func getForeignRadarHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		from, to, err := intelRange(c, db, defaultIntelWindowDays)
		if err != nil {
			return err
		}
		mode := strings.ToLower(c.Query("mode", "akumulasi"))
		if mode != "akumulasi" && mode != "distribusi" {
			return badRequest(c, "mode harus akumulasi atau distribusi")
		}

		codes := analytics.BrokerCodesByType("asing")
		rows, err := store.GetNetByBrokerGroupDaily(db, from, to, codes)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		nets := make([]analytics.DayNet, len(rows))
		for i, r := range rows {
			nets[i] = analytics.DayNet{Symbol: r.Symbol, Date: r.DateStr(), NetVal: r.NetVal}
		}

		closeRows, err := store.GetClosesRange(db, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		closes := map[string][]analytics.ClosePoint{}
		for _, r := range closeRows {
			closes[r.Symbol] = append(closes[r.Symbol], analytics.ClosePoint{Date: r.DateStr(), Close: r.Close})
		}

		sectors, err := store.GetSectors(db)
		if err != nil {
			// sektor hanya memperkaya tampilan — radar tetap berguna tanpanya
			sectors = map[string]string{}
		}

		radar := analytics.BuildForeignRadar(nets, closes, sectors, mode, from, to)

		if limit := queryInt(c, "limit", 40); limit > 0 && len(radar.Rows) > limit {
			radar.Rows = radar.Rows[:limit]
		}
		return c.JSON(radar)
	}
}

func queryInt(c *fiber.Ctx, key string, def int) int {
	v := c.Query(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

// ---- Broker Intel: peringkat pasangan broker x saham ----

type BrokerIntelResponse struct {
	From  string                     `json:"from"`
	To    string                     `json:"to"`
	Mode  string                     `json:"mode"`
	Dates []string                   `json:"dates"`
	Rows  []analytics.BrokerStockRow `json:"rows"`
}

func getBrokerIntelHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		from, to, err := intelRange(c, db, defaultIntelWindowDays)
		if err != nil {
			return err
		}
		mode := strings.ToLower(c.Query("mode", "accum"))
		if mode != "accum" && mode != "dist" {
			return badRequest(c, "mode harus accum atau dist")
		}
		limit := queryInt(c, "limit", 40)
		symbol := strings.ToUpper(strings.TrimSpace(c.Query("symbol")))
		brokerCodes := splitCodes(c.Query("brokers"))

		agg, err := store.GetBrokerStockAgg(db, from, to, mode, brokerCodes, symbol, limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if len(agg) == 0 {
			return c.JSON(BrokerIntelResponse{From: from, To: to, Mode: mode, Rows: []analytics.BrokerStockRow{}})
		}

		aggIn := make([]analytics.BrokerStockAgg, len(agg))
		brokerSet, symbolSet := map[string]bool{}, map[string]bool{}
		for i, a := range agg {
			aggIn[i] = analytics.BrokerStockAgg{
				BrokerCode: a.BrokerCode, Symbol: a.Symbol,
				BuyVal: a.BuyVal, SellVal: a.SellVal,
				BuyLot: a.BuyLot, SellLot: a.SellLot, NDays: a.NDays,
			}
			brokerSet[a.BrokerCode] = true
			symbolSet[a.Symbol] = true
		}

		dailyRows, err := store.GetBrokerStockDaily(db, from, to, keys(brokerSet), keys(symbolSet))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		daily := make([]analytics.BrokerStockDay, 0, len(dailyRows))
		dateSet := map[string]bool{}
		for _, d := range dailyRows {
			daily = append(daily, analytics.BrokerStockDay{
				BrokerCode: d.BrokerCode, Symbol: d.Symbol, Date: d.DateStr(), NetVal: d.NetVal,
			})
			dateSet[d.DateStr()] = true
		}
		dates := keys(dateSet)
		sort.Strings(dates)

		lastClose, err := lastCloseBySymbol(db, from, to, keys(symbolSet))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		return c.JSON(BrokerIntelResponse{
			From: from, To: to, Mode: mode, Dates: dates,
			Rows: analytics.BuildBrokerStockRows(aggIn, daily, lastClose, dates),
		})
	}
}

// ---- Broker Profiler: portofolio satu/beberapa broker ----

type BrokerProfilerResponse struct {
	From      string                      `json:"from"`
	To        string                      `json:"to"`
	Brokers   []BrokerIdentity            `json:"brokers"`
	Dates     []string                    `json:"dates"`
	Flow      []analytics.PortfolioSeries `json:"flow"`
	TopBuys   []analytics.BrokerStockRow  `json:"topBuys"`
	TopSells  []analytics.BrokerStockRow  `json:"topSells"`
	TotalNet  float64                     `json:"totalNet"`
	TotalBuy  float64                     `json:"totalBuy"`
	TotalSell float64                     `json:"totalSell"`
}

type BrokerIdentity struct {
	Code string `json:"code"`
	Name string `json:"name"`
	Type string `json:"type"`
}

func getBrokerProfilerHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		from, to, err := intelRange(c, db, defaultIntelWindowDays)
		if err != nil {
			return err
		}
		codes := splitCodes(c.Query("brokers"))
		if len(codes) == 0 {
			return badRequest(c, "parameter brokers wajib diisi, mis. brokers=MG,YP")
		}
		// Batas 5 broker mengikuti panel referensi: lebih dari itu grafik
		// portfolio flow jadi tidak terbaca.
		if len(codes) > 5 {
			codes = codes[:5]
		}

		dailyRows, err := store.GetBrokerStockDaily(db, from, to, codes, nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		resp := BrokerProfilerResponse{From: from, To: to, Flow: []analytics.PortfolioSeries{}}
		for _, code := range codes {
			resp.Brokers = append(resp.Brokers, BrokerIdentity{
				Code: code, Name: analytics.BrokerName(code), Type: analytics.BrokerType(code),
			})
		}
		if len(dailyRows) == 0 {
			resp.TopBuys, resp.TopSells = []analytics.BrokerStockRow{}, []analytics.BrokerStockRow{}
			return c.JSON(resp)
		}

		daily := make([]analytics.BrokerStockDay, 0, len(dailyRows))
		dateSet, symbolSet := map[string]bool{}, map[string]bool{}
		type acc struct {
			buyVal, sellVal float64
			buyLot, sellLot int64
			days            map[string]bool
		}
		byPair := map[[2]string]*acc{}
		for _, d := range dailyRows {
			date := d.DateStr()
			daily = append(daily, analytics.BrokerStockDay{
				BrokerCode: d.BrokerCode, Symbol: d.Symbol, Date: date, NetVal: d.NetVal,
			})
			dateSet[date] = true
			symbolSet[d.Symbol] = true
			resp.TotalBuy += d.BuyVal
			resp.TotalSell += d.SellVal

			k := [2]string{d.BrokerCode, d.Symbol}
			a := byPair[k]
			if a == nil {
				a = &acc{days: map[string]bool{}}
				byPair[k] = a
			}
			a.buyVal += d.BuyVal
			a.sellVal += d.SellVal
			a.buyLot += d.BuyLot
			a.sellLot += d.SellLot
			a.days[date] = true
		}
		resp.TotalNet = resp.TotalBuy - resp.TotalSell

		dates := keys(dateSet)
		sort.Strings(dates)
		resp.Dates = dates
		resp.Flow = analytics.BuildPortfolioFlow(daily, dates, 10)

		aggIn := make([]analytics.BrokerStockAgg, 0, len(byPair))
		for k, a := range byPair {
			aggIn = append(aggIn, analytics.BrokerStockAgg{
				BrokerCode: k[0], Symbol: k[1],
				BuyVal: a.buyVal, SellVal: a.sellVal,
				BuyLot: a.buyLot, SellLot: a.sellLot, NDays: len(a.days),
			})
		}
		lastClose, err := lastCloseBySymbol(db, from, to, keys(symbolSet))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		rows := analytics.BuildBrokerStockRows(aggIn, daily, lastClose, dates)
		sort.Slice(rows, func(i, j int) bool { return rows[i].NetVal > rows[j].NetVal })

		const topN = 10
		for _, r := range rows {
			if r.NetVal > 0 && len(resp.TopBuys) < topN {
				resp.TopBuys = append(resp.TopBuys, r)
			}
		}
		for i := len(rows) - 1; i >= 0; i-- {
			if rows[i].NetVal < 0 && len(resp.TopSells) < topN {
				resp.TopSells = append(resp.TopSells, rows[i])
			}
		}
		if resp.TopBuys == nil {
			resp.TopBuys = []analytics.BrokerStockRow{}
		}
		if resp.TopSells == nil {
			resp.TopSells = []analytics.BrokerStockRow{}
		}
		return c.JSON(resp)
	}
}

// ---- Stock Profiler ----

func getStockProfileHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		from, to, err := intelRange(c, db, 90)
		if err != nil {
			return err
		}

		brokerRows, err := store.GetBrokerSummaryRange(db, symbol, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		barRows, err := store.GetBars(db, symbol, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		bars := make([]analytics.Bar, len(barRows))
		for i, r := range barRows {
			bars[i] = analytics.Bar{Date: r.DateStr(), Open: r.Open, High: r.High, Low: r.Low, Close: r.Close, Volume: r.Volume}
		}

		// IHSG dicoba dari beberapa kode karena sumber ingest berbeda
		// memakai penamaan berbeda; kalau tak satu pun ada, blok kekuatan
		// relatif ditandai unavailable dan sisanya tetap tampil.
		var indexBars []analytics.Bar
		for _, code := range []string{"COMPOSITE", "IHSG", "^JKSE"} {
			rows, err := store.GetBars(db, code, from, to)
			if err != nil || len(rows) < 2 {
				continue
			}
			indexBars = make([]analytics.Bar, len(rows))
			for i, r := range rows {
				indexBars[i] = analytics.Bar{Date: r.DateStr(), Open: r.Open, High: r.High, Low: r.Low, Close: r.Close, Volume: r.Volume}
			}
			break
		}

		profile := analytics.BuildStockProfile(symbol, reshapeBrokerRows(brokerRows), bars, indexBars, from, to)
		return c.JSON(profile)
	}
}

// ---- helpers ----

func splitCodes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, p := range parts {
		code := strings.ToUpper(strings.TrimSpace(p))
		if code == "" || seen[code] {
			continue
		}
		seen[code] = true
		out = append(out, code)
	}
	return out
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// lastCloseBySymbol returns the most recent close within the window for
// each symbol — the reference price for floating P/L on broker rows.
func lastCloseBySymbol(db *sqlx.DB, from, to string, symbols []string) (map[string]float64, error) {
	if len(symbols) == 0 {
		return map[string]float64{}, nil
	}
	rows, err := store.GetClosesRange(db, from, to)
	if err != nil {
		return nil, err
	}
	want := make(map[string]bool, len(symbols))
	for _, s := range symbols {
		want[s] = true
	}
	out := make(map[string]float64, len(symbols))
	// GetClosesRange sudah terurut menaik, jadi penulisan terakhir menang.
	for _, r := range rows {
		if want[r.Symbol] {
			out[r.Symbol] = r.Close
		}
	}
	return out, nil
}
