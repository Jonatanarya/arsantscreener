package api

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

type pipelineControlRequest struct {
	Paused *bool `json:"paused"`
}

type dataSourceControlRequest struct {
	Enabled *bool `json:"enabled"`
}

type enqueueDataJobRequest struct {
	SourceCode   string          `json:"sourceCode"`
	JobType      string          `json:"jobType"`
	Symbol       string          `json:"symbol"`
	Priority     int             `json:"priority"`
	MaxAttempts  uint            `json:"maxAttempts"`
	ScheduledFor string          `json:"scheduledFor"`
	RunAfter     string          `json:"runAfter"`
	DedupeKey    string          `json:"dedupeKey"`
	Payload      json.RawMessage `json:"payload"`
}

func pipelineStatusHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		status, err := store.PipelineStatus(c.UserContext(), db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(status)
	}
}

func listPipelineJobsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit"))
		jobs, err := store.ListDataJobs(c.UserContext(), db, c.Query("status"), limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(jobs)
	}
}

func listPipelineFreshnessHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit"))
		rows, err := store.ListDataFreshness(c.UserContext(), db, c.Query("dataset"), c.Query("symbol"), limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}

func enqueuePipelineJobHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req enqueueDataJobRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		if strings.TrimSpace(req.SourceCode) == "" || strings.TrimSpace(req.JobType) == "" {
			return badRequest(c, "sourceCode and jobType are required")
		}
		parseOptionalTime := func(value string) (time.Time, error) {
			if strings.TrimSpace(value) == "" {
				return time.Time{}, nil
			}
			return time.Parse(time.RFC3339, value)
		}
		scheduledFor, err := parseOptionalTime(req.ScheduledFor)
		if err != nil {
			return badRequest(c, "scheduledFor must use RFC3339")
		}
		runAfter, err := parseOptionalTime(req.RunAfter)
		if err != nil {
			return badRequest(c, "runAfter must use RFC3339")
		}
		jobID, err := store.EnqueueDataJob(c.UserContext(), db, store.EnqueueDataJobParams{
			SourceCode: req.SourceCode, JobType: req.JobType, Symbol: req.Symbol,
			Priority: req.Priority, MaxAttempts: req.MaxAttempts,
			ScheduledFor: scheduledFor, RunAfter: runAfter,
			DedupeKey: req.DedupeKey, Payload: req.Payload,
		})
		if errors.Is(err, store.ErrPipelineSourceNotFound) {
			return badRequest(c, "unknown sourceCode")
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": jobID, "status": "pending"})
	}
}

func retryPipelineJobHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id, err := strconv.ParseUint(c.Params("id"), 10, 64)
		if err != nil || id == 0 {
			return badRequest(c, "invalid job id")
		}
		updated, err := store.RetryDataJob(c.UserContext(), db, id)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if !updated {
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{Error: "job is not retryable"})
		}
		return c.JSON(fiber.Map{"id": id, "status": "pending"})
	}
}

func pipelineControlHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req pipelineControlRequest
		if err := c.BodyParser(&req); err != nil || req.Paused == nil {
			return badRequest(c, "paused is required")
		}
		if err := store.SetPipelinePaused(c.UserContext(), db, *req.Paused); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"paused": *req.Paused})
	}
}

func dataSourceControlHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req dataSourceControlRequest
		if err := c.BodyParser(&req); err != nil || req.Enabled == nil {
			return badRequest(c, "enabled is required")
		}
		updated, err := store.SetDataSourceEnabled(c.UserContext(), db, c.Params("code"), *req.Enabled)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if !updated {
			return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{Error: "data source not found"})
		}
		return c.JSON(fiber.Map{"code": c.Params("code"), "enabled": *req.Enabled})
	}
}
