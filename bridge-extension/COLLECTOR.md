# 🛰 Arsant Screener Data Collector (Bridge Extension MV3)

Modul **Data Collector / Engine Scraper** di dalam extension ini: menarik data historis
Stockbit sampai 5 tahun ke belakang, mengelompokkan emiten per kategori, lalu
meneruskannya ke REST API backend Arsant Screener.

> **Sejak v3.1.0 panel analisa lama (Brokermology) dimatikan** supaya halaman Stockbit
> bersih dan fokus ke collector. `app.js` dan `idx-universe.js` **tidak dihapus**, hanya
> dicabut dari `content_scripts` di `manifest.json`. Untuk menghidupkannya lagi,
> kembalikan entri ini ke array `content_scripts`:
>
> ```json
> {
>   "matches": ["https://stockbit.com/*", "https://*.stockbit.com/*"],
>   "js": ["idx-universe.js", "app.js"],
>   "run_at": "document_idle",
>   "all_frames": true,
>   "world": "MAIN"
> }
> ```
>
> `interceptor.js` **wajib tetap terpasang** — dari sanalah token Stockbit tertangkap.
> Efek samping mematikan `app.js`: relay pasif miliknya ikut berhenti (kuotasi IHSG tiap
> 10 detik, market movers tiap 60 detik, calendar events, insider, berita stream). Semua
> data itu kini ditarik lewat antrean collector, tapi sesuai jadwal crawl — bukan lagi
> polling terus-menerus.

---

## 1. Arsitektur

```
┌─ popup.html / options.html ────────── kontrol & setelan (Start/Pause/Resume/Stop)
│         ↕ chrome.runtime.sendMessage
├─ background.js  (service worker, type: module)
│    ├─ lib/auth.js       Auth Interceptor  — tangkap Bearer token & header (pasif)
│    ├─ lib/queue.js      Queue & Rate Limit Engine — jitter, batch pause, cooldown
│    ├─ lib/planner.js    Penyusun job: universe × endpoint × jendela tahun
│    ├─ lib/relay.js      DB Relay Forwarder — transform + POST ke backend + buffer
│    ├─ lib/storage.js    Semua state persisten (tahan service worker mati)
│    ├─ apiClient.js      Wrapper seluruh endpoint Stockbit + katalog endpoint
│    └─ stockCategorizer.js  Klasifikasi bluechip/second/third + deteksi gorengan
│         ↕ chrome.runtime.connect (port "tw-collector")
├─ content.js     (ISOLATED world)  jembatan + overlay progress di halaman Stockbit
│         ↕ window.postMessage
└─ pageAgent.js   (MAIN world)      EKSEKUTOR fetch — request keluar dari konteks
                                    halaman Stockbit yang asli
```

### Kenapa fetch tidak dilakukan dari service worker

Fetch dari service worker berjalan atas nama origin extension: `Origin`, `Referer`,
`Sec-Fetch-Site/Mode/Dest`, dan urutan header-nya berbeda dari request asli aplikasi
Stockbit — persis pola yang dicari WAF (Cloudflare/Sentinel) untuk menandai lalu lintas
non-browser.

Karena itu service worker hanya **mengatur antrean**; eksekusi fetch-nya dititipkan ke
`pageAgent.js` yang hidup di MAIN world tab Stockbit. Di sana request keluar dari
konteks halaman itu sendiri, jadi User-Agent, Referer `https://stockbit.com/`, cookie,
TLS fingerprint, dan seluruh header **identik** dengan request buatan Stockbit sendiri.
Ini emulasi header dalam bentuk paling kuat: tidak memalsukan apa pun, tapi memakai
konteks yang memang asli.

Konsekuensinya: **harus ada minimal satu tab Stockbit terbuka & login** selama crawling.
Kalau tab ditutup, engine otomatis pause (`no-tab`) dan lanjut sendiri begitu tab
Stockbit dibuka lagi.

---

## 2. Auth Interceptor (pasif)

Tiga sumber token, digabung, yang paling segar menang:

