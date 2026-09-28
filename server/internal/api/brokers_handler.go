package api

import (
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

// Master broker: daftar resmi dari Stockbit yang direlay Data Collector.
// Menggantikan daftar hardcoded di frontend maupun di internal/analytics
// sebagai sumber nama & golongan Asing/Lokal.

type IngestBrokersRequest struct {
	Brokers []store.BrokerRowMaster `json:"brokers"`
}

// RefreshBrokerMaster memuat tabel `brokers` ke overlay in-memory yang dipakai
// analytics.BrokerName/BrokerType. Dipanggil saat server start dan setiap kali
// master broker di-ingest ulang, supaya nama broker yang berubah langsung
// terpakai tanpa restart.
func RefreshBrokerMaster(db *sqlx.DB) {
	rows, err := store.ListBrokers(db)
	if err != nil {
		log.Printf("peringatan: muat master broker: %v", err)
		return
	}
	m := make(map[string][2]string, len(rows))
	for _, b := range rows {
		m[strings.ToUpper(b.Code)] = [2]string{b.Name, b.Group}
	}
	analytics.SetBrokerOverlay(m)
	if len(m) > 0 {
		log.Printf("master broker dimuat: %d broker", len(m))
	}
}

func ingestBrokersHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req IngestBrokersRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid JSON body: "+err.Error())
		}
		for i := range req.Brokers {
			req.Brokers[i].Code = strings.ToUpper(strings.TrimSpace(req.Brokers[i].Code))
		}
		n, err := store.UpsertBrokers(db, req.Brokers)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		RefreshBrokerMaster(db)
		return c.JSON(fiber.Map{"status": "ok", "ingested": n})
	}
}

// BrokerMasterResponse menggabungkan data Stockbit dengan klasifikasi
// smart-money milik terminal, jadi frontend tidak perlu menyimpan daftar
// broker apa pun.
type BrokerMasterResponse struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Group  string `json:"group"`           // "Asing"/"Lokal" — dari Stockbit
	Type   string `json:"type"`            // asing|bumn|lokal-inst|ritel|… — klasifikasi terminal
	Smart  bool   `json:"smart"`           // ikut hitungan smart money
	Color  string `json:"color,omitempty"` // warna dari Stockbit
	Source string `json:"source"`          // db | builtin
}

func listBrokersHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := store.ListBrokers(db)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}
		out := make([]BrokerMasterResponse, 0, len(rows))
		for _, b := range rows {
			code := strings.ToUpper(b.Code)
			out = append(out, BrokerMasterResponse{
				Code: code, Name: analytics.BrokerName(code), Group: b.Group,
				Type: analytics.BrokerType(code), Smart: analytics.IsSmartBroker(code),
				Color: b.Color, Source: "db",
			})
		}
		return c.JSON(out)
	}
}
