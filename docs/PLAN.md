# Arsant Screener — Rencana Sistem Analisis Saham Indonesia

> Web app analisis saham multi-panel untuk trader IDX, dibangun dari 3 referensi project
> (algotrader, saham-mcp, stockai) + extension brokermology (data Stockbit).
> Konteks: market 2026 — ketidakpastian geopolitik, perang tarif, tekanan macro domestik.

---

## 1. Visi & Positioning

Satu layar kerja (terminal multi-panel) yang menggabungkan **empat pilar analisa** yang
selama ini terpisah di banyak tool:

1. **Teknikal** — chart, indikator, struktur trend, S/R, fibonacci, sinyal.
2. **Brokermology** — fase akumulasi/distribusi, smart money detector, avg cost bandar,
   foreign flow.
3. **Tape reading / bid-offer** — orderbook depth realtime, imbalance, deteksi bid/offer
   palsu, transaksi besar.
4. **Fundamental + Macro** — valuasi, laporan keuangan, dan **dashboard rezim macro 2026**
   (USD/IDR, BI rate, komoditas, foreign flow agregat, berita tarif/geopolitik).

Prinsip: **decision support, bukan auto-trading**. Eksekusi tetap manual di broker
(menghindari risiko ToS + risiko operasional auto-order dari algotrader).

---

## 2. Apa yang Diambil dari Tiap Referensi

| Sumber | Yang di-reuse | Bentuk di sistem baru |
|---|---|---|
| **extension/brokermology** (JS) | Interceptor token + API Stockbit (broker summary, orderbook, candle daily, WS tick protobuf); heuristik fase akumulasi/distribusi; smart money detector (clean buy %, konsistensi, avg/trx); VSA effort-vs-result; live tape + fake wall detection; S/R clustering; ARA/ARB tier & tick IDX; TP/SL berbasis ATR | **Data bridge** (extension diperluas untuk push data ke backend lokal) + seluruh logika analisa di-port ke Go (`internal/analytics`, teruji unit test) |
| **saham-mcp** (TS) | Data source multi-fallback (Yahoo Finance, GitHub Dataset-Saham-IDX 2019–2025, scraper); technical-analysis service; desain tools MCP | Logika data source & tools di-port ke Go (`internal/ingest`, `internal/mcp` via mcp-go) agar terminal bisa "ditanya" via Claude |
| **stockai** (Python) | Multi-factor scoring (Value/Quality/Momentum/Volatility); 6-gate decision filter; position sizing 2% risk; portfolio risk (VaR, Sharpe, drawdown); morning/evening briefing; multi-agent AI (Technical/Fundamental/Risk Manager) | Di-port ke Go di `internal/quant` + AI layer pakai Claude API (bukan Gemini) |
| **algotrader** (Python) | Konsep workflow sinyal → alert Telegram; money management | Alert engine (Telegram/desktop notification); **auto-order TIDAK diambil** |

---

