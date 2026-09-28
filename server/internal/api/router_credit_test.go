package api

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestRouterCreditAdmission(t *testing.T) {
	tests := []struct {
		name, uri, header, key string
		want                   int
	}{
		{"empty balance", "/v1/chat/completions", "Authorization", "Bearer sk-empty", 403},
		{"positive balance", "/v1/chat/completions", "Authorization", "Bearer sk-funded", 204},
		{"anthropic empty", "/v1/messages", "X-Api-Key", "sk-empty", 403},
		{"gemini empty", "/v1beta/models/test:generateContent", "X-Goog-Api-Key", "sk-empty", 403},
		{"query key", "/v1beta/models?key=sk-empty", "", "", 403},
		{"missing key", "/v1/models", "", "", 401},
		{"invalid key", "/api/v1/responses", "Authorization", "Bearer invalid", 401},
		{"database unavailable", "/v1/responses", "Authorization", "Bearer sk-unavailable", 503},
		{"operator dashboard", "/dashboard", "", "", 204},
		{"alternate path with customer key", "/other", "Authorization", "Bearer sk-empty", 403},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			app.Get("/check", routerCreditHandler(func(key string) int {
				switch key {
				case "sk-empty":
					return 403
				case "sk-funded":
					return 204
				case "sk-unavailable":
					return 503
				default:
					return 401
				}
			}))
			req := httptest.NewRequest("GET", "/check", nil)
			req.Header.Set("X-Original-URI", tc.uri)
			if tc.header != "" {
				req.Header.Set(tc.header, tc.key)
			}
			response, err := app.Test(req)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != tc.want {
				t.Fatalf("got %d want %d", response.StatusCode, tc.want)
			}
		})
	}
}

func TestConflictingCredentialsCannotBypassQuota(t *testing.T) {
	app := fiber.New()
	app.Get("/check", routerCreditHandler(func(key string) int {
		if key == "sk-empty" {
			return 403
		}
		return 204
	}))
	req := httptest.NewRequest("GET", "/check", nil)
	req.Header.Set("X-Original-URI", "/v1/messages")
	req.Header.Set("Authorization", "Bearer sk-empty")
	req.Header.Set("X-Api-Key", "sk-funded")
	response, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("conflicting credential bypass")
	}
}
