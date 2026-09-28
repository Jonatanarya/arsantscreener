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

// zona WIB — trade_date diturunkan dari ts millis memakai jam bursa Jakarta,
// bukan timezone server, supaya print jam 07:00 UTC (14:00 WIB) tidak
// pernah tergeser ke tanggal yang salah.
var wib = time.FixedZone("WIB", 7*3600)

var validDirections = map[string]bool{"buy": true, "sell": true, "unknown": true}

func ingestTradesHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestTradesRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		if len(req.Trades) == 0 {
			return c.SendStatus(fiber.StatusNoContent)
		}

		rows := make([]store.TradeInput, 0, len(req.Trades))
		for _, t := range req.Trades {
			if t.Ts <= 0 || t.Price <= 0 || t.Lot <= 0 {
				continue // print kosong/aneh dibuang diam-diam, bukan gagal total
			}
			dir := t.Direction
			if !validDirections[dir] {
				dir = "unknown"
			}
			row := store.TradeInput{
				Symbol: symbol, TradeDate: time.UnixMilli(t.Ts).In(wib).Format("2006-01-02"),
				Ts: t.Ts, Price: t.Price, Lot: int64(t.Lot), Freq: int(t.Freq), Direction: dir,
			}
			if b := strings.ToUpper(strings.TrimSpace(t.BuyerBroker)); b != "" {
				row.BuyerBroker = &b
			}
			if s := strings.ToUpper(strings.TrimSpace(t.SellerBroker)); s != "" {
				row.SellerBroker = &s
			}
			if id := strings.TrimSpace(t.ExtTradeID); id != "" {
				row.ExtTradeID = &id
			}
			rows = append(rows, row)
		}
		if err := store.EnsureSymbol(db, symbol); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if err := store.InsertTrades(db, rows); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func ingestBrokerRangeHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestBrokerRangeRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		if !validDate(req.From) || !validDate(req.To) {
			return badRequest(c, "invalid from/to date")
		}

		rows := make([]store.BrokerRangeAggInput, 0, len(req.Buyers)+len(req.Sellers))
		add := func(side string, list []IngestBrokerRow) {
			for _, b := range list {
				if b.BrokerCode == "" {
					continue
				}
				rows = append(rows, store.BrokerRangeAggInput{
					Symbol: symbol, FromDate: req.From, ToDate: req.To,
					BrokerCode: b.BrokerCode, Side: side,
					Value: b.Value, Lot: int64(b.Lot), Freq: int(b.Freq),
					InvestorType: b.InvestorType,
				})
			}
		}
		add("buy", req.Buyers)
		add("sell", req.Sellers)

		if err := store.EnsureSymbol(db, symbol); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if err := store.UpsertBrokerRangeAgg(db, rows); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func ingestNewsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestNewsRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		rows := make([]store.NewsInput, 0, len(req.Items))
		for _, it := range req.Items {
			if strings.TrimSpace(it.ExtID) == "" || strings.TrimSpace(it.Title) == "" {
				continue
			}
			n := store.NewsInput{ExtID: it.ExtID, Title: strings.TrimSpace(it.Title)}
			if s := strings.ToUpper(strings.TrimSpace(it.Symbol)); s != "" {
				n.Symbol = &s
			}
			if it.URL != "" {
				u := it.URL
				n.URL = &u
			}
			if it.Source != "" {
				s := it.Source
				n.Source = &s
			}
			if it.PostedAt != "" {
				if t, err := time.Parse(time.RFC3339, it.PostedAt); err == nil {
					n.PostedAt = &t
				}
			}
			rows = append(rows, n)
		}
		if err := store.UpsertNews(db, rows); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func toPressureResponse(p analytics.TradePressure) *TradePressureResponse {
	return &TradePressureResponse{
		BuyLot: p.BuyLot, SellLot: p.SellLot, UnknownLot: p.UnknownLot,
		BuyVal: p.BuyVal, SellVal: p.SellVal, VWAP: p.VWAP,
		NPrints: p.NPrints, BigPrints: p.BigPrints, BigLotMin: p.BigLotMin,
	}
}

func toTopBrokerResponses(rows []store.TopBuyerSeller) []TopBrokerResponse {
	out := make([]TopBrokerResponse, len(rows))
	for i, r := range rows {
		out[i] = TopBrokerResponse{Code: r.Code, Name: analytics.BrokerName(r.Code), Val: r.Val, N: r.N}
	}
	return out
}

