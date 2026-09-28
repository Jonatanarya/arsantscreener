package api

type ErrorResponse struct {
	Error string `json:"error"`
}

type DailyBar struct {
	Date        string   `json:"date"`
	Open        float64  `json:"open"`
	High        float64  `json:"high"`
	Low         float64  `json:"low"`
	Close       float64  `json:"close"`
	Volume      int64    `json:"volume"`
	Value       *float64 `json:"value,omitempty"`
	Freq        *int     `json:"freq,omitempty"`
	ForeignBuy  *int64   `json:"foreignBuy,omitempty"`
	ForeignSell *int64   `json:"foreignSell,omitempty"`
	ForeignFlow *int64   `json:"foreignFlow,omitempty"`
}

// IngestDailyBar mirrors DailyBar but uses FlexInt/FlexInt64 for the
// integer-ish fields: bridge-extension's browser-side arithmetic can
// produce values like 1500000.0000000002 for counts that are conceptually
// whole numbers, and a plain int64/int field rejects any JSON number with
// a fractional part outright (see flexint.go). Kept as a separate type
// from DailyBar (the read-path response shape) so this leniency never
// touches the response-building code.
type IngestDailyBar struct {
	Date        string     `json:"date"`
	Open        float64    `json:"open"`
	High        float64    `json:"high"`
	Low         float64    `json:"low"`
	Close       float64    `json:"close"`
	Volume      FlexInt64  `json:"volume"`
	Value       *float64   `json:"value,omitempty"`
	Freq        *FlexInt   `json:"freq,omitempty"`
	ForeignBuy  *FlexInt64 `json:"foreignBuy,omitempty"`
	ForeignSell *FlexInt64 `json:"foreignSell,omitempty"`
	ForeignFlow *FlexInt64 `json:"foreignFlow,omitempty"`
}

type IngestBarsRequest struct {
	Symbol string           `json:"symbol"`
	Source string           `json:"source"`
	Bars   []IngestDailyBar `json:"bars"`
}

type BrokerRow struct {
	BrokerCode   string  `json:"brokerCode"`
	Value        float64 `json:"value"`
	Lot          int64   `json:"lot"`
	Freq         int     `json:"freq"`
	InvestorType string  `json:"investorType,omitempty"`
}

// IngestBrokerRow is BrokerRow's ingest-side counterpart — see IngestDailyBar.
type IngestBrokerRow struct {
	BrokerCode string    `json:"brokerCode"`
	Value      float64   `json:"value"`
	Lot        FlexInt64 `json:"lot"`
	Freq       FlexInt   `json:"freq"`
	// Domisili ALIRAN DANA baris ini ("Asing"/"Lokal") apa adanya dari
	// Stockbit — bukan kebangsaan brokernya.
	InvestorType string `json:"investorType,omitempty"`
}

type IngestBrokerSummaryRequest struct {
	Symbol  string            `json:"symbol"`
	Date    string            `json:"date"`
	Buyers  []IngestBrokerRow `json:"buyers"`
	Sellers []IngestBrokerRow `json:"sellers"`
}

type BrokerSummaryDay struct {
	Symbol  string      `json:"symbol"`
	Date    string      `json:"date"`
	Buyers  []BrokerRow `json:"buyers"`
	Sellers []BrokerRow `json:"sellers"`
}

// BrokerSummaryRangeResponse is BrokerSummaryDay's counterpart for a
// custom date range: buyers/sellers are totals summed across [from, to],
// not one day's snapshot.
type BrokerSummaryRangeResponse struct {
	Symbol  string      `json:"symbol"`
	From    string      `json:"from"`
	To      string      `json:"to"`
	Buyers  []BrokerRow `json:"buyers"`
	Sellers []BrokerRow `json:"sellers"`
}

type WatchlistItem struct {
	Symbol    string   `json:"symbol"`
	Name      string   `json:"name"`
	Sector    *string  `json:"sector,omitempty"`
	Date      *string  `json:"date,omitempty"`
	Close     *float64 `json:"close,omitempty"`
	PrevClose *float64 `json:"prevClose,omitempty"`
	ChangePct *float64 `json:"changePct,omitempty"`
	Volume    *int64   `json:"volume,omitempty"`
}

type PhaseBrokerNet struct {
	Code string  `json:"code"`
	Net  float64 `json:"net"`
}

