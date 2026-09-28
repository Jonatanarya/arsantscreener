package main

import (
	"context"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"

	"tradewise/server/internal/alerts"
	"tradewise/server/internal/api"
	"tradewise/server/internal/config"
	"tradewise/server/internal/store"
	"tradewise/server/internal/ws"
	"tradewise/server/internal/yahoofinance"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, err := store.NewMySQL(cfg.MySQLDSN())
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer db.Close()
	log.Printf("connected to MySQL at %s:%s/%s", cfg.DBHost, cfg.DBPort, cfg.DBName)

	// Penyesuaian skema yang tidak lewat file migrasi (tabel yang lahir dari
	// kode + kolom yang menyusul belakangan). Idempoten; gagal di sini tidak
	// fatal supaya server tetap bisa melayani data lama.
	if err := store.EnsureBrokersTable(db); err != nil {
		log.Printf("peringatan: tabel brokers: %v", err)
	}
	if err := store.EnsureBrokerInvestorTypeColumn(db); err != nil {
		log.Printf("peringatan: kolom investor_type: %v", err)
	}
	// Master broker dari database menggantikan daftar hardcoded sebagai sumber
	// nama & golongan Asing/Lokal.
	api.RefreshBrokerMaster(db)

	// Sinkronisasi historis bisa memakan waktu beberapa menit pada database
	// besar. Jalankan setelah proses mulai agar restart/deploy tidak membuat
	// API tidak tersedia selama pekerjaan tersebut berlangsung.
	go func() {
		if err := store.SyncRawIngestToTables(db); err != nil {
			log.Printf("peringatan: sync raw_ingest: %v", err)
			return
		}
		api.RefreshBrokerMaster(db)
	}()

	app := fiber.New(fiber.Config{
		AppName: "Arsant Screener API",

		// ReadBufferSize bawaan Fiber cuma 4 KB, dan itu batas untuk SELURUH
		// baris request + header. Browser gampang melewatinya: cookie tidak
		// mengenal nomor port, jadi cookie milik semua aplikasi yang pernah
		// jalan di localhost (phpMyAdmin MAMP, dev server frontend, dsb)
		// menumpuk jadi satu header Cookie raksasa untuk :4000 juga —
		// hasilnya server membalas HTTP 431 "Request Header Fields Too Large"
		// padahal backend sehat.
		ReadBufferSize: 32 * 1024,

		// Payload crawl Data Collector (mis. candle harian 5 tahun atau broker
		// activity historis setahun penuh) bisa jauh melewati batas bawaan 4 MB.
		BodyLimit: 32 * 1024 * 1024,
	})

	// Chrome Private Network Access: request dari halaman publik (https://
	// stockbit.com) ke alamat privat (localhost) butuh browser mengirim
	// preflight dengan header Access-Control-Request-Private-Network, dan
	// server WAJIB membalas Access-Control-Allow-Private-Network: true —
	// tanpa ini browser blok fetch()-nya dengan "Failed to fetch" walau
	// server hidup & CORS origin sudah benar (fiber's cors middleware belum
	// dukung header ini, jadi ditangani manual di sini, sebelum cors.New).
	app.Use(func(c *fiber.Ctx) error {
		if c.Get("Access-Control-Request-Private-Network") == "true" {
			c.Set("Access-Control-Allow-Private-Network", "true")
		}
		return c.Next()
	})

	// bridge-extension jalan di context halaman stockbit.com (world: MAIN),
	// jadi fetch() ke server ini tunduk pada CORS browser biasa. Alat lokal
	// single-user tanpa cookie/credential -> wildcard origin aman.
	//
	// AllowHeaders sengaja dikosongkan: Fiber lalu memantulkan kembali
	// apa pun yang browser minta lewat Access-Control-Request-Headers pada
	// preflight (lihat setCORSHeaders di middleware/cors), bukan daftar
	// tetap. Stockbit sendiri otomatis menambahkan header seperti
	// `sentry-trace`/`baggage` (dari Sentry SDK mereka) ke semua fetch di
	// halamannya, termasuk yang menuju sini — daftar tetap ("Content-Type"
	// saja) memblokirnya dengan pesan CORS yang membingungkan.
	app.Use(cors.New(cors.Config{
		AllowOrigins: cfg.CORSAllowedOrigins,
		AllowMethods: "GET,POST,OPTIONS",
	}))

	if cfg.IngestAPIKey != "" {
		checkKey := api.RequireIngestAPIKey(cfg.IngestAPIKey)
		app.Use(func(c *fiber.Ctx) error {
			path := c.Path()
			if path == "/ingest" || strings.HasPrefix(path, "/ingest/") ||
				path == "/raw-ingest" || strings.HasPrefix(path, "/raw-ingest/") ||
				path == "/classification" || strings.HasPrefix(path, "/classification/") {
				return checkKey(c)
			}
			return c.Next()
		})
	}

	hub := ws.NewHub()

	alertHub := alerts.NewHub()
	watcher := alerts.NewWatcher(db, alertHub)
	go watcher.Run(context.Background())

	yf := yahoofinance.NewClient()

	api.RegisterRoutes(app, db, hub, alertHub, yf, cfg.AppEnv, api.RouterAuthConfig{
		GoogleClientID:             cfg.GoogleClientID,
		GoogleClientSecret:         cfg.GoogleClientSecret,
		GoogleRedirectURL:          cfg.GoogleRedirectURL,
		ScreenerGoogleClientID:     cfg.ScreenerGoogleClientID,
		ScreenerGoogleClientSecret: cfg.ScreenerGoogleClientSecret,
		SessionSecret:              cfg.RouterSessionSecret,
		GatewayURL:                 cfg.RouterGatewayURL,
		GatewayPassword:            cfg.RouterGatewayPassword,
		GatewayDBPath:              cfg.RouterGatewayDBPath,
		MayarAPIKey:                cfg.MayarAPIKey,
		AdminEmails:                cfg.RouterAdminEmails,
	})

	listenAddr := cfg.AppHost + ":" + cfg.AppPort
	log.Printf("listening on %s", listenAddr)
	if err := app.Listen(listenAddr); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
