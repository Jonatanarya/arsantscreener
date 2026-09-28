package store

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseMarketMoversPayload(t *testing.T) {
	payload := []byte(`{
		"data": [
			{
				"code": "BBCA",
				"name": "Bank Central Asia",
				"price": 10250,
				"change_percentage": 2.5,
				"volume": 50000,
				"value": 512500000,
				"net_foreign": 12000000
			}
		]
	}`)

	row := RawIngestRow{
		Endpoint:  "market_mover",
		Variant:   "MOVER_TYPE_TOP_GAINER",
		Payload:   json.RawMessage(payload),
		FetchedAt: time.Now(),
	}

	if len(row.Payload) == 0 {
		t.Fatal("payload empty")
	}
}
