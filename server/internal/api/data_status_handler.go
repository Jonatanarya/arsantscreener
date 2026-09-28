package api

import (
	"database/sql"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"
)

type dataAreaStatus struct {
	Available bool   `json:"available"`
	Count     int    `json:"count"`
	Latest    string `json:"latest,omitempty"`
}

type dataStatusResponse struct {
	Symbol       string                    `json:"symbol"`
	Completeness int                       `json:"completeness"`
	Latest       string                    `json:"latest,omitempty"`
	Areas        map[string]dataAreaStatus `json:"areas"`
}

func readDataArea(db *sqlx.DB, query string, args ...interface{}) dataAreaStatus {
	var row struct {
		Count  int            `db:"count"`
		Latest sql.NullString `db:"latest"`
	}
	if err := db.Get(&row, query, args...); err != nil {
		return dataAreaStatus{}
	}
	return dataAreaStatus{Available: row.Count > 0, Count: row.Count, Latest: row.Latest.String}
}

func dataStatusHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" || len(symbol) > 10 {
			return badRequest(c, "symbol is required")
		}

		areas := map[string]dataAreaStatus{
			"price":        readDataArea(db, `SELECT COUNT(*) count,DATE_FORMAT(MAX(date),'%Y-%m-%d') latest FROM bars_daily WHERE symbol=?`, symbol),
			"broker":       readDataArea(db, `SELECT COUNT(DISTINCT date) count,DATE_FORMAT(MAX(date),'%Y-%m-%d') latest FROM broker_summary WHERE symbol=?`, symbol),
			"transactions": readDataArea(db, `SELECT COUNT(*) count,DATE_FORMAT(MAX(trade_date),'%Y-%m-%d') latest FROM trades WHERE symbol=?`, symbol),
			"fundamentals": readDataArea(db, `SELECT COUNT(*) count,DATE_FORMAT(MAX(updated_at),'%Y-%m-%d') latest FROM financial_statements WHERE symbol=?`, symbol),
			"ownership":    readDataArea(db, `SELECT COUNT(*) count,DATE_FORMAT(MAX(report_date),'%Y-%m-%d') latest FROM shareholding WHERE symbol=?`, symbol),
			"analysis":     readDataArea(db, `SELECT COUNT(*) count,DATE_FORMAT(MAX(date),'%Y-%m-%d') latest FROM screener_results WHERE symbol=?`, symbol),
		}
		available := 0
		latest := ""
		for _, area := range areas {
			if area.Available {
				available++
			}
			if area.Latest > latest {
				latest = area.Latest
			}
		}
		return c.JSON(dataStatusResponse{Symbol: symbol, Completeness: available * 100 / len(areas), Latest: latest, Areas: areas})
	}
}