## 3. Arsitektur

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER EXTENSION (brokermology v2 = "data bridge")        │
│  intercept Stockbit: token, broker summary, orderbook,      │
│  WS ticks, candle  ──►  POST ke backend localhost           │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  BACKEND — Golang (Fiber/Gin)                               │
│  • Ingestion: bridge API, EOD (Yahoo/GitHub dataset),       │
│    berita & kalender macro (RSS/scrape), kurs & komoditas   │
│  • Storage: MySQL 5.7 lokal via MAMP, 127.0.0.1:8889        │
│    (OHLCV, broksum, orderbook snapshot — tabel ter-partisi  │
│    per bulan) · Redis (cache, pub/sub, ring buffer tick)     │
│  • Analytics engine: internal/analytics + internal/quant    │
│  • WebSocket fan-out ke frontend (tick, orderbook, alert)   │
│    — goroutine hub per topik (gorilla/websocket)            │
│  • AI service: Claude API (agents, sentiment, briefing)     │
│  • MCP server via mcp-go (tools setara saham-mcp)           │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND — React 18 + TypeScript + Vite                    │
│  • Layout: dockview (panel dock/split/tab workspace)        │
│  • Chart: TradingView Lightweight Charts + custom overlay   │
│    (kotak fase, panah sinyal, S/R, fib, TP/SL, marker lot)  │
│  • Grid: TanStack Table (broksum, screener, watchlist)      │
│  • State: Zustand + TanStack Query · WS client realtime     │
│  • Command palette (Ctrl+K): "BBCA <GO>"                   │
└─────────────────────────────────────────────────────────────┘
```

**Kenapa extension tetap dipakai sebagai sumber data:** data broker summary & orderbook
Stockbit hanya tersedia lewat sesi login user. Pola interceptor yang sudah terbukti di
brokermology (fetch/XHR/PerformanceObserver/WebSocket patch, JWT refresh dari frame WS)
dipertahankan; yang baru hanyalah **relay ke backend** supaya data tersimpan permanen di
MySQL dan bisa dianalisa lintas-hari/lintas-saham, bukan cuma di localStorage.

**Catatan stack Golang + MySQL:**
- **Framework**: Fiber atau Gin + `gorilla/websocket`; akses DB pakai `sqlx` (query
  eksplisit, cocok untuk agregasi time-series) + `golang-migrate` untuk migrasi skema.
- **Database lokal via MAMP** — tidak pakai Docker. MySQL sudah jalan di
  `127.0.0.1:8889` (root/root, dikelola lewat phpMyAdmin `http://localhost:8888/phpMyAdmin5/`),
  versi **5.7.34**. Server Go connect langsung ke instance ini lewat DSN di `.env`.
  Nama database: **`tradewise_terminal`** (bukan `tradewise` — nama itu sudah dipakai
  instance MAMP yang sama untuk aplikasi lain milik user: tabel `users`, `signals`,
  `trades`, `subscription_plans`, `payment_history`, dst. Sempat tertimpa migrasi awal
  lalu di-rollback bersih sebelum lanjut ke database baru).
- **Implikasi MySQL 5.7** (bukan 8.0): belum ada window function & CTE. Agregasi yang
  biasanya pakai `ROW_NUMBER()`/`RANK()`/running total (mis. ranking broker per hari,
  running OBV) dihitung di kode Go setelah query mentah, bukan di SQL. Ini sejalan
  dengan rencana awal (analytics memang di-port ke Go), jadi bukan hambatan — hanya
  perlu disiplin agar query tetap query sederhana (SELECT + agregat dasar), logika
  urutan/ranking di service layer.
- **Time-series di MySQL**: tabel `bars_daily`, `broker_summary`, `orderbook_snapshot`
  dipartisi `PARTITION BY RANGE` per bulan pada kolom tanggal, primary key komposit
  `(symbol, date)`. Untuk skala single-user IDX (±950 saham, data 2019–sekarang) ini
  ringan; tick intraday di-downsample ke candle 1 menit sebelum disimpan, tick mentah
  cukup di Redis (ring buffer per simbol) untuk Live Tape — tidak masuk MySQL sama
  sekali.
- **Redis**: masih perlu dijalankan terpisah (MAMP tidak menyediakannya) — cukup
  `brew install redis && brew services start redis`, tanpa Docker.
- **Analytics di Go**: port heuristik brokermology & scoring stockai jadi package Go
  (concurrent per-simbol via goroutine — screening 950 saham jauh lebih cepat).
- **Kontrak Go ↔ TypeScript**: definisikan API dengan OpenAPI spec, generate types
  frontend pakai `openapi-typescript` — satu sumber kebenaran, tanpa duplikasi manual.

---

## 4. Modul Terminal (Panel)

### Fase inti (MVP)
1. **Watchlist + Quote board** — harga realtime (WS tick), % change, foreign flow harian,
   status fase bandar terakhir, skor multi-factor.
2. **Chart workspace** — candlestick + overlay fase akumulasi/distribusi, S/R otomatis,
   fibonacci, sinyal ▲/▼, rencana TP/SL, avg cost bandar (port penuh dari brokermology).
3. **Broker Summary / Brokermology panel** — tabel smart money per periode, top broker
   net buy/sell, klasifikasi broker (asing/BUMN/institusi/ritel), riwayat fase.
