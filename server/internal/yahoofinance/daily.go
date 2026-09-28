package yahoofinance

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type DailyBar struct {
	Date   time.Time
	Open   float64
	High   float64
	Low    float64
	Close  float64
	Volume int64
}

type dailyChartResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				ExchangeTimezoneName string `json:"exchangeTimezoneName"`
				GMTOffset            int    `json:"gmtoffset"`
			} `json:"meta"`
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Open   []*float64 `json:"open"`
					High   []*float64 `json:"high"`
					Low    []*float64 `json:"low"`
					Close  []*float64 `json:"close"`
					Volume []*int64   `json:"volume"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
		Error *yahooError `json:"error"`
	} `json:"chart"`
}

// FetchDailyBars returns daily OHLCV for one IDX symbol. period2 on Yahoo is
// exclusive, so one day is added to keep the requested `to` date inclusive.
func (c *Client) FetchDailyBars(symbol string, from, to time.Time) ([]DailyBar, error) {
	if to.IsZero() {
		to = time.Now().UTC()
	}
	if from.IsZero() || !from.Before(to) {
		from = to.AddDate(0, -1, 0)
	}
	ticker := tickerFor(symbol)
	query := url.Values{}
	query.Set("period1", strconv.FormatInt(from.UTC().Unix(), 10))
	query.Set("period2", strconv.FormatInt(to.AddDate(0, 0, 1).UTC().Unix(), 10))
	query.Set("interval", "1d")
	query.Set("events", "history")
	query.Set("includeAdjustedClose", "true")
	u := "https://query2.finance.yahoo.com/v8/finance/chart/" + url.PathEscape(ticker) + "?" + query.Encode()
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://finance.yahoo.com/quote/"+ticker)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request daily chart: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("read daily chart: %w", err)
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("yahoo finance: rate limited daily chart (429)")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("yahoo finance: daily chart HTTP %d: %s", resp.StatusCode, truncate(string(body), 120))
	}
	var parsed dailyChartResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("decode daily chart: %w", err)
	}
	if parsed.Chart.Error != nil {
		return nil, fmt.Errorf("yahoo finance: %s", parsed.Chart.Error.Description)
	}
	if len(parsed.Chart.Result) == 0 {
		return nil, fmt.Errorf("yahoo finance: no daily data for %s", ticker)
	}
	result := parsed.Chart.Result[0]
	if len(result.Indicators.Quote) == 0 {
		return nil, fmt.Errorf("yahoo finance: no daily candles for %s", ticker)
	}
	location := time.FixedZone("exchange", result.Meta.GMTOffset)
	if result.Meta.ExchangeTimezoneName != "" {
		if loaded, err := time.LoadLocation(result.Meta.ExchangeTimezoneName); err == nil {
			location = loaded
		}
	}
	quote := result.Indicators.Quote[0]
	bars := make([]DailyBar, 0, len(result.Timestamp))
	for i, timestamp := range result.Timestamp {
		if i >= len(quote.Open) || i >= len(quote.High) || i >= len(quote.Low) || i >= len(quote.Close) {
			break
		}
		if quote.Open[i] == nil || quote.High[i] == nil || quote.Low[i] == nil || quote.Close[i] == nil || *quote.Close[i] <= 0 {
			continue
		}
		var volume int64
		if i < len(quote.Volume) && quote.Volume[i] != nil && *quote.Volume[i] > 0 {
			volume = *quote.Volume[i]
		}
		bars = append(bars, DailyBar{
			Date: time.Unix(timestamp, 0).In(location), Open: *quote.Open[i],
			High: *quote.High[i], Low: *quote.Low[i], Close: *quote.Close[i], Volume: volume,
		})
	}
	if len(bars) == 0 {
		return nil, fmt.Errorf("yahoo finance: all daily candles empty for %s", ticker)
	}
	return bars, nil
}