type Phase struct {
	Type       string           `json:"type"`  // AKUMULASI | DISTRIBUSI
	Actor      string           `json:"actor"` // SMART MONEY | RITEL
	AvgTrx     float64          `json:"avgTrx"`
	AvgPrice   float64          `json:"avgPrice"`
	FromDate   string           `json:"fromDate"`
	ToDate     string           `json:"toDate"`
	PriceLow   float64          `json:"priceLow"`
	PriceHigh  float64          `json:"priceHigh"`
	TopBrokers []PhaseBrokerNet `json:"topBrokers"`
	Flow       float64          `json:"flow"`
	SmartShare float64          `json:"smartShare"`
	Days       int              `json:"days"`
}

type PhasesResponse struct {
	Symbol string  `json:"symbol"`
	Window int     `json:"window"`
	Sens   string  `json:"sensitivity"`
	Phases []Phase `json:"phases"`
	Error  string  `json:"error,omitempty"`
}

type PVARow struct {
	Date   string  `json:"date"`
	Close  float64 `json:"close"`
	ChgPct float64 `json:"chgPct"`
	VolRel float64 `json:"volRel"`
	Class  string  `json:"class"`
	Desc   string  `json:"desc,omitempty"`
	Score  int     `json:"score"`
}

type Climax struct {
	Type string `json:"type"` // SELLING CLIMAX | BUYING CLIMAX
	Desc string `json:"desc"`
	Date string `json:"date"`
}

type PVAResponse struct {
	Symbol      string   `json:"symbol"`
	Rows        []PVARow `json:"rows"`
	ObvText     string   `json:"obvText"`
	ObvSignal   string   `json:"obvSignal,omitempty"` // bull | bear
	UpDownRatio float64  `json:"upDownRatio"`
	Dominance   string   `json:"dominance"` // demand | supply | seimbang
	Climax      *Climax  `json:"climax,omitempty"`
	Score       int      `json:"score"`
	Bias        string   `json:"bias"` // BULLISH | BEARISH | NETRAL
	Error       string   `json:"error,omitempty"`
}

type IngestScreenerBroker struct {
	Code string  `json:"code"`
	Net  float64 `json:"net"`
	Type string  `json:"type"`
}

type IngestScreenerItem struct {
	Symbol      string                 `json:"sym"`
	Name        string                 `json:"name"`
	Category    string                 `json:"category"` // bluechip, second, third
	ScoreAccum  int                    `json:"scoreAccum"`
	ScoreTech   int                    `json:"scoreTech"`
	ScorePVA    int                    `json:"scorePva"`
	ScoreLiq    int                    `json:"scoreLiq"`
	FitScalp    int                    `json:"fitScalp"`
	FitDaytrade int                    `json:"fitDaytrade"`
	FitSwing    int                    `json:"fitSwing"`
	Tags        []string               `json:"tags"`
	TopBuyers   []IngestScreenerBroker `json:"topBuyers"`
	TopSellers  []IngestScreenerBroker `json:"topSellers"`
}

type IngestScreenerRequest struct {
	Date    string               `json:"date"`
	Results []IngestScreenerItem `json:"results"`
}

type ScanRow struct {
	Symbol          string   `json:"symbol"`
	Name            string   `json:"name"`
	Sector          *string  `json:"sector,omitempty"`
	Date            *string  `json:"date,omitempty"`
	Close           *float64 `json:"close,omitempty"`
	ChangePct       *float64 `json:"changePct,omitempty"`
	Category        string   `json:"category,omitempty"` // bluechip, second, third
	ScoreAccum      int      `json:"scoreAccum,omitempty"`
	ScoreTech       int      `json:"scoreTech,omitempty"`
	ScorePVA        int      `json:"scorePva,omitempty"`
	ScoreLiq        int      `json:"scoreLiq,omitempty"`
	FitScalp        int      `json:"fitScalp,omitempty"`
	FitDaytrade     int      `json:"fitDaytrade,omitempty"`
	FitSwing        int      `json:"fitSwing,omitempty"`
	Tags            []string `json:"tags,omitempty"`
	Phase           *Phase   `json:"phase,omitempty"` // fase terakhir/sedang berjalan, bila ada
	PVABias         string   `json:"pvaBias,omitempty"`
	PVAScore        int      `json:"pvaScore,omitempty"`
	Climax          *Climax  `json:"climax,omitempty"`
	HistoryDays     int      `json:"historyDays,omitempty"`
	AverageTurnover float64  `json:"averageTurnover,omitempty"`
}

