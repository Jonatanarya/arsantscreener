package newsfeed

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxFeedBytes = 4 << 20

var htmlTagPattern = regexp.MustCompile(`(?s)<[^>]*>`)

type Feed struct {
	Name string
	URL  string
}

type Item struct {
	ExtID   string
	Title   string
	Summary string
	URL     string
	Source  string
	Posted  *time.Time
}

type FetchReport struct {
	Items          []Item
	SucceededFeeds int
	FailedFeeds    map[string]string
}

type Client struct {
	httpClient *http.Client
}

func NewClient() *Client {
	return &Client{httpClient: &http.Client{Timeout: 25 * time.Second}}
}

func NewClientWithHTTPClient(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 25 * time.Second}
	}
	return &Client{httpClient: httpClient}
}

// FetchAll reads independent RSS feeds concurrently. A partial provider outage
// does not discard items from feeds that were available.
func (c *Client) FetchAll(ctx context.Context, feeds []Feed) (FetchReport, error) {
	report := FetchReport{Items: make([]Item, 0), FailedFeeds: make(map[string]string)}
	if len(feeds) == 0 {
		return report, errors.New("news feed list is empty")
	}
	type result struct {
		feed  Feed
		items []Item
		err   error
	}
	results := make(chan result, len(feeds))
	var wg sync.WaitGroup
	for _, feed := range feeds {
		feed := Feed{Name: strings.TrimSpace(feed.Name), URL: strings.TrimSpace(feed.URL)}
		if feed.Name == "" {
			feed.Name = feed.URL
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			items, err := c.fetch(ctx, feed)
			results <- result{feed: feed, items: items, err: err}
		}()
	}
	wg.Wait()
	close(results)

	byID := make(map[string]Item)
	for result := range results {
		if result.err != nil {
			report.FailedFeeds[result.feed.Name] = result.err.Error()
			continue
		}
		report.SucceededFeeds++
		for _, item := range result.items {
			byID[item.ExtID] = item
		}
	}
	for _, item := range byID {
		report.Items = append(report.Items, item)
	}
	sort.Slice(report.Items, func(i, j int) bool {
		if report.Items[i].Posted == nil {
			return false
		}
		if report.Items[j].Posted == nil {
			return true
		}
		return report.Items[i].Posted.After(*report.Items[j].Posted)
	})
	if report.SucceededFeeds == 0 {
		return report, fmt.Errorf("all %d news feeds failed", len(feeds))
	}
	return report, nil
}

func (c *Client) fetch(ctx context.Context, feed Feed) ([]Item, error) {
	if feed.URL == "" {
		return nil, errors.New("feed URL is empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feed.URL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8")
	req.Header.Set("User-Agent", "Arsant-Screener/0.3 (+https://arsant.web.id)")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request feed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("feed returned HTTP %d", resp.StatusCode)
	}
	var document rssDocument
	decoder := xml.NewDecoder(io.LimitReader(resp.Body, maxFeedBytes))
	if err := decoder.Decode(&document); err != nil {
		return nil, fmt.Errorf("parse RSS: %w", err)
	}
	items := make([]Item, 0, len(document.Channel.Items))
	for _, raw := range document.Channel.Items {
		title := cleanText(raw.Title, 500)
		link := strings.TrimSpace(raw.Link)
		if title == "" || link == "" {
			continue
		}
		source := cleanText(raw.Source, 100)
		if source == "" {
			source = feed.Name
		}
		stableID := firstNonEmpty(strings.TrimSpace(raw.GUID), link, title)
		sum := sha256.Sum256([]byte(strings.ToLower(feed.Name) + "\x00" + stableID))
		item := Item{
			ExtID: hex.EncodeToString(sum[:]), Title: title,
			Summary: cleanText(raw.Description, 600), URL: link, Source: source,
		}
		if posted, ok := parseDate(raw.PubDate); ok {
			item.Posted = &posted
		}
		items = append(items, item)
	}
	return items, nil
}

type rssDocument struct {
	Channel struct {
		Items []rssItem `xml:"item"`
	} `xml:"channel"`
}

type rssItem struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	GUID        string `xml:"guid"`
	PubDate     string `xml:"pubDate"`
	Description string `xml:"description"`
	Source      string `xml:"source"`
}

func parseDate(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	formats := []string{
		time.RFC1123Z, time.RFC1123, time.RFC822Z, time.RFC822,
		time.RFC3339, "Mon, 2 Jan 2006 15:04:05 -0700",
	}
	for _, format := range formats {
		if parsed, err := time.Parse(format, value); err == nil {
			return parsed.UTC(), true
		}
	}
	return time.Time{}, false
}

func cleanText(value string, maxRunes int) string {
	value = html.UnescapeString(htmlTagPattern.ReplaceAllString(value, " "))
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if maxRunes > 0 && len(runes) > maxRunes {
		value = strings.TrimSpace(string(runes[:maxRunes])) + "…"
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
