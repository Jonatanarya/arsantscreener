package api

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/stockbitagent"
	"tradewise/server/internal/store"
)

func brokerSummaryHealthHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit"))
		if limit < 1 || limit > 1000 {
			limit = 300
		}
		target, err := store.LatestOverallBarDate(c.UserContext(), db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if target == nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(ErrorResponse{Error: "market date is unavailable"})
		}
		health, err := store.ReadBrokerSummaryHealth(c.UserContext(), db, *target, limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(health)
	}
}

func brokerSessionProxyHandler(method, targetPath string, maxBytes int64) fiber.Handler {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("ARSANT_BROKER_AGENT_URL")), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:4311"
	}
	client := &http.Client{Timeout: 45 * time.Second}
	return func(c *fiber.Ctx) error {
		var body io.Reader
		if method == http.MethodPost {
			body = bytes.NewReader(c.Body())
		}
		request, err := http.NewRequestWithContext(c.UserContext(), method, baseURL+targetPath, body)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "viewer request could not be created"})
		}
		if contentType := c.Get("Content-Type"); contentType != "" {
			request.Header.Set("Content-Type", contentType)
		}
		response, err := client.Do(request)
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(ErrorResponse{Error: "data session viewer is unavailable"})
		}
		defer response.Body.Close()
		data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
		if err != nil || int64(len(data)) > maxBytes {
			return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{Error: "invalid viewer response"})
		}
		if contentType := response.Header.Get("Content-Type"); contentType != "" {
			c.Set("Content-Type", contentType)
		}
		c.Set("Cache-Control", "no-store")
		return c.Status(response.StatusCode).Send(data)
	}
}

func brokerSessionHealthHandler() fiber.Handler {
	client := stockbitagent.NewClient(os.Getenv("ARSANT_BROKER_AGENT_URL"))
	return func(c *fiber.Ctx) error {
		health, err := client.Health(c.UserContext())
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(health)
	}
}