type CreatePositionRequest struct {
	Symbol     string   `json:"symbol"`
	EntryDate  string   `json:"entryDate"`
	EntryPrice float64  `json:"entryPrice"`
	Lot        int64    `json:"lot"`
	StopLoss   *float64 `json:"stopLoss,omitempty"`
	TakeProfit *float64 `json:"takeProfit,omitempty"`
	Notes      *string  `json:"notes,omitempty"`
}

type CreatePositionResponse struct {
	ID int64 `json:"id"`
}

type ClosePositionRequest struct {
	ExitDate  string  `json:"exitDate"`
	ExitPrice float64 `json:"exitPrice"`
}

type PositionResponse struct {
	ID              int64    `json:"id"`
	Symbol          string   `json:"symbol"`
	Sector          *string  `json:"sector,omitempty"`
	EntryDate       string   `json:"entryDate"`
	EntryPrice      float64  `json:"entryPrice"`
	Lot             int64    `json:"lot"`
	StopLoss        *float64 `json:"stopLoss,omitempty"`
	TakeProfit      *float64 `json:"takeProfit,omitempty"`
	Notes           *string  `json:"notes,omitempty"`
	Status          string   `json:"status"`
	ExitDate        *string  `json:"exitDate,omitempty"`
	ExitPrice       *float64 `json:"exitPrice,omitempty"`
	CurrentPrice    *float64 `json:"currentPrice,omitempty"`
	CostBasis       float64  `json:"costBasis"`
	MarketValue     float64  `json:"marketValue"`
	UnrealizedPL    float64  `json:"unrealizedPL"`
	UnrealizedPLPct float64  `json:"unrealizedPLPct"`
	RiskAmount      *float64 `json:"riskAmount,omitempty"`
}

type ConcentrationWarning struct {
	Kind  string  `json:"kind"` // stock | sector
	Key   string  `json:"key"`
	Pct   float64 `json:"pct"`
	Limit float64 `json:"limit"`
}

type PortfolioSummaryResponse struct {
	Positions            []PositionResponse     `json:"positions"`
	TotalCostBasis       float64                `json:"totalCostBasis"`
	TotalMarketValue     float64                `json:"totalMarketValue"`
	TotalUnrealizedPL    float64                `json:"totalUnrealizedPL"`
	TotalUnrealizedPLPct float64                `json:"totalUnrealizedPLPct"`
	StockConcentration   map[string]float64     `json:"stockConcentration"`
	SectorConcentration  map[string]float64     `json:"sectorConcentration"`
	Warnings             []ConcentrationWarning `json:"warnings"`
}

type PositionSizeRequest struct {
	Equity     float64 `json:"equity"`
	RiskPct    float64 `json:"riskPct"`
	EntryPrice float64 `json:"entryPrice"`
	StopLoss   float64 `json:"stopLoss"`
}

type PositionSizeResponse struct {
	RiskAmount    float64 `json:"riskAmount"`
	PerShareRisk  float64 `json:"perShareRisk"`
	Lots          int64   `json:"lots"`
	Shares        int64   `json:"shares"`
	PositionValue float64 `json:"positionValue"`
	Error         string  `json:"error,omitempty"`
}

type OutlookSignal struct {
	Source string `json:"source"` // fase | pva
	Text   string `json:"text"`
	Points int    `json:"points"`
}

type OutlookResponse struct {
	Symbol   string          `json:"symbol"`
	Bias     string          `json:"bias"` // BULLISH | BEARISH | NETRAL
	Score    int             `json:"score"`
	Bullish  []OutlookSignal `json:"bullish"`
	Bearish  []OutlookSignal `json:"bearish"`
	Phase    *Phase          `json:"phase,omitempty"`
	PVABias  string          `json:"pvaBias,omitempty"`
	PVAScore int             `json:"pvaScore,omitempty"`
	Climax   *Climax         `json:"climax,omitempty"`
}

