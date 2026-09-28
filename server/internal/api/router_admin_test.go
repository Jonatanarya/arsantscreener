package api

import "testing"

func TestRouterAdminAllowed(t *testing.T) {
	cfg := RouterAuthConfig{AdminEmails: "jonatanaryas@gmail.com, second@example.com"}
	for _, email := range []string{"jonatanaryas@gmail.com", "JONATANARYAS@GMAIL.COM", " second@example.com "} {
		if !routerAdminAllowed(email, cfg) {
			t.Fatalf("expected admin access for %q", email)
		}
	}
	for _, email := range []string{"", "other@gmail.com", "jonatanaryas@gmail.com.attacker.test"} {
		if routerAdminAllowed(email, cfg) {
			t.Fatalf("unexpected admin access for %q", email)
		}
	}
}
