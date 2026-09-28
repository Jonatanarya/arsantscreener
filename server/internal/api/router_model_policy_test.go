package api

import "testing"

func TestCustomerModelAllowlist(t *testing.T) {
	models := customerModelIDs()
	if len(models) != 7 {
		t.Fatal("unexpected customer catalog")
	}
	for _, id := range models {
		for _, name := range []string{id, "/" + id} {
			target, ok := customerModelTarget(name)
			if !ok || target != id {
				t.Fatalf("bad target for %s", name)
			}
		}
	}
	for _, name := range []string{"gpt-luna", "cx/gpt-5.6-sol", "j/f/deepseek-v4-flash", "big-pickle/../../gpt-luna", "j/f/big-pickle-extra", "", "*"} {
		if _, ok := customerModelTarget(name); ok {
			t.Fatalf("restricted model accepted: %s", name)
		}
	}
}