4. **Live Tape / Bid-Offer** — depth bid/offer, imbalance gauge, deteksi fake wall,
   penanda transaksi besar, running trade.
5. **PVA/VSA panel** — klasifikasi candle effort-vs-result, OBV + divergensi,
   selling/buying climax.

### Fase lanjutan
6. **Screener** — filter gabungan: teknikal + fase bandar + skor kuant + likuiditas
   (contoh: "saham fase AKUMULASI + foreign net buy 20 hari + RSI < 50 + value > 5 M/hari").
7. **Fundamental panel** — rasio valuasi, tren laba, dividen (sumber: dataset publik +
   input manual laporan keuangan).
8. **Macro Dashboard 2026** — lihat §5.
9. **Risk & Portfolio manager** — posisi, sizing 2% rule, batas 20%/saham & 40%/sektor,
   VaR & drawdown, P&L harian.
10. **Trading journal** — entry/exit + alasan + screenshot chart otomatis; review win-rate.
11. **Alert engine** — sinyal teknikal, fase baru terdeteksi, fake wall, berita penting →
    notifikasi desktop + Telegram.
12. **AI Copilot** — panel chat (Claude): validasi trade plan 3-agent (Technical,
    Fundamental, Risk Manager), morning/evening briefing otomatis, ringkasan berita.

---

## 5. Fitur Khusus Konteks 2026 (Perang, Perang Tarif, Macro Domestik)

Era sekarang membuat analisa bottom-up saja tidak cukup — top-down regime harus jadi
layer pertama:

1. **Regime Detector (Risk-On/Risk-Off meter)** — komposit dari: tren IHSG vs MA200,
   foreign flow agregat 20 hari, USD/IDR momentum, VIX/CDS Indonesia (bila tersedia),
   breadth (% saham di atas MA50). Output: label rezim + rekomendasi eksposur maksimal
   (mis. Risk-Off → max 30% invested, sisanya cash).
2. **Peta sensitivitas sektor terhadap tarif & komoditas** — mapping statis + skor:
   - Perang tarif ekspor → tekstil, alas kaki, elektronik ekspor, CPO.
   - Harga energi naik (perang) → batubara/migas diuntungkan (ADRO, PTBA, MEDC),
     importir energi & transportasi tertekan.
   - Rupiah melemah → emiten utang USD & bahan baku impor (farmasi, poultry) tertekan;
     eksportir komoditas diuntungkan.
   - Defensive rotation → konsumer, telko, healthcare, dividen tinggi.
3. **Macro ticker bar** (baris atas workspace): IHSG, USD/IDR, harga
   batubara/CPO/nikel/emas/minyak, yield SBN 10 th, BI rate — dengan sparkline.
4. **News & event stream** — agregasi RSS berita ekonomi ID/global, di-scoring sentimen
   oleh Claude dengan konteks tarif/geopolitik; kalender ekonomi (rilis inflasi, RDG BI,
   FOMC) dengan countdown.
5. **Scenario stress test portofolio** — simulasi sederhana: "rupiah −5%", "tarif baru
   sektor X", "minyak +20%" → estimasi dampak per posisi via beta sektor & sensitivitas.
6. **Foreign flow watch** — agregat net asing harian IDX + per saham, deteksi divergensi
   (asing akumulasi saat harga turun — sudah ada di brokermology, dinaikkan jadi
   dashboard lintas-saham).

---

## 6. Struktur Repo (monorepo)

```
QuantModelBEI/
├── web/                      # React + TS + Vite (terminal UI, pnpm)
│   └── src/generated/        # types API hasil generate dari OpenAPI
├── server/                   # Golang
│   ├── cmd/server/           # entrypoint API + WS
│   ├── cmd/ingest/           # worker EOD backfill & scheduler
│   ├── internal/api/         # handler HTTP (Fiber/Gin) + OpenAPI spec
│   ├── internal/ws/          # hub WebSocket (tick, orderbook, alert)
│   ├── internal/ingest/      # bridge receiver, Yahoo/dataset, berita, kurs
│   ├── internal/analytics/   # port brokermology: fase, smart money, VSA,
│   │                         # S/R, sinyal, tick/ARA-ARB IDX, fib, TP/SL
│   ├── internal/quant/       # port stockai: scoring, gates, sizing, risk
│   ├── internal/ai/          # Claude API (agents, sentiment, briefing)
│   ├── internal/store/       # repository MySQL (sqlx) + Redis
│   ├── internal/mcp/         # MCP server (mcp-go, tools setara saham-mcp)
│   └── migrations/           # golang-migrate (skema MySQL ter-partisi)
├── bridge-extension/         # brokermology v2 (intercept + relay)
└── docs/
```