func toTradePrints(rows []store.TradeRow) []analytics.TradePrint {
	out := make([]analytics.TradePrint, len(rows))
	for i, r := range rows {
		out[i] = analytics.TradePrint{Ts: r.Ts, Price: r.Price, Lot: r.Lot, Direction: r.Direction}
	}
	return out
}

func getTradesHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		date := c.Query("date")
		if date == "" {
			latest, err := store.LatestTradeDate(db, symbol)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
			}
			if latest == "" {
				return c.JSON(TradesResponse{Symbol: symbol, Date: "", Prints: []TradePrintResponse{}})
			}
			date = latest
		}
		if !validDate(date) {
			return badRequest(c, "invalid date")
		}
		limit := 0
		if v := c.Query("limit"); v != "" {
			if strings.EqualFold(v, "all") {
				limit = 0
			} else {
				n, err := strconv.Atoi(v)
				if err != nil || n < 0 || n > 50000 {
					return badRequest(c, "limit must be 0..50000 (0 for all trades)")
				}
				limit = n
			}
		}

		display, err := store.GetTrades(db, symbol, date, limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		all, err := store.GetTradesAll(db, symbol, date)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		prints := make([]TradePrintResponse, len(display))
		for i, r := range display {
			p := TradePrintResponse{Ts: r.Ts, Price: r.Price, Lot: r.Lot, Freq: r.Freq, Direction: r.Direction, Market: "RG"}
			if r.BuyerBroker != nil {
				p.BuyerBroker = *r.BuyerBroker
			}
			if r.SellerBroker != nil {
				p.SellerBroker = *r.SellerBroker
			}
			if r.ExtTradeID != nil {
				p.ExtTradeID = *r.ExtTradeID
			}
			prints[i] = p
		}
		resp := TradesResponse{Symbol: symbol, Date: date, Prints: prints}
		if availableDates, err := store.AvailableTradeDates(db, symbol); err == nil {
			resp.AvailableDates = availableDates
		}
		if len(all) > 0 {
			resp.Pressure = toPressureResponse(analytics.AnalyzeTradePressure(toTradePrints(all)))
		}

		if topBuyers, err := store.TopBuyers(db, symbol, date, 5); err == nil {
			resp.TopBuyers = toTopBrokerResponses(topBuyers)
		}
		if topSellers, err := store.TopSellers(db, symbol, date, 5); err == nil {
			resp.TopSellers = toTopBrokerResponses(topSellers)
		}
		return c.JSON(resp)
	}
}

