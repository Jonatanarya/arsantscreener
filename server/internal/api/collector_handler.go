package api

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
)

// Endpoint penampung untuk bridge-extension "Data Collector". Endpoint Stockbit
// yang sudah punya route khusus (bars, broker-range, keystats, financial
// statements, market movers, insider) tetap lewat route masing-masing; sisanya
// mendarat di sini apa adanya supaya tidak ada data crawl yang hilang.

type IngestRawRequest struct {
	Source    string          `json:"source"`
	Endpoint  string          `json:"endpoint"`
	Symbol    string          `json:"symbol"`
	Variant   string          `json:"variant"`
	URL       string          `json:"url"`
	Params    json.RawMessage `json:"params"`
	Payload   json.RawMessage `json:"payload"`
	FetchedAt string          `json:"fetchedAt"`
}

func ingestRawHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestRawRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body: "+err.Error())
		}
		endpoint := strings.TrimSpace(req.Endpoint)
		if endpoint == "" {
			return badRequest(c, "endpoint is required")
		}
		if len(req.Payload) == 0 {
			return badRequest(c, "payload is required")
		}

		row := store.RawIngestRow{
			Source:    strings.TrimSpace(req.Source),
			Endpoint:  endpoint,
			Symbol:    strings.ToUpper(strings.TrimSpace(req.Symbol)),
			Variant:   truncate(strings.TrimSpace(req.Variant), 96),
			URL:       truncate(req.URL, 700),
			Params:    req.Params,
			Payload:   req.Payload,
			FetchedAt: parseFetchedAt(req.FetchedAt),
		}
		if err := store.UpsertRawIngest(db, row); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		_ = store.ProcessRawIngestPayload(db, row)
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func listRawIngestHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit"))
		rows, err := store.ListRawIngest(db,
			strings.ToUpper(strings.TrimSpace(c.Query("symbol"))),
			strings.TrimSpace(c.Query("endpoint")),
			limit)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}

// Rekap per endpoint — dipakai untuk memastikan tiap endpoint collector
// benar-benar mendarat di database setelah crawl berjalan.
func rawIngestStatsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := store.RawIngestStats(db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}

func getRawIngestHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		row, err := store.GetRawIngest(db,
			strings.TrimSpace(c.Query("endpoint")),
			strings.ToUpper(strings.TrimSpace(c.Query("symbol"))),
			strings.TrimSpace(c.Query("variant")))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		if row == nil {
			return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{Error: "not found"})
		}
		return c.JSON(row)
	}
}

// Dipakai Data Collector sebelum menarik satu emiten: apa yang sudah ada di
// database tidak perlu ditarik lagi. Jendela histori yang sudah lewat bersifat
// tetap, jadi cukup diambil sekali; hanya jendela yang menyentuh hari ini yang
// disegarkan.
func coverageHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// symbol kosong = cakupan endpoint GLOBAL (market mover, papan khusus,
		// dsb) yang memang disimpan dengan symbol=''. Bukan error.
		symbol := strings.ToUpper(strings.TrimSpace(c.Query("symbol")))
		cov, err := store.GetCoverage(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(cov)
	}
}

type IngestClassificationGorengan struct {
	Is      bool     `json:"is"`
	Score   int      `json:"score"`
	Reasons []string `json:"reasons"`
}

type IngestClassificationRequest struct {
	Symbol       string                       `json:"symbol"`
	Tier         string                       `json:"tier"`
	MarketCap    float64                      `json:"marketCap"`
	Categories   []string                     `json:"categories"`
	Gorengan     IngestClassificationGorengan `json:"gorengan"`
	ClassifiedAt string                       `json:"classifiedAt"`
}

func ingestClassificationHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestClassificationRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body: "+err.Error())
		}
		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}

		reasons, _ := json.Marshal(req.Gorengan.Reasons)
		categories, _ := json.Marshal(req.Categories)

		row := store.StockClassificationRow{
			Symbol:          symbol,
			Tier:            strings.TrimSpace(req.Tier),
			MarketCap:       req.MarketCap,
			IsGorengan:      req.Gorengan.Is,
			GorenganScore:   req.Gorengan.Score,
			GorenganReasons: reasons,
			Categories:      categories,
			ClassifiedAt:    parseFetchedAt(req.ClassifiedAt),
		}
		if err := store.UpsertStockClassification(db, row); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func listClassificationHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := store.ListStockClassification(db,
			strings.TrimSpace(c.Query("tier")),
			c.Query("gorengan") == "1" || c.Query("gorengan") == "true")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(rows)
	}
}

// Extension mengirim waktu sebagai ISO-8601; toleran juga terhadap epoch
// milidetik dan nilai kosong.
func parseFetchedAt(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Now()
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC()
	}
	if ms, err := strconv.ParseInt(s, 10, 64); err == nil && ms > 0 {
		return time.UnixMilli(ms).UTC()
	}
	return time.Now()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