| Sumber | Mekanisme | Catatan |
|---|---|---|
| `chrome.webRequest.onBeforeSendHeaders` | menguping header `Authorization` request halaman | jalan walau tab di background |
| `interceptor.js` (MAIN world) | patch fetch/XHR + **frame WebSocket** | JWT dari frame subscribe WS diperbarui terus selama sesi → paling awet |
| `chrome.cookies` | cek cookie sesi `stockbit.com` | hanya indikator login, tidak dikirim manual |

Tidak ada login otomatis, tidak ada pengisian form, tidak ada request tambahan untuk
memancing token. Token muncul sendiri saat user memakai Stockbit seperti biasa.

Kalau Stockbit membalas `401`, engine berhenti sementara dan meminta user me-refresh tab
Stockbit — token baru akan tertangkap pasif, lalu tinggal **Resume**.

---

## 3. Strategi anti-deteksi

| Aturan | Bawaan | Diatur di |
|---|---|---|
| Concurrency | **1** (sekuensial mutlak) | tidak dapat diubah — desain |
| Jitter antar-request | acak **3–7 detik** | Options → `minDelayMs` / `maxDelayMs` |
| Istirahat panjang | **20–40 detik** tiap **15–20** request | `longPause*` / `batchMin` / `batchMax` |
| Kena `429` / `403` | tidur **2–5 menit**, job **diulang** (bukan dilewati), UI diberi tahu | `cooldown*` |
| Kena `401` | pause + notifikasi "refresh Stockbit" | — |
| Header | identik request halaman (lihat §1) | — |
| Percobaan ulang | 2× per job sebelum menyerah | `maxRetries` |

Angka bawaan konservatif untuk crawl semalaman. Makin pelan makin aman.

**Ketahanan:** service worker MV3 bisa dimatikan Chrome kapan saja. Seluruh posisi
antrean ada di `chrome.storage.local`, jadwal berikutnya disimpan sebagai `nextRunAt`,
dan ada alarm watchdog tiap 1 menit yang membangunkan mesin kalau `setTimeout` ikut mati
bersama service worker-nya. Crawl 5 tahun aman ditinggal.

---

## 4. Segmentasi emiten

| Segmen | Kriteria |
|---|---|
| 💎 Bluechip / First Liner | Market cap **> Rp 10 T** |
| 🔷 Second Liner | Rp 500 M – Rp 10 T |
| 🔸 Third Liner | **< Rp 500 M** |
| 🔥 Gorengan / Volatil | **deteksi perilaku**, bukan ukuran |

Deteksi gorengan memberi skor 0–100 dengan alasan yang bisa dibaca:

- tercantum di `GET /emitten/indexes/special-board` (Papan Pemantauan Khusus / UMA / suspend) → **+45**
- masuk market mover ekstrem (`TOP_GAINER` / `TOP_LOSER` / `TOP_VOLUME`) → +12 per tipe
- perubahan harga ≥ 15% → +15
- konsentrasi broker ≥ 55% di 3 broker (dari `/marketdetectors/{symbol}`) → +20
- rata-rata rentang harian ≥ 8% / lonjakan volume ≥ 4× → +15 / +12

Skor ≥ 40 = gorengan. Karena berbasis perilaku, satu emiten bisa **sekaligus** third
liner **dan** gorengan — hasil klasifikasi menyimpan `tier` dan flag `gorengan` terpisah.

### Gerbang kategori (penghemat request terbesar)

Fase profil satu emiten sengaja hanya **1 request** (`keystats`, sumber market cap).
Setelah itu emiten diklasifikasi; yang tidak masuk kategori pilihan **dilewati sebelum**
job berat (histori 5 tahun) dijalankan. Untuk universe penuh ~900 emiten, ini yang
membedakan ±900 request dengan ±37.000 request.

Setelah data mendalam terkumpul, emiten diklasifikasi ULANG dengan tambahan volatilitas
harga & konsentrasi broker — hasil akhirnya lebih akurat daripada saat gerbang.

---

## 4b. Template request dari halaman (anti-`INVALID_PARAMETER`)

