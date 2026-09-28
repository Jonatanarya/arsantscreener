package api

import (
	"context"
	"database/sql"
	"net/url"
	"path/filepath"
	"testing"
)

func TestUsageReadsLiveWALAndDoesNotDoubleCountCachedTokens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.sqlite")
	writer, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	for _, q := range []string{
		`PRAGMA journal_mode=WAL`,
		`CREATE TABLE usageHistory(id INTEGER PRIMARY KEY AUTOINCREMENT,apiKey TEXT,promptTokens INTEGER,completionTokens INTEGER,timestamp TEXT,tokens TEXT,model TEXT,provider TEXT,status TEXT)`,
		`INSERT INTO usageHistory(apiKey,promptTokens,completionTokens,timestamp,tokens) VALUES ('test-only-key',100,25,'2026-09-03T01:00:00Z','{"cached_tokens":50}')`,
	} {
		if _, err = writer.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	uri := url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(path)}
	q := uri.Query()
	q.Set("mode", "ro")
	uri.RawQuery = q.Encode()
	reader, err := sql.Open("sqlite", uri.String())
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	events, err := readSourceUsage(context.Background(), reader)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Input+events[0].Output != 125 {
		t.Fatalf("incorrect token accounting: %+v", events)
	}
	if _, err = reader.Exec(`DELETE FROM usageHistory`); err == nil {
		t.Fatal("source must be read-only")
	}
	if _, err = writer.Exec(`INSERT INTO usageHistory(apiKey,promptTokens,completionTokens,timestamp) VALUES ('test-only-key',10,2,'2026-09-03T02:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	events, err = readSourceUsage(context.Background(), reader)
	if err != nil || len(events) != 2 {
		t.Fatalf("live WAL not visible: %v", err)
	}
}

func TestUsageRejectsNegativeCounts(t *testing.T) {
	source, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	source.Exec(`CREATE TABLE usageHistory(id INTEGER,apiKey TEXT,promptTokens INTEGER,completionTokens INTEGER,timestamp TEXT,model TEXT,provider TEXT,status TEXT)`)
	source.Exec(`INSERT INTO usageHistory VALUES (1,'test',-1,5,'now','','','')`)
	if _, err = readSourceUsage(context.Background(), source); err == nil {
		t.Fatal("negative source usage accepted")
	}
}

func TestUsageKeyHashSeparatesOwners(t *testing.T) {
	if usageKeyHash("customer-a") == usageKeyHash("customer-b") {
		t.Fatal("key collision")
	}
	if len(usageKeyHash("customer-a")) != 64 {
		t.Fatal("invalid fingerprint")
	}
	var unavailable *routerUsage
	if _, err := unavailable.stats("user"); err == nil {
		t.Fatal("unavailable usage must not return zero balance")
	}
}

func TestPublicModelLabelHidesProviderTargets(t *testing.T) {
	labels := map[string]string{}
	for _, name := range []string{"DeepSeek-V4.1-Flash", "GLM-5.3-Flash", "Gemini-3.8-flash", "Kimi-K3", "Mimo-v2.5-Pro", "MiniMax-M3", "Qwen3.8-27B"} {
		for _, variant := range usageModelVariants(name) {
			if labels[variant] == "" {
				labels[variant] = name
			}
		}
	}
	for _, tc := range []struct {
		model, want string
	}{
		{"openrouter/deepseek/deepseek-v4.1-flash", "DeepSeek-V4.1-Flash"},
		{"orca/z-ai/glm-5.3-flash-free", "GLM-5.3-Flash"},
		{"ag/gemini-3.8-flash", "Gemini-3.8-flash"},
		{"alibaba/kimi-k3", "Kimi-K3"},
		{"vercel/xiaomi/mimo-v2.5-pro", "Mimo-v2.5-Pro"},
		{"MiniMaxAI/MiniMax-M3", "MiniMax-M3"},
		{"Qwen/Qwen3.8-27B", "Qwen3.8-27B"},
	} {
		if got := publicModelLabel(tc.model, "", labels); got != tc.want {
			t.Fatalf("model %q mapped to %q, want %q", tc.model, got, tc.want)
		}
	}
	if got := publicModelLabel("provider/internal-secret-model", "provider", labels); got != "" {
		t.Fatalf("unmapped provider leaked as %q", got)
	}
}