type AlertResponse struct {
	ID        int64  `json:"id"`
	Symbol    string `json:"symbol"`
	OldBias   string `json:"oldBias,omitempty"`
	NewBias   string `json:"newBias"`
	Score     int    `json:"score"`
	CreatedAt string `json:"createdAt"`
}

type LiquidityAlertResponse struct {
	ID        int64    `json:"id"`
	Symbol    string   `json:"symbol"`
	OldLevel  string   `json:"oldLevel,omitempty"`
	NewLevel  string   `json:"newLevel"`
	Score     int      `json:"score"`
	Reasons   []string `json:"reasons,omitempty"`
	CreatedAt string   `json:"createdAt"`
}

type LiquidityCandidateResponse struct {
	Symbol    string `json:"symbol"`
	Level     string `json:"level"`
	Score     int    `json:"score"`
	UpdatedAt string `json:"updatedAt"`
}

// ---- self-analysis: running trade, broker analysis, news, keputusan ----

type IngestTradePrint struct {
	Ts           int64     `json:"ts"`
	Price        float64   `json:"price"`
	Lot          FlexInt64 `json:"lot"`
	Freq         FlexInt   `json:"freq"`
	Direction    string    `json:"direction"` // buy | sell | unknown
	BuyerBroker  string    `json:"buyerBroker,omitempty"`
	SellerBroker string    `json:"sellerBroker,omitempty"`
	ExtTradeID   string    `json:"extTradeId,omitempty"`
}

type IngestTradesRequest struct {
	Symbol string             `json:"symbol"`
	Trades []IngestTradePrint `json:"trades"`
}

type IngestBrokerRangeRequest struct {
	Symbol  string            `json:"symbol"`
	From    string            `json:"from"`
	To      string            `json:"to"`
	Buyers  []IngestBrokerRow `json:"buyers"`
	Sellers []IngestBrokerRow `json:"sellers"`
}

type IngestNewsItem struct {
	ExtID    string `json:"extId"`
	Symbol   string `json:"symbol,omitempty"`
	Title    string `json:"title"`
	URL      string `json:"url,omitempty"`
	Source   string `json:"source,omitempty"`
	PostedAt string `json:"postedAt,omitempty"` // RFC3339
}

type IngestNewsRequest struct {
	Items []IngestNewsItem `json:"items"`
}

type TradePrintResponse struct {
	Ts           int64   `json:"ts"`
	Price        float64 `json:"price"`
	Lot          int64   `json:"lot"`
	Freq         int     `json:"freq"`
	Direction    string  `json:"direction"`
	BuyerBroker  string  `json:"buyerBroker,omitempty"`
	SellerBroker string  `json:"sellerBroker,omitempty"`
	ExtTradeID   string  `json:"extTradeId,omitempty"`
	Market       string  `json:"market,omitempty"`
}

type TopBrokerResponse struct {
	Code string  `json:"code"`
	Name string  `json:"name"`
	Val  float64 `json:"val"`
	N    int     `json:"n"`
}

type TradePressureResponse struct {
	BuyLot     int64   `json:"buyLot"`
	SellLot    int64   `json:"sellLot"`
	UnknownLot int64   `json:"unknownLot"`
	BuyVal     float64 `json:"buyVal"`
	SellVal    float64 `json:"sellVal"`
	VWAP       float64 `json:"vwap"`
	NPrints    int     `json:"nPrints"`
	BigPrints  int     `json:"bigPrints"`
	BigLotMin  int64   `json:"bigLotMin"`
}

type TradesResponse struct {
	Symbol         string                 `json:"symbol"`
	Date           string                 `json:"date"`
	AvailableDates []string               `json:"availableDates,omitempty"`
	Prints         []TradePrintResponse   `json:"prints"`
	Pressure       *TradePressureResponse `json:"pressure,omitempty"`
	TopBuyers      []TopBrokerResponse    `json:"topBuyers,omitempty"`
	TopSellers     []TopBrokerResponse    `json:"topSellers,omitempty"`
}

type BrokerFlow struct {
	Code         string  `json:"code"`
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	BuyVal       float64 `json:"buyVal"`
	SellVal      float64 `json:"sellVal"`
	NetVal       float64 `json:"netVal"`
	BuyLot       int64   `json:"buyLot"`
	SellLot      int64   `json:"sellLot"`
	AvgBuyPrice  float64 `json:"avgBuyPrice,omitempty"`
	AvgSellPrice float64 `json:"avgSellPrice,omitempty"`
	Freq         int     `json:"freq"`
	// Domisili aliran dana yang lewat broker ini. Dipakai untuk menandai kasus
	// seperti YU: brokernya asing, tapi yang bertransaksi investor lokal.
	InvestorType string `json:"investorType,omitempty"`
}