Sebagian endpoint Exodus menolak request kalau **satu saja** nilai enum-nya meleset —
balasannya `400 INVALID_PARAMETER` / "Your request is invalid" — dan nama enum itu tidak
terdokumentasi serta berubah sewaktu-waktu. Menebaknya satu per satu adalah pekerjaan
yang tidak pernah selesai.

Karena itu collector **tidak menebak**. `interceptor.js` sudah mencatat setiap URL API
yang dipanggil halaman Stockbit saat Anda browsing biasa; URL itu — menurut definisi —
memakai kombinasi parameter yang benar. `lib/templates.js` menyalinnya sebagai template,
lalu saat crawl hanya mengganti:

- **kode emiten** di path (`/marketdetectors/BBCA` → `/marketdetectors/AALI`) dan di
  parameter (`symbol`, `symbols[]`, `companies`, …)
- **rentang tanggal** (`from`/`to`, `date_from`/`date_to`, `start_date`/`end_date`,
  `period_start`/`period_end`, `date`)

Seluruh parameter lain **dibiarkan apa adanya**. Arah tanggal pun tidak dihafal tapi
dibaca dari template: endpoint chartbit memakai `from` = tanggal *terbaru*, endpoint lain
sebaliknya — orientasi aslinya dipertahankan otomatis.

Endpoint bertanda `needsTemplate` **tidak dijalankan** sebelum template-nya ada; lebih
baik dilewati daripada menghabiskan jatah request untuk error 400. Statusnya terlihat di
halaman Options ("Template request dari halaman"), lengkap dengan halaman Stockbit mana
yang perlu dibuka sekali agar template-nya terpelajari.

### Nilai parameter yang sudah terverifikasi

Dikonfirmasi dari `app.js` yang sudah lama jalan di produksi, plus pesan error Exodus:

| Parameter | Nilai benar | Yang ditolak |
|---|---|---|
| `investor_type` | `INVESTOR_TYPE_ALL` / `_FOREIGN` / `_DOMESTIC` | `all_investor` |
| `market_board` | `MARKET_BOARD_REGULER` | `all_market` |
| `transaction_type` | `TRANSACTION_TYPE_GROSS` / `_NET` | — |
| `year_limit` (keystats) | hanya `0`, `3`, atau `10` | `5` |
| candle harian | `/chartbit/{s}/price/daily?from={terbaru}&to={terlama}&limit=0` | `/charts/{s}/daily` |
| running trade | `symbols[]={s}` | `symbol={s}` |

Endpoint chartbit membatasi responsnya ±250 baris, jadi histori 5 tahun dipecah jadi
**9 jendela 220 hari** (±150 hari bursa per jendela), bukan satu request besar.

---

## 5. Cakupan endpoint

Katalog lengkapnya ada di `apiClient.js` (`ENDPOINTS`) dan bisa dinyalakan/dimatikan
satu per satu di halaman Options.

| Grup | Endpoint |
|---|---|
| Discovery | `/emitten/indexes/special-board`, `/order-trade/market-mover` (6 tipe), `/emitten/trending`, `/user/v2/discovery/trending`, `/company-price-feed/prices/close`, `/order-trade/running-trade` |
| Referensi | `/calendar/events` *(per hari, dibatasi `calendarDays` — bawaan 90 hari)*, `/company-price-feed/market-time/session`, `/company-price-feed/prices/IHSG/market`, `/charts/IHSG/daily`, `/company/{index}`, `/findata-view/marketdetectors/brokers`, `/order-trade/broker/top`, `/fundachart/templates`, `/fundachart/metrics`, `/screener/templates/{id}`, `/auth/websocket/key` |
| Profil | `/keystats/ratio/v1/{symbol}`, `/emitten/{symbol}/info`, `/company-price-feed/price-performance/{symbol}`, `/emitten/{symbol}/profile`, `/emitten/{symbol}/contact` |
| Harga | `/charts/{symbol}/daily`, `/company-price-feed/historical/summary/{symbol}` *(per tahun)* |
| Bandarmologi | `/marketdetectors/{symbol}` *(per tahun)*, `/order-trade/broker/activity/historical` *(per tahun)*, `/order-trade/running-trade/chart/{symbol}`, `/order-trade/broker/distribution`, `/order-trade/trade-book/chart`, `/orderbook/companies/{symbol}` |
| Fundamental | `/findata-view/company/financial` (6 kombinasi), `/research/company/{symbol}`, `/analyst-ratings/{symbol}`, `/analyst-ratings/{symbol}/consensus`, `/fundachart` |
| Kepemilikan | `/insider/shareholding/network` *(graf KSEI → tabel `shareholding`)*, `/insider/company/majorholder` *(per tahun)*, `/insider/shareholding/composition/companies/{symbol}` *(per tahun)*, `/emitten-metadata/shareholders/token` + `/shareholders/{symbol}/chart` |
| Aksi Korporasi | `/corpaction/dividend` *(riwayat dividen → tabel `dividends`)*, `/corpaction/{symbol}`, `/corpaction/{symbol}/stock_conversion` |
| Web | `https://stockbit.com/_next/data/{buildId}/symbol/{symbol}/{tab}.json` (buildId dibaca otomatis dari `__NEXT_DATA__`) |

