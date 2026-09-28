// Package ai turns the per-symbol outlook data TradeWise Terminal already
// collects into a plain-language narrative via Google's Gemini API. The
// API key is supplied by the caller per request (the user's own key,
// entered in the web frontend and kept in the browser) — this package
// never stores or logs it.
package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const geminiEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"

type GeminiClient struct {
	http *http.Client
}

func NewGeminiClient() *GeminiClient {
	return &GeminiClient{http: &http.Client{Timeout: 45 * time.Second}}
}

type geminiRequest struct {
	Contents         []geminiContent `json:"contents"`
	GenerationConfig geminiGenConfig `json:"generationConfig"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiGenConfig struct {
	Temperature     float64 `json:"temperature"`
	TopK            int     `json:"topK"`
	TopP            float64 `json:"topP"`
	MaxOutputTokens int     `json:"maxOutputTokens"`
}

type geminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
	PromptFeedback *struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
}

// GenerateAnalysis sends prompt to Gemini using the caller-supplied API
// key and returns the model's plain-text response.
func (c *GeminiClient) GenerateAnalysis(apiKey, prompt string) (string, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return "", fmt.Errorf("gemini: api key kosong")
	}

	reqBody := geminiRequest{
		Contents: []geminiContent{{Parts: []geminiPart{{Text: prompt}}}},
		GenerationConfig: geminiGenConfig{
			Temperature: 0.6, TopK: 40, TopP: 0.95, MaxOutputTokens: 2048,
		},
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("gemini: marshal request: %w", err)
	}

	url := fmt.Sprintf("%s?key=%s", geminiEndpoint, apiKey)
	httpReq, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("gemini: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	res, err := c.http.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("gemini: request failed: %w", err)
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return "", fmt.Errorf("gemini: read response: %w", err)
	}

	var parsed geminiResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", fmt.Errorf("gemini: parse response: %w", err)
	}
	if res.StatusCode != http.StatusOK {
		if parsed.Error != nil && parsed.Error.Message != "" {
			return "", fmt.Errorf("gemini: %s", parsed.Error.Message)
		}
		return "", fmt.Errorf("gemini: HTTP %d", res.StatusCode)
	}
	if parsed.PromptFeedback != nil && parsed.PromptFeedback.BlockReason != "" {
		return "", fmt.Errorf("gemini: prompt diblokir (%s)", parsed.PromptFeedback.BlockReason)
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini: respons kosong")
	}

	var sb strings.Builder
	for _, p := range parsed.Candidates[0].Content.Parts {
		sb.WriteString(p.Text)
	}
	text := strings.TrimSpace(sb.String())
	if text == "" {
		return "", fmt.Errorf("gemini: respons kosong")
	}
	return text, nil
}