type BrokerAnalysisResponse struct {
	Symbol        string       `json:"symbol"`
	From          string       `json:"from"`
	To            string       `json:"to"`
	Granularity   string       `json:"granularity"` // harian | agregat
	TotalValue    float64      `json:"totalValue"`
	SmartNetValue float64      `json:"smartNetValue"`
	SmartSharePct float64      `json:"smartSharePct"`
	Top3AccumPct  float64      `json:"top3AccumPct"`
	Brokers       []BrokerFlow `json:"brokers"`
	Error         string       `json:"error,omitempty"`
}

type NewsItemResponse struct {
	ID        int64                `json:"id"`
	Symbol    string               `json:"symbol,omitempty"`
	Title     string               `json:"title"`
	Summary   string               `json:"summary,omitempty"`
	URL       string               `json:"url,omitempty"`
	Source    string               `json:"source,omitempty"`
	Topic     string               `json:"topic"`
	Sentiment string               `json:"sentiment"`
	Impacts   []NewsImpactResponse `json:"impacts"`
	PostedAt  string               `json:"postedAt,omitempty"`
}

type NewsImpactResponse struct {
	Symbol     string  `json:"symbol"`
	Sentiment  string  `json:"sentiment"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason,omitempty"`
}

type DecisionSignalResponse struct {
	Source string `json:"source"`
	Text   string `json:"text"`
	Points int    `json:"points"`
}

type TradePlanResponse struct {
	Entry      float64 `json:"entry"`
	StopLoss   float64 `json:"stopLoss"`
	TakeProfit float64 `json:"takeProfit"`
	ATR        float64 `json:"atr"`
	RiskReward float64 `json:"riskReward"`
}

type DecisionResponse struct {
	Symbol  string                   `json:"symbol"`
	Verdict string                   `json:"verdict"` // BELI | PANTAU | HINDARI
	Score   int                      `json:"score"`
	Signals []DecisionSignalResponse `json:"signals"`
	Plan    *TradePlanResponse       `json:"plan,omitempty"`
	From    string                   `json:"from"`
	To      string                   `json:"to"`
	Quality DecisionQualityResponse  `json:"quality"`
}

type DecisionQualityResponse struct {
	Eligible        bool     `json:"eligible"`
	Reasons         []string `json:"reasons"`
	AverageTurnover float64  `json:"averageTurnover"`
	ActiveSessions  int      `json:"activeSessions"`
	HistoryDays     int      `json:"historyDays"`
	Confidence      string   `json:"confidence"`
	DataSources     int      `json:"dataSources"`
}

type AIOutlookRequest struct {
	APIKey string `json:"apiKey"`
}

type AIOutlookResponse struct {
	Symbol      string `json:"symbol"`
	Analysis    string `json:"analysis"`
	GeneratedAt string `json:"generatedAt"`
}

