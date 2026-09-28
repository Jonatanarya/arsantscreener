package main

import (
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"

	"tradewise/server/internal/api"
	"tradewise/server/internal/config"
	"tradewise/server/internal/store"
)

// routerserver keeps the Arsant Router account and credit service independent
// from the retired stock-screener application.
func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := store.NewMySQL(cfg.MySQLDSN())
	if err != nil {
		log.Fatalf("connect router database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{AppName: "Arsant Router Account API", ReadBufferSize: 32 * 1024})
	app.Use(cors.New(cors.Config{AllowOrigins: cfg.CORSAllowedOrigins, AllowMethods: "GET,POST,DELETE,OPTIONS"}))
	app.Get("/health", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"status": "ok", "service": "arsant-router"}) })
	api.RegisterRouterAuthRoutes(app, db, api.RouterAuthConfig{
		GoogleClientID:     cfg.GoogleClientID,
		GoogleClientSecret: cfg.GoogleClientSecret,
		GoogleRedirectURL:  cfg.GoogleRedirectURL,
		SessionSecret:      cfg.RouterSessionSecret,
		GatewayURL:         cfg.RouterGatewayURL,
		GatewayPassword:    cfg.RouterGatewayPassword,
		GatewayDBPath:      cfg.RouterGatewayDBPath,
		MayarAPIKey:        cfg.MayarAPIKey,
		AdminEmails:        cfg.RouterAdminEmails,
	})

	listenAddr := cfg.AppHost + ":" + cfg.AppPort
	log.Printf("router account API listening on %s", listenAddr)
	if err := app.Listen(listenAddr); err != nil {
		log.Fatalf("router account API: %v", err)
	}
}