// buildBrokerAnalysis is shared between the broker-analysis endpoint and the
// decision endpoint. Prefers per-day broker_summary (granularity "harian");
// falls back to the scan's stored range aggregate ("agregat").
func buildBrokerAnalysis(db *sqlx.DB, symbol, from, to string) (BrokerAnalysisResponse, error) {
	resp := BrokerAnalysisResponse{Symbol: symbol, From: from, To: to, Brokers: []BrokerFlow{}}

	type acc struct {
		buyVal, sellVal float64
		buyLot, sellLot int64
		freq            int
		investorType    string
	}
	byBroker := map[string]*acc{}

	dayRows, err := store.GetBrokerSummaryAggregate(db, symbol, from, to)
	if err != nil {
		return resp, err
	}
	if len(dayRows) > 0 {
		resp.Granularity = "harian"
		for _, r := range dayRows {
			a := byBroker[r.BrokerCode]
			if a == nil {
				a = &acc{}
				byBroker[r.BrokerCode] = a
			}
			// Domisili aliran dana: kalau antar-baris berbeda, tandai campuran.
			if r.InvestorType != "" {
				if a.investorType == "" {
					a.investorType = r.InvestorType
				} else if a.investorType != r.InvestorType {
					a.investorType = "Campuran"
				}
			}
			if r.Side == "buy" {
				a.buyVal += r.Value
				a.buyLot += r.Lot
			} else {
				a.sellVal += r.Value
				a.sellLot += r.Lot
			}
			a.freq += r.Freq
		}
	} else {
		aggRows, err := store.GetLatestBrokerRangeAgg(db, symbol)
		if err != nil {
			return resp, err
		}
		if len(aggRows) == 0 {
			resp.Error = "belum ada data broker untuk simbol ini — jalankan Analisa 1 Saham atau Scan di extension"
			return resp, nil
		}
		resp.Granularity = "agregat"
		resp.From, resp.To = aggRows[0].FromDate, aggRows[0].ToDate
		for _, r := range aggRows {
			a := byBroker[r.BrokerCode]
			if a == nil {
				a = &acc{}
				byBroker[r.BrokerCode] = a
			}
			if r.Side == "buy" {
				a.buyVal += r.Value
				a.buyLot += r.Lot
			} else {
				a.sellVal += r.Value
				a.sellLot += r.Lot
			}
			a.freq += r.Freq
		}
	}

	var totalVal, smartNet float64
	for code, a := range byBroker {
		f := BrokerFlow{
			Code: code, Name: analytics.BrokerName(code), Type: analytics.BrokerType(code),
			BuyVal: a.buyVal, SellVal: a.sellVal, NetVal: a.buyVal - a.sellVal,
			BuyLot: a.buyLot, SellLot: a.sellLot, Freq: a.freq,
			InvestorType: a.investorType,
		}
		if a.buyLot > 0 {
			f.AvgBuyPrice = a.buyVal / (float64(a.buyLot) * 100)
		}
		if a.sellLot > 0 {
			f.AvgSellPrice = a.sellVal / (float64(a.sellLot) * 100)
		}
		totalVal += (a.buyVal + a.sellVal) / 2
		if analytics.IsSmartBroker(code) {
			smartNet += f.NetVal
		}
		resp.Brokers = append(resp.Brokers, f)
	}
	sort.Slice(resp.Brokers, func(i, j int) bool { return resp.Brokers[i].NetVal > resp.Brokers[j].NetVal })

	resp.TotalValue = totalVal
	resp.SmartNetValue = smartNet
	if totalVal > 0 {
		resp.SmartSharePct = smartNet / totalVal * 100
	}
	var accumTotal, top3 float64
	for i, b := range resp.Brokers {
		if b.NetVal > 0 {
			accumTotal += b.NetVal
			if i < 3 {
				top3 += b.NetVal
			}
		}
	}
	if accumTotal > 0 {
		resp.Top3AccumPct = top3 / accumTotal * 100
	}
	return resp, nil
}

func getBrokerAnalysisHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		to := c.Query("to", time.Now().Format("2006-01-02"))
		from := c.Query("from", "")
		if from == "" {
			toDate, err := time.Parse("2006-01-02", to)
			if err != nil {
				return badRequest(c, "invalid to date")
			}
			from = toDate.AddDate(0, -3, 0).Format("2006-01-02")
		}
		if !validDate(from) || !validDate(to) {
			return badRequest(c, "invalid from/to date")
		}
		resp, err := buildBrokerAnalysis(db, symbol, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(resp)
	}
}

func listNewsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Query("symbol")))
		limit := 50
		if v := c.Query("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > 200 {
				return badRequest(c, "limit must be 1..200")
			}
			limit = n
		}
		rows, err := store.ListNews(db, symbol, limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		out := make([]NewsItemResponse, len(rows))
		for i, r := range rows {
			it := NewsItemResponse{
				ID: r.ID, Title: r.Title, Topic: r.Topic, Sentiment: r.Sentiment,
				Impacts: make([]NewsImpactResponse, 0, len(r.Impacts)),
			}
			if r.Summary != nil {
				it.Summary = *r.Summary
			}
			if r.Symbol != nil {
				it.Symbol = *r.Symbol
			}
			if r.URL != nil {
				it.URL = *r.URL
			}
			if r.Source != nil {
				it.Source = *r.Source
			}
			if r.PostedAt != nil {
				it.PostedAt = r.PostedAt.Format(time.RFC3339)
			} else {
				it.PostedAt = r.CreatedAt.Format(time.RFC3339)
			}
			for _, impact := range r.Impacts {
				mapped := NewsImpactResponse{Symbol: impact.Symbol, Sentiment: impact.Sentiment, Confidence: impact.Confidence}
				if impact.Reason != nil {
					mapped.Reason = *impact.Reason
				}
				it.Impacts = append(it.Impacts, mapped)
			}
			out[i] = it
		}
		return c.JSON(out)
	}
}

func getDecisionHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		to := c.Query("to", time.Now().Format("2006-01-02"))
		from := c.Query("from", "")
		if from == "" {
			toDate, err := time.Parse("2006-01-02", to)
			if err != nil {
				return badRequest(c, "invalid to date")
			}
			from = toDate.AddDate(0, -6, 0).Format("2006-01-02")
		}
		if !validDate(from) || !validDate(to) {
			return badRequest(c, "invalid from/to date")
		}

		dec, err := computeDecision(db, symbol, from, to)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		resp := DecisionResponse{
			Symbol: symbol, Verdict: dec.Verdict, Score: dec.Score,
			Signals: make([]DecisionSignalResponse, len(dec.Signals)),
			From:    from, To: to,
			Quality: DecisionQualityResponse{Eligible: dec.Quality.Eligible, Reasons: dec.Quality.Reasons, AverageTurnover: dec.Quality.AverageTurnover, ActiveSessions: dec.Quality.ActiveSessions, HistoryDays: dec.Quality.HistoryDays, Confidence: dec.Quality.Confidence, DataSources: dec.Quality.DataSources},
		}
		for i, s := range dec.Signals {
			resp.Signals[i] = DecisionSignalResponse{Source: s.Source, Text: s.Text, Points: s.Points}
		}
		if dec.Plan != nil {
			resp.Plan = &TradePlanResponse{
				Entry: dec.Plan.Entry, StopLoss: dec.Plan.StopLoss, TakeProfit: dec.Plan.TakeProfit,
				ATR: dec.Plan.ATR, RiskReward: dec.Plan.RiskReward,
			}
		}
		return c.JSON(resp)
	}
}

// computeDecision holds the actual "merge every lens into one verdict"
// pipeline, shared by /decision/:symbol and the AI outlook handler so
// there is exactly one place that builds a Decision — see
// analytics.BuildDecision doc comment: it must stay the single source of
// truth for action recommendations, not be reimplemented per caller.
func computeDecision(db *sqlx.DB, symbol, from, to string) (analytics.Decision, error) {
	// 1) bars + fase + PVA -> Outlook (pola sama dengan /outlook)
	barRows, err := store.GetBars(db, symbol, from, to)
	if err != nil {
		return analytics.Decision{}, err
	}
	bars := make([]analytics.Bar, len(barRows))
	for i, r := range barRows {
		bars[i] = analytics.Bar{Date: r.DateStr(), Open: r.Open, High: r.High, Low: r.Low, Close: r.Close, Volume: r.Volume}
	}
	var phasePtr *analytics.Phase
	if brokerRows, err := store.GetBrokerSummaryRange(db, symbol, from, to); err == nil && len(brokerRows) > 0 {
		phaseRes := analytics.DetectPhases(bars, reshapeBrokerRows(brokerRows), analytics.Options{Window: 10, Sensitivity: analytics.SensitivityMedium})
		if len(phaseRes.Phases) > 0 {
			p := phaseRes.Phases[len(phaseRes.Phases)-1]
			phasePtr = &p
		}
	}
	outlook := analytics.BuildOutlook(phasePtr, analytics.AnalyzePVA(bars))

	// 2) aliran broker (harian atau fallback agregat scan)
	ba, err := buildBrokerAnalysis(db, symbol, from, to)
	if err != nil {
		return analytics.Decision{}, err
	}

	// 3) tekanan running trade hari terakhir yang punya data
	var pressure *analytics.TradePressure
	if latest, err := store.LatestTradeDate(db, symbol); err == nil && latest != "" {
		if all, err := store.GetTradesAll(db, symbol, latest); err == nil && len(all) > 0 {
			p := analytics.AnalyzeTradePressure(toTradePrints(all))
			pressure = &p
		}
	}

	// 4) katalis Future Earnings
	var bull, bear int
	if cats, err := store.ListCatalysts(db, symbol); err == nil {
		for _, ct := range cats {
			switch ct.Impact {
			case "bullish":
				bull++
			case "bearish":
				bear++
			}
		}
	}

	// 5) valuasi dari cache fundamental (tanpa memaksa fetch Yahoo)
	var pe, pbv *float64
	if f, err := store.GetFundamentals(db, symbol); err == nil && f != nil {
		pe, pbv = f.PERatio, f.PriceToBook
	}

	return analytics.BuildDecision(analytics.DecisionInput{
		Outlook:       outlook,
		Bars:          bars,
		SmartNetValue: ba.SmartNetValue, TotalRangeValue: ba.TotalValue,
		HasBrokerData:    ba.Granularity != "",
		Pressure:         pressure,
		BullishCatalysts: bull, BearishCatalysts: bear,
		PERatio: pe, PriceToBook: pbv,
	}), nil
}
