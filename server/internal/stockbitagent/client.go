package stockbitagent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	http    *http.Client
}

type Health struct {
	Status           string     `json:"status"`
	BrowserConnected bool       `json:"browserConnected"`
	Authenticated    bool       `json:"authenticated"`
	ExpiresAt        *time.Time `json:"expiresAt"`
	CapturedAt       *time.Time `json:"capturedAt"`
	LastFetchAt      *time.Time `json:"lastFetchAt"`
	PageURL          string     `json:"pageUrl"`
	Error            *string    `json:"error"`
}

type AgentError struct {
	StatusCode int
	Message    string
}

func (e *AgentError) Error() string { return e.Message }

func NewClient(baseURL string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:4311"
	}
	return &Client{baseURL: baseURL, http: &http.Client{Timeout: 45 * time.Second}}
}

func (c *Client) Health(ctx context.Context) (Health, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return Health{}, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return Health{}, fmt.Errorf("stockbit session agent health: %w", err)
	}
	defer response.Body.Close()
	var health Health
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&health); err != nil {
		return Health{}, fmt.Errorf("decode stockbit session health: %w", err)
	}
	return health, nil
}

func (c *Client) FetchBrokerSummary(ctx context.Context, symbol, date string) (json.RawMessage, error) {
	body, _ := json.Marshal(map[string]string{"symbol": symbol, "date": date})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/broker-summary", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("stockbit session agent request: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("read stockbit session response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		var envelope struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &envelope)
		if envelope.Error == "" {
			envelope.Error = fmt.Sprintf("stockbit session agent returned HTTP %d", response.StatusCode)
		}
		return nil, &AgentError{StatusCode: response.StatusCode, Message: envelope.Error}
	}
	var envelope struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil || len(envelope.Payload) == 0 {
		return nil, fmt.Errorf("decode stockbit broker summary response")
	}
	return envelope.Payload, nil
}
