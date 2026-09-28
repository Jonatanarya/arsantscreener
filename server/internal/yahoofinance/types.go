package yahoofinance

// rawNum mirrors Yahoo's `{"raw": 123.4, "fmt": "123.40"}` wrapper. When a
// field has no value Yahoo sends `{}`, which leaves Raw nil — encoding/json
// handles that for free, no custom UnmarshalJSON needed.
type rawNum struct {
	Raw *float64 `json:"raw"`
}

type yahooError struct {
	Code        string `json:"code"`
	Description string `json:"description"`
}

type quoteSummaryResponse struct {
	QuoteSummary struct {
		Result []quoteSummaryResult `json:"result"`
		Error  *yahooError          `json:"error"`
	} `json:"quoteSummary"`
}

type quoteSummaryResult struct {
	SummaryDetail struct {
		MarketCap                    rawNum `json:"marketCap"`
		TrailingPE                   rawNum `json:"trailingPE"`
		ForwardPE                    rawNum `json:"forwardPE"`
		DividendYield                rawNum `json:"dividendYield"`
		DividendRate                 rawNum `json:"dividendRate"`
		PayoutRatio                  rawNum `json:"payoutRatio"`
		PriceToSalesTrailing12Months rawNum `json:"priceToSalesTrailing12Months"`
		FiftyTwoWeekLow              rawNum `json:"fiftyTwoWeekLow"`
		FiftyTwoWeekHigh             rawNum `json:"fiftyTwoWeekHigh"`
		Beta                         rawNum `json:"beta"`
		Currency                     string `json:"currency"`
	} `json:"summaryDetail"`
	DefaultKeyStatistics struct {
		PriceToBook       rawNum `json:"priceToBook"`
		BookValue         rawNum `json:"bookValue"`
		TrailingEps       rawNum `json:"trailingEps"`
		ForwardEps        rawNum `json:"forwardEps"`
		PegRatio          rawNum `json:"pegRatio"`
		SharesOutstanding rawNum `json:"sharesOutstanding"`
		Week52Change      rawNum `json:"52WeekChange"`
	} `json:"defaultKeyStatistics"`
	FinancialData struct {
		TotalRevenue            rawNum `json:"totalRevenue"`
		RevenueGrowth           rawNum `json:"revenueGrowth"`
		EarningsGrowth          rawNum `json:"earningsGrowth"`
		ProfitMargins           rawNum `json:"profitMargins"`
		OperatingMargins        rawNum `json:"operatingMargins"`
		ReturnOnEquity          rawNum `json:"returnOnEquity"`
		ReturnOnAssets          rawNum `json:"returnOnAssets"`
		TotalCash               rawNum `json:"totalCash"`
		TotalDebt               rawNum `json:"totalDebt"`
		TargetMeanPrice         rawNum `json:"targetMeanPrice"`
		TargetHighPrice         rawNum `json:"targetHighPrice"`
		TargetLowPrice          rawNum `json:"targetLowPrice"`
		RecommendationKey       string `json:"recommendationKey"`
		NumberOfAnalystOpinions rawNum `json:"numberOfAnalystOpinions"`
	} `json:"financialData"`
}

// Fundamentals is the parsed, flat shape callers work with (store layer and
// API handler both convert to/from this rather than the raw Yahoo shape).
type Fundamentals struct {
	Symbol            string
	MarketCap         *float64
	PERatio           *float64
	ForwardPE         *float64
	PegRatio          *float64
	PriceToBook       *float64
	PriceToSales      *float64
	BookValue         *float64
	EPSTrailing       *float64
	EPSForward        *float64
	DividendYield     *float64
	DividendRate      *float64
	PayoutRatio       *float64
	RevenueTTM        *float64
	RevenueGrowth     *float64
	EarningsGrowth    *float64
	ProfitMargin      *float64
	OperatingMargin   *float64
	ROE               *float64
	ROA               *float64
	TotalCash         *float64
	TotalDebt         *float64
	Beta              *float64
	SharesOutstanding *int64
	Week52Low         *float64
	Week52High        *float64
	Week52Change      *float64
	TargetMeanPrice   *float64
	TargetHighPrice   *float64
	TargetLowPrice    *float64
	RecommendationKey string
	NumAnalysts       *int
	Currency          string
}

func toFundamentals(symbol string, r quoteSummaryResult) Fundamentals {
	var sharesOut *int64
	if v := r.DefaultKeyStatistics.SharesOutstanding.Raw; v != nil {
		n := int64(*v)
		sharesOut = &n
	}
	var numAnalysts *int
	if v := r.FinancialData.NumberOfAnalystOpinions.Raw; v != nil {
		n := int(*v)
		numAnalysts = &n
	}
	return Fundamentals{
		Symbol:            symbol,
		MarketCap:         r.SummaryDetail.MarketCap.Raw,
		PERatio:           r.SummaryDetail.TrailingPE.Raw,
		ForwardPE:         r.SummaryDetail.ForwardPE.Raw,
		PegRatio:          r.DefaultKeyStatistics.PegRatio.Raw,
		PriceToBook:       r.DefaultKeyStatistics.PriceToBook.Raw,
		PriceToSales:      r.SummaryDetail.PriceToSalesTrailing12Months.Raw,
		BookValue:         r.DefaultKeyStatistics.BookValue.Raw,
		EPSTrailing:       r.DefaultKeyStatistics.TrailingEps.Raw,
		EPSForward:        r.DefaultKeyStatistics.ForwardEps.Raw,
		DividendYield:     r.SummaryDetail.DividendYield.Raw,
		DividendRate:      r.SummaryDetail.DividendRate.Raw,
		PayoutRatio:       r.SummaryDetail.PayoutRatio.Raw,
		RevenueTTM:        r.FinancialData.TotalRevenue.Raw,
		RevenueGrowth:     r.FinancialData.RevenueGrowth.Raw,
		EarningsGrowth:    r.FinancialData.EarningsGrowth.Raw,
		ProfitMargin:      r.FinancialData.ProfitMargins.Raw,
		OperatingMargin:   r.FinancialData.OperatingMargins.Raw,
		ROE:               r.FinancialData.ReturnOnEquity.Raw,
		ROA:               r.FinancialData.ReturnOnAssets.Raw,
		TotalCash:         r.FinancialData.TotalCash.Raw,
		TotalDebt:         r.FinancialData.TotalDebt.Raw,
		Beta:              r.SummaryDetail.Beta.Raw,
		SharesOutstanding: sharesOut,
		Week52Low:         r.SummaryDetail.FiftyTwoWeekLow.Raw,
		Week52High:        r.SummaryDetail.FiftyTwoWeekHigh.Raw,
		Week52Change:      r.DefaultKeyStatistics.Week52Change.Raw,
		TargetMeanPrice:   r.FinancialData.TargetMeanPrice.Raw,
		TargetHighPrice:   r.FinancialData.TargetHighPrice.Raw,
		TargetLowPrice:    r.FinancialData.TargetLowPrice.Raw,
		RecommendationKey: r.FinancialData.RecommendationKey,
		NumAnalysts:       numAnalysts,
		Currency:          r.SummaryDetail.Currency,
	}
}