Endpoint bertanda *(per tahun)* dipecah jadi satu job per jendela 12 bulan, **dari yang
paling baru ke paling lama** — kalau crawl dihentikan di tengah jalan, yang sudah masuk
database adalah data paling relevan untuk analisa hari ini.

Filter `investor_type` (`all_investor` / `foreign` / `domestic`) dan `market_board`
(`all_market` / `regular` / `nego` / `tunai`) diatur global di Options.

---

## 5b. Broker summary: per rentang vs per hari

Ada DUA endpoint broker, dan keduanya mengisi tabel berbeda:

| Endpoint collector | Request | Tabel backend | Dipakai fitur web |
|---|---|---|---|
| `marketdetectors` *(nyala)* | 1 per tahun per emiten | `broker_range_agg` | tampilan **rentang** broker |
| `broker_summary_daily` *(mati)* | ±245 per tahun per emiten | `broker_summary` | **Broker Analysis, Fase Akumulasi/Distribusi, PVA, Decision** |

Fitur-fitur analisa di web terminal membaca `broker_summary` yang **per hari bursa** —
tanpa granularitas harian, fase akumulasi/distribusi tidak bisa dihitung sama sekali.
Karena itu `broker_summary_daily` disediakan, tapi **default mati**: 2 tahun × 1 emiten =
±522 request (±1,1 jam dengan timing bawaan). Nyalakan untuk daftar emiten pilihan lewat
mode kustom, jangan untuk seluruh universe.

Sebagai penambal, `GET /broker-summary-range/:symbol` di backend sekarang **jatuh ke
`broker_range_agg`** kalau data harian belum ada — jadi tampilan rentang langsung hidup
dengan data yang murah, sementara fitur berbasis fase tetap menunggu data harian.

---

## 5bb. Graf kepemilikan KSEI (panel SID di terminal)

`GET /insider/shareholding/network` mengembalikan GRAF: nodes (emiten & investor) +
edges (kepemilikan, lengkap pecahan scrip/scripless). Sumbernya laporan **bulanan** KSEI,
jadi `report_date`-nya akhir bulan — bukan harian. Hasilnya mengisi tabel `shareholding`,
yang dibaca `GET /sid`, `GET /shareholding/{symbol}`, dan `GET /shareholding-divergence`
di terminal.

**Endpoint ini di-key oleh `company_id`, bukan simbol.** Stockbit tidak menyediakan
pencarian simbol → company_id, jadi collector memanennya sendiri dari dua sumber:

1. `GET /emitten/trending` — satu-satunya endpoint yang membawa `company_id` bersama
   simbolnya;
2. setiap respons graf itu sendiri — tiap graf menyebut company_id emiten lain yang
   tersentuh di tepinya.

Pemetaannya menumpuk lintas run, jadi cakupannya bertambah tiap crawl alih-alih mulai
dari nol. Emiten yang company_id-nya belum dikenal otomatis dilewati dan ikut pada crawl
berikutnya.

