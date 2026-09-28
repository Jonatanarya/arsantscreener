package api

import (
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/store"
	"tradewise/server/internal/yahoofinance"
)

// macroFetchConcurrency caps simultaneous Yahoo Finance calls per request.
const macroFetchConcurrency = 4

// macroInstruments is the fixed dashboard set — deliberately small and
// hardcoded rather than configurable, since the user chose "live-only, no
// manual entries" and this is exactly the subset Yahoo Finance can serve
// reliably (BI Rate/Fed Rate/Nickel/Coal have no clean Yahoo ticker).
// Group memisahkan komoditas/kurs (dipakai tag sensitivitas macro) dari
// indeks & kripto global yang hanya menjadi ticker Market Overview di
// header — panel Macro menyaring dengan field ini agar daftar tagnya tidak
// ikut membengkak.
var macroInstruments = []struct {
	Ticker string
	Name   string
	Group  string // komoditas | kurs | indeks | kripto
}{
	{"USDIDR=X", "USD/IDR", "kurs"},
	{"CL=F", "Minyak WTI", "komoditas"},
	{"BZ=F", "Minyak Brent", "komoditas"},
	{"GC=F", "Emas", "komoditas"},
	{"HG=F", "Tembaga", "komoditas"},
	{"^JKSE", "IHSG", "indeks"},

	// Bursa Asia — jam perdagangannya beririsan dengan IDX, jadi ini yang
	// paling sering menjelaskan gap pembukaan.
	{"^N225", "Nikkei 225", "asia"},
	{"^HSI", "Hang Seng", "asia"},
	{"000001.SS", "Shanghai Composite", "asia"},
	{"^KS11", "KOSPI", "asia"},
	{"^TWII", "Taiwan Weighted", "asia"},
	{"^STI", "Straits Times", "asia"},
	{"^KLSE", "FTSE Malaysia KLCI", "asia"},
	{"^SET.BK", "SET Thailand", "asia"},
	{"^BSESN", "BSE Sensex", "asia"},
	{"^AXJO", "ASX 200", "asia"},

	// Bursa Amerika — tutup saat IDX buka, jadi ini konteks semalam.
	{"^GSPC", "S&P 500", "amerika"},
	{"^IXIC", "Nasdaq Composite", "amerika"},
	{"^DJI", "Dow Jones", "amerika"},
	{"^RUT", "Russell 2000", "amerika"},
	{"^VIX", "VIX", "amerika"},
	{"^GSPTSE", "S&P/TSX Toronto", "amerika"},
	{"^BVSP", "Bovespa Brazil", "amerika"},

	{"BTC-USD", "Bitcoin", "kripto"},
	{"ETH-USD", "Ethereum", "kripto"},
}

func ingestMacroHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestMacroQuoteRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		if req.Ticker == "" || req.Price == 0 {
			return badRequest(c, "ticker and price are required")
		}
		if req.Name == "" {
			req.Name = req.Ticker
		}
		if req.Currency == "" {
			req.Currency = "IDR"
		}
		row := store.MacroQuoteRow{
			Ticker:        req.Ticker,
			Name:          req.Name,
			Price:         req.Price,
			Currency:      req.Currency,
			ChangePercent: req.ChangePercent,
		}
		if err := store.UpsertMacroQuote(db, row); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.JSON(fiber.Map{"status": "ok"})
	}
}

func getMacroHandler(db *sqlx.DB, yf *yahoofinance.Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows := make([]MacroQuoteResponse, len(macroInstruments))
		// Konkurensi dibatasi: daftar instrumen tumbuh jadi selusin sejak
		// ticker Market Overview ikut di sini, dan Yahoo Finance sudah
		// terbukti membalas 429 kalau dihujani serentak.
		sem := make(chan struct{}, macroFetchConcurrency)
		var wg sync.WaitGroup
		for i, inst := range macroInstruments {
			wg.Add(1)
			go func(i int, ticker, name, group string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				r := fetchMacroQuote(db, yf, ticker, name)
				r.Group = group
				rows[i] = r
			}(i, inst.Ticker, inst.Name, inst.Group)
		}
		wg.Wait()

		return c.JSON(rows)
	}
}

