package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv  string
	AppHost string
	AppPort string

	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string

	RedisAddr string

	AnthropicAPIKey    string
	IngestAPIKey       string
	CORSAllowedOrigins string

	GoogleClientID             string
	GoogleClientSecret         string
	GoogleRedirectURL          string
	ScreenerGoogleClientID     string
	ScreenerGoogleClientSecret string
	RouterSessionSecret        string
	RouterGatewayURL           string
	RouterGatewayPassword      string
	RouterGatewayDBPath        string
	MayarAPIKey                string
	RouterAdminEmails          string
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	cfg := &Config{
		AppEnv:                     getEnv("APP_ENV", "development"),
		AppHost:                    getEnv("APP_HOST", "127.0.0.1"),
		AppPort:                    getEnv("APP_PORT", "4000"),
		DBHost:                     getEnv("DB_HOST", "127.0.0.1"),
		DBPort:                     getEnv("DB_PORT", "8889"),
		DBUser:                     getEnv("DB_USER", "root"),
		DBPassword:                 getEnv("DB_PASSWORD", "root"),
		DBName:                     getEnv("DB_NAME", "tradewise"),
		RedisAddr:                  getEnv("REDIS_ADDR", "127.0.0.1:6379"),
		AnthropicAPIKey:            getEnv("ANTHROPIC_API_KEY", ""),
		IngestAPIKey:               getEnv("INGEST_API_KEY", ""),
		CORSAllowedOrigins:         getEnv("CORS_ALLOWED_ORIGINS", "*"),
		GoogleClientID:             getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:         getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:          getEnv("GOOGLE_REDIRECT_URL", "https://arsant.my.id/api/auth/google/callback"),
		ScreenerGoogleClientID:     getEnv("SCREENER_GOOGLE_CLIENT_ID", ""),
		ScreenerGoogleClientSecret: getEnv("SCREENER_GOOGLE_CLIENT_SECRET", ""),
		RouterSessionSecret:        getEnv("ROUTER_SESSION_SECRET", ""),
		RouterGatewayURL:           getEnv("ROUTER_GATEWAY_URL", "http://127.0.0.1:20128"),
		RouterGatewayPassword:      getEnv("ROUTER_GATEWAY_PASSWORD", ""),
		RouterGatewayDBPath:        getEnv("ROUTER_GATEWAY_DB_PATH", ""),
		MayarAPIKey:                getEnv("MAYAR_API_KEY", ""),
		RouterAdminEmails:          getEnv("ROUTER_ADMIN_EMAILS", ""),
	}

	return cfg, nil
}

// NewIngestAPIKey returns a URL-safe secret for the collector-to-server relay.
func NewIngestAPIKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (c *Config) MySQLDSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=Local&charset=utf8mb4",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName)
}

func (c *Config) MySQLMigrationDSN() string {
	return c.MySQLDSN() + "&multiStatements=true"
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