> **Hanya emiten ROOT yang disimpan.** Emiten lain dalam graf cuma tersentuh di tepi —
> Stockbit mengembalikan sebagian kecil pemegangnya saja. Menyimpannya akan membuat
> "jumlah pemegang" jadi 1-2 orang: angka yang **salah**, bukan sekadar kurang lengkap.
> Nilai graf yang lebih luas tetap dipanen, tapi sebagai pemetaan company_id.

---

## 5bb2. TAHAP EKSEKUSI — seluruh emiten dulu, baru yang berat

Untuk universe 900+ emiten, mengerjakan satu emiten sampai tuntas sebelum pindah
ke emiten berikutnya berarti running trade emiten PERTAMA (ribuan request
berpaginasi) jalan sebelum data ringan emiten ke-900 tersentuh — berhari-hari
sebelum datanya berguna.

Karena itu antreannya bertahap. Seluruh emiten diselesaikan pada satu tahap dulu,
baru pindah ke tahap berikutnya:

| Tahap | Isi | Beban |
|---|---|---|
| **1** | profil, keystats, candle, fundamental, kepemilikan, historical summary | ringan–menengah |
| **2** | broker summary harian | 1 request/hari bursa |
| **3** | running trade | paling berat, berpaginasi cursor |

Nomor tahap ada di field `pass` tiap endpoint (`apiClient.js`). Posisi antrean
(`pass`, `symbolIndex`, `jobIndex`) tersimpan di storage, jadi crawl yang
terputus lanjut dari tahap & emiten yang sama — bukan mulai dari nol.

Kedalaman tiap tahap boleh diubah kapan saja, termasuk di tengah crawl: jendela
tanggal dibangun ulang dari setelan terbaru pada job berikutnya.

Pengaturannya ada di Options → **Kedalaman histori per jenis data**, satu kartu per
kelompok (`lib/depth.js`: chart, historical, broker, runningTrade, ownership, default).
Tiap kartu punya dua mode yang saling meniadakan:

- **N satuan** — preset cepat (1/3/6 bulan, 1/2/5 tahun) atau angka bebas + satuan
  hari/minggu/bulan/tahun. Field tanggal disembunyikan dan nilainya **dikosongkan**
  (`from`/`to` disimpan sebagai string kosong), jadi tidak ada tanggal tersembunyi
  yang ikut tersimpan.
- **Rentang tanggal** — dua date picker (`max` = hari ini). Saat pindah dari mode
  N satuan, tanggalnya diisi otomatis dari rentang yang sedang berlaku.

Popup **tidak** punya kontrol kedalaman lagi. Dulu ada dropdown `years` di sana yang
isinya bisa berbeda dari tabel per-jenis-data ini — dua tempat mengklaim hal yang sama,
dan yang dipakai engine cuma salah satunya. Sekarang popup hanya menampilkan daftar
baca-saja; teksnya dihitung di service worker (`GET_STATE` -> `depth[]`) dengan
`describeDepth()`, fungsi yang sama dipakai engine, jadi mustahil berbeda. Kunci
`settings.years` sudah dicabut dari `lib/config.js`, dari fallback `resolveDepth()`,
dan dari `fundachart` (yang kini menurunkan periode `Ny`-nya dari kelompok `default`).

Sumber kebenaran nilainya dipegang variabel `depthState` di `options.js`, bukan DOM —
itulah sebabnya kontrol yang tidak relevan boleh benar-benar disembunyikan tanpa
membuat nilai lain hilang. Badge biru di dasar kartu menunjukkan rentang efektif dan
selalu sama dengan hasil `resolveDepth()` yang dipakai engine.

---

## 5c. Crawl inkremental — tidak mengulang yang sudah ada

Sebelum mengerjakan satu emiten, collector menanyakan ke backend apa yang sudah
tersimpan (`GET /ingest/coverage?symbol=…`), lalu melewati job yang datanya sudah ada.
Job yang dilewati **tidak memakan jatah jeda anti-bot sama sekali** — dicek sebelum
request disusun.

