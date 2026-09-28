package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func paidStarterFixture() mayarPaidTransaction {
	p := mayarPaidTransaction{TransactionID: "3510efce-be0a-4e5a-9d21-40518133ecb3", ProductID: "609f3164-397d-43f9-954d-de3da795576c", Status: "paid", Credit: 3300}
	p.Customer.Email = " Buyer@Example.com "
	return p
}

func TestMayarPaymentEligibility(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*mayarPaidTransaction)
		valid  bool
	}{
		{"paid", func(p *mayarPaidTransaction) {}, true},
		{"settled", func(p *mayarPaidTransaction) { p.Status = "settled" }, true},
		{"unpaid", func(p *mayarPaidTransaction) { p.Status = "pending" }, false},
		{"failed", func(p *mayarPaidTransaction) { p.Status = "failed" }, false},
		{"underpaid", func(p *mayarPaidTransaction) { p.Credit = 3299 }, false},
		{"other product", func(p *mayarPaidTransaction) { p.ProductID = "f4dc63be-0941-42b6-bd15-43b9f841b9e0" }, false},
		{"missing ID", func(p *mayarPaidTransaction) { p.TransactionID = "" }, false},
		{"invalid email", func(p *mayarPaidTransaction) { p.Customer.Email = "bad" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := paidStarterFixture()
			tc.change(&p)
			plan, email, ok := eligibleMayarPayment(p)
			if ok != tc.valid {
				t.Fatalf("eligible=%v", ok)
			}
			if ok && (email != "buyer@example.com" || plan.Tokens != 5000000) {
				t.Fatal("wrong credit or recipient")
			}
		})
	}
}

func TestMayarReconcileUsesAuthenticatedPaginatedData(t *testing.T) {
	requests, applied := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing API authentication")
		}
		if r.URL.Path != "/transactions" {
			t.Error("wrong path")
		}
		if r.URL.Query().Get("limit") != "50" {
			t.Errorf("expected V2 limit=50, got %q", r.URL.Query().Get("limit"))
		}
		if r.URL.Query().Get("startingAfter") == "" {
			p := paidStarterFixture()
			p.Status = "pending"
			json.NewEncoder(w).Encode(map[string]any{"statusCode": 200, "hasMore": true, "nextStartingAfter": "1768375011059", "data": []mayarPaidTransaction{p}})
		} else {
			if got := r.URL.Query().Get("startingAfter"); got != "1768375011059" {
				t.Errorf("wrong startingAfter cursor: %q", got)
			}
			json.NewEncoder(w).Encode(map[string]any{"statusCode": 200, "hasMore": false, "data": []mayarPaidTransaction{paidStarterFixture()}})
		}
	}))
	defer server.Close()
	s := &mayarPayments{apiKey: "test-key", baseURL: server.URL, client: server.Client(), apply: func(p mayarPaidTransaction) (bool, error) { applied++; return true, nil }}
	if err := s.reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if requests != 2 || applied != 1 {
		t.Fatalf("requests=%d applied=%d", requests, applied)
	}
}

func TestMayarAPIFailureDoesNotCredit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
		w.Write([]byte(`{"statusCode":401}`))
	}))
	defer server.Close()
	s := &mayarPayments{baseURL: server.URL, client: server.Client(), apply: func(p mayarPaidTransaction) (bool, error) { t.Fatal("must not credit"); return false, nil }}
	if s.reconcile(context.Background()) == nil {
		t.Fatal("expected API error")
	}
}

func TestMayarWebhookNeverCreditsUnverifiedBody(t *testing.T) {
	s := &mayarPayments{apiKey: "test-key", wake: make(chan struct{}, 1), apply: func(p mayarPaidTransaction) (bool, error) { t.Fatal("must verify API first"); return false, nil }}
	app := fiber.New()
	app.Post("/webhook", s.webhook)
	for _, event := range []string{"testing", "payment.received", "payment.received"} {
		r := httptest.NewRequest("POST", "/webhook", strings.NewReader(`{"event":"`+event+`","data":{"amount":999999999,"status":"SUCCESS"}}`))
		r.Header.Set("Content-Type", "application/json")
		response, err := app.Test(r)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatal(response.StatusCode)
		}
		if event == "testing" && len(s.wake) != 0 {
			t.Fatal("testing must not trigger credit")
		}
	}
	if len(s.wake) != 1 {
		t.Fatal("callbacks should coalesce")
	}
}
