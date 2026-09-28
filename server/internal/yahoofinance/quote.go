package yahoofinance

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

type Quote struct {
	Ticker        string
	Name          string
	Price         float64
	Currency      string
	ChangePercent float64
}

type chartResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Symbol             string  `json:"symbol"`
				Currency           string  `json:"currency"`
				ShortName          string  `json:"shortName"`
				LongName           string  `json:"longName"`
				RegularMarketPrice float64 `json:"regularMarketPrice"`
				ChartPreviousClose float64 `json:"chartPreviousClose"`
			} `json:"meta"`
		} `json:"result"`
		Error *yahooError `json:"error"`
	} `json:"chart"`
}

// FetchQuote fetches a live price for any Yahoo Finance ticker (forex pair,
// futures/commodity, or index — e.g. "USDIDR=X", "GC=F", "^JKSE") via the
// v8/finance/chart endpoint, which unlike quoteSummary needs no crumb.
func (c *Client) FetchQuote(ticker string) (Quote, error) {
	u := fmt.Sprintf("https://query2.finance.yahoo.com/v8/finance/chart/%s?range=5d&interval=1d", url.PathEscape(ticker))
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return Quote{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://finance.yahoo.com")

	resp, err := c.http.Do(req)
	if err != nil {
		return Quote{}, fmt.Errorf("request chart: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		return Quote{}, fmt.Errorf("yahoo finance: rate limited (429)")
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return Quote{}, fmt.Errorf("read chart: %w", err)
	}

	var parsed chartResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return Quote{}, fmt.Errorf("decode chart: %w", err)
	}
	if parsed.Chart.Error != nil {
		return Quote{}, fmt.Errorf("yahoo finance: %s", parsed.Chart.Error.Description)
	}
	if len(parsed.Chart.Result) == 0 {
		return Quote{}, fmt.Errorf("yahoo finance: no data for %s", ticker)
	}

	m := parsed.Chart.Result[0].Meta
	name := m.ShortName
	if name == "" {
		name = m.LongName
	}
	var changePct float64
	if m.ChartPreviousClose != 0 {
		changePct = (m.RegularMarketPrice - m.ChartPreviousClose) / m.ChartPreviousClose * 100
	}

	return Quote{
		Ticker:        ticker,
		Name:          name,
		Price:         m.RegularMarketPrice,
		Currency:      m.Currency,
		ChangePercent: changePct,
	}, nil
}
