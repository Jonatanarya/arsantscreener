package api

import (
	"encoding/json"
	"testing"
)

func TestLoadGateEnforcesKeyConcurrencyAndRate(t *testing.T) {
	g := newRouterLoadGate()
	one, _, reason := g.acquire("key-a", "model-a")
	if one == nil || reason != "" {
		t.Fatal("first request rejected")
	}
	two, _, _ := g.acquire("key-a", "model-a")
	if two == nil {
		t.Fatal("second concurrent request rejected")
	}
	if third, _, reason := g.acquire("key-a", "model-a"); third != nil || reason != "key_concurrency" {
		t.Fatal("key concurrency not enforced")
	}
	one.release()
	two.release()
	for i := 0; i < defaultRequestsPerMinute-2; i++ {
		p, _, _ := g.acquire("key-a", "model-a")
		if p == nil {
			t.Fatal("rate limit early")
		}
		p.release()
	}
	if p, retry, reason := g.acquire("key-a", "model-a"); p != nil || reason != "rate" || retry <= 0 {
		t.Fatal("rate limit not enforced")
	}
}

func TestTokenReservationEstimate(t *testing.T) {
	p := map[string]json.RawMessage{"max_tokens": json.RawMessage(`2000`)}
	if got := tokenReservation(p, 400); got != 4096 {
		t.Fatalf("minimum reserve = %d", got)
	}
	p["max_tokens"] = json.RawMessage(`200000`)
	if got := tokenReservation(p, 100); got != 131072 {
		t.Fatalf("maximum reserve = %d", got)
	}
}
