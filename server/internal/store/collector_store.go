package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
)

// Penampung hasil Data Collector (bridge-extension) untuk endpoint Stockbit
// yang BELUM punya tabel khusus: historical summary, broker activity historis,
// komposisi kepemilikan, aksi korporasi, analyst ratings, orderbook, dan
// seterusnya. Payload disimpan apa adanya sebagai JSON supaya tidak ada data
// yang hilang hanya karena skema tabelnya belum sempat dirancang; kalau nanti
// salah satunya butuh tabel sendiri, datanya sudah ada dan tinggal di-backfill
// dari sini.
//
// Kunci unik (endpoint, symbol, variant) membuat crawl ulang MEMPERBARUI baris
// yang sama alih-alih menumpuk. `variant` diisi extension dari jendela tanggal /
// varian request (mis. "2024-07-30..2025-07-29" atau "income-annual"), jadi tiap
// tahun histori tetap jadi barisnya sendiri.
type RawIngestRow struct {
	ID        int64           `db:"id" json:"id"`
	Source    string          `db:"source" json:"source"`
	Endpoint  string          `db:"endpoint" json:"endpoint"`
	Symbol    string          `db:"symbol" json:"symbol"`
	Variant   string          `db:"variant" json:"variant"`
	URL       string          `db:"url" json:"url"`
	Params    json.RawMessage `db:"params" json:"params"`
	Payload   json.RawMessage `db:"payload" json:"payload"`
	FetchedAt time.Time       `db:"fetched_at" json:"fetchedAt"`
	CreatedAt time.Time       `db:"created_at" json:"createdAt"`
}

// Hasil segmentasi emiten dari stockCategorizer.js: tier kapitalisasi +
// deteksi "gorengan" berbasis perilaku (papan pemantauan khusus, market mover
// ekstrem, konsentrasi broker, volatilitas). Satu baris per emiten, ditimpa
// tiap kali collector mengklasifikasi ulang.
type StockClassificationRow struct {
	Symbol          string          `db:"symbol" json:"symbol"`
	Tier            string          `db:"tier" json:"tier"`
	MarketCap       float64         `db:"market_cap" json:"marketCap"`
	IsGorengan      bool            `db:"is_gorengan" json:"isGorengan"`
	GorenganScore   int             `db:"gorengan_score" json:"gorenganScore"`
	GorenganReasons json.RawMessage `db:"gorengan_reasons" json:"gorenganReasons"`
	Categories      json.RawMessage `db:"categories" json:"categories"`
	ClassifiedAt    time.Time       `db:"classified_at" json:"classifiedAt"`
	UpdatedAt       time.Time       `db:"updated_at" json:"updatedAt"`
}

