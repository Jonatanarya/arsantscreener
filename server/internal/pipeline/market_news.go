package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/newsfeed"
	"tradewise/server/internal/store"
)

const (
	marketNewsSource  = "market_news"
	marketNewsJobType = "market_news.sync"
)

var defaultNewsFeeds = []newsfeed.Feed{
	{Name: "ANTARA Bursa", URL: "https://www.antaranews.com/rss/ekonomi-bursa.xml"},
	{Name: "ANTARA Finansial", URL: "https://www.antaranews.com/rss/ekonomi-finansial.xml"},
	{Name: "ANTARA Bisnis", URL: "https://www.antaranews.com/rss/ekonomi-bisnis.xml"},
}

type MarketNews struct {
	db     *sqlx.DB
	client *newsfeed.Client
	feeds  []newsfeed.Feed
	now    func() time.Time
}

func NewMarketNews(db *sqlx.DB, client *newsfeed.Client, feeds []newsfeed.Feed) *MarketNews {
	if client == nil {
		client = newsfeed.NewClient()
	}
	if len(feeds) == 0 {
		feeds = append([]newsfeed.Feed(nil), defaultNewsFeeds...)
	}
	return &MarketNews{db: db, client: client, feeds: feeds, now: time.Now}
}

func (m *MarketNews) Schedule(ctx context.Context) (int, error) {
	enabled, err := store.DataSourceEnabled(ctx, m.db, marketNewsSource)
	if err != nil {
		return 0, err
	}
	if !enabled {
		return 0, nil
	}
	bucket := m.now().UTC().Truncate(15 * time.Minute)
	_, err = store.EnqueueDataJob(ctx, m.db, store.EnqueueDataJobParams{
		SourceCode:  marketNewsSource,
		JobType:     marketNewsJobType,
		Priority:    900,
		MaxAttempts: 3,
		DedupeKey:   fmt.Sprintf("%s:%s", marketNewsJobType, bucket.Format("20060102T1504Z")),
	})
	if err != nil {
		return 0, err
	}
	return 1, nil
}

func (m *MarketNews) Handle(ctx context.Context, _ store.DataJob) (store.DataRunResult, error) {
	report, err := m.client.FetchAll(ctx, m.feeds)
	if err != nil {
		count, latest, _ := store.NewsCoverage(m.db)
		_ = store.UpsertDataFreshness(ctx, m.db, marketNewsSource, "market_news", "", "error", latest, count, err.Error())
		return store.DataRunResult{}, err
	}
	symbols, err := store.ListSymbols(m.db)
	if err != nil {
		return store.DataRunResult{}, err
	}
	companies := make([]newsfeed.Company, 0, len(symbols))
	for _, symbol := range symbols {
		companies = append(companies, newsfeed.Company{Symbol: symbol.Code, Name: symbol.Name})
	}
	analyzer := newsfeed.NewAnalyzer(companies)
	inputs := make([]store.NewsInput, 0, len(report.Items))
	for _, item := range report.Items {
		analysis := analyzer.Analyze(item.Title, item.Summary)
		title, summary, url, source := item.Title, item.Summary, item.URL, item.Source
		input := store.NewsInput{
			ExtID: item.ExtID, Title: title, URL: &url, Source: &source,
			Topic: analysis.Topic, Sentiment: analysis.Sentiment, PostedAt: item.Posted,
			Impacts: make([]store.NewsImpactInput, 0, len(analysis.Impacts)),
		}
		if summary != "" {
			input.Summary = &summary
		}
		for _, impact := range analysis.Impacts {
			input.Impacts = append(input.Impacts, store.NewsImpactInput{
				Symbol: impact.Symbol, Sentiment: impact.Sentiment,
				Confidence: impact.Confidence, Reason: impact.Reason,
			})
		}
		if len(input.Impacts) == 1 {
			symbol := input.Impacts[0].Symbol
			input.Symbol = &symbol
		}
		inputs = append(inputs, input)
	}
	before, _, err := store.NewsCoverage(m.db)
	if err != nil {
		return store.DataRunResult{}, err
	}
	if err := store.UpsertNews(m.db, inputs); err != nil {
		return store.DataRunResult{}, err
	}
	after, latest, err := store.NewsCoverage(m.db)
	if err != nil {
		return store.DataRunResult{}, err
	}
	written := uint64(0)
	if after > before {
		written = after - before
	}
	skipped := uint64(0)
	if uint64(len(inputs)) > written {
		skipped = uint64(len(inputs)) - written
	}
	status := "fresh"
	lastError := ""
	if len(report.FailedFeeds) > 0 {
		status = "partial"
		parts := make([]string, 0, len(report.FailedFeeds))
		for feed, message := range report.FailedFeeds {
			parts = append(parts, feed+": "+message)
		}
		lastError = strings.Join(parts, "; ")
	}
	if err := store.UpsertDataFreshness(ctx, m.db, marketNewsSource, "market_news", "", status, latest, after, lastError); err != nil {
		return store.DataRunResult{}, err
	}
	metadata, _ := json.Marshal(map[string]any{
		"feedsSucceeded": report.SucceededFeeds,
		"feedsFailed":    report.FailedFeeds,
		"articles":       len(report.Items),
		"totalStored":    after,
	})
	return store.DataRunResult{
		ItemsRead: uint64(len(report.Items)), ItemsWritten: written,
		ItemsSkipped: skipped, Metadata: metadata,
	}, nil
}

func ParseNewsFeeds(raw string) []newsfeed.Feed {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	feeds := make([]newsfeed.Feed, 0, len(parts))
	for index, part := range parts {
		url := strings.TrimSpace(part)
		if url == "" {
			continue
		}
		feeds = append(feeds, newsfeed.Feed{Name: fmt.Sprintf("News Feed %d", index+1), URL: url})
	}
	return feeds
}
