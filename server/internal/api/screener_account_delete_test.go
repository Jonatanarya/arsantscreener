package api

import (
	"testing"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite"
)

func TestDeleteScreenerAccountRemovesOnlyOwnedData(t *testing.T) {
	db, err := sqlx.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	for _, schema := range []string{
		`CREATE TABLE screener_users (id TEXT PRIMARY KEY)`,
		`CREATE TABLE user_watchlist_items (user_id TEXT)`,
		`CREATE TABLE user_watchlists (user_id TEXT)`,
		`CREATE TABLE user_alert_settings (user_id TEXT)`,
		`CREATE TABLE positions (user_id TEXT)`,
	} {
		if _, err = db.Exec(schema); err != nil {
			t.Fatal(err)
		}
	}
	for _, userID := range []string{"delete-me", "keep-me"} {
		if _, err = db.Exec(`INSERT INTO screener_users(id) VALUES(?)`, userID); err != nil {
			t.Fatal(err)
		}
		for _, table := range []string{"user_watchlist_items", "user_watchlists", "user_alert_settings", "positions"} {
			if _, err = db.Exec(`INSERT INTO `+table+`(user_id) VALUES(?)`, userID); err != nil {
				t.Fatal(err)
			}
		}
	}

	if err = deleteScreenerAccount(db, "delete-me"); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"screener_users", "user_watchlist_items", "user_watchlists", "user_alert_settings", "positions"} {
		var deleted, kept int
		if err = db.Get(&deleted, `SELECT COUNT(*) FROM `+table+` WHERE `+map[bool]string{true: "id", false: "user_id"}[table == "screener_users"]+`=?`, "delete-me"); err != nil {
			t.Fatal(err)
		}
		if err = db.Get(&kept, `SELECT COUNT(*) FROM `+table+` WHERE `+map[bool]string{true: "id", false: "user_id"}[table == "screener_users"]+`=?`, "keep-me"); err != nil {
			t.Fatal(err)
		}
		if deleted != 0 || kept != 1 {
			t.Fatalf("%s counts after delete: deleted=%d kept=%d", table, deleted, kept)
		}
	}
}
