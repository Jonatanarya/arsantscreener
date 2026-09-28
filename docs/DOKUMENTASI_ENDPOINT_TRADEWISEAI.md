# Rekap Endpoint & Contoh Struktur Data JSON - `arsant-screener-frontend`

Dokumen ini berisi rekapitulasi lengkap seluruh **API Endpoints**, **Query Parameters**, dan **Contoh Struktur Data JSON (Response & Request)** yang ada pada frontend Arsant Screener, sehingga mudah diolah ke dalam bahasa Go (Structs) maupun TypeScript (Interfaces).

---

## 📌 Ringkasan Arsitektur Data

Frontend Arsant Screener mengonsumsi 4 sumber data utama:
1. **Stockbit Exodus API** (`https://exodus.stockbit.com`) — Feed bursa BEI realtime & historis.
2. **Axentraz News Wire API** (`https://api.axentraz.id`) — Feed berita pasar modal & topik emiten.
3. **Google Gemini LLM API** (`https://generativelanguage.googleapis.com`) — Analisis AI cerdas.
4. **WhatsApp Gateway (GOWA)** (`https://gowa.taqiyyabimbel.my.id`) — Notifikasi sinyal trading.

---

## 1. 📈 Stockbit Exodus API (`https://exodus.stockbit.com`)

Seluruh Panggilan HTTP membutuhkan Header:
```http
Authorization: Bearer <JWT_TOKEN>
Origin: https://stockbit.com
Referer: https://stockbit.com/
Accept: application/json
```

---

### A. Market Movers (Top Pergerakan Pasar)
- **Endpoint**: `GET /order-trade/market-mover`
- **Query Params**:
  - `mover_type`: `MOVER_TYPE_TOP_GAINER`, `MOVER_TYPE_TOP_LOSER`, `MOVER_TYPE_TOP_VALUE`, `MOVER_TYPE_TOP_VOLUME`, `MOVER_TYPE_TOP_FREQUENCY`, `MOVER_TYPE_NET_FOREIGN_BUY`, `MOVER_TYPE_NET_FOREIGN_SELL`.
  - `filter_stocks`: `FILTER_STOCKS_TYPE_MAIN_BOARD&filter_stocks=FILTER_STOCKS_TYPE_DEVELOPMENT_BOARD`

#### 📦 Contoh JSON Response:
```json
{
  "message": "Market mover retrieved successfully",
  "data": [
    {
      "code": "PSAB",
      "name": "J Resources Asia Pasifik Tbk.",
      "price": 340,
      "change": 25,
      "change_percentage": 7.93,
      "volume": 145020000,
      "value": 49300000000,
      "net_foreign": 12500000000,
      "frequency": 18450
    },
    {
      "code": "BBCA",
      "name": "Bank Central Asia Tbk.",
      "price": 10250,
      "change": 125,
      "change_percentage": 1.23,
      "volume": 85400000,
      "value": 875350000000,
      "net_foreign": 142000000000,
      "frequency": 24100
    }
  ]
}
```

---

### B. Orderbook & Quote Realtime
- **Endpoint**: `GET /company-price-feed/v2/orderbook/companies/{symbol}` (contoh: `PSAB`, `IHSG`)

#### 📦 Contoh JSON Response:
```json
{
  "message": "Orderbook retrieved successfully",
  "data": {
    "symbol": "PSAB",
    "last_price": 340,
    "prev_price": 315,
    "open_price": 320,
    "high_price": 346,
    "low_price": 318,
    "change": 25,
    "change_percentage": 7.93,
    "total_volume": 1450200,
    "total_value": 49300000000,
    "bids": [
      { "price": 338, "volume": 15400, "orders": 42 },
      { "price": 336, "volume": 28900, "orders": 85 }
    ],
    "offers": [
      { "price": 340, "volume": 8200, "orders": 19 },
      { "price": 342, "volume": 31000, "orders": 64 }
    ]
  }
}
```

---

### C. Running Trade (Transaksi Per-Print)
- **Endpoint**: `GET /order-trade/running-trade`
- **Query Params**:
  - `symbols[]=PSAB`
  - `sort=ASC` (Urut dari pembukaan jam 08:58)
  - `order_by=RUNNING_TRADE_ORDER_BY_TIME`
  - `limit=1000`
  - `date=2026-07-26`
  - `trade_number=8492019` (Cursor pagination)

#### 📦 Contoh JSON Response:
```json
{
  "message": "Running trade list retrieved successfully",
  "data": {
    "running_trade": [
      {
        "trade_number": "8492001",
        "time": "08:58:12",
        "action": "buy",
        "price": 320,
        "lot": 500,
        "value": { "raw": 16000000, "formatted": "16.00 M" },
        "buyer": "YP - Mirae Asset",
        "seller": "CC - Mandiri Sekuritas",
        "buy_order_number": "1002941",
        "sell_order_number": "8002914"
      },
      {
        "trade_number": "8492002",
        "time": "08:58:15",
        "action": "sell",
        "price": 318,
        "lot": 1200,
        "value": { "raw": 38160000, "formatted": "38.16 M" },
        "buyer": "PD - Indo Premier",
        "seller": "NI - BNIS",
        "buy_order_number": "1002945",
        "sell_order_number": "8002920"
      }
    ]
  }
}
```

