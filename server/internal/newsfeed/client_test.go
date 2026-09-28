package newsfeed

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFetchAllParsesRSSAndCleansDescription(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		_, _ = w.Write([]byte(`<?xml version="1.0"?><rss version="2.0"><channel><item>
			<title>BBCA membagikan dividen tunai</title>
			<link>https://example.test/news/1</link><guid>news-1</guid>
			<pubDate>Sun, 20 Sep 2026 08:30:00 +0700</pubDate>
			<description><![CDATA[<p>Laba naik &amp; kinerja positif.</p>]]></description>
		</item></channel></rss>`))
	}))
	defer server.Close()

	report, err := NewClient().FetchAll(context.Background(), []Feed{{Name: "Test Feed", URL: server.URL}})
	if err != nil {
		t.Fatalf("FetchAll() error = %v", err)
	}
	if report.SucceededFeeds != 1 || len(report.Items) != 1 {
		t.Fatalf("unexpected report: %+v", report)
	}
	item := report.Items[0]
	if item.Summary != "Laba naik & kinerja positif." {
		t.Fatalf("Summary = %q", item.Summary)
	}
	if len(item.ExtID) != 64 {
		t.Fatalf("ExtID length = %d", len(item.ExtID))
	}
	want := time.Date(2026, 9, 20, 1, 30, 0, 0, time.UTC)
	if item.Posted == nil || !item.Posted.Equal(want) {
		t.Fatalf("Posted = %v, want %v", item.Posted, want)
	}
}

func TestFetchAllKeepsSuccessfulFeed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<rss><channel><item><title>IHSG menguat</title><link>https://example.test/2</link></item></channel></rss>`))
	}))
	defer server.Close()

	report, err := NewClient().FetchAll(context.Background(), []Feed{
		{Name: "Good", URL: server.URL},
		{Name: "Bad", URL: "://invalid"},
	})
	if err != nil {
		t.Fatalf("FetchAll() error = %v", err)
	}
	if report.SucceededFeeds != 1 || len(report.FailedFeeds) != 1 || len(report.Items) != 1 {
		t.Fatalf("unexpected partial report: %+v", report)
	}
}
