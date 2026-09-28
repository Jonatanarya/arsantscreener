package api

import (
	"crypto/subtle"

	"github.com/gofiber/fiber/v2"
)

// RequireIngestAPIKey protects collector write endpoints when the API is exposed
// outside the local machine. An empty configured key keeps local development simple.
func RequireIngestAPIKey(key string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		provided := c.Get("X-API-Key")
		if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(key)) != 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid API key"})
		}
		return c.Next()
	}
}
