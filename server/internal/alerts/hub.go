// Package alerts watches every symbol's Outlook bias on an interval and
// broadcasts a notification whenever it changes, independent of the
// per-symbol live-tape hub in internal/ws (alerts are terminal-wide, not
// scoped to whichever symbol happens to be selected).
package alerts

import (
	"encoding/json"
	"log"
	"sync"

	tapehub "tradewise/server/internal/ws"
)

// Message is the WS wire format broadcast to every connected client on a
// bias change. OldBias is empty for a symbol's very first observation —
// that case never reaches here (see Watcher.tick), but the field stays a
// plain string for simplicity on the frontend.
type Message struct {
	ID        int64  `json:"id"`
	Symbol    string `json:"symbol"`
	OldBias   string `json:"oldBias"`
	NewBias   string `json:"newBias"`
	Score     int    `json:"score"`
	CreatedAt string `json:"createdAt"`
}

// Hub fans out alert messages to every connected client — unlike the tape
// hub there's no per-symbol subscription, since an alert for any watched
// symbol is relevant to whoever has the panel open.
type Hub struct {
	mu      sync.Mutex
	clients map[*tapehub.Client]bool
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*tapehub.Client]bool)}
}

func (h *Hub) Subscribe(c *tapehub.Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = true
}

func (h *Hub) Unsubscribe(c *tapehub.Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
}

func (h *Hub) Broadcast(msg Message) {
	h.mu.Lock()
	targets := make([]*tapehub.Client, 0, len(h.clients))
	for c := range h.clients {
		targets = append(targets, c)
	}
	h.mu.Unlock()

	if len(targets) == 0 {
		return
	}
	b, err := json.Marshal(msg)
	if err != nil {
		log.Printf("alerts: marshal message: %v", err)
		return
	}
	for _, c := range targets {
		c.Send(b)
	}
}
