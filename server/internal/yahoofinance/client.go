// Package yahoofinance talks to Yahoo Finance's unofficial quoteSummary
// endpoint to pull fundamental/valuation data for IDX stocks (ticker+".JK").
// This is an undocumented API, gated behind a crumb+cookie handshake that
// Yahoo can change or rate-limit without notice (observed firsthand during
// development: the query1 host 429s far more readily than query2, and the
// crumb endpoint itself can rate-limit). Callers must treat this as
// best-effort and always keep a cached fallback — never assume it's
// reliably available.
package yahoofinance

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
	idxSuffix = ".JK"
)

var errInvalidCrumb = errors.New("yahoo finance: invalid crumb")

type Client struct {
	http *http.Client

	mu    sync.Mutex
	crumb string
}

func NewClient() *Client {
	jar, _ := cookiejar.New(nil)
	return &Client{http: &http.Client{Jar: jar, Timeout: 25 * time.Second}}
}

func tickerFor(symbol string) string {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	// Kode internal Arsant untuk indeks utama tetap IHSG, sedangkan Yahoo
	// memakai simbol indeks ^JKSE. Tanpa pemetaan ini worker menganggap IHSG
	// sebagai saham IHSG.JK yang memang tidak ada.
	if s == "IHSG" || s == "^JKSE" {
		return "^JKSE"
	}
	if strings.HasSuffix(s, idxSuffix) {
		return s
	}
	return s + idxSuffix
}

// FetchFundamentals fetches summaryDetail+defaultKeyStatistics+financialData
// for a bare IDX code (e.g. "BBCA" — ".JK" is appended automatically).
func (c *Client) FetchFundamentals(symbol string) (Fundamentals, error) {
	ticker := tickerFor(symbol)

	crumb, err := c.ensureCrumb()
	if err != nil {
		return Fundamentals{}, err
	}

	result, err := c.callQuoteSummary(ticker, crumb)
	if errors.Is(err, errInvalidCrumb) {
		if crumb, err = c.refreshCrumb(); err != nil {
			return Fundamentals{}, fmt.Errorf("refresh crumb: %w", err)
		}
		result, err = c.callQuoteSummary(ticker, crumb)
	}
	if err != nil {
		return Fundamentals{}, err
	}
	return toFundamentals(strings.ToUpper(strings.TrimSpace(symbol)), result), nil
}

func (c *Client) ensureCrumb() (string, error) {
	c.mu.Lock()
	crumb := c.crumb
	c.mu.Unlock()
	if crumb != "" {
		return crumb, nil
	}
	return c.refreshCrumb()
}

// refreshCrumb primes the cookie jar against fc.yahoo.com then reads a
// fresh crumb from query2's getcrumb endpoint. The two-step dance (rather
// than hitting getcrumb directly) is what makes Yahoo actually issue a
// usable session cookie.
func (c *Client) refreshCrumb() (string, error) {
	primeReq, err := http.NewRequest(http.MethodGet, "https://fc.yahoo.com", nil)
	if err != nil {
		return "", err
	}
	primeReq.Header.Set("User-Agent", userAgent)
	primeResp, err := c.http.Do(primeReq)
	if err != nil {
		return "", fmt.Errorf("prime cookie: %w", err)
	}
	primeResp.Body.Close()

	crumbReq, err := http.NewRequest(http.MethodGet, "https://query2.finance.yahoo.com/v1/test/getcrumb", nil)
	if err != nil {
		return "", err
	}
	crumbReq.Header.Set("User-Agent", userAgent)
	crumbResp, err := c.http.Do(crumbReq)
	if err != nil {
		return "", fmt.Errorf("get crumb: %w", err)
	}
	defer crumbResp.Body.Close()

	body, err := io.ReadAll(crumbResp.Body)
	if err != nil {
		return "", fmt.Errorf("read crumb: %w", err)
	}
	if crumbResp.StatusCode == http.StatusTooManyRequests {
		return "", fmt.Errorf("yahoo finance: rate limited fetching crumb (429)")
	}
	crumb := strings.TrimSpace(string(body))
	if crumb == "" || strings.HasPrefix(crumb, "<") {
		return "", fmt.Errorf("yahoo finance: unexpected crumb response %q", truncate(crumb, 80))
	}

	c.mu.Lock()
	c.crumb = crumb
	c.mu.Unlock()
	return crumb, nil
}

func (c *Client) callQuoteSummary(ticker, crumb string) (quoteSummaryResult, error) {
	u := fmt.Sprintf(
		"https://query2.finance.yahoo.com/v10/finance/quoteSummary/%s?modules=summaryDetail,defaultKeyStatistics,financialData&crumb=%s",
		url.PathEscape(ticker), url.QueryEscape(crumb),
	)
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return quoteSummaryResult{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", "https://finance.yahoo.com/quote/"+ticker)

	resp, err := c.http.Do(req)
	if err != nil {
		return quoteSummaryResult{}, fmt.Errorf("request quoteSummary: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		return quoteSummaryResult{}, fmt.Errorf("yahoo finance: rate limited (429)")
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return quoteSummaryResult{}, fmt.Errorf("read quoteSummary: %w", err)
	}

	var parsed quoteSummaryResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return quoteSummaryResult{}, fmt.Errorf("decode quoteSummary: %w", err)
	}
	if parsed.QuoteSummary.Error != nil {
		if strings.Contains(strings.ToLower(parsed.QuoteSummary.Error.Description), "crumb") {
			return quoteSummaryResult{}, errInvalidCrumb
		}
		return quoteSummaryResult{}, fmt.Errorf("yahoo finance: %s", parsed.QuoteSummary.Error.Description)
	}
	if len(parsed.QuoteSummary.Result) == 0 {
		return quoteSummaryResult{}, fmt.Errorf("yahoo finance: no data for %s", ticker)
	}
	return parsed.QuoteSummary.Result[0], nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