Aturan kesegarannya:

| Jenis data | Kapan ditarik ulang |
|---|---|
| Jendela histori yang sudah lewat (`window.end < hari ini`) | **Tidak pernah** — broker summary 3 Maret 2024 tidak akan berubah lagi |
| Jendela yang menyentuh hari ini | Sekali sehari (bar hari ini belum selesai) |
| Data pasar global (market mover, papan khusus) | Sekali sehari |
| Data tanpa tanggal (profil, rasio, analyst rating) | Tiap `refreshAfterDays` hari (bawaan 7) |

Efeknya: **aman dijalankan rutin tiap hari** — hanya menarik yang benar-benar baru. Dan
kalau Anda tidak sengaja menjalankan ulang periode yang sudah lengkap, popup menampilkan
pesan terang-terangan bahwa datanya sudah ada, bukan diam seolah crawl gagal.

**Sumber kebenarannya tabel hasil, bukan `raw_ingest`.** Untuk data broker, coverage
mengecek `broker_summary` / `broker_range_agg` — bukan sekadar ada tidaknya baris di
`raw_ingest`. Ini disengaja: pernah terjadi request broker mendarat di `raw_ingest`
dengan payload keliru (bug URL), sehingga tabel hasilnya kosong. Kalau patokannya
`raw_ingest`, data rusak itu akan dilewati selamanya dan tidak pernah diperbaiki.

Kalau backend tidak terjangkau, coverage dianggap kosong dan crawl jalan penuh — lebih
baik menarik ulang daripada diam-diam melewatkan data. Bisa dimatikan lewat Options
("Lewati data yang sudah ada di database").

### Endpoint yang membalas 401 tidak lagi menghentikan antrean

`/emitten-metadata/shareholders/{s}/chart` memakai **WebViewToken** tersendiri di luar
Bearer biasa, dan membalas `401 UNAUTHORIZED` walau sesi Stockbit sehat. Dulu satu 401
semacam itu menjeda SELURUH antrean — crawl bisa berhenti di 99% gara-gara satu endpoint.
Sekarang 401 yang berdiri sendiri dilewati; antrean baru dijeda kalau 401-nya **beruntun**
(bawaan 3×), yang memang menandakan token sesi kedaluwarsa.

---

## 6. Relay ke backend

Endpoint yang sudah punya route khusus di `server/internal/api/routes.go` dikirim dalam
bentuk yang sudah ditransformasi:

| Sumber Stockbit | Route backend |
|---|---|
| `/charts/{symbol}/daily` | `POST /ingest/bars` |
| `/marketdetectors/{symbol}` | `POST /ingest/broker-range` |
| `/keystats/ratio/v1/{symbol}` | `POST /ingest/keystats` |
| `/findata-view/company/financial` | `POST /ingest/financial-statements` |
| `/order-trade/market-mover` | `POST /ingest/market-movers` |
| `/insider/company/majorholder` | `POST /ingest/insider-transactions` |
| `/insider/shareholding/network` | `POST /ingest/shareholding` |
| `/corpaction/dividend` | `POST /ingest/dividends` |
| `/calendar/events` | `POST /ingest/calendar-events` |

Sisanya dikirim ke **path penampung** `POST /ingest/raw` (dapat diubah di Options) dengan
amplop:

```json
{
  "source": "stockbit_collector",
  "endpoint": "historical_summary",
  "symbol": "BBCA",
  "variant": "2025-07-30..2026-07-29",
  "url": "https://exodus.stockbit.com/...",
  "params": { "window": { "start": "2025-07-30", "end": "2026-07-29" } },
  "fetchedAt": "2026-07-29T04:00:00.000Z",
  "payload": { "...respons Stockbit apa adanya..." }
}
```

Amplop itu mendarat di tabel **`raw_ingest`** (MySQL, kolom `params`/`payload` bertipe
`JSON`). Kunci uniknya `(endpoint, symbol, variant)` — `variant` berisi jendela tahun
(`2024-07-30..2025-07-29`) atau varian request (`income-annual`), jadi crawl ulang
**memperbarui** baris yang sama alih-alih menumpuknya, sementara tiap tahun histori tetap
punya barisnya sendiri.

