package stockbitagent

import (
	"encoding/json"
	"testing"
)

func TestParseBrokerSummary(t *testing.T) {
	payload := json.RawMessage(`{"data":{"broker_summary":{"brokers_buy":[
		{"netbs_broker_code":"XL","bval":1000,"blot":10,"freq":2,"type":"Asing"},
		{"netbs_broker_code":"XL","bval":500,"blot":5,"freq":1,"type":"Asing"}],
		"brokers_sell":[{"broker_code":"YP","sval":-700,"svalv":750,"slot":7,"freq":3,"type":"Lokal"}]}}}`)
	rows, err := ParseBrokerSummary(payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	for _, row := range rows {
		if row.BrokerCode == "XL" && (row.Value != 1500 || row.Lot != 15 || row.Frequency != 3) {
			t.Fatalf("unexpected XL aggregate: %+v", row)
		}
		if row.BrokerCode == "YP" && row.Value != 750 {
			t.Fatalf("unexpected YP value: %+v", row)
		}
	}
}
