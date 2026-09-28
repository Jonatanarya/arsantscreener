package api

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"

	"tradewise/server/internal/analytics"
	tapehub "tradewise/server/internal/ws"
)

// Orders/Freq use FlexInt (not plain int) since bridge-extension's
// browser-side arithmetic can produce counts with a stray fractional part
// (e.g. 12.000000000002) that encoding/json otherwise rejects outright —
// see flexint.go.
type OrderbookLevel struct {
	Price  float64 `json:"price"`
	Lot    float64 `json:"lot"`
	Orders FlexInt `json:"orders"`
}

type IngestOrderbookRequest struct {
	Symbol string           `json:"symbol"`
	Last   float64          `json:"last"`
	Bid    []OrderbookLevel `json:"bid"`
	Offer  []OrderbookLevel `json:"offer"`
	Value  float64          `json:"value"`
	Volume float64          `json:"volume"`
	Freq   FlexInt          `json:"freq"`
}

func toSnapshotLevels(levels []OrderbookLevel) []analytics.PriceLevel {
	out := make([]analytics.PriceLevel, len(levels))
	for i, l := range levels {
		lpo := 0.0
		if l.Orders > 0 {
			lpo = l.Lot / float64(l.Orders)
		}
		out[i] = analytics.PriceLevel{Price: l.Price, Lot: l.Lot, Orders: int(l.Orders), LotPerOrder: lpo}
	}
	return out
}

// ingestOrderbookHandler receives one polled orderbook snapshot from
// bridge-extension, analyzes it against the symbol's recent history, and
// broadcasts the result to any live-tape WebSocket subscribers. Fire-and-
// forget from the caller's perspective, same as /ingest/bars.
func ingestOrderbookHandler(hub *tapehub.Hub) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestOrderbookRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body")
		}
		symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}

		snap := analytics.OrderbookSnapshot{
			Symbol: symbol, Ts: time.Now().UnixMilli(), Last: req.Last,
			Bid: toSnapshotLevels(req.Bid), Offer: toSnapshotLevels(req.Offer),
			Value: req.Value, Volume: req.Volume, Freq: int(req.Freq),
		}
		hub.Ingest(snap)

		return c.SendStatus(fiber.StatusNoContent)
	}
}

// tapeWSHandler upgrades to a WebSocket and streams every subsequent
// orderbook snapshot + analysis for :symbol as it's ingested. No history
// replay on connect — the client's first message is whatever arrives next.
func tapeWSHandler(hub *tapehub.Hub) fiber.Handler {
	return websocket.New(func(conn *websocket.Conn) {
		symbol := strings.ToUpper(strings.TrimSpace(conn.Params("symbol")))
		if symbol == "" {
			return
		}

		client := tapehub.NewClient(conn)
		hub.Subscribe(symbol, client)
		defer hub.Unsubscribe(symbol, client)
		defer client.Close()

		go client.WritePump()
		client.ReadPump()
	})
}
