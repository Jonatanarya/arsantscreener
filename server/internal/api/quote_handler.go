package api

import (
	"database/sql"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"
)

type quoteResponse struct {
	Symbol    string   `json:"symbol" db:"symbol"`
	Name      string   `json:"name" db:"name"`
	Sector    *string  `json:"sector,omitempty" db:"sector"`
	Date      *string  `json:"date,omitempty"`
	Close     *float64 `json:"close,omitempty"`
	ChangePct *float64 `json:"changePct,omitempty"`
}

func quoteHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" || len(symbol) > 10 {
			return badRequest(c, "symbol is required")
		}
		var out quoteResponse
		if err := db.Get(&out, `SELECT code symbol,COALESCE(name,code) name,sector FROM symbols WHERE code=?`, symbol); err != nil {
			if err == sql.ErrNoRows {
				return c.SendStatus(404)
			}
			return c.SendStatus(500)
		}
		var bars []struct {
			Date  string  `db:"date"`
			Close float64 `db:"close"`
		}
		if err := db.Select(&bars, `SELECT DATE_FORMAT(date,'%Y-%m-%d') date,close FROM bars_daily WHERE symbol=? ORDER BY date DESC LIMIT 2`, symbol); err != nil {
			return c.SendStatus(500)
		}
		if len(bars) > 0 {
			out.Date, out.Close = &bars[0].Date, &bars[0].Close
		}
		if len(bars) > 1 && bars[1].Close != 0 {
			change := (bars[0].Close - bars[1].Close) / bars[1].Close * 100
			out.ChangePct = &change
		}
		return c.JSON(out)
	}
}