func EnsureCollectorTables(db *sqlx.DB) error {
	queries := []string{
		// url dibatasi 700 karakter supaya muat di index prefix bila nanti
		// diperlukan; URL Stockbit terpanjang (broker activity historis dengan
		// banyak parameter) masih jauh di bawahnya.
		`CREATE TABLE IF NOT EXISTS raw_ingest (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			source VARCHAR(32) NOT NULL DEFAULT 'stockbit_collector',
			endpoint VARCHAR(64) NOT NULL,
			symbol VARCHAR(16) NOT NULL DEFAULT '',
			variant VARCHAR(96) NOT NULL DEFAULT '',
			url VARCHAR(700) NOT NULL DEFAULT '',
			params JSON,
			payload JSON,
			fetched_at DATETIME NOT NULL,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY uq_raw (endpoint, symbol, variant),
			KEY idx_raw_symbol (symbol, endpoint),
			KEY idx_raw_fetched (fetched_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

		`CREATE TABLE IF NOT EXISTS stock_classification (
			symbol VARCHAR(16) PRIMARY KEY,
			tier VARCHAR(16) NOT NULL DEFAULT 'unknown',
			market_cap DOUBLE NOT NULL DEFAULT 0,
			is_gorengan TINYINT(1) NOT NULL DEFAULT 0,
			gorengan_score INT NOT NULL DEFAULT 0,
			gorengan_reasons JSON,
			categories JSON,
			classified_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			KEY idx_cls_tier (tier),
			KEY idx_cls_gorengan (is_gorengan, gorengan_score)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

		`CREATE TABLE IF NOT EXISTS historical_summary (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
			symbol VARCHAR(16) NOT NULL,
			period VARCHAR(32) NOT NULL,
			date DATE NOT NULL,
			open DOUBLE NOT NULL DEFAULT 0,
			high DOUBLE NOT NULL DEFAULT 0,
			low DOUBLE NOT NULL DEFAULT 0,
			close DOUBLE NOT NULL DEFAULT 0,
			volume BIGINT NOT NULL DEFAULT 0,
			value DOUBLE NOT NULL DEFAULT 0,
			change_pct DOUBLE NOT NULL DEFAULT 0,
			freq INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uq_hist_sym_period_date (symbol, period, date),
			KEY idx_hist_sym_period (symbol, period),
			KEY idx_hist_date (date)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
	}
	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return fmt.Errorf("create collector table error: %w", err)
		}
	}
	histColsOnce.Do(func() { ensureHistoricalSummaryExtraColumns(db) })
	return nil
}

var histColsOnce sync.Once

// average / foreign_buy / net_foreign memang dikirim Stockbit di data.result[]
// tapi tidak ada di skema awal historical_summary. Tanpa kolomnya, aliran dana
// asing PER PERIODE terbuang — padahal itu justru nilai tambah endpoint ini
// dibanding bars_daily yang selalu harian. Ditambahkan idempoten agar database
// yang sudah jalan ikut terurus tanpa langkah manual.
func ensureHistoricalSummaryExtraColumns(db *sqlx.DB) {
	for _, c := range []struct{ name, ddl string }{
		{"average", "DOUBLE NOT NULL DEFAULT 0"},
		{"foreign_buy", "DOUBLE NOT NULL DEFAULT 0"},
		{"net_foreign", "DOUBLE NOT NULL DEFAULT 0"},
	} {
		var n int
		if err := db.Get(&n, `SELECT COUNT(*) FROM information_schema.columns
			WHERE table_schema = DATABASE() AND table_name = 'historical_summary' AND column_name = ?`,
			c.name); err != nil || n > 0 {
			continue
		}
		if _, err := db.Exec("ALTER TABLE historical_summary ADD COLUMN `" + c.name + "` " + c.ddl); err != nil {
			log.Printf("peringatan: tambah kolom historical_summary.%s: %v", c.name, err)
		}
	}
}

func UpsertRawIngest(db *sqlx.DB, row RawIngestRow) error {
	if err := EnsureCollectorTables(db); err != nil {
		return err
	}
	if row.Source == "" {
		row.Source = "stockbit_collector"
	}
	if row.FetchedAt.IsZero() {
		row.FetchedAt = time.Now()
	}
	if row.Symbol != "" {
		_ = EnsureSymbol(db, row.Symbol)
	}
	// kolom JSON MySQL menolak string kosong — pakai NULL bila tidak ada isinya
	params := nullableJSON(row.Params)
	payload := nullableJSON(row.Payload)

	q := `INSERT INTO raw_ingest (source, endpoint, symbol, variant, url, params, payload, fetched_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	ON DUPLICATE KEY UPDATE
		source=VALUES(source), url=VALUES(url), params=VALUES(params),
		payload=VALUES(payload), fetched_at=VALUES(fetched_at);`
	_, err := db.Exec(q, row.Source, row.Endpoint, row.Symbol, row.Variant, row.URL,
		params, payload, row.FetchedAt)
	return err
}

func UpsertStockClassification(db *sqlx.DB, row StockClassificationRow) error {
	if err := EnsureCollectorTables(db); err != nil {
		return err
	}
	if row.Symbol == "" {
		return fmt.Errorf("symbol is required")
	}
	if row.Tier == "" {
		row.Tier = "unknown"
	}
	if row.ClassifiedAt.IsZero() {
		row.ClassifiedAt = time.Now()
	}
	_ = EnsureSymbol(db, row.Symbol)

	q := `INSERT INTO stock_classification
		(symbol, tier, market_cap, is_gorengan, gorengan_score, gorengan_reasons, categories, classified_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	ON DUPLICATE KEY UPDATE
		tier=VALUES(tier), market_cap=VALUES(market_cap), is_gorengan=VALUES(is_gorengan),
		gorengan_score=VALUES(gorengan_score), gorengan_reasons=VALUES(gorengan_reasons),
		categories=VALUES(categories), classified_at=VALUES(classified_at);`
	_, err := db.Exec(q, row.Symbol, row.Tier, row.MarketCap, row.IsGorengan, row.GorenganScore,
		nullableJSON(row.GorenganReasons), nullableJSON(row.Categories), row.ClassifiedAt)
	return err
}

// ListRawIngest: telusuri apa saja yang sudah masuk (dipakai untuk verifikasi
// hasil crawl). Payload sengaja TIDAK ikut dikembalikan supaya responsnya ringan;
// pakai GetRawIngest untuk mengambil satu payload utuh.
func ListRawIngest(db *sqlx.DB, symbol, endpoint string, limit int) ([]RawIngestRow, error) {
	if err := EnsureCollectorTables(db); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `SELECT id, source, endpoint, symbol, variant, url,
		COALESCE(params, CAST('null' AS JSON)) AS params,
		CAST('null' AS JSON) AS payload, fetched_at, created_at
		FROM raw_ingest WHERE 1=1`
	args := []interface{}{}
	if symbol != "" {
		q += " AND symbol = ?"
		args = append(args, symbol)
	}
	if endpoint != "" {
		q += " AND endpoint = ?"
		args = append(args, endpoint)
	}
	q += " ORDER BY fetched_at DESC LIMIT ?"
	args = append(args, limit)

	var rows []RawIngestRow
	if err := db.Select(&rows, q, args...); err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}

func GetRawIngest(db *sqlx.DB, endpoint, symbol, variant string) (*RawIngestRow, error) {
	if err := EnsureCollectorTables(db); err != nil {
		return nil, err
	}
	// COALESCE wajib: kolom JSON yang NULL tidak bisa di-scan ke json.RawMessage.
	var row RawIngestRow
	err := db.Get(&row, `SELECT id, source, endpoint, symbol, variant, url,
		COALESCE(params, CAST('null' AS JSON)) AS params,
		COALESCE(payload, CAST('null' AS JSON)) AS payload,
		fetched_at, created_at
		FROM raw_ingest WHERE endpoint = ? AND symbol = ? AND variant = ?`,
		endpoint, symbol, variant)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// RawIngestStat: rekap jumlah baris per endpoint — cara tercepat memastikan
// setiap endpoint collector benar-benar mendarat di database.
type RawIngestStat struct {
	Endpoint  string    `db:"endpoint" json:"endpoint"`
	Rows      int64     `db:"rows" json:"rows"`
	Symbols   int64     `db:"symbols" json:"symbols"`
	LastFetch time.Time `db:"last_fetch" json:"lastFetch"`
}

func RawIngestStats(db *sqlx.DB) ([]RawIngestStat, error) {
	if err := EnsureCollectorTables(db); err != nil {
		return nil, err
	}
	var rows []RawIngestStat
	// NULLIF: endpoint global disimpan dengan symbol='' — jangan dihitung sebagai emiten.
	err := db.Select(&rows, `SELECT endpoint, COUNT(*) AS `+"`rows`"+`,
		COUNT(DISTINCT NULLIF(symbol, '')) AS symbols, MAX(fetched_at) AS last_fetch
		FROM raw_ingest GROUP BY endpoint ORDER BY `+"`rows`"+` DESC`)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}

func ListStockClassification(db *sqlx.DB, tier string, gorenganOnly bool) ([]StockClassificationRow, error) {
	if err := EnsureCollectorTables(db); err != nil {
		return nil, err
	}
	q := `SELECT symbol, tier, market_cap, is_gorengan, gorengan_score,
		COALESCE(gorengan_reasons, CAST('null' AS JSON)) AS gorengan_reasons,
		COALESCE(categories, CAST('null' AS JSON)) AS categories,
		classified_at, updated_at
		FROM stock_classification WHERE 1=1`
	args := []interface{}{}
	if tier != "" {
		q += " AND tier = ?"
		args = append(args, tier)
	}
	if gorenganOnly {
		q += " AND is_gorengan = 1"
	}
	q += " ORDER BY market_cap DESC"

	var rows []StockClassificationRow
	if err := db.Select(&rows, q, args...); err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	return rows, nil
}

// Coverage: apa yang SUDAH tersimpan untuk satu emiten. Dipakai Data Collector
// supaya crawl ulang tidak menarik lagi data yang sudah ada — jendela histori
// yang sudah lewat bersifat tetap, jadi cukup ditarik sekali seumur hidup.
type Coverage struct {
	Symbol string            `json:"symbol"`
	Keys   map[string]string `json:"keys"` // "endpoint|variant" -> waktu ambil (RFC3339)
	Bars   CoverageRange     `json:"bars"` // rentang candle harian yang sudah ada
	// Sumber kebenaran untuk data broker adalah TABEL HASILNYA, bukan sekadar
	// adanya baris di raw_ingest. Pernah terjadi request broker mendarat di
	// raw_ingest dengan payload yang keliru (URL salah), sehingga tabel
	// hasilnya kosong; kalau collector cuma melihat raw_ingest, data rusak itu
	// akan dilewati selamanya dan tidak pernah diperbaiki.
	BrokerDays   []string `json:"brokerDays"`   // tanggal di broker_summary
	BrokerRanges []string `json:"brokerRanges"` // "from..to" di broker_range_agg
}

type CoverageRange struct {
	Count int    `json:"count"`
	Min   string `json:"min"`
	Max   string `json:"max"`
}

func GetCoverage(db *sqlx.DB, symbol string) (*Coverage, error) {
	if err := EnsureCollectorTables(db); err != nil {
		return nil, err
	}
	cov := &Coverage{Symbol: symbol, Keys: map[string]string{}, BrokerDays: []string{}}

	var rows []struct {
		Endpoint  string    `db:"endpoint"`
		Variant   string    `db:"variant"`
		FetchedAt time.Time `db:"fetched_at"`
	}
	if err := db.Select(&rows,
		`SELECT endpoint, variant, fetched_at FROM raw_ingest WHERE symbol = ?`, symbol); err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("coverage raw_ingest %s: %w", symbol, err)
	}
	for _, r := range rows {
		cov.Keys[r.Endpoint+"|"+r.Variant] = r.FetchedAt.UTC().Format(time.RFC3339)
	}

	// bars_daily & broker_summary dicek terpisah: keduanya bisa terisi lewat
	// route khusus tanpa melewati raw_ingest (kalau relayRaw dimatikan).
	var br struct {
		Count int            `db:"count"`
		Min   sql.NullString `db:"min"`
		Max   sql.NullString `db:"max"`
	}
	if err := db.Get(&br,
		"SELECT COUNT(*) AS `count`, MIN(`date`) AS `min`, MAX(`date`) AS `max` FROM bars_daily WHERE symbol = ?",
		symbol); err == nil {
		cov.Bars = CoverageRange{Count: br.Count, Min: br.Min.String, Max: br.Max.String}
	}

	var days []string
	if err := db.Select(&days,
		"SELECT DISTINCT DATE_FORMAT(`date`, '%Y-%m-%d') FROM broker_summary WHERE symbol = ? ORDER BY `date`",
		symbol); err == nil {
		cov.BrokerDays = days
	}

	var ranges []string
	if err := db.Select(&ranges,
		"SELECT DISTINCT CONCAT(DATE_FORMAT(from_date,'%Y-%m-%d'),'..',DATE_FORMAT(to_date,'%Y-%m-%d'))"+
			" FROM broker_range_agg WHERE symbol = ?", symbol); err == nil {
		cov.BrokerRanges = ranges
	}

	return cov, nil
}

func nullableJSON(raw json.RawMessage) interface{} {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return []byte(raw)
}

// SyncRawIngestToTables mengekstrak semua data raw_ingest ke tabel-tabel terstruktur.
func SyncRawIngestToTables(db *sqlx.DB) error {
	if err := EnsureCollectorTables(db); err != nil {
		return err
	}
	var rows []RawIngestRow
	err := db.Select(&rows, `
		SELECT id, source, endpoint, symbol, variant, url, params, payload, fetched_at, created_at
		FROM raw_ingest
	`)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("select raw_ingest for sync: %w", err)
	}
	synced := 0
	for _, r := range rows {
		if err := ProcessRawIngestPayload(db, r); err == nil {
			synced++
		}
	}
	log.Printf("[SyncRawIngest] Selesai memproses %d dari %d baris raw_ingest ke tabel terstruktur", synced, len(rows))
	return nil
}

// ProcessRawIngestPayload mengekstrak satu baris RawIngestRow ke tabel tujuan yang sesuai.
func ProcessRawIngestPayload(db *sqlx.DB, row RawIngestRow) error {
	if len(row.Payload) == 0 || string(row.Payload) == "null" {
		return nil
	}
	ep := strings.ToLower(row.Endpoint)
	url := strings.ToLower(row.URL)

	if strings.Contains(ep, "market") || strings.Contains(url, "market-mover") || strings.Contains(url, "market_mover") {
		return parseAndUpsertMarketMovers(db, row)
	}
	if strings.Contains(ep, "network") || strings.Contains(url, "shareholding/network") {
		return parseAndUpsertShareholdingNetwork(db, row)
	}
	if strings.Contains(ep, "composition") || strings.Contains(url, "shareholding/composition") {
		return parseAndUpsertShareholdingComposition(db, row)
	}
	if strings.Contains(ep, "majorholder") || strings.Contains(ep, "insider") || strings.Contains(url, "majorholder") || strings.Contains(url, "insider") {
		return parseAndUpsertMajorHolder(db, row)
	}
	if strings.Contains(ep, "historical") || strings.Contains(url, "historical/summary") {
		return parseAndUpsertHistoricalSummary(db, row)
	}
	return nil
}

func parseAndUpsertMarketMovers(db *sqlx.DB, row RawIngestRow) error {
	moverType := row.Variant
	if len(row.Params) > 0 {
		var p struct {
			MoverType      string `json:"moverType"`
			MoverTypeSnake string `json:"mover_type"`
		}
		_ = json.Unmarshal(row.Params, &p)
		if p.MoverType != "" {
			moverType = p.MoverType
		} else if p.MoverTypeSnake != "" {
			moverType = p.MoverTypeSnake
		}
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(row.Payload, &raw); err != nil {
		var arr []map[string]interface{}
		if err2 := json.Unmarshal(row.Payload, &arr); err2 == nil {
			return upsertMarketMoversFromMaps(db, arr, moverType)
		}
		return nil
	}

	var list []interface{}
	if d, ok := raw["data"]; ok {
		if arr, ok := d.([]interface{}); ok {
			list = arr
		} else if m, ok := d.(map[string]interface{}); ok {
			if moverList, ok := m["mover_list"].([]interface{}); ok {
				list = moverList
			} else if items, ok := m["items"].([]interface{}); ok {
				list = items
			} else if dataArr, ok := m["data"].([]interface{}); ok {
				list = dataArr
			}
		}
	} else if moverList, ok := raw["mover_list"].([]interface{}); ok {
		list = moverList
	} else if items, ok := raw["items"].([]interface{}); ok {
		list = items
	} else if movers, ok := raw["movers"].([]interface{}); ok {
		list = movers
	}

	var maps []map[string]interface{}
	for _, item := range list {
		if m, ok := item.(map[string]interface{}); ok {
			maps = append(maps, m)
		}
	}
	return upsertMarketMoversFromMaps(db, maps, moverType)
}

func upsertMarketMoversFromMaps(db *sqlx.DB, maps []map[string]interface{}, defaultMoverType string) error {
	if len(maps) == 0 {
		return nil
	}
	var movers []MarketMoverRow
	for _, m := range maps {
		sd, _ := m["stock_detail"].(map[string]interface{})

		sym := ""
		if sd != nil {
			sym = getString(firstVal(sd, "code", "symbol", "ticker"))
		}
		if sym == "" {
			sym = getString(firstVal(m, "symbol", "code", "ticker"))
		}
		sym = strings.ToUpper(strings.TrimSpace(sym))
		if sym == "" {
			continue
		}

		name := ""
		if sd != nil {
			name = getString(firstVal(sd, "name", "company_name"))
		}
		if name == "" {
			name = getString(firstVal(m, "name", "company_name"))
		}

		mt := getString(firstVal(m, "moverType", "mover_type"))
		if mt == "" {
			mt = defaultMoverType
		}
		if mt == "" {
			mt = "MOVER_TYPE_TOP_GAINER"
		}

		price := getFloat(firstVal(m, "price", "close", "last"))

		changePct := getFloat(firstVal(m, "changePct", "change_pct", "change_percentage"))
		if changePct == 0 {
			if chgMap, ok := m["change"].(map[string]interface{}); ok {
				changePct = getFloat(firstVal(chgMap, "percentage", "value"))
			}
		}

		volume := getInt64(firstVal(m, "volume", "vol"))
		value := getFloat(firstVal(m, "value", "val"))

		netBuy := getFloat(firstVal(m, "net_buy", "netBuy"))
		netSell := getFloat(firstVal(m, "net_sell", "netSell"))
		netForeign := getFloat(firstVal(m, "netForeign", "net_foreign"))
		if netForeign == 0 && (netBuy > 0 || netSell > 0) {
			netForeign = netBuy - netSell
		}

		movers = append(movers, MarketMoverRow{
			MoverType:  mt,
			Symbol:     sym,
			Name:       name,
			Price:      price,
			ChangePct:  changePct,
			Volume:     volume,
			Value:      value,
			NetForeign: netForeign,
		})
	}
	if len(movers) > 0 {
		return UpsertMarketMovers(db, movers)
	}
	return nil
}

func parseAndUpsertShareholdingNetwork(db *sqlx.DB, row RawIngestRow) error {
	var raw map[string]interface{}
	if err := json.Unmarshal(row.Payload, &raw); err != nil {
		return nil
	}
	d, ok := raw["data"].(map[string]interface{})
	if !ok {
		d = raw
	}

	reportDateStr := getString(d["report_date"])
	reportDate, err := ParseKSEIReportDate(reportDateStr)
	if err != nil || reportDate == "" {
		reportDate = lastMonthEndStr(row.FetchedAt)
	}

	nodesArr, _ := d["nodes"].([]interface{})
	edgesArr, _ := d["edges"].([]interface{})
	if len(nodesArr) == 0 || len(edgesArr) == 0 {
		return nil
	}

	nodesMap := make(map[string]map[string]interface{})
	var rootSymbol string
	for _, n := range nodesArr {
		nm, ok := n.(map[string]interface{})
		if !ok {
			continue
		}
		idStr := getString(nm["id"])
		nodesMap[idStr] = nm

		minDepth := getInt64(nm["min_depth"])
		meta, _ := nm["metadata"].(map[string]interface{})
		comp, _ := meta["company"].(map[string]interface{})
		if minDepth == 0 && comp != nil {
			rootSymbol = strings.ToUpper(getString(comp["symbol"]))
		}
	}
	if rootSymbol == "" {
		rootSymbol = strings.ToUpper(strings.TrimSpace(row.Symbol))
	}

	var holdings []ShareholdingInput
	for _, e := range edgesArr {
		em, ok := e.(map[string]interface{})
		if !ok {
			continue
		}
		fromID := getString(em["from_id"])
		toID := getString(em["to_id"])
		nodeA := nodesMap[fromID]
		nodeB := nodesMap[toID]
		if nodeA == nil || nodeB == nil {
			continue
		}

		typeA := getString(nodeA["node_type"])
		typeB := getString(nodeB["node_type"])

		var compNode, invNode map[string]interface{}
		if strings.HasSuffix(typeA, "COMPANY") && strings.HasSuffix(typeB, "INVESTOR") {
			compNode, invNode = nodeA, nodeB
		} else if strings.HasSuffix(typeB, "COMPANY") && strings.HasSuffix(typeA, "INVESTOR") {
			compNode, invNode = nodeB, nodeA
		} else {
			continue
		}

		cMeta, _ := compNode["metadata"].(map[string]interface{})
		iMeta, _ := invNode["metadata"].(map[string]interface{})
		compInfo, _ := cMeta["company"].(map[string]interface{})
		invInfo, _ := iMeta["investor"].(map[string]interface{})
		if compInfo == nil || invInfo == nil {
			continue
		}

		sym := strings.ToUpper(getString(compInfo["symbol"]))
		if sym == "" {
			continue
		}
		if rootSymbol != "" && sym != rootSymbol {
			continue
		}

		sh, _ := em["shareholding"].(map[string]interface{})
		invID := getInt64(invInfo["id"])
		if invID == 0 {
			continue
		}

		holdings = append(holdings, ShareholdingInput{
			ReportDate:     reportDate,
			Symbol:         sym,
			InvestorID:     invID,
			InvestorName:   getString(invInfo["name"]),
			InvestorType:   getString(invInfo["investor_type"]),
			Location:       getString(invInfo["location"]),
			Nationality:    getString(invInfo["nationality"]),
			Domicile:       getString(invInfo["domicile"]),
			Classification: getString(invInfo["investor_classification"]),
			Scrip:          getInt64(sh["scrip"]),
			Scripless:      getInt64(sh["scripless"]),
			TotalShares:    getInt64(sh["total_shares"]),
			Percentage:     getFloat(sh["percentage"]),
			CompanyID:      getInt64(compInfo["id"]),
		})
	}

	if len(holdings) > 0 {
		return UpsertShareholding(db, holdings)
	}
	return nil
}

func parseAndUpsertShareholdingComposition(db *sqlx.DB, row RawIngestRow) error {
	var raw map[string]interface{}
	var list []interface{}

	if err := json.Unmarshal(row.Payload, &raw); err == nil {
		if d, ok := raw["data"]; ok {
			if arr, ok := d.([]interface{}); ok {
				list = arr
			} else if m, ok := d.(map[string]interface{}); ok {
				if items, ok := m["composition"].([]interface{}); ok {
					list = items
				} else if items2, ok := m["items"].([]interface{}); ok {
					list = items2
				}
			}
		}
	} else {
		var arr []interface{}
		if err2 := json.Unmarshal(row.Payload, &arr); err2 == nil {
			list = arr
		}
	}

	if len(list) == 0 {
		return nil
	}

	symbol := strings.ToUpper(strings.TrimSpace(row.Symbol))
	reportDate := lastMonthEndStr(row.FetchedAt)

	var holdings []ShareholdingInput
	for idx, item := range list {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		sym := strings.ToUpper(getString(firstVal(m, "symbol", "code")))
		if sym == "" {
			sym = symbol
		}
		if sym == "" {
			continue
		}

		invID := getInt64(firstVal(m, "investor_id", "investorId", "id"))
		if invID == 0 {
			invID = int64(idx + 1)
		}
		invName := getString(firstVal(m, "investor_name", "investorName", "name", "holder_name"))
		if invName == "" {
			continue
		}

		rdStr := getString(firstVal(m, "report_date", "date"))
		parsedRd, err := ParseKSEIReportDate(rdStr)
		if err == nil && parsedRd != "" {
			reportDate = parsedRd
		}

		holdings = append(holdings, ShareholdingInput{
			ReportDate:     reportDate,
			Symbol:         sym,
			InvestorID:     invID,
			InvestorName:   invName,
			InvestorType:   getString(firstVal(m, "investor_type", "investorType", "type")),
			Location:       getString(firstVal(m, "location")),
			Nationality:    getString(firstVal(m, "nationality")),
			Domicile:       getString(firstVal(m, "domicile")),
			Classification: getString(firstVal(m, "classification")),
			Scrip:          getInt64(firstVal(m, "scrip")),
			Scripless:      getInt64(firstVal(m, "scripless")),
			TotalShares:    getInt64(firstVal(m, "total_shares", "totalShares", "shares")),
			Percentage:     getFloat(firstVal(m, "percentage", "pct")),
			CompanyID:      getInt64(firstVal(m, "company_id", "companyId")),
		})
	}

	if len(holdings) > 0 {
		return UpsertShareholding(db, holdings)
	}
	return nil
}

func parseAndUpsertMajorHolder(db *sqlx.DB, row RawIngestRow) error {
	var list []interface{}
	var raw map[string]interface{}
	if err := json.Unmarshal(row.Payload, &raw); err == nil {
		if d, ok := raw["data"]; ok {
			if arr, ok := d.([]interface{}); ok {
				list = arr
			} else if m, ok := d.(map[string]interface{}); ok {
				if mv, ok := m["movement"].([]interface{}); ok {
					list = mv
				} else if items, ok := m["items"].([]interface{}); ok {
					list = items
				}
			}
		} else if mv, ok := raw["movement"].([]interface{}); ok {
			list = mv
		}
	} else {
		_ = json.Unmarshal(row.Payload, &list)
	}

	if len(list) == 0 {
		return nil
	}

	symbol := strings.ToUpper(strings.TrimSpace(row.Symbol))
	var txs []InsiderTxRow
	var holdings []ShareholdingInput

	reportDate := lastMonthEndStr(row.FetchedAt)

	for idx, item := range list {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		sym := strings.ToUpper(getString(firstVal(m, "symbol", "code")))
		if sym == "" {
			sym = symbol
		}
		if sym == "" {
			continue
		}

		holder := getString(firstVal(m, "holder_name", "investor_name", "name"))
		action := getString(firstVal(m, "action_type", "action", "type"))
		txDateStr := getString(firstVal(m, "date", "tx_date"))

		var shares int64
		if chg, ok := m["changes"].(map[string]interface{}); ok {
			_, shares = parseNumberStr(getString(chg["value"]))
		}
		if shares == 0 {
			shares = getInt64(firstVal(m, "shares", "total_shares", "volume"))
		}

		price := getFloat(firstVal(m, "price", "avg_price"))

		if holder != "" && (action != "" || shares > 0) {
			txs = append(txs, InsiderTxRow{
				Symbol:     sym,
				HolderName: holder,
				ActionType: action,
				Shares:     shares,
				Price:      price,
				TxDate:     txDateStr,
			})
		}

		var pct float64
		var totalShares int64

		if cur, ok := m["current"].(map[string]interface{}); ok {
			pct, _ = parseNumberStr(getString(cur["percentage"]))
			_, totalShares = parseNumberStr(getString(cur["value"]))
		}
		if pct == 0 {
			pct = getFloat(firstVal(m, "percentage", "pct"))
		}
		if totalShares == 0 {
			totalShares = shares
		}

		if holder != "" && (pct > 0 || totalShares > 0) {
			invID := getInt64(firstVal(m, "cmh_id", "investor_id", "id"))
			if invID == 0 {
				invID = int64(idx + 1)
			}
			holdings = append(holdings, ShareholdingInput{
				ReportDate:     reportDate,
				Symbol:         sym,
				InvestorID:     invID,
				InvestorName:   holder,
				InvestorType:   getString(firstVal(m, "investor_type", "type")),
				TotalShares:    totalShares,
				Percentage:     pct,
				Classification: "MAJORHOLDER",
			})
		}
	}

	if len(txs) > 0 {
		_ = UpsertInsiderTransactions(db, txs)
	}
	if len(holdings) > 0 {
		_ = UpsertShareholding(db, holdings)
	}
	return nil
}

func parseNumberStr(s string) (float64, int64) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ",", "")
	s = strings.ReplaceAll(s, "+", "")
	f, _ := strconv.ParseFloat(s, 64)
	i, _ := strconv.ParseInt(s, 10, 64)
	return f, i
}

func firstVal(m map[string]interface{}, keys ...string) interface{} {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

func getFloat(v interface{}) float64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int64:
		return float64(val)
	case int:
		return float64(val)
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(val), 64)
		return f
	case map[string]interface{}:
		if raw, ok := val["raw"]; ok {
			return getFloat(raw)
		}
	}
	return 0
}

func getInt64(v interface{}) int64 {
	if v == nil {
		return 0
	}
	switch val := v.(type) {
	case float64:
		return int64(val)
	case int64:
		return val
	case int:
		return int64(val)
	case string:
		i, _ := strconv.ParseInt(strings.TrimSpace(val), 10, 64)
		return i
	case map[string]interface{}:
		if raw, ok := val["raw"]; ok {
			return getInt64(raw)
		}
	}
	return 0
}

func getString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case float64:
		if val == float64(int64(val)) {
			return strconv.FormatInt(int64(val), 10)
		}
		return strconv.FormatFloat(val, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(val), 'f', -1, 32)
	case int64:
		return strconv.FormatInt(val, 10)
	case int:
		return strconv.Itoa(val)
	case fmt.Stringer:
		return val.String()
	case map[string]interface{}:
		if f, ok := val["formatted"].(string); ok {
			return f
		}
		if name, ok := val["name"].(string); ok {
			return name
		}
		if raw, ok := val["raw"]; ok {
			return getString(raw)
		}
	}
	return fmt.Sprintf("%v", v)
}

func lastMonthEndStr(t time.Time) string {
	if t.IsZero() {
		t = time.Now()
	}
	firstOfThisMonth := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
	lastDayPrevMonth := firstOfThisMonth.AddDate(0, 0, -1)
	return lastDayPrevMonth.Format("2006-01-02")
}

type HistoricalSummaryRow struct {
	ID        int64     `db:"id" json:"id"`
	Symbol    string    `db:"symbol" json:"symbol"`
	Period    string    `db:"period" json:"period"`
	Date      string    `db:"date" json:"date"`
	Open      float64   `db:"open" json:"open"`
	High      float64   `db:"high" json:"high"`
	Low       float64   `db:"low" json:"low"`
	Close     float64   `db:"close" json:"close"`
	Volume    int64     `db:"volume" json:"volume"`
	Value     float64   `db:"value" json:"value"`
	ChangePct float64   `db:"change_pct" json:"changePct"`
	Freq      int       `db:"freq" json:"freq"`
	UpdatedAt time.Time `db:"updated_at" json:"updatedAt"`
}

func parseAndUpsertHistoricalSummary(db *sqlx.DB, row RawIngestRow) error {
	symbol := strings.ToUpper(strings.TrimSpace(row.Symbol))
	period := row.Variant
	if period == "" {
		period = "HS_PERIOD_DAILY"
	}
	if len(row.Params) > 0 {
		var p struct {
			Period string `json:"period"`
		}
		_ = json.Unmarshal(row.Params, &p)
		if p.Period != "" {
			period = p.Period
		}
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(row.Payload, &raw); err != nil {
		return nil
	}

	var items []interface{}
	if d, ok := raw["data"].([]interface{}); ok {
		items = d
	} else if d, ok := raw["data"].(map[string]interface{}); ok {
		// `result` adalah kunci yang BENAR-BENAR dipakai Stockbit
		// (data.result[] berisi {date, open, high, low, close, value, change,
		// volume, average, frequency, foreign_buy, net_foreign}). Kunci lain
		// dipertahankan sebagai cadangan kalau bentuknya berubah lagi.
		for _, key := range []string{"result", "results", "items", "history", "historical_summary", "data"} {
			if list, ok := d[key].([]interface{}); ok && len(list) > 0 {
				items = list
				break
			}
		}
	} else if list, ok := raw["items"].([]interface{}); ok {
		items = list
	}

	if len(items) == 0 {
		return nil
	}

	_ = EnsureCollectorTables(db)

	for _, item := range items {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		itemSym := symbol
		if code := getString(firstVal(m, "code", "symbol")); code != "" {
			itemSym = strings.ToUpper(code)
		}
		dateStr := getString(firstVal(m, "date", "time", "trade_date"))
		if len(dateStr) >= 10 {
			dateStr = dateStr[:10]
		}
		if dateStr == "" || itemSym == "" {
			continue
		}

		openPrice := getFloat(m["open"])
		highPrice := getFloat(m["high"])
		lowPrice := getFloat(m["low"])
		closePrice := getFloat(m["close"])
		volume := getInt64(m["volume"])
		val := getFloat(m["value"])
		// `change` = selisih harga absolut (mis. -15), bukan persen. Persennya
		// dihitung dari harga penutupan periode sebelumnya = close - change.
		changeAbs := getFloat(firstVal(m, "change", "change_value"))
		changePct := getFloat(firstVal(m, "change_percentage", "change_pct"))
		if changePct == 0 && changeAbs != 0 {
			if prev := closePrice - changeAbs; prev != 0 {
				changePct = changeAbs / prev * 100
			}
		}
		freq := int(getInt64(firstVal(m, "freq", "frequency")))
		average := getFloat(m["average"])
		foreignBuy := getFloat(firstVal(m, "foreign_buy", "foreignBuy"))
		netForeign := getFloat(firstVal(m, "net_foreign", "netForeign"))

		q := `INSERT INTO historical_summary (symbol, period, date, open, high, low, close, volume, value, change_pct, freq, average, foreign_buy, net_foreign)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close),
			volume=VALUES(volume), value=VALUES(value), change_pct=VALUES(change_pct), freq=VALUES(freq),
			average=VALUES(average), foreign_buy=VALUES(foreign_buy), net_foreign=VALUES(net_foreign);`

		if _, err := db.Exec(q, itemSym, period, dateStr, openPrice, highPrice, lowPrice, closePrice,
			volume, val, changePct, freq, average, foreignBuy, netForeign); err != nil {
			return fmt.Errorf("upsert historical_summary %s %s %s: %w", itemSym, period, dateStr, err)
		}
	}

	return nil
}

func GetHistoricalSummary(db *sqlx.DB, symbol, period string, limit int) ([]HistoricalSummaryRow, error) {
	if err := EnsureCollectorTables(db); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	q := `SELECT id, symbol, period, DATE_FORMAT(date, '%Y-%m-%d') AS date, open, high, low, close,
		volume, value, change_pct, freq, average, foreign_buy, net_foreign, updated_at
		FROM historical_summary WHERE symbol = ?`
	args := []interface{}{strings.ToUpper(strings.TrimSpace(symbol))}
	if period != "" {
		q += " AND period = ?"
		args = append(args, period)
	}
	q += " ORDER BY date DESC LIMIT ?"
	args = append(args, limit)

	var rows []HistoricalSummaryRow
	err := db.Select(&rows, q, args...)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("get historical summary: %w", err)
	}
	return rows, nil
}
