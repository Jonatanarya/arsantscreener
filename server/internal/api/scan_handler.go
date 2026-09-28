package api

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

const (
	scanLookbackMonths     = 6
	scanDefaultWindow      = 10
	scanDefaultSensitivity = analytics.SensitivityMedium
)

const scanCacheTTL = 5 * time.Minute

var scanCache = struct {
	sync.RWMutex
	rows      []ScanRow
	updatedAt time.Time
}{}

var scanBuildMu sync.Mutex

func ingestScreenerHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestScreenerRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "invalid body: " + err.Error()})
		}
		if len(req.Results) == 0 {
			return c.JSON(fiber.Map{"status": "ok", "ingested": 0})
		}

		nowDate := req.Date
		if nowDate == "" {
			nowDate = time.Now().Format("2006-01-02")
		}

		dbItems := make([]store.ScreenerResult, 0, len(req.Results))
		for _, item := range req.Results {
			if item.Symbol == "" {
				continue
			}

			// Ensure symbol is registered in symbols table
			name := item.Name
			if name == "" {
				name = item.Symbol
			}
			_ = store.EnsureSymbol(db, item.Symbol)

			tagsBytes, _ := json.Marshal(item.Tags)
			buyersBytes, _ := json.Marshal(item.TopBuyers)
			sellersBytes, _ := json.Marshal(item.TopSellers)

			cat := item.Category
			if cat == "" {
				cat = "second"
			}

			dbItems = append(dbItems, store.ScreenerResult{
				Symbol:      item.Symbol,
				Date:        nowDate,
				Category:    cat,
				ScoreAccum:  item.ScoreAccum,
				ScoreTech:   item.ScoreTech,
				ScorePVA:    item.ScorePVA,
				ScoreLiq:    item.ScoreLiq,
				FitScalp:    item.FitScalp,
				FitDaytrade: item.FitDaytrade,
				FitSwing:    item.FitSwing,
				Tags:        json.RawMessage(tagsBytes),
				TopBuyers:   json.RawMessage(buyersBytes),
				TopSellers:  json.RawMessage(sellersBytes),
			})
		}

		if err := store.UpsertScreenerResults(db, dbItems); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "upsert screener: " + err.Error()})
		}

		return c.JSON(fiber.Map{"status": "ok", "ingested": len(dbItems)})
	}
}

func getScanHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		scanCache.RLock()
		if scanCache.rows != nil && time.Since(scanCache.updatedAt) < scanCacheTTL {
			rows := scanCache.rows
			scanCache.RUnlock()
			c.Set("X-Arsant-Scan-Cache", "HIT")
			return c.JSON(rows)
		}
		scanCache.RUnlock()

		// Hanya satu request yang boleh membangun scan pasar. Tanpa ini,
		// beberapa browser yang membuka dashboard bersamaan melipatgandakan
		// ratusan query per-emiten dan membebani VPS kecil.
		scanBuildMu.Lock()
		defer scanBuildMu.Unlock()

		scanCache.RLock()
		if scanCache.rows != nil && time.Since(scanCache.updatedAt) < scanCacheTTL {
			rows := scanCache.rows
			scanCache.RUnlock()
			c.Set("X-Arsant-Scan-Cache", "HIT-AFTER-WAIT")
			return c.JSON(rows)
		}
		scanCache.RUnlock()

		symbols, err := store.ListSymbols(db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		screenerMap, _ := store.GetScreenerMap(db)

		to := time.Now().Format("2006-01-02")
		from := time.Now().AddDate(0, -scanLookbackMonths, 0).Format("2006-01-02")

		rows := make([]ScanRow, len(symbols))
		var wg sync.WaitGroup
		for i, s := range symbols {
			rows[i] = ScanRow{Symbol: s.Code, Name: s.Name, Sector: s.Sector}
			wg.Add(1)
			go func(i int, code string) {
				defer wg.Done()
				scanSymbol(db, code, from, to, &rows[i])
			}(i, s.Code)
		}
		wg.Wait()

		// Merge screener results into scan rows
		for i := range rows {
			if scr, ok := screenerMap[rows[i].Symbol]; ok {
				rows[i].Category = scr.Category
				rows[i].ScoreAccum = scr.ScoreAccum
				rows[i].ScoreTech = scr.ScoreTech
				rows[i].ScorePVA = scr.ScorePVA
				rows[i].ScoreLiq = scr.ScoreLiq
				rows[i].FitScalp = scr.FitScalp
				rows[i].FitDaytrade = scr.FitDaytrade
				rows[i].FitSwing = scr.FitSwing
				if len(scr.Tags) > 0 {
					var tags []string
					_ = json.Unmarshal(scr.Tags, &tags)
					rows[i].Tags = tags
				}
			}
		}

		scanCache.Lock()
		scanCache.rows = rows
		scanCache.updatedAt = time.Now()
		scanCache.Unlock()
		c.Set("X-Arsant-Scan-Cache", "MISS")

		return c.JSON(rows)
	}
}

func scanSymbol(db *sqlx.DB, symbol, from, to string, row *ScanRow) {
	barRows, err := store.GetBars(db, symbol, from, to)
	if err != nil || len(barRows) == 0 {
		return
	}

	bars := make([]analytics.Bar, len(barRows))
	for i, r := range barRows {
		bars[i] = analytics.Bar{
			Date: r.DateStr(), Open: r.Open, High: r.High, Low: r.Low, Close: r.Close,
			Volume: r.Volume,
		}
	}

	last := barRows[len(barRows)-1]
	row.HistoryDays = len(barRows)
	turnoverStart := len(barRows) - 20
	if turnoverStart < 0 {
		turnoverStart = 0
	}
	for _, bar := range barRows[turnoverStart:] {
		row.AverageTurnover += bar.Close * float64(bar.Volume)
	}
	if count := len(barRows) - turnoverStart; count > 0 {
		row.AverageTurnover /= float64(count)
	}
	dateStr, close := last.DateStr(), last.Close
	row.Date, row.Close = &dateStr, &close
	if len(barRows) > 1 {
		if prev := barRows[len(barRows)-2].Close; prev != 0 {
			pct := (close - prev) / prev * 100
			row.ChangePct = &pct
		}
	}

	if brokerRows, err := store.GetBrokerSummaryRange(db, symbol, from, to); err == nil && len(brokerRows) > 0 {
		phaseRes := analytics.DetectPhases(bars, reshapeBrokerRows(brokerRows), analytics.Options{
			Window: scanDefaultWindow, Sensitivity: scanDefaultSensitivity,
		})
		if len(phaseRes.Phases) > 0 {
			p := toPhaseResponse(phaseRes.Phases[len(phaseRes.Phases)-1])
			row.Phase = &p
		}
	}

	pvaRes := analytics.AnalyzePVA(bars)
	if pvaRes.Error == "" {
		row.PVABias, row.PVAScore, row.Climax = pvaRes.Bias, pvaRes.Score, toClimaxResponse(pvaRes.Climax)
	}
}
