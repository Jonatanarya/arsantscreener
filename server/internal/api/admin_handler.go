package api

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

type ResetDataRequest struct {
	Confirm bool `json:"confirm"`
}

// resetDataHandler powers the terminal's "Reset Data" button. Requires an
// explicit confirm:true in the body — not real security (this is a local
// single-user tool), just a guard against an empty/stray POST accidentally
// wiping everything.
func resetDataHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req ResetDataRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		if !req.Confirm {
			return badRequest(c, "confirm must be true")
		}
		results, err := store.ResetAllData(db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		var total int64
		for _, r := range results {
			if r.Rows > 0 {
				total += r.Rows
			}
		}
		// Ringkasan dikembalikan supaya UI bisa menyebut apa yang benar-benar
		// terhapus — dulu balasannya 204 kosong, jadi tidak ada cara memastikan
		// tabel yang dimaksud memang ikut dibersihkan.
		return c.JSON(fiber.Map{
			"status":     "ok",
			"tables":     results,
			"tableCount": len(results),
			"totalRows":  total,
		})
	}
}
