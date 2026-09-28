package api

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/alerts"
	tapehub "tradewise/server/internal/ws"
	"tradewise/server/internal/yahoofinance"
)

func RegisterRoutes(app *fiber.App, db *sqlx.DB, hub *tapehub.Hub, alertHub *alerts.Hub, yf *yahoofinance.Client, env string, routerAuth RouterAuthConfig) {
	RegisterRouterAuthRoutes(app, db, routerAuth)
	RegisterScreenerAuthRoutes(app, db, routerAuth)
	app.Get("/health", healthHandler(db, env))
	app.Get("/operations/status", operationsStatusHandler(db))
	app.Get("/service-status", serviceStatusHandler(db))
	app.Post("/ingest/bars", ingestBarsHandler(db))
	app.Post("/ingest/broker-summary", ingestBrokerSummaryHandler(db))
	app.Post("/ingest/orderbook", ingestOrderbookHandler(hub))

	app.Get("/symbols", listSymbolsHandler(db))
	app.Get("/symbols/search", searchSymbolsHandler(db))
	app.Get("/symbols/catalog", symbolCatalogHandler(db))
	app.Post("/ingest/symbol-metadata", ingestSymbolMetadataHandler(db))
	app.Get("/bars/:symbol", getBarsHandler(db))
	app.Get("/quote/:symbol", quoteHandler(db))
	app.Get("/broker-summary/:symbol", getBrokerSummaryHandler(db))
	app.Get("/broker-summary-range/:symbol", getBrokerSummaryRangeHandler(db))
	app.Get("/broker-summary-availability/:symbol", getBrokerSummaryAvailabilityHandler(db))
	app.Get("/broker-distribution/:symbol", getBrokerDistributionHandler(db))
	app.Get("/phases/:symbol", getPhasesHandler(db))
	app.Get("/pva/:symbol", getPVAHandler(db))
	app.Get("/scan", getScanHandler(db))
	app.Get("/outlook/:symbol", getOutlookHandler(db))
	app.Get("/data-status/:symbol", dataStatusHandler(db))
	dataSessionAdmin := requireScreenerAdmin(db, routerAuth)
	app.Get("/account/data-session", dataSessionAdmin, brokerSessionHealthHandler())
	app.Get("/account/data-session/viewer", dataSessionAdmin, brokerSessionProxyHandler("GET", "/viewer", 1<<20))
	app.Get("/account/data-session/screen", dataSessionAdmin, brokerSessionProxyHandler("GET", "/screen", 4<<20))
	app.Get("/account/data-session/health", dataSessionAdmin, brokerSessionProxyHandler("GET", "/health", 1<<20))
	app.Post("/account/data-session/input", dataSessionAdmin, brokerSessionProxyHandler("POST", "/input", 1<<20))

	positionAuth := requireScreenerUser(db, routerAuth.SessionSecret)
	app.Delete("/account", positionAuth, deleteScreenerAccountHandler(db))
	app.Get("/account/watchlists", positionAuth, listUserWatchlistsHandler(db))
	app.Post("/account/watchlists", positionAuth, createUserWatchlistHandler(db))
	app.Patch("/account/watchlists/:name", positionAuth, renameUserWatchlistHandler(db))
	app.Delete("/account/watchlists/:name", positionAuth, deleteUserWatchlistHandler(db))
	app.Post("/account/watchlists/items", positionAuth, addUserWatchlistItemHandler(db))
	app.Delete("/account/watchlists/items/:symbol", positionAuth, deleteUserWatchlistItemHandler(db))
	app.Get("/account/alerts", positionAuth, listUserAlertsHandler(db))
	app.Get("/account/alert-settings", positionAuth, getUserAlertSettingsHandler(db))
	app.Patch("/account/alert-settings", positionAuth, updateUserAlertSettingsHandler(db))
	app.Post("/positions", positionAuth, createPositionHandler(db))
	app.Get("/positions", positionAuth, listPositionsHandler(db))
	app.Patch("/positions/:id/close", positionAuth, closePositionHandler(db))
	app.Delete("/positions/:id", positionAuth, deletePositionHandler(db))
	app.Get("/portfolio/summary", positionAuth, getPortfolioSummaryHandler(db))
	app.Post("/risk/position-size", positionSizeHandler())

	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			c.Locals("allowed", true)
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	app.Get("/ws/tape/:symbol", tapeWSHandler(hub))

	app.Get("/alerts", listAlertsHandler(db))
	app.Get("/ws/alerts", alertsWSHandler(alertHub))

	app.Get("/liquidity-alerts", listLiquidityAlertsHandler(db))
	app.Get("/screener/liquidity-candidates", listLiquidityCandidatesHandler(db))

	app.Get("/fundamentals/:symbol", getFundamentalsHandler(db, yf))

	app.Get("/macro", getMacroHandler(db, yf))
	app.Post("/ingest/macro", ingestMacroHandler(db))
	app.Get("/macro/sensitivity/:symbol", listMacroSensitivityHandler(db))
	app.Post("/macro/sensitivity", createMacroSensitivityHandler(db))
	app.Delete("/macro/sensitivity/:id", deleteMacroSensitivityHandler(db))

	app.Post("/ingest/trades", ingestTradesHandler(db))
	app.Post("/ingest/broker-range", ingestBrokerRangeHandler(db))
	app.Post("/ingest/screener", ingestScreenerHandler(db))
	app.Post("/ingest/news", ingestNewsHandler(db))
	app.Get("/trades/:symbol", getTradesHandler(db))
	app.Get("/broker-analysis/:symbol", getBrokerAnalysisHandler(db))
	app.Get("/news", listNewsHandler(db))
	app.Get("/decision/:symbol", getDecisionHandler(db))
	app.Get("/historical-summary/:symbol", getHistoricalSummaryHandler(db))

	app.Post("/admin/reset-data", dataSessionAdmin, resetDataHandler(db))
	app.Get("/admin/pipeline/status", dataSessionAdmin, pipelineStatusHandler(db))
	app.Get("/admin/pipeline/jobs", dataSessionAdmin, listPipelineJobsHandler(db))
	app.Get("/admin/pipeline/freshness", dataSessionAdmin, listPipelineFreshnessHandler(db))
	app.Post("/admin/pipeline/jobs", dataSessionAdmin, enqueuePipelineJobHandler(db))
	app.Post("/admin/pipeline/jobs/:id/retry", dataSessionAdmin, retryPipelineJobHandler(db))
	app.Post("/admin/pipeline/control", dataSessionAdmin, pipelineControlHandler(db))
	app.Patch("/admin/pipeline/sources/:code", dataSessionAdmin, dataSourceControlHandler(db))
	app.Get("/admin/maintenance/preview", dataSessionAdmin, maintenancePreviewHandler(db))
	app.Post("/admin/maintenance/run", dataSessionAdmin, maintenanceRunHandler(db))
	app.Get("/admin/maintenance/runs", dataSessionAdmin, maintenanceRunsHandler(db))
	app.Get("/admin/broker-summary/health", dataSessionAdmin, brokerSummaryHealthHandler(db))
	app.Get("/admin/broker-session/status", dataSessionAdmin, brokerSessionHealthHandler())

	app.Get("/catalysts/:symbol", listCatalystsHandler(db))
	app.Post("/catalysts", createCatalystHandler(db))
	app.Patch("/catalysts/:id", updateCatalystHandler(db))
	app.Delete("/catalysts/:id", deleteCatalystHandler(db))

	app.Post("/ingest/market-movers", ingestMarketMoversHandler(db))
	app.Get("/market-movers", getMarketMoversHandler(db))

	app.Post("/ingest/calendar-events", ingestCalendarEventsHandler(db))
	app.Get("/calendar-events", getCalendarEventsHandler(db))

	app.Post("/ingest/insider-transactions", ingestInsiderTransactionsHandler(db))
	app.Get("/insider-transactions", getInsiderTransactionsHandler(db))

	app.Post("/ingest/keystats", ingestKeyStatsHandler(db))
	app.Get("/keystats/:symbol", getKeyStatsHandler(db))
	app.Get("/keystats-ratios/:symbol", getKeyStatsRatiosHandler(db))

	app.Post("/ingest/dividends", ingestDividendsHandler(db))
	app.Get("/dividends/:symbol", getDividendsHandler(db))

	app.Post("/ingest/financial-statements", ingestFinancialStatementsHandler(db))
	app.Get("/financial-statements/:symbol", getFinancialStatementsHandler(db))

	app.Post("/ai/outlook/:symbol", postAIOutlookHandler(db))

	app.Get("/technical/:symbol", getTechnicalHandler(db))
	app.Get("/foreign-radar", getForeignRadarHandler(db))
	app.Get("/broker-intel", getBrokerIntelHandler(db))
	app.Get("/broker-profiler", getBrokerProfilerHandler(db))
	app.Get("/stock-profile/:symbol", getStockProfileHandler(db))

	// Data Collector (bridge-extension): penampung endpoint Stockbit yang belum
	// punya tabel khusus + hasil segmentasi emiten.
	app.Post("/ingest/raw", ingestRawHandler(db))
	app.Get("/raw-ingest", listRawIngestHandler(db))
	app.Get("/raw-ingest/one", getRawIngestHandler(db))
	app.Get("/raw-ingest/stats", rawIngestStatsHandler(db))
	app.Get("/ingest/coverage", coverageHandler(db))
	app.Post("/ingest/brokers", ingestBrokersHandler(db))
	app.Get("/brokers", listBrokersHandler(db))
	app.Post("/ingest/classification", ingestClassificationHandler(db))
	app.Get("/classification", listClassificationHandler(db))

	app.Post("/ingest/shareholding", ingestShareholdingHandler(db))
	app.Get("/sid", getSIDHandler(db))
	app.Get("/shareholding/:symbol", getShareholdingCompositionHandler(db))
	app.Get("/shareholding-divergence", getShareholdingDivergenceHandler(db))
}

func healthHandler(db *sqlx.DB, env string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if err := db.Ping(); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"status": "error",
				"db":     err.Error(),
			})
		}
		return c.JSON(fiber.Map{
			"status": "ok",
			"env":    env,
		})
	}
}
