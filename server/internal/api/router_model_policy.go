package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

// This is the customer catalog, shared by the tracker and inference gate.
// Each ID is a 9Router combo. The combo owns its provider fallbacks, while
// customers can only invoke the stable public name below.
var defaultCustomerModels = []string{
	"DeepSeek-V4.1-Flash",
	"GLM-5.3-Flash",
	"Gemini-3.8-flash",
	"Kimi-K3",
	"Mimo-v2.5-Pro",
	"MiniMax-M3",
	"Qwen3.8-27B",
}

var customerModelCatalog = struct {
	sync.RWMutex
	models []string
}{models: append([]string(nil), defaultCustomerModels...)}

func customerModelIDs() []string {
	customerModelCatalog.RLock()
	defer customerModelCatalog.RUnlock()
	return append([]string(nil), customerModelCatalog.models...)
}

func setCustomerModelIDs(models []string) {
	customerModelCatalog.Lock()
	customerModelCatalog.models = append([]string(nil), models...)
	customerModelCatalog.Unlock()
}

func customerModelTarget(name string) (string, bool) {
	name = strings.TrimPrefix(name, "/")
	for _, id := range customerModelIDs() {
		if name == id {
			return id, true
		}
	}
	return "", false
}

func modelPolicyError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message, "type": "invalid_request_error"}})
}

func startCustomerModelProxy(cfg RouterAuthConfig) {
	target, err := url.Parse(cfg.GatewayURL)
	if err != nil {
		log.Printf("model gate configuration invalid")
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		modelPolicyError(w, 502, "gateway_unavailable", "Gateway sementara tidak tersedia")
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		inference := strings.HasPrefix(path, "/v1") || strings.HasPrefix(path, "/api/v1")
		if r.Method == http.MethodOptions {
			proxy.ServeHTTP(w, r)
			return
		}
		keys := []string{r.Header.Get("X-Api-Key"), r.Header.Get("X-Goog-Api-Key"), r.URL.Query().Get("key"), r.URL.Query().Get("api_key")}
		auth := strings.Fields(r.Header.Get("Authorization"))
		if len(auth) == 2 && strings.EqualFold(auth[0], "Bearer") {
			keys = append(keys, auth[1])
		}
		managed, found, managedKey := false, false, ""
		for _, key := range keys {
			if key == "" {
				continue
			}
			if !inference && !strings.HasPrefix(key, "sk-") {
				continue
			}
			found = true
			if cfg.Usage == nil {
				modelPolicyError(w, 503, "credit_check_unavailable", "Saldo belum dapat diperiksa")
				return
			}
			status := cfg.Usage.authorizeCredit(key)
			if status != 204 {
				if status == 403 {
					modelPolicyError(w, 402, "credit_exhausted", "Limit credit habis. Silakan top up.")
				} else {
					modelPolicyError(w, status, "authentication_failed", "API key atau saldo belum dapat diverifikasi")
				}
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			var count int
			err := cfg.Usage.db.GetContext(ctx, &count, `SELECT COUNT(*) FROM router_key_versions WHERE key_hash=?`, usageKeyHash(key))
			cancel()
			if err != nil {
				modelPolicyError(w, 503, "policy_unavailable", "Kebijakan model belum dapat diperiksa")
				return
			}
			if count > 0 {
				managed = true
				managedKey = key
			}
		}
		if inference && !found {
			modelPolicyError(w, 401, "invalid_api_key", "API key diperlukan")
			return
		}
		if !managed {
			proxy.ServeHTTP(w, r)
			return
		}
		// Never let a customer key access admin or alternative inference routes.
		normalized := strings.TrimSuffix(strings.TrimPrefix(path, "/api"), "/")
		if normalized == "/v1/models" && r.Method == http.MethodGet {
			models := customerModelIDs()
			data := make([]map[string]string, 0, len(models))
			for _, id := range models {
				data = append(data, map[string]string{"id": id, "object": "model", "owned_by": "arsant"})
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": data})
			return
		}
		if r.Method != http.MethodPost || (normalized != "/v1/chat/completions" && normalized != "/v1/completions" && normalized != "/v1/responses" && normalized != "/v1/messages") {
			modelPolicyError(w, 403, "endpoint_not_allowed", "Endpoint ini tidak tersedia untuk API key pelanggan")
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<20))
		if err != nil {
			modelPolicyError(w, 413, "request_too_large", "Request terlalu besar")
			return
		}
		r.Body.Close()
		var payload map[string]json.RawMessage
		if json.Unmarshal(raw, &payload) != nil || payload == nil {
			modelPolicyError(w, 400, "invalid_json", "Body harus berupa JSON")
			return
		}
		var model string
		if json.Unmarshal(payload["model"], &model) != nil {
			modelPolicyError(w, 400, "model_required", "Pilih model dari /v1/models")
			return
		}
		canonical, ok := customerModelTarget(model)
		if !ok {
			modelPolicyError(w, 403, "model_not_allowed", "Model ini tidak diizinkan. Gunakan model dari /v1/models.")
			return
		}
		payload["model"], _ = json.Marshal(canonical)
		raw, err = json.Marshal(payload)
		if err != nil {
			modelPolicyError(w, 400, "invalid_json", "Request tidak valid")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		r.ContentLength = int64(len(raw))
		r.Header.Set("Content-Length", fmt.Sprint(len(raw)))
		r.Header.Set("Content-Type", "application/json")
		if cfg.LoadGate == nil {
			modelPolicyError(w, 503, "load_gate_unavailable", "Pengaturan beban belum siap")
			return
		}
		permit, retryAfter, reason := cfg.LoadGate.acquire(managedKey, canonical)
		if permit == nil {
			if retryAfter > 0 {
				w.Header().Set("Retry-After", fmt.Sprintf("%.0f", retryAfter.Seconds()))
			}
			message := "Terlalu banyak request. Coba lagi sebentar."
			if reason == "key_concurrency" {
				message = "Tunggu request API key ini selesai terlebih dahulu."
			}
			modelPolicyError(w, 429, "rate_limit_exceeded", message)
			return
		}
		defer permit.release()
		creditCtx, cancelCredit := context.WithTimeout(r.Context(), 25*time.Second)
		_, err = cfg.Usage.reserveCredit(creditCtx, managedKey, newReservationID(), tokenReservation(payload, len(raw)))
		cancelCredit()
		if err != nil {
			modelPolicyError(w, 402, "credit_reservation_failed", "Credit tidak cukup untuk request ini.")
			return
		}
		proxy.ServeHTTP(w, r)
	})
	listener, err := net.Listen("tcp", "127.0.0.1:4001")
	if err != nil {
		log.Printf("customer model gate: %v", err)
		return
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("customer model gate stopped: %v", err)
		}
	}()
}