---

### D. Bandar Detector & Broker Activity
- **Endpoint**: `GET /marketdetectors/{symbol}?from=2026-07-01&to=2026-07-26&transaction_type=TRANSACTION_TYPE_NET`

#### 📦 Contoh JSON Response:
```json
{
  "message": "Successfully retrieved broker activity detail",
  "data": {
    "bandar_detector": {
      "broker_accdist": "Big Accumulation",
      "average": 328.50,
      "top1": { "accdist": "Big Accum", "amount": 12500000000, "percent": 45.2, "vol": 381000 },
      "top3": { "accdist": "Big Accum", "amount": 21400000000, "percent": 77.4, "vol": 651000 },
      "top5": { "accdist": "Big Accum", "amount": 24800000000, "percent": 89.6, "vol": 755000 },
      "total_buyer": 14,
      "total_seller": 82
    },
    "broker_summary": {
      "brokers_buy": [
        {
          "netbs_broker_code": "BK",
          "netbs_stock_code": "PSAB",
          "netbs_buy_avg_price": "326",
          "bval": "12500000000",
          "blot": "383435",
          "type": "Asing"
        }
      ],
      "brokers_sell": [
        {
          "netbs_broker_code": "YP",
          "netbs_stock_code": "PSAB",
          "netbs_sell_avg_price": "332",
          "sval": "4200000000",
          "slot": "126500",
          "type": "Lokal"
        }
      ]
    }
  }
}
```

---

### E. KeyStats & Rasio Fundamental
- **Endpoint**: `GET /keystats/ratio/v1/{symbol}?year_limit=10` (contoh: `PSAB`, `BBCA`)

#### 📦 Contoh JSON Response:
```json
{
  "message": "Key stats retrieved successfully",
  "data": {
    "symbol": "PSAB",
    "pe_ratio": 12.4,
    "pbv_ratio": 1.15,
    "roe": 14.8,
    "roa": 8.2,
    "der": 0.65,
    "dividend_yield": 3.45,
    "market_cap": 8900000000000,
    "eps": 27.4,
    "bvps": 295.6,
    "revenue_growth": 18.5,
    "net_profit_margin": 15.2
  }
}
```

---

### F. Financial Statements (Laporan Keuangan)
- **Endpoint**: `GET /findata-view/company/financial?symbol={symbol}&data_type=1&report_type=1&statement_type=2`
  - `report_type`: `1` (Laba Rugi), `2` (Neraca), `3` (Arus Kas)
  - `statement_type`: `1` (Kuartalan), `2` (Tahunan)

#### 📦 Contoh JSON Response:
```json
{
  "message": "Company financial retrieved successfully",
  "data": {
    "symbol": "PSAB",
    "period": "2025-Q4",
    "currency": "IDR",
    "report_type": "Income Statement",
    "statement_type": "Annual",
    "items": [
      { "item_id": 101, "item_name": "Revenue / Penjualan", "value": 3450000000000 },
      { "item_id": 102, "item_name": "Gross Profit / Laba Kotor", "value": 1280000000000 },
      { "item_id": 105, "item_name": "Net Profit / Laba Bersih", "value": 540000000000 }
    ]
  }
}
```

---

### G. Dividen Tunai (Dividends)
- **Endpoint**: `GET /corpaction/dividend?symbol={symbol}`

#### 📦 Contoh JSON Response:
```json
{
  "message": "Dividend history retrieved successfully",
  "data": [
    {
      "symbol": "PSAB",
      "cum_date": "2025-11-14",
      "ex_date": "2025-11-15",
      "recording_date": "2025-11-18",
      "payment_date": "2025-12-02",
      "amount": 12.5,
      "currency": "IDR",
      "type": "Interim"
    }
  ]
}
```

---

### H. Insider & Major Holder Transactions
- **Endpoint**: `GET /insider/company/majorholder?date_start=2026-06-26&date_end=2026-07-26&page=1&limit=50`

#### 📦 Contoh JSON Response:
```json
{
  "message": "Major holder transactions retrieved successfully",
  "data": [
    {
      "symbol": "PSAB",
      "holder_name": "PT Sangihe Gold Mineral",
      "action_type": "BUY",
      "shares": 15000000,
      "price": 320,
      "date": "2026-07-20",
      "percentage_after": 58.4
    }
  ]
}
```

---

### I. Kalender Aksi Korporasi (Calendar Events)
- **Endpoint**: `GET /calendar/events?date=2026-07-26`

