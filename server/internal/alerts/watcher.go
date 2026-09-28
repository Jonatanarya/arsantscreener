package alerts

import (
	"context"
	"log"
	"time"

	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

const (
	// checkInterval matches how often it's worth re-checking: bias only
	// moves on new daily bars/broker-summary data, which the bridge feeds
	// in at most a few times a minute, so this is plenty responsive without
	// hammering MySQL.
	checkInterval  = 5 * time.Minute
	lookbackMonths = 6
	phaseWindow    = 10
)

// Watcher recomputes analytics.Outlook AND analytics.DetectLiquidityShift
// for every known symbol on an interval. Whenever a symbol's Outlook bias
// differs from the last value recorded in outlook_state, it persists an
// outlook_alerts row and broadcasts it over Hub; whenever its liquidity
// level differs from liquidity_alert_state, it persists a liquidity_alerts
// row (no broadcast — see checkAndRecordLiquidity). Call Run in its own
// goroutine.
type Watcher struct {
	db  *sqlx.DB
	hub *Hub
}

func NewWatcher(db *sqlx.DB, hub *Hub) *Watcher {
	return &Watcher{db: db, hub: hub}
}

func (w *Watcher) Run(ctx context.Context) {
	w.tick()
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.tick()
		}
	}
}

func (w *Watcher) tick() {
	symbols, err := store.ListSymbols(w.db)
	if err != nil {
		log.Printf("alerts: list symbols: %v", err)
		return
	}

	to := time.Now().Format("2006-01-02")
	from := time.Now().AddDate(0, -lookbackMonths, 0).Format("2006-01-02")

	for _, sym := range symbols {
		// Satu fetch bars dipakai ulang untuk Outlook (fase+PVA) maupun
		// deteksi anomali volume/likuiditas — keduanya butuh histori
		// harian yang sama, tidak perlu dua round-trip DB per simbol.
		barRows, err := store.GetBars(w.db, sym.Code, from, to)
		if err != nil {
			log.Printf("alerts: get bars %s: %v", sym.Code, err)
			continue
		}

		outlook := w.computeOutlook(sym.Code, barRows, from, to)
		w.checkAndRecord(sym.Code, string(outlook.Bias), outlook.Score)

		shift := analytics.DetectLiquidityShift(toVolBars(barRows))
		w.checkAndRecordLiquidity(sym.Code, shift)
	}
}

func toVolBars(rows []store.BarRow) []analytics.VolBar {
	out := make([]analytics.VolBar, len(rows))
	for i, r := range rows {
		var value float64
		if r.Value != nil {
			value = *r.Value
		}
		var freq int
		if r.Freq != nil {
			freq = *r.Freq
		}
		out[i] = analytics.VolBar{Date: r.DateStr(), Volume: r.Volume, Value: value, Freq: freq}
	}
	return out
}

func (w *Watcher) computeOutlook(symbol string, barRows []store.BarRow, from, to string) analytics.Outlook {
	bars := make([]analytics.Bar, len(barRows))
	for i, r := range barRows {
		bars[i] = analytics.Bar{
			Date: r.DateStr(), Open: r.Open, High: r.High, Low: r.Low, Close: r.Close,
			Volume: r.Volume,
		}
	}

	var phasePtr *analytics.Phase
	if brokerRows, err := store.GetBrokerSummaryRange(w.db, symbol, from, to); err == nil && len(brokerRows) > 0 {
		phaseRes := analytics.DetectPhases(bars, reshapeBrokerRows(brokerRows), analytics.Options{
			Window: phaseWindow, Sensitivity: analytics.SensitivityMedium,
		})
		if len(phaseRes.Phases) > 0 {
			p := phaseRes.Phases[len(phaseRes.Phases)-1]
			phasePtr = &p
		}
	}

	pvaRes := analytics.AnalyzePVA(bars)
	return analytics.BuildOutlook(phasePtr, pvaRes)
}

// checkAndRecord compares newBias against the symbol's stored state. A
// symbol with no prior state is a first observation: it seeds the baseline
// silently so start-up (or a newly-added symbol) never fires a spurious
// "changed from nothing" alert.
func (w *Watcher) checkAndRecord(symbol, newBias string, score int) {
	prev, err := store.GetOutlookState(w.db, symbol)
	if err != nil {
		log.Printf("alerts: get state %s: %v", symbol, err)
		return
	}

	if prev == nil {
		if err := store.UpsertOutlookState(w.db, symbol, newBias, score); err != nil {
			log.Printf("alerts: seed state %s: %v", symbol, err)
		}
		return
	}

	if prev.Bias == newBias {
		if prev.Score != score {
			if err := store.UpsertOutlookState(w.db, symbol, newBias, score); err != nil {
				log.Printf("alerts: update state %s: %v", symbol, err)
			}
		}
		return
	}

	oldBias := prev.Bias
	id, createdAt, err := store.CreateOutlookAlert(w.db, store.NewOutlookAlert{
		Symbol: symbol, OldBias: &oldBias, NewBias: newBias, Score: score,
	})
	if err != nil {
		log.Printf("alerts: create alert %s: %v", symbol, err)
		return
	}
	if err := store.UpsertOutlookState(w.db, symbol, newBias, score); err != nil {
		log.Printf("alerts: update state %s: %v", symbol, err)
	}

	w.hub.Broadcast(Message{
		ID: id, Symbol: symbol, OldBias: oldBias, NewBias: newBias, Score: score,
		CreatedAt: createdAt.Format(time.RFC3339),
	})
}

// checkAndRecordLiquidity mirrors checkAndRecord for the volume/liquidity
// anomaly detector (analytics.DetectLiquidityShift). It deliberately does
// NOT broadcast over Hub: that WS/Message pair is shaped for Outlook bias
// changes and read by the terminal's AlertsPanel, so reusing it here would
// mean stretching that contract to a differently-shaped signal. History is
// readable via GET /liquidity-alerts, and symbols currently flagged via
// GET /screener/liquidity-candidates — that's enough to pick which symbols
// deserve running trade / broker summary daily today.
func (w *Watcher) checkAndRecordLiquidity(symbol string, shift analytics.LiquidityShift) {
	prev, err := store.GetLiquidityState(w.db, symbol)
	if err != nil {
		log.Printf("alerts: get liquidity state %s: %v", symbol, err)
		return
	}

	if prev == nil {
		if err := store.UpsertLiquidityState(w.db, symbol, shift.Level, shift.Score); err != nil {
			log.Printf("alerts: seed liquidity state %s: %v", symbol, err)
		}
		return
	}

	if prev.Level == shift.Level {
		if prev.Score != shift.Score {
			if err := store.UpsertLiquidityState(w.db, symbol, shift.Level, shift.Score); err != nil {
				log.Printf("alerts: update liquidity state %s: %v", symbol, err)
			}
		}
		return
	}

	oldLevel := prev.Level
	if _, _, err := store.CreateLiquidityAlert(w.db, store.NewLiquidityAlert{
		Symbol: symbol, OldLevel: &oldLevel, NewLevel: shift.Level, Score: shift.Score, Reasons: shift.Reasons,
	}); err != nil {
		log.Printf("alerts: create liquidity alert %s: %v", symbol, err)
		return
	}
	if err := store.UpsertLiquidityState(w.db, symbol, shift.Level, shift.Score); err != nil {
		log.Printf("alerts: update liquidity state %s: %v", symbol, err)
	}
}