// fetchMacroQuote always hits Yahoo Finance directly first — no DB read
// gates whether the external call happens, so every GET /macro poll returns
// a genuinely live price instead of whatever was cached up to an hour ago.
// The DB is only touched as: (a) a write-through after a successful fetch,
// which is also how ai_handler's macro context (GetMacroQuote for ^JKSE /
// USDIDR=X) stays populated, and (b) a last-resort fallback when Yahoo
// itself fails or rate-limits (429), so the panel shows a stale-but-labeled
// price instead of going blank.
func fetchMacroQuote(db *sqlx.DB, yf *yahoofinance.Client, ticker, name string) MacroQuoteResponse {
	q, err := yf.FetchQuote(ticker)
	if err != nil {
		if cached, cErr := store.GetMacroQuote(db, ticker); cErr == nil && cached != nil {
			return toMacroQuoteResponse(*cached, true, "gagal ambil data terbaru: "+err.Error())
		}
		return MacroQuoteResponse{Ticker: ticker, Name: name, Error: "gagal ambil data: " + err.Error()}
	}

	live := MacroQuoteResponse{
		Ticker: ticker, Name: name, Price: q.Price, Currency: q.Currency,
		ChangePercent: q.ChangePercent, FetchedAt: time.Now().Format(time.RFC3339),
	}

	row := store.MacroQuoteRow{Ticker: ticker, Name: name, Price: q.Price, Currency: q.Currency, ChangePercent: q.ChangePercent}
	if err := store.UpsertMacroQuote(db, row); err != nil {
		// Quote-nya sendiri valid dan baru saja diambil — kegagalan simpan ke
		// DB tidak boleh menutupi itu, cukup kembalikan apa adanya.
		return live
	}
	reloaded, err := store.GetMacroQuote(db, ticker)
	if err != nil || reloaded == nil {
		return live
	}
	return toMacroQuoteResponse(*reloaded, false, "")
}

func toMacroQuoteResponse(r store.MacroQuoteRow, stale bool, errMsg string) MacroQuoteResponse {
	return MacroQuoteResponse{
		Ticker: r.Ticker, Name: r.Name, Price: r.Price, Currency: r.Currency,
		ChangePercent: r.ChangePercent, FetchedAt: r.FetchedAt.Format(time.RFC3339),
		Stale: stale, Error: errMsg,
	}
}

var validFactors = map[string]bool{
	"usdidr": true, "oil": true, "gold": true, "copper": true,
	"nickel": true, "coal": true, "bi_rate": true, "fed_rate": true, "other": true,
}
var validImpactDirections = map[string]bool{"diuntungkan": true, "dirugikan": true}

func listMacroSensitivityHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		rows, err := store.ListMacroSensitivity(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		out := make([]MacroSensitivityResponse, len(rows))
		for i, r := range rows {
			out[i] = toMacroSensitivityResponse(r)
		}
		return c.JSON(out)
	}
}

func createMacroSensitivityHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req CreateMacroSensitivityRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		if !validFactors[req.Factor] {
			return badRequest(c, "factor must be one of: usdidr, oil, gold, copper, nickel, coal, bi_rate, fed_rate, other")
		}
		if !validImpactDirections[req.ImpactDirection] {
			return badRequest(c, "impactDirection must be one of: diuntungkan, dirugikan")
		}

		var note *string
		if trimmed := strings.TrimSpace(req.Note); trimmed != "" {
			note = &trimmed
		}

		id, err := store.CreateMacroSensitivity(db, store.NewMacroSensitivity{
			Symbol: symbol, Factor: req.Factor, ImpactDirection: req.ImpactDirection, Note: note,
		})
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": id})
	}
}

func deleteMacroSensitivityHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id, err := c.ParamsInt("id")
		if err != nil {
			return badRequest(c, "invalid id")
		}
		if err := store.DeleteMacroSensitivity(db, int64(id)); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
}

func toMacroSensitivityResponse(r store.MacroSensitivityRow) MacroSensitivityResponse {
	resp := MacroSensitivityResponse{
		ID: r.ID, Symbol: r.Symbol, Factor: r.Factor, ImpactDirection: r.ImpactDirection,
		CreatedAt: r.CreatedAt.Format(time.RFC3339),
	}
	if r.Note != nil {
		resp.Note = *r.Note
	}
	return resp
}
