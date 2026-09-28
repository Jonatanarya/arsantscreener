package api

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

var validCategories = map[string]bool{
	"proyek": true, "ekspansi": true, "tenant": true, "pabrik": true,
	"pemerintah": true, "makro": true, "lainnya": true,
}
var validImpacts = map[string]bool{"bullish": true, "bearish": true, "netral": true}
var validStatuses = map[string]bool{"rumor": true, "confirmed": true, "in_progress": true, "completed": true}
var validConfidences = map[string]bool{"rendah": true, "sedang": true, "tinggi": true}
var validAddedBy = map[string]bool{"riset": true, "manual": true}

func listCatalystsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		rows, err := store.ListCatalysts(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		out := make([]CatalystResponse, len(rows))
		for i, r := range rows {
			out[i] = toCatalystResponse(r)
		}
		return c.JSON(out)
	}
}

func createCatalystHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req CreateCatalystRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		if strings.TrimSpace(req.Description) == "" {
			return badRequest(c, "description is required")
		}
		if !validCategories[req.Category] {
			return badRequest(c, "category must be one of: proyek, ekspansi, tenant, pabrik, pemerintah, makro, lainnya")
		}
		if !validImpacts[req.Impact] {
			return badRequest(c, "impact must be one of: bullish, bearish, netral")
		}
		status := req.Status
		if status == "" {
			status = "rumor"
		}
		if !validStatuses[status] {
			return badRequest(c, "status must be one of: rumor, confirmed, in_progress, completed")
		}
		if req.Confidence != "" && !validConfidences[req.Confidence] {
			return badRequest(c, "confidence must be one of: rendah, sedang, tinggi")
		}
		addedBy := req.AddedBy
		if addedBy == "" {
			addedBy = "manual"
		}
		if !validAddedBy[addedBy] {
			return badRequest(c, "addedBy must be one of: riset, manual")
		}

		id, err := store.CreateCatalyst(db, store.NewCatalyst{
			Symbol: symbol, Category: req.Category, Description: strings.TrimSpace(req.Description),
			Impact: req.Impact, ExpectedPeriod: strPtr(req.ExpectedPeriod), Status: status,
			SourceURL: strPtr(req.SourceURL), SourceName: strPtr(req.SourceName),
			Confidence: strPtr(req.Confidence), AddedBy: addedBy,
		})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": id})
	}
}

func updateCatalystHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id, err := c.ParamsInt("id")
		if err != nil {
			return badRequest(c, "invalid id")
		}
		var req UpdateCatalystRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		if strings.TrimSpace(req.Description) == "" {
			return badRequest(c, "description is required")
		}
		if !validCategories[req.Category] {
			return badRequest(c, "category must be one of: proyek, ekspansi, tenant, pabrik, pemerintah, makro, lainnya")
		}
		if !validImpacts[req.Impact] {
			return badRequest(c, "impact must be one of: bullish, bearish, netral")
		}
		if !validStatuses[req.Status] {
			return badRequest(c, "status must be one of: rumor, confirmed, in_progress, completed")
		}
		if req.Confidence != "" && !validConfidences[req.Confidence] {
			return badRequest(c, "confidence must be one of: rendah, sedang, tinggi")
		}

		err = store.UpdateCatalyst(db, int64(id), store.CatalystUpdate{
			Category: req.Category, Description: strings.TrimSpace(req.Description), Impact: req.Impact,
			ExpectedPeriod: strPtr(req.ExpectedPeriod), Status: req.Status,
			SourceURL: strPtr(req.SourceURL), SourceName: strPtr(req.SourceName), Confidence: strPtr(req.Confidence),
		})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func deleteCatalystHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id, err := c.ParamsInt("id")
		if err != nil {
			return badRequest(c, "invalid id")
		}
		if err := store.DeleteCatalyst(db, int64(id)); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func strPtr(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

func toCatalystResponse(r store.CatalystRow) CatalystResponse {
	resp := CatalystResponse{
		ID: r.ID, Symbol: r.Symbol, Category: r.Category, Description: r.Description,
		Impact: r.Impact, Status: r.Status, AddedBy: r.AddedBy,
		CreatedAt: r.CreatedAt.Format(time.RFC3339), UpdatedAt: r.UpdatedAt.Format(time.RFC3339),
	}
	if r.ExpectedPeriod != nil {
		resp.ExpectedPeriod = *r.ExpectedPeriod
	}
	if r.SourceURL != nil {
		resp.SourceURL = *r.SourceURL
	}
	if r.SourceName != nil {
		resp.SourceName = *r.SourceName
	}
	if r.Confidence != nil {
		resp.Confidence = *r.Confidence
	}
	return resp
}