---

## 7. Roadmap Bertahap

### Phase 0 — Fondasi (±1 minggu)
- Setup monorepo, CI ringan. Database pakai MySQL MAMP lokal yang sudah jalan
  (`127.0.0.1:8889`); Redis via `brew install redis`. Tanpa Docker.
- Skeleton Go (Fiber/Gin + sqlx + golang-migrate) + OpenAPI spec awal + generate types
  frontend.
- Definisikan struct/skema dari format API Stockbit yang sudah dipetakan interceptor
  (`brokers_buy/sell`, `chartbit price/daily`, orderbook, WS tick protobuf).

### Phase 1 — Data foundation (±2 minggu)
- Upgrade brokermology → bridge: relay token + broker summary + orderbook + tick ke
  backend; endpoint ingestion + skema MySQL ter-partisi.
- EOD pipeline dari Yahoo/GitHub Dataset-Saham-IDX (port dari saham-mcp) untuk backfill
  2019–sekarang.
- Backfill broker summary historis per saham watchlist (replay per hari bursa, seperti
  mekanisme cache extension sekarang).

### Phase 2 — Terminal UI core (±2–3 minggu)
- Layout dockview + command palette + macro ticker bar.
- Chart panel (Lightweight Charts) + watchlist realtime via WS.
- Port overlay chart: fase, S/R, sinyal, TP/SL.

### Phase 3 — Analytics port (±2–3 minggu)
- Port penuh `app.js` brokermology ke Go `internal/analytics` dengan unit test
  (fase akumulasi/distribusi, smart money, VSA, live tape, fake wall, ARA/ARB).
- Broker summary panel + PVA panel + Live Tape panel.

### Phase 4 — Quant & Screener (±2 minggu)
- Port scoring stockai (multi-factor, 6-gate, sizing, VaR/Sharpe).
- Screener lintas-saham di atas data MySQL (concurrent per-simbol via goroutine).
- Regime detector + peta sensitivitas sektor (fitur 2026).

### Phase 5 — AI & Alerts (±2 minggu)
- Claude API: 3-agent trade validation, morning/evening briefing, sentimen berita.
- News stream + kalender ekonomi.
- Alert engine → desktop + Telegram.
- MCP server supaya terminal bisa diquery dari Claude Code/Desktop.

### Phase 6 — Risk, Journal, Stress test (±1–2 minggu)
- Portfolio manager, journal, scenario stress test.

Total estimasi: **±3 bulan** part-time untuk MVP lengkap; panel inti (Phase 0–3) sudah
bisa dipakai trading harian di ±6 minggu.

---

## 8. Risiko & Batasan

| Risiko | Mitigasi |
|---|---|
| Stockbit mengubah struktur API | Parser toleran (sudah pola brokermology), template URL ditangkap ulang otomatis, fallback EOD Yahoo/dataset |
| Token expiry | Sudah dipecahkan interceptor via JWT segar dari frame WS subscribe |
| ToS Stockbit | Hanya memakai akses akun sendiri, single-user, tanpa redistribusi data; tidak ada auto-order |
| Data fundamental terbatas | Mulai dari dataset publik + input manual; sumber berbayar opsional belakangan |
| Overfitting heuristik (sensitivitas fase) | Simpan parameter per-preset, backtest di data historis broksum yang mulai terkumpul di MySQL |
| Ketergantungan sesi browser untuk data realtime | Bridge hanya perlu 1 tab Stockbit terbuka saat jam bursa; EOD tetap jalan tanpa itu |

**Disclaimer tetap dipasang di UI:** semua output heuristik/AI = alat bantu konfirmasi,
bukan rekomendasi jual/beli.
