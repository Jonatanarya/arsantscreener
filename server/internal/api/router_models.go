package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

type publicModel struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Reason string `json:"reason"`
}
type modelSnapshot struct {
	Models    []publicModel `json:"models"`
	UpdatedAt time.Time     `json:"updatedAt"`
	Stale     bool          `json:"stale"`
}
type modelTracker struct {
	mu       sync.RWMutex
	snapshot modelSnapshot
	cfg      RouterAuthConfig
}
type trackerConnection struct {
	active bool
	state  string
	locks  map[string]time.Time
}

func newModelTracker(cfg RouterAuthConfig) *modelTracker {
	t := &modelTracker{cfg: cfg}
	go func() {
		for {
			if err := t.refresh(); err != nil {
				log.Printf("model tracker refresh failed: %v", err)
			}
			time.Sleep(30 * time.Second)
		}
	}()
	return t
}

func (t *modelTracker) handler(c *fiber.Ctx) error {
	t.mu.RLock()
	s := t.snapshot
	t.mu.RUnlock()
	c.Set("Cache-Control", "no-store")
	if s.UpdatedAt.IsZero() {
		return c.Status(503).JSON(fiber.Map{"error": "Status model belum tersedia. Coba lagi sebentar."})
	}
	s.Stale = time.Since(s.UpdatedAt) > 2*time.Minute
	return c.JSON(s)
}

