// Package ws is the live-tape broadcast hub: it keeps a short in-memory
// rolling history of orderbook snapshots per symbol (never persisted to
// MySQL — this is ephemeral real-time data, per the storage design in
// PLAN.md) and fans out each new snapshot + its computed analysis to every
// WebSocket client currently watching that symbol.
package ws

import (
	"encoding/json"
	"log"
	"sync"

	"tradewise/server/internal/analytics"
)

// maxHistory bounds the rolling window analyzeBook needs (its longest
// lookback is 8s; at ~1 snapshot/sec, 20 is comfortable headroom).
const maxHistory = 20

type TapeMessage struct {
	Snapshot analytics.OrderbookSnapshot `json:"snapshot"`
	Analysis analytics.BookAnalysis      `json:"analysis"`
}

type Hub struct {
	mu      sync.Mutex
	history map[string][]analytics.OrderbookSnapshot
	clients map[string]map[*Client]bool
}

func NewHub() *Hub {
	return &Hub{
		history: make(map[string][]analytics.OrderbookSnapshot),
		clients: make(map[string]map[*Client]bool),
	}
}

// Ingest analyzes snap against the symbol's prior history, records it, and
// broadcasts the result to subscribed clients. Returns the analysis so the
// HTTP handler can also hand it back to the caller synchronously.
func (h *Hub) Ingest(snap analytics.OrderbookSnapshot) analytics.BookAnalysis {
	h.mu.Lock()
	hist := h.history[snap.Symbol]
	analysis := analytics.AnalyzeBook(snap, hist)

	hist = append(hist, snap)
	if len(hist) > maxHistory {
		hist = hist[len(hist)-maxHistory:]
	}
	h.history[snap.Symbol] = hist

	subs := h.clients[snap.Symbol]
	targets := make([]*Client, 0, len(subs))
	for c := range subs {
		targets = append(targets, c)
	}
	h.mu.Unlock()

	if len(targets) == 0 {
		return analysis
	}
	msg, err := json.Marshal(TapeMessage{Snapshot: snap, Analysis: analysis})
	if err != nil {
		log.Printf("ws: marshal tape message: %v", err)
		return analysis
	}
	for _, c := range targets {
		c.Send(msg)
	}
	return analysis
}

func (h *Hub) Subscribe(symbol string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[symbol] == nil {
		h.clients[symbol] = make(map[*Client]bool)
	}
	h.clients[symbol][c] = true
}

func (h *Hub) Unsubscribe(symbol string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients[symbol], c)
	if len(h.clients[symbol]) == 0 {
		delete(h.clients, symbol)
	}
}