Hasil segmentasi emiten dikirim terpisah ke `POST /ingest/classification` → tabel
**`stock_classification`** (`symbol`, `tier`, `market_cap`, `is_gorengan`,
`gorengan_score`, `gorengan_reasons`, `categories`).

Untuk memverifikasi hasil crawl:

| Endpoint backend | Kegunaan |
|---|---|
| `GET /raw-ingest/stats` | rekap jumlah baris & emiten per endpoint — cek cepat apa saja yang sudah mendarat |
| `GET /raw-ingest?symbol=BBCA&endpoint=historical_summary` | daftar baris (tanpa payload, ringan) |
| `GET /raw-ingest/one?endpoint=...&symbol=...&variant=...` | satu payload utuh |
| `GET /classification?tier=third&gorengan=1` | daftar emiten hasil segmentasi |

Kegagalan relay **tidak pernah** menghentikan crawling: payload masuk **buffer** di
storage dan dikirim ulang otomatis (tombol "Kirim ulang buffer" di Options juga ada).

---

## 7. Cara pakai

1. `chrome://extensions` → Developer mode → **Load unpacked** → pilih folder `bridge-extension`.
2. Buka `https://stockbit.com` dan pastikan sudah login (biarkan tab ini terbuka).
3. Klik ikon extension:
   - isi **Base URL REST API Backend** (mis. `http://localhost:4000`) → **Tes**,
   - centang **kategori** yang ingin dikumpulkan,
   - opsional: isi daftar emiten manual (`BBCA, TLKM, BBNI`) dan centang
     *"Crawl HANYA emiten di daftar ini"*,
   - pilih **kedalaman histori** (5 tahun) dan batas jumlah emiten,
   - perkiraan jumlah request & durasi muncul otomatis di bawahnya.
4. **▶ Start**. Progress terlihat di popup **dan** di overlay kiri-bawah halaman Stockbit
   (bisa Pause/Resume/Stop dari sana juga).
5. Setelan lanjutan (timing anti-bot, ambang market cap, pemilihan endpoint, penguji
   endpoint, tabel hasil klasifikasi) ada di **⚙ Setelan lanjutan & endpoint**.

**Backend di luar localhost:** Options → tombol **"Izinkan host backend"** untuk meminta
izin host tambahan (`optional_host_permissions`).

### Perkiraan beban

Universe penuh (~900 emiten), 5 tahun, seluruh endpoint bawaan aktif:
±916 request bila semua emiten tersaring keluar setelah fase profil, sampai ±37.000
request bila semua lolos — setara ±2 jam sampai ±75 jam dengan timing bawaan. Persempit
dengan filter kategori, batas jumlah emiten, atau matikan endpoint yang tidak dipakai.

---

## 8. Catatan implementasi

- **Ambang kategori berbeda dengan `app.js`.** Screener harian di `app.js`
  (`mcapCategory`) dan collector memakai batas yang sama: bluechip di atas
  10 T, second liner 500 M–10 T, dan third liner di bawah 500 M.
  pasar yang diminta. Keduanya sengaja dipisah agar tidak saling mengganggu; ambang
  collector dapat diubah di Options.
- **Enum yang mungkin berubah** (`period`, `transaction_type`, `mover_type`, dst)
  dikumpulkan di satu blok `PARAMS` pada `apiClient.js` — kalau Stockbit menggantinya,
  cukup satu blok itu yang disunting. Halaman Options punya penguji endpoint untuk
  memverifikasi satu per satu.
- **Respons Stockbit tidak seragam** antar-endpoint. Semua ekstraksi
  (`stockCategorizer.js`, `lib/relay.js`) ditulis toleran: mencoba beberapa kandidat nama
  field dan tidak pernah melempar kalau tidak ketemu.
- **`chrome.storage.session`** dipakai untuk token supaya ikut hilang saat browser
  ditutup; sisanya di `storage.local` dengan `unlimitedStorage`.
