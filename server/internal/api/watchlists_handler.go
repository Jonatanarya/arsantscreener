package api

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"
	"strings"
)

const defaultWatchlistName = "Pantauan Utama"

type watchlistMutation struct {
	ListName string `json:"listName"`
	Symbol   string `json:"symbol"`
}
type watchlistGroup struct {
	Name    string   `json:"name"`
	Symbols []string `json:"symbols"`
}
type watchlistRow struct {
	Name   string  `db:"list_name"`
	Symbol *string `db:"symbol"`
}

type watchlistNameMutation struct {
	Name string `json:"name"`
}

func ensureUserWatchlists(db *sqlx.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS user_watchlists (user_id CHAR(36) NOT NULL, name VARCHAR(80) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS user_watchlist_items (user_id CHAR(36) NOT NULL, list_name VARCHAR(80) NOT NULL DEFAULT 'Pantauan Utama', symbol VARCHAR(10) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,list_name,symbol), KEY idx_user_watchlist_symbol(symbol)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	_, err := db.Exec(`INSERT IGNORE INTO user_watchlists(user_id,name) SELECT DISTINCT user_id,list_name FROM user_watchlist_items`)
	return err
}
func listUserWatchlistsHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID := c.Locals("screener_user_id")
		if _, err := db.Exec(`INSERT IGNORE INTO user_watchlists(user_id,name) VALUES(?,?)`, userID, defaultWatchlistName); err != nil {
			return c.SendStatus(500)
		}
		var rows []watchlistRow
		if e := db.Select(&rows, `SELECT l.name AS list_name,i.symbol FROM user_watchlists l LEFT JOIN user_watchlist_items i ON i.user_id=l.user_id AND i.list_name=l.name WHERE l.user_id=? ORDER BY l.created_at,l.name,i.symbol`, userID); e != nil {
			return c.SendStatus(500)
		}
		groups := []watchlistGroup{}
		for _, r := range rows {
			if len(groups) == 0 || groups[len(groups)-1].Name != r.Name {
				groups = append(groups, watchlistGroup{Name: r.Name, Symbols: []string{}})
			}
			if r.Symbol != nil {
				groups[len(groups)-1].Symbols = append(groups[len(groups)-1].Symbols, *r.Symbol)
			}
		}
		return c.JSON(fiber.Map{"lists": groups})
	}
}
func addUserWatchlistItemHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req watchlistMutation
		if c.BodyParser(&req) != nil {
			return badRequest(c, "invalid JSON body")
		}
		req.Symbol = strings.ToUpper(strings.TrimSpace(req.Symbol))
		req.ListName = strings.TrimSpace(req.ListName)
		if req.ListName == "" {
			req.ListName = defaultWatchlistName
		}
		if req.Symbol == "" || len(req.ListName) > 80 {
			return badRequest(c, "symbol atau nama daftar tidak valid")
		}
		var n int
		if e := db.Get(&n, `SELECT COUNT(*) FROM symbols WHERE code=?`, req.Symbol); e != nil || n == 0 {
			return badRequest(c, "emiten tidak ditemukan")
		}
		userID := c.Locals("screener_user_id")
		if _, e := db.Exec(`INSERT IGNORE INTO user_watchlists(user_id,name) VALUES(?,?)`, userID, req.ListName); e != nil {
			return c.SendStatus(500)
		}
		_, e := db.Exec(`INSERT IGNORE INTO user_watchlist_items(user_id,list_name,symbol) VALUES(?,?,?)`, userID, req.ListName, req.Symbol)
		if e != nil {
			return c.SendStatus(500)
		}
		return c.SendStatus(204)
	}
}
func deleteUserWatchlistItemHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		name := strings.TrimSpace(c.Query("listName", defaultWatchlistName))
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		_, e := db.Exec(`DELETE FROM user_watchlist_items WHERE user_id=? AND list_name=? AND symbol=?`, c.Locals("screener_user_id"), name, symbol)
		if e != nil {
			return c.SendStatus(500)
		}
		return c.SendStatus(204)
	}
}

func createUserWatchlistHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req watchlistNameMutation
		if c.BodyParser(&req) != nil {
			return badRequest(c, "invalid JSON body")
		}
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" || len(req.Name) > 80 {
			return badRequest(c, "nama watchlist tidak valid")
		}
		userID := c.Locals("screener_user_id")
		var count int
		if err := db.Get(&count, `SELECT COUNT(*) FROM user_watchlists WHERE user_id=?`, userID); err != nil {
			return c.SendStatus(500)
		}
		if count >= 10 {
			return badRequest(c, "maksimal 10 watchlist per akun")
		}
		if _, err := db.Exec(`INSERT INTO user_watchlists(user_id,name) VALUES(?,?)`, userID, req.Name); err != nil {
			return c.Status(409).JSON(ErrorResponse{Error: "nama watchlist sudah digunakan"})
		}
		return c.Status(201).JSON(fiber.Map{"name": req.Name})
	}
}

func renameUserWatchlistHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		oldName := strings.TrimSpace(c.Params("name"))
		var req watchlistNameMutation
		if c.BodyParser(&req) != nil {
			return badRequest(c, "invalid JSON body")
		}
		req.Name = strings.TrimSpace(req.Name)
		if oldName == defaultWatchlistName || req.Name == "" || len(req.Name) > 80 {
			return badRequest(c, "watchlist bawaan tidak dapat diganti namanya")
		}
		userID := c.Locals("screener_user_id")
		tx, err := db.Beginx()
		if err != nil {
			return c.SendStatus(500)
		}
		defer tx.Rollback()
		res, err := tx.Exec(`UPDATE user_watchlists SET name=? WHERE user_id=? AND name=?`, req.Name, userID, oldName)
		if err != nil {
			return c.Status(409).JSON(ErrorResponse{Error: "nama watchlist sudah digunakan"})
		}
		changed, _ := res.RowsAffected()
		if changed == 0 {
			return c.SendStatus(404)
		}
		if _, err = tx.Exec(`UPDATE user_watchlist_items SET list_name=? WHERE user_id=? AND list_name=?`, req.Name, userID, oldName); err != nil {
			return c.SendStatus(500)
		}
		if err = tx.Commit(); err != nil {
			return c.SendStatus(500)
		}
		return c.JSON(fiber.Map{"name": req.Name})
	}
}

func deleteUserWatchlistHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		name := strings.TrimSpace(c.Params("name"))
		if name == defaultWatchlistName {
			return badRequest(c, "watchlist bawaan tidak dapat dihapus")
		}
		userID := c.Locals("screener_user_id")
		tx, err := db.Beginx()
		if err != nil {
			return c.SendStatus(500)
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`DELETE FROM user_watchlist_items WHERE user_id=? AND list_name=?`, userID, name); err != nil {
			return c.SendStatus(500)
		}
		res, err := tx.Exec(`DELETE FROM user_watchlists WHERE user_id=? AND name=?`, userID, name)
		if err != nil {
			return c.SendStatus(500)
		}
		changed, _ := res.RowsAffected()
		if changed == 0 {
			return c.SendStatus(404)
		}
		if err = tx.Commit(); err != nil {
			return c.SendStatus(500)
		}
		return c.SendStatus(204)
	}
}