#### 📦 Contoh JSON Response:
```json
{
  "message": "Calendar events retrieved successfully",
  "data": [
    {
      "code": "PSAB",
      "type": "DIVIDEND",
      "title": "Cum Date Dividen Interim Rp 12.5/saham",
      "description": "Pembayaran dividen tunai interim tahun buku 2025.",
      "date": "2026-07-26"
    },
    {
      "code": "BBCA",
      "type": "RUPS",
      "title": "RUPS Luar Biasa",
      "description": "Agenda persetujuan pemecahan saham (stock split).",
      "date": "2026-07-26"
    }
  ]
}
```

---

### J. Intraday Trade Book Chart
- **Endpoint**: `GET /order-trade/trade-book/chart?symbol=PSAB&time_interval=1m`

#### 📦 Contoh JSON Response:
```json
{
  "message": "Trade book chart retrieved successfully",
  "data": [
    {
      "time": "09:00:00",
      "open": 320, "high": 326, "low": 318, "close": 324,
      "buy_volume": 45200,
      "sell_volume": 12800,
      "total_volume": 58000
    }
  ]
}
```

---

### K. Daily Candlestick Chart
- **Endpoint**: `GET /charts/{symbol}/daily?timeframe=1w`

#### 📦 Contoh JSON Response:
```json
{
  "message": "Daily chart retrieved successfully",
  "data": [
    { "timestamp": 1774483200, "open": 315, "high": 330, "low": 312, "close": 328, "volume": 98400000 },
    { "timestamp": 1774569600, "open": 328, "high": 346, "low": 322, "close": 340, "volume": 145020000 }
  ]
}
```

---

## 2. 📰 Axentraz News Wire API (`https://api.axentraz.id`)

- **Endpoint**: `GET https://api.axentraz.id/news` (Proxied via `/api/news`)

#### 📦 Contoh JSON Response:
```json
{
  "status": "success",
  "topics": [
    {
      "topic": "REKOMENDASI",
      "items": [
        {
          "id": "news-101",
          "title": "Rekomendasi Saham PSAB: Target Breakout di Rp 360 Ditopang Penguatan Emas Dunia",
          "url": "https://market.bisnis.com/read/20260726/101/psab-target-360",
          "source": "Bisnis.com",
          "time": "2026-07-26T14:30:00Z",
          "summary": "Analisis teknikal menunjukkan pola kenaikan harga emas mendorong akumulasi broker asing pada PSAB."
        }
      ]
    },
    {
      "topic": "SAHAM",
      "items": [
        {
          "id": "news-102",
          "title": "GOTO Umumkan Peluncuran Fitur Baru dan Rencana Buyback Saham Rp 3 Triliun",
          "url": "https://finance.detik.com/bursa/goto-buyback-3t",
          "source": "Detik Finance",
          "time": "2026-07-26T13:15:00Z",
          "summary": "Manajemen GOTO mengalokasikan dana internal untuk aksi corporate buyback."
        }
      ]
    }
  ]
}
```

---

## 3. 🤖 Google Gemini AI API (`https://generativelanguage.googleapis.com`)

- **Endpoint**: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={API_KEY}`

#### 📤 Contoh Request Payload:
```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "Kamu adalah analis saham profesional BEI. Berikan analisis PVA untuk saham PSAB berdasarkan harga 340 (+7.93%), volume 145 juta, net foreign buy Rp 12.5 Miliar."
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.7,
    "topK": 40,
    "topP": 0.95,
    "maxOutputTokens": 1024
  }
}
```

#### 📦 Contoh JSON Response:
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "text": "📊 ANALISIS PVA SAHAM PSAB:\n\n1. KONDISI UTAMA: Kenaikan harga +7.93% disertai lompatan volume 145 juta lembar menunjukkan DEMAND KUAT (Effort = Result).\n2. SMART MONEY: Broker asing mencatatkan Net Buy Rp 12.5 Miliar, mengonfirmasi fase Akumulasi Senyap.\n3. REKOMENDASI TRADING: BUY ON WEAKNESS dengan Entry di area Rp 330-334.\n4. RISK LEVEL: Stop Loss ketat jika harga penutupan di bawah Rp 318."
          }
        ]
      }
    }
  ]
}
```

---

## 4. 💬 WhatsApp Gateway Service (`https://gowa.taqiyyabimbel.my.id`)

- **Endpoint**: `POST /wa-api/send/group` (Proxied via `/wa-api`)

#### 📤 Contoh Request Payload:
```json
{
  "device_id": "cb86676c-0856-4915-a081-86f40854f55d",
  "group_id": "120363402379230658@g.us",
  "message": "🚀 SINYAL BREAKOUT BEI:\n\nSaham: PSAB\nHarga: Rp 340 (+7.93%)\nStatus: Akumulasi Smart Money (Net Foreign +12.5M)\nTarget: Rp 360 / Stop Loss: Rp 318"
}
```

#### 📦 Contoh JSON Response:
```json
{
  "status": true,
  "message": "Message sent successfully to group",
  "data": {
    "message_id": "WAMID.3EB071295A20"
  }
}
```

---

*Dokumen contoh struktur data JSON ini dibuat untuk mempermudah parsing langsung ke struct Go (`encoding/json`) maupun TypeScript interfaces di Arsant Screener.*