type CatalystResponse struct {
	ID             int64  `json:"id"`
	Symbol         string `json:"symbol"`
	Category       string `json:"category"`
	Description    string `json:"description"`
	Impact         string `json:"impact"`
	ExpectedPeriod string `json:"expectedPeriod,omitempty"`
	Status         string `json:"status"`
	SourceURL      string `json:"sourceUrl,omitempty"`
	SourceName     string `json:"sourceName,omitempty"`
	Confidence     string `json:"confidence,omitempty"`
	AddedBy        string `json:"addedBy"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

type CreateCatalystRequest struct {
	Symbol         string `json:"symbol"`
	Category       string `json:"category"`
	Description    string `json:"description"`
	Impact         string `json:"impact"`
	ExpectedPeriod string `json:"expectedPeriod,omitempty"`
	Status         string `json:"status,omitempty"`
	SourceURL      string `json:"sourceUrl,omitempty"`
	SourceName     string `json:"sourceName,omitempty"`
	Confidence     string `json:"confidence,omitempty"`
	AddedBy        string `json:"addedBy,omitempty"`
}

type UpdateCatalystRequest struct {
	Category       string `json:"category"`
	Description    string `json:"description"`
	Impact         string `json:"impact"`
	ExpectedPeriod string `json:"expectedPeriod,omitempty"`
	Status         string `json:"status"`
	SourceURL      string `json:"sourceUrl,omitempty"`
	SourceName     string `json:"sourceName,omitempty"`
	Confidence     string `json:"confidence,omitempty"`
}

type MacroQuoteResponse struct {
	Ticker        string  `json:"ticker"`
	Name          string  `json:"name"`
	Group         string  `json:"group,omitempty"` // komoditas | kurs | indeks | kripto
	Price         float64 `json:"price,omitempty"`
	Currency      string  `json:"currency,omitempty"`
	ChangePercent float64 `json:"changePercent,omitempty"`
	FetchedAt     string  `json:"fetchedAt,omitempty"`
	Stale         bool    `json:"stale,omitempty"`
	Error         string  `json:"error,omitempty"`
}

type MacroSensitivityResponse struct {
	ID              int64  `json:"id"`
	Symbol          string `json:"symbol"`
	Factor          string `json:"factor"`
	ImpactDirection string `json:"impactDirection"`
	Note            string `json:"note,omitempty"`
	CreatedAt       string `json:"createdAt"`
}

type CreateMacroSensitivityRequest struct {
	Symbol          string `json:"symbol"`
	Factor          string `json:"factor"`
	ImpactDirection string `json:"impactDirection"`
	Note            string `json:"note,omitempty"`
}

type IngestMacroQuoteRequest struct {
	Ticker        string  `json:"ticker"`
	Name          string  `json:"name"`
	Price         float64 `json:"price"`
	Currency      string  `json:"currency"`
	ChangePercent float64 `json:"changePercent"`
}

type FundamentalsResponse struct {
	Symbol            string   `json:"symbol"`
	MarketCap         *float64 `json:"marketCap,omitempty"`
	PERatio           *float64 `json:"peRatio,omitempty"`
	ForwardPE         *float64 `json:"forwardPE,omitempty"`
	PegRatio          *float64 `json:"pegRatio,omitempty"`
	PriceToBook       *float64 `json:"priceToBook,omitempty"`
	PriceToSales      *float64 `json:"priceToSales,omitempty"`
	BookValue         *float64 `json:"bookValue,omitempty"`
	EPSTrailing       *float64 `json:"epsTrailing,omitempty"`
	EPSForward        *float64 `json:"epsForward,omitempty"`
	DividendYield     *float64 `json:"dividendYield,omitempty"`
	DividendRate      *float64 `json:"dividendRate,omitempty"`
	PayoutRatio       *float64 `json:"payoutRatio,omitempty"`
	RevenueTTM        *float64 `json:"revenueTtm,omitempty"`
	RevenueGrowth     *float64 `json:"revenueGrowth,omitempty"`
	EarningsGrowth    *float64 `json:"earningsGrowth,omitempty"`
	ProfitMargin      *float64 `json:"profitMargin,omitempty"`
	OperatingMargin   *float64 `json:"operatingMargin,omitempty"`
	ROE               *float64 `json:"roe,omitempty"`
	ROA               *float64 `json:"roa,omitempty"`
	TotalCash         *float64 `json:"totalCash,omitempty"`
	TotalDebt         *float64 `json:"totalDebt,omitempty"`
	Beta              *float64 `json:"beta,omitempty"`
	SharesOutstanding *int64   `json:"sharesOutstanding,omitempty"`
	Week52Low         *float64 `json:"week52Low,omitempty"`
	Week52High        *float64 `json:"week52High,omitempty"`
	Week52Change      *float64 `json:"week52Change,omitempty"`
	TargetMeanPrice   *float64 `json:"targetMeanPrice,omitempty"`
	TargetHighPrice   *float64 `json:"targetHighPrice,omitempty"`
	TargetLowPrice    *float64 `json:"targetLowPrice,omitempty"`
	RecommendationKey string   `json:"recommendationKey,omitempty"`
	NumAnalysts       *int     `json:"numAnalysts,omitempty"`
	Currency          string   `json:"currency,omitempty"`
	FetchedAt         string   `json:"fetchedAt"`
	Stale             bool     `json:"stale,omitempty"`
	Error             string   `json:"error,omitempty"`
}
