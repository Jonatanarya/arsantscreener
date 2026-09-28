package api

import (
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/maintenance"
)

type maintenanceRunRequest struct {
	DryRun  *bool `json:"dryRun"`
	Confirm bool  `json:"confirm"`
}

func maintenancePreviewHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		policy := maintenance.DefaultPolicy()
		counts, err := maintenance.Preview(c.UserContext(), db, policy)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"dryRun": true, "policy": policy, "candidates": counts})
	}
}

func maintenanceRunHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req maintenanceRunRequest
		if len(c.Body()) > 0 {
			if err := c.BodyParser(&req); err != nil {
				return badRequest(c, "invalid JSON body")
			}
		}
		dryRun := true
		if req.DryRun != nil {
			dryRun = *req.DryRun
		}
		if !dryRun && !req.Confirm {
			return badRequest(c, "confirm=true is required when dryRun=false")
		}
		report, err := maintenance.Run(c.UserContext(), db, maintenance.DefaultPolicy(), dryRun, 2000)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(report)
	}
}

func maintenanceRunsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit"))
		runs, err := maintenance.ListRuns(c.UserContext(), db, limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(runs)
	}
}