// No inference probes or customer credentials are needed. Public output is an
// allowlist of model IDs and generic statuses, never upstream account/error data.
func (t *modelTracker) refresh() error {
	if t.cfg.Usage == nil {
		return fmt.Errorf("gateway database unavailable")
	}
	client, err := gatewayClient(t.cfg)
	if err != nil {
		return err
	}
	client.Timeout = 50 * time.Second
	get := func(path string, out any) error {
		r, err := client.Get(strings.TrimRight(t.cfg.GatewayURL, "/") + path)
		if err != nil {
			return err
		}
		defer r.Body.Close()
		if r.StatusCode != http.StatusOK {
			return fmt.Errorf("gateway catalog status %d", r.StatusCode)
		}
		return json.NewDecoder(r.Body).Decode(out)
	}
	var catalog struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err = get("/v1/models", &catalog); err != nil {
		return err
	}
	var disabled struct {
		Disabled map[string][]string `json:"disabled"`
	}
	if err = get("/api/models/disabled", &disabled); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db := t.cfg.Usage.source
	// 9Router exposes Antigravity models with the short `ag` prefix in
	// combo targets, while its provider connection is stored as `antigravity`.
	// Keep both names aligned so combo health is reflected in the public tracker.
	aliases := map[string]string{"cx": "codex", "ag": "antigravity"}
	prefix := map[string]string{"codex": "cx"}
	rows, err := db.QueryContext(ctx, `SELECT id,json_extract(data,'$.prefix') FROM providerNodes`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var p *string
		if err = rows.Scan(&id, &p); err != nil {
			rows.Close()
			return err
		}
		if p != nil && *p != "" {
			aliases[*p] = id
			prefix[id] = *p
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	connections := map[string][]trackerConnection{}
	rows, err = db.QueryContext(ctx, `SELECT provider,isActive,data FROM providerConnections`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var provider, raw string
		var active int
		if err = rows.Scan(&provider, &active, &raw); err != nil {
			rows.Close()
			return err
		}
		var data map[string]json.RawMessage
		if err = json.Unmarshal([]byte(raw), &data); err != nil {
			rows.Close()
			return err
		}
		conn := trackerConnection{active: active == 1, locks: map[string]time.Time{}}
		json.Unmarshal(data["testStatus"], &conn.state)
		for k, v := range data {
			if strings.HasPrefix(k, "modelLock_") {
				var until string
				if json.Unmarshal(v, &until) == nil {
					if at, e := time.Parse(time.RFC3339Nano, until); e == nil {
						conn.locks[strings.TrimPrefix(k, "modelLock_")] = at
					}
				}
			}
		}
		connections[provider] = append(connections[provider], conn)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	published := map[string]bool{}
	all := map[string]bool{}
	for _, m := range catalog.Data {
		published[m.ID] = true
		all[m.ID] = true
	}
	// Include configured custom models even when the gateway hides them while off.
	rows, err = db.QueryContext(ctx, `SELECT value FROM kv WHERE scope='customModels'`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var raw string
		if err = rows.Scan(&raw); err != nil {
			rows.Close()
			return err
		}
		var m struct{ ProviderAlias, ID, Type string }
		if err = json.Unmarshal([]byte(raw), &m); err != nil {
			rows.Close()
			return err
		}
		p := m.ProviderAlias
		if v, ok := prefix[p]; ok {
			p = v
		}
		provider := p
		if v, ok := aliases[p]; ok {
			provider = v
		}
		if len(connections[provider]) > 0 && (m.Type == "llm" || m.Type == "") {
			all[p+"/"+m.ID] = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	combos := map[string][]string{}
	rows, err = db.QueryContext(ctx, `SELECT name,models FROM combos`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var name, raw string
		if err = rows.Scan(&name, &raw); err != nil {
			rows.Close()
			return err
		}
		var models []string
		if json.Unmarshal([]byte(raw), &models) == nil {
			combos[name] = models
			all[name] = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for alias, ids := range disabled.Disabled {
		p := alias
		if v, ok := prefix[p]; ok {
			p = v
		}
		for _, id := range ids {
			all[p+"/"+id] = true
		}
	}
	t.mu.RLock()
	previous := t.snapshot.Models
	t.mu.RUnlock()
	for _, m := range previous {
		all[m.ID] = true
	}
	now := time.Now().UTC()
	var resolve func(string, map[string]bool) publicModel
	resolve = func(id string, seen map[string]bool) publicModel {
		result := publicModel{ID: id, Status: "unknown", Reason: "Data status belum cukup"}
		if seen[id] {
			return result
		}
		seen[id] = true
		defer delete(seen, id)
		if targets, ok := combos[id]; ok {
			statuses := []string{}
			for _, target := range targets {
				statuses = append(statuses, resolve(target, seen).Status)
			}
			result.Status = combineModelStatus(statuses)
			result.Reason = trackerReason(result.Status)
			return result
		}
		p, model, ok := strings.Cut(id, "/")
		if !ok {
			return result
		}
		provider := p
		if v, ok := aliases[p]; ok {
			provider = v
		}
		for _, key := range []string{p, provider} {
			for _, v := range disabled.Disabled[key] {
				if v == model {
					return publicModel{id, "off", "Dinonaktifkan di gateway"}
				}
			}
		}
		if !published[id] {
			return publicModel{id, "off", "Tidak tersedia pada katalog gateway"}
		}
		states := []string{}
		for _, conn := range connections[provider] {
			states = append(states, connectionModelStatus(conn, model, now))
		}
		result.Status = combineModelStatus(states)
		result.Reason = trackerReason(result.Status)
		return result
	}
	snapshot := modelSnapshot{Models: make([]publicModel, 0, len(all)), UpdatedAt: now}
	for _, id := range customerModelIDs() {
		model := resolve(id, map[string]bool{})
		model.ID = id
		snapshot.Models = append(snapshot.Models, model)
	}
	sort.Slice(snapshot.Models, func(i, j int) bool { return snapshot.Models[i].ID < snapshot.Models[j].ID })
	t.mu.Lock()
	t.snapshot = snapshot
	t.mu.Unlock()
	return nil
}

func connectionModelStatus(c trackerConnection, model string, now time.Time) string {
	if !c.active {
		return "off"
	}
	if c.locks[model].After(now) || c.locks["__all"].After(now) || c.locks[""].After(now) {
		return "off"
	}
	if c.state == "unavailable" || c.state == "error" || c.state == "invalid" {
		return "off"
	}
	if c.state == "active" || c.state == "success" || c.state == "valid" {
		return "available"
	}
	return "unknown"
}
func combineModelStatus(statuses []string) string {
	if len(statuses) == 0 {
		return "unknown"
	}
	unknown := false
	for _, s := range statuses {
		if s == "available" {
			return "available"
		}
		if s == "unknown" {
			unknown = true
		}
	}
	if unknown {
		return "unknown"
	}
	return "off"
}
func trackerReason(status string) string {
	switch status {
	case "available":
		return "Ada koneksi aktif tanpa blokir model"
	case "off":
		return "Koneksi nonaktif, bermasalah, atau sedang cooldown"
	default:
		return "Data status belum cukup"
	}
}
