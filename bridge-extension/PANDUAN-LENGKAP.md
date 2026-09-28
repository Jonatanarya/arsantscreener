# 📚 Panduan Lengkap Brokermology Overlay untuk Stockbit

Dokumen ini merangkum **semua fitur, konsep, dan rumus** di dalam extension —
untuk dipelajari kembali kapan saja. Disusun dari pengembangan bertahap (v1.0 → v2.2).

Dokumen pendamping:
- [README.md](README.md) — instalasi & ringkasan fitur
- [PANDUAN.md](PANDUAN.md) — fokus mendalam Jendela Fase & Sensitivitas dengan contoh

---

## Daftar Isi
1. [Filosofi & Alur Kerja](#1-filosofi--alur-kerja)
2. [Brokermology: Fase Akumulasi & Distribusi](#2-brokermology-fase-akumulasi--distribusi)
3. [Smart Money Detector](#3-smart-money-detector)
4. [Analisa Teknikal Konfluensi](#4-analisa-teknikal-konfluensi)
5. [Support/Resistance & Fibonacci](#5-supportresistance--fibonacci)
6. [Sinyal Beli/Jual & Rencana TP/SL](#6-sinyal-belijual--rencana-tpsl)
7. [Price-Volume Analysis (VSA)](#7-price-volume-analysis-vsa)
8. [Live Tape & Orderbook (Scalping)](#8-live-tape--orderbook-scalping)
9. [Deteksi Bid/Offer Palsu](#9-deteksi-bidoffer-palsu)
10. [Cara Kerja Teknis](#10-cara-kerja-teknis)
11. [Roadmap: WebSocket Realtime](#11-roadmap-websocket-realtime)
12. [Glosarium](#12-glosarium)

---

## 1. Filosofi & Alur Kerja

Extension ini menggabungkan **tiga sudut pandang** yang saling mengonfirmasi. Prinsipnya:
sinyal tunggal mudah menipu; konfluensi tiga domain jauh lebih andal.

| Domain | Pertanyaan yang dijawab | Fitur |
|---|---|---|
| **Brokermology** | Siapa yang mengumpulkan/membuang saham? Di harga berapa? | Fase, Smart Money, Avg cost bandar |
| **Teknikal** | Ke mana arah & momentum harga? Di mana level kunci? | 🧠 Analisa, S/R, Fib, MA/RSI/MACD |
| **Volume/Tape** | Apakah pergerakan didukung uang nyata? | PVA, Live Tape, foreign flow |

**Alur ideal (dari lambat ke cepat):**
1. **▶ Analisa brokermology** — cari saham yang sedang diakumulasi bandar smart money
2. **🧠 Analisa Teknikal** — pastikan trend & momentum searah, cek level kunci
3. **📊 Price-Volume** — konfirmasi volume mendukung (absorpsi/demand)
4. **🎯 Rencana TP/SL** — tetapkan entry, stop, target sebelum masuk
5. **⚡ Live Tape / Sinyal** — eksekusi timing saat kondisi terpenuhi

> ⚠️ **Semua bersifat heuristik statistik, BUKAN rekomendasi jual/beli.**
> Alat bantu konfirmasi, keputusan tetap di tangan Anda.

---

## 2. Brokermology: Fase Akumulasi & Distribusi

### Konsep
- **AKUMULASI** = bandar diam-diam mengumpulkan saham saat harga *sideways*, agar
  tidak menaikkan harga terlalu cepat. Ditandai **kotak hijau** di chart.
- **DISTRIBUSI** = bandar melepas saham (sering saat harga naik/topping), membagi ke
  ritel. Ditandai **kotak merah**.

### Cara deteksi (jendela geser)
Extension menggeser "kaca pembesar" selebar **N hari** (Jendela Fase) di sepanjang
periode. Tiap potongan ditandai AKUMULASI bila:
1. **Harga terkompresi** (sideways): `(high−low)/harga rata-rata ≤ ambang`
2. **Ada broker net buy konsisten**: broker yang beli di ≥60% hari potongan dengan
   clean buy ≥60%, dengan total flow ≥ ambang% dari nilai transaksi
3. **Sisi smart money menang**: bobot broker institusi/asing di sisi beli > sisi jual
   (ritel jual ramai ke bandar ≠ distribusi — justru akumulasi)

Potongan sejenis yang bersambung digabung jadi satu kotak.

### Pengaturan
| Setelan | Fungsi | Panduan |
|---|---|---|
| **Periode** | Rentang tanggal analisa (date range bebas, maks ±250 hari bursa) | Panjang = akumulasi lambat; pendek = momentum |
| **Jendela fase** | Lebar kaca pembesar (5–20 hari) | ≈ setengah panjang fase yang dicari |
| **Sensitivitas** | Ketatnya ambang | Mulai Sedang, naikkan bila tak ada fase |

**Tabel ambang sensitivitas:**
| | Kompresi harga maks | Flow broker min |
|---|---|---|
| Rendah | ≤ 7% | ≥ 18% |
| Sedang | ≤ 10% | ≥ 12% |
| Tinggi | ≤ 14% | ≥ 7% |

### Avg harga bandar (cost)
Setiap fase menampilkan **harga rata-rata transaksi broker motornya**:
```
avg cost = Σ(nilai transaksi broker motor) / (Σ lot × 100)
```
Ini menjawab pertanyaan terpenting bandarmology: **bandar modal di harga berapa?**
Kalau harga sekarang masih dekat cost akumulasi → masih "murah"; kalau sudah +25%
di atas cost → bandar rawan ambil untung.

> 📖 Contoh perhitungan detail: lihat [PANDUAN.md](PANDUAN.md).

---

## 3. Smart Money Detector

Tabel yang mendeteksi broker mana yang benar-benar mengoleksi vs sekadar lewat.

| Kolom | Arti | Rumus |
|---|---|---|
| **Net** | Total net buy(+)/sell(−) periode | Σbval − Σsval |
| **Clean%** | Beli "bersih" yang tidak dicuci jualan | (Buy−Sell)/Buy |
| **Konsist** | % hari broker clean buy/sell ≥ 80% | hari clean / hari aktif |
| **Avg/Trx** | Nilai rata-rata per transaksi (proxy smart vs ritel) | (Buy+Sell)/total freq |
| **Verdict** | Kesimpulan | lihat bawah |

**Verdict:**
- `SMART ACCUM` — akumulasi clean ≥80%, konsisten ≥60%, oleh broker institusi/asing
  **atau** ber-ticket besar (💰 = avg/trx di atas persentil-75)
- `AKUM RITEL` — pola sama tapi profil broker ritel
- `SMART DIST` / `DIST RITEL` — kebalikannya
- `NET BUY` / `NET SELL` — arah jelas tapi belum memenuhi syarat "smart/konsisten"

**Kunci membaca:** avg/trx besar = order gede (bandar); avg/trx ~1jt = ritel.
Broker asing yang clean buy 90% konsisten dengan avg/trx puluhan juta = smart money klasik.

### Klasifikasi broker
Extension punya database ~45 broker IDX (asing/BUMN/institusi lokal/ritel online), plus
membaca field `type` dari API (Lokal/Asing/Pemerintah). Bisa diedit di `app.js` →
konstanta `BROKER_DB`.

### Catatan akurasi data
Angka Net & Clean% diambil dari **satu query rentang penuh** (identik dengan panel
Broker Summary Stockbit, papan Regular, mode gross). Data harian dipakai untuk
konsistensi & deteksi fase. Kalau ada hari gagal diambil, muncul peringatan +
angka total tetap akurat berkat rekonsiliasi ini.

---

## 4. Analisa Teknikal Konfluensi

Tombol **🧠 Analisa Teknikal** menghasilkan skor bias dari 6 bagian:

### Trend
- Struktur **HH+HL** (uptrend) / **LH+LL** (downtrend) dari pivot harga
- Posisi harga vs MA20 / MA50 / MA200

### Momentum
- **RSI** + status overbought (≥70) / oversold (≤30)
- **Divergensi RSI** otomatis (sinyal pembalikan paling andal):
  - *Bullish*: harga bikin low lebih rendah, RSI bikin low lebih tinggi
  - *Bearish*: harga bikin high lebih tinggi, RSI bikin high lebih rendah
- **MACD**: posisi vs signal + arah histogram

### Volume
- **Volume spike** (≥2× rata-rata 20 hari) — dibedakan candle hijau/merah
- **Volume dry-up** (5 hari <55% normal) — supply mengering, ciri jelang markup

### Foreign Flow
Kumulatif 20 hari dari `Σ(foreignbuy − foreignsell)` harian. Pola emas:
- 🟢 asing akumulasi saat harga turun
- 🔴 asing distribusi saat harga naik

> ⚠️ **Catatan penting**: field `foreignflow` dari API adalah nilai **kumulatif**
> (saldo berjalan), BUKAN harian. Karena itu net dihitung dari `foreignbuy−foreignsell`,
> bukan menjumlahkan `foreignflow`. (Bug ini sempat memberi hasil 58T sebelum diperbaiki.)

### Posisi vs Bandar
Jarak harga sekarang dari avg cost bandar fase terakhir.

### Risk (khas IDX)
- **ATR(14)** — volatilitas harian, saran SL = 1.5 × ATR
- **ARA/ARB besok** — batas auto-reject berdasarkan tier IDX:

| Harga close | ARA/ARB |
|---|---|
| > 5.000 | ±20% |
| 200 – 5.000 | ±25% |
| < 200 | ±35% |

Semua dibulatkan ke **fraksi tick IDX** yang benar (lihat glosarium).

**Kesimpulan:** skor = jumlah sinyal bullish − bearish, dirangkum jadi
`🟢 BIAS BULLISH KUAT` dst.

---

## 5. Support/Resistance & Fibonacci

### 📏 Support & Resistance
- Deteksi **pivot fractal** (high/low lokal), lalu **cluster** level berdekatan (<1,5%)
- Diranking berdasarkan **jumlah sentuhan** + seberapa baru disentuh
- 6 level terbaik digambar: garis putus-putus **hijau (support)** / **merah (resistance)**
- Tabel menampilkan harga, jarak dari posisi sekarang, jumlah sentuhan

### ƒ Fibonacci
- Otomatis menemukan **swing utama** (titik tertinggi & terendah) di rentang analisa
- Menggambar **fib retracement asli TradingView** (level 38.2% / 50% / 61.8%)
- Level ini sering jadi area pantul saat koreksi

---

## 6. Sinyal Beli/Jual & Rencana TP/SL

### ⚡ Sinyal Beli/Jual
Panah **▲BUY / ▼SELL** digambar di chart, dengan pemicu yang bisa dijelaskan:
- **Golden/death cross** MA (mengikuti setelan MA Anda)
- **RSI keluar** dari oversold/overbought (lebih andal daripada sekadar menyentuh)
- **Breakout/breakdown** high-low 20 hari
- **Volume spike** sebagai penguat

Setiap sinyal menyimpan **hasilnya** (return sampai sinyal berlawanan berikutnya) dan
panel menampilkan **win-rate** rentang tersebut — untuk menilai apakah setelan cocok
dengan karakter saham itu.

*Cooldown*: minimal 6 hari antar sinyal, 15 hari untuk breakout beruntun (anti-spam).

### 🎯 Rencana TP/SL
Digambar berlabel di chart:
- **Entry** — harga sekarang
- **SL** — di bawah support terdekat, dibatasi maks 2.5× ATR
- **TP1–TP3** — dari resistance terdekat; bila kurang, dilengkapi kelipatan 1.5× ATR
- Setiap TP menampilkan **R-multiple** (mis. TP2 = 2.4R) → dasar disiplin risk/reward

Semua harga dibulatkan ke tick IDX.

---

## 7. Price-Volume Analysis (VSA)

Prinsip **VSA (Volume Spread Analysis)**: bandingkan *effort* (volume) dengan
*result* (pergerakan harga). Ketidakcocokan = sinyal.

### Klasifikasi per candle
| Klasifikasi | Kondisi | Arti |
|---|---|---|
| **DEMAND KUAT** | naik + volume & range besar | pergerakan valid |
| **NO DEMAND** | naik tanpa volume | kenaikan rapuh |
| **ABSORPSI SUPPLY** | naik, volume besar, range sempit | ada yang jualan diam-diam di atas |
| **ABSORPSI DEMAND** | turun ditahan volume besar | ada yang menampung (teman akumulasi) |
| **NO SUPPLY** | turun tanpa volume | koreksi sehat |
| **SUPPLY KUAT** | turun + volume & range besar | tekanan jual nyata |

### Indikator tambahan
- **OBV 20 hari + divergensi** — OBV naik saat harga turun = akumulasi terselubung
- **Rasio volume hari naik vs turun** — >1.3 demand dominan, <0.75 supply dominan
- **Klimaks volume**:
  - *Selling climax* — volume terbesar 40 hari di area low = panic selling, sering jadi dasar
  - *Buying climax* — volume terbesar di area high = euforia, rawan puncak/distribusi

**Kombinasi terkuat:** fase AKUMULASI + ABSORPSI DEMAND + harga dekat cost bandar
= tiga sudut pandang menunjuk arah sama.

---

## 8. Live Tape & Orderbook (Scalping)

Tombol **⚡ Live Tape** — polling orderbook realtime tiap **~1,5 detik** (untuk scalping,
jauh lebih cepat dari Monitor Sinyal 60 detik).

### Yang ditampilkan
1. **Kedalaman bid/offer** — 5 level tiap sisi sebagai bar proporsional, dengan
   **lot + jumlah order** (`16.6jt · 3932o`)
2. **Gauge imbalance** — tekanan beli vs jual instan:
   `imbalance = (total bid − total offer) / (total bid + total offer)`
   - >+20% = tekanan beli, <−20% = tekanan jual
3. **Realisasi beli vs jual berjalan** — tiap refresh menghitung Δvolume dan
   mengklasifikasi agresor:
   - transaksi di harga **offer** = market buy (haka)
   - transaksi di harga **bid** = market sell
   - diakumulasi jadi **net delta lot**
4. **Penanda transaksi besar di chart** — big print (>0,3% volume harian dalam
   satu tick) ditandai panah ▲/▼ berlabel lot (dedupe maks 1 per 30 detik)

### Batasan
- Butuh **jam bursa aktif** untuk data bergerak
- **Tab harus tetap terbuka** (monitor hidup di halaman)
- Sinyal volume baru penuh menjelang sore (volume hari berjalan belum lengkap)

### Monitor Sinyal (60 detik) vs Live Tape (1,5 detik)
- **🔔 Monitor Sinyal** — untuk swing; cek sinyal MA/RSI/breakout tiap 60 detik,
  alert beep + notifikasi + panah. Sinyal candle berjalan ditandai "belum konfirmasi"
  sampai close ±16:00 WIB (bisa berubah/repaint).
- **⚡ Live Tape** — untuk scalping; baca tape orderbook realtime.

---

## 9. Deteksi Bid/Offer Palsu

Konsep yang Anda minta: **tembok palsu** = order besar yang dipasang untuk menipu,
bukan untuk benar-benar dieksekusi (spoofing). Bisa ditarik kapan saja.

### Logika deteksi (4 syarat sekaligus)
Sebuah level ditandai **PALSU** (+ beep + notifikasi) bila:
1. **Lot tebal tak wajar** — `lot per order ≥ 4× median` seluruh buku
2. **Order sedikit** — `que_num ≤ 10` (tembok dipegang segelintir order, mudah ditarik)
3. **Pasar sepi** — `value` & `frequency` **tidak bergerak** dalam 4–6 detik (tidak
   ada haka/eksekusi yang menyentuhnya)
4. **Bertahan** — level itu ada di ≥60% snapshot 8 detik terakhir

Kenapa 4 syarat? Agar **tidak salah tuduh**: tembok bid asli (mis. BBRI 2700 dengan
3.932 order) tidak kena flag karena order-nya banyak; tembok yang sedang dieksekusi
saat pasar ramai juga tidak, karena `value` bergerak.

### Metrik kunci: lot per order
```
lot per order = volume level / jumlah order (que_num)
```
- Rendah (mis. 4rb lot/order dengan ribuan order) = **tembok asli** (banyak antrean)
- Tinggi (mis. 10jt lot/order dengan 2 order) = **mencurigakan** (1-2 entitas, bisa hilang)

---

## 10. Cara Kerja Teknis

### Arsitektur
- **`interceptor.js`** (jalan di konteks halaman, `document_start`, semua frame) —
  menyadap `fetch`/XHR/WebSocket untuk menangkap: token Bearer, URL API broker summary,
  candle harian, dan orderbook — tanpa login/token tambahan.
- **`app.js`** (`document_idle`, frame utama) — mesin analisa, UI panel, dan penggambar
  di chart TradingView Chartbit.

### Endpoint API (exodus.stockbit.com)
| Data | Endpoint | Catatan |
|---|---|---|
| Broker summary | `/marketdetectors/{SYMBOL}` | simbol di path; param `transaction_type=GROSS`, `market_board`, `limit=0`, `from`/`to`; **hapus `period`** (menimpa tanggal) |
| Candle harian | `/chartbit/{SYMBOL}/price/daily` | `from`=terbaru, `to`=terlama (terbalik!); respons `data.chartbit[{date,open,...,frequency,foreignbuy,foreignsell,foreignflow}]` |
| Orderbook | `/orderbook/companies/{SYMBOL}` | bid/offer price1-10, volume1-10, que_num1-10 |

**Penting:** fetch ke exodus **tanpa** `credentials:'include'` (CORS wildcard menolak
request ber-cookie → "Failed to fetch"). Auth cukup lewat header Bearer.

### Menggambar di chart
Memakai `createMultipointShape` / `createShape` / `createStudy` pada widget TradingView
(dicari lewat scan properti window + iframe same-origin). Fungsi ini mengembalikan
**Promise** di Chartbit live; pelacakan ID marka pakai diff `getAllShapes()`
sebelum/sesudah. Kotak/sinyal **digambar ulang otomatis** saat timeframe diganti
(Chartbit menghapus objek gambar ketika resolusi berubah).

### Cache
Broker summary di-cache per `simbol:tanggal` di `localStorage` (prefix `__bm3:`).
Hari berjalan tidak di-cache (data masih berubah intraday).

---

## 11. Roadmap: WebSocket Realtime

Live Tape saat ini polling REST ~1,5 detik. Untuk realtime penuh (update tiap tick),
protokol WebSocket Stockbit sudah dibongkar sampai level frame:

- **Endpoint**: `wss://wss-trading.stockbit.com/ws` (subprotocol `"web"`)
- **Format**: protobuf biner (bukan JSON)
- **Subscribe frame** (sudah didekode): field 1 = session id, field 2 = daftar simbol,
  field 3 = ws-key (base64 32-byte dari `auth/websocket/key`), field 5 = JWT
- **Heartbeat**: kirim `ping` protobuf berkala, balas `pong`

**Sisa pekerjaan (wajib saat pasar buka):** memetakan field data frame orderbook
(mana bid price/volume/order) dengan mengorelasikan ke data REST yang nilainya sudah
diketahui. Tidak boleh dilakukan buta — salah angka pada data trading berbahaya.

Rencana: dikerjakan di sesi saat jam bursa aktif (Sen–Jum 09:00–16:00 WIB).

---

## 12. Glosarium

| Istilah | Arti |
|---|---|
| **Bandarmology / Brokermology** | Analisa aktivitas broker untuk melacak "bandar" (pemodal besar) |
| **Akumulasi** | Pengumpulan saham diam-diam oleh bandar (biasanya saat sideways) |
| **Distribusi** | Pelepasan saham bandar ke pasar (biasanya saat harga tinggi) |
| **Clean buy/sell** | (Buy−Sell)/Buy — porsi beli yang tidak "dicuci" dengan jualan |
| **Haka** | "Hajar kanan" — beli agresif di harga offer (market buy) |
| **Haki** | "Hajar kiri" — jual agresif di harga bid (market sell) |
| **Freq (frekuensi)** | Jumlah transaksi; freq kecil + lot besar = order gede (bandar) |
| **Smart money** | Uang institusi/asing yang bergerak lebih dulu & terinformasi |
| **VSA** | Volume Spread Analysis — baca hubungan volume vs range harga |
| **OBV** | On-Balance Volume — akumulasi volume berarah untuk deteksi divergensi |
| **ATR** | Average True Range — ukuran volatilitas harian |
| **ARA/ARB** | Auto Reject Atas/Bawah — batas harian gerak harga di IDX |
| **Tick / fraksi harga** | Kelipatan minimum perubahan harga IDX: <200→1, 200-500→2, 500-2000→5, 2000-5000→10, ≥5000→25 |
| **Imbalance** | Ketimpangan total lot bid vs offer di orderbook |
| **Spoofing / bid palsu** | Order besar palsu untuk menipu, ditarik sebelum dieksekusi |
| **R-multiple** | Kelipatan risiko; 1R = jarak entry ke stop loss |
| **Golden/Death cross** | MA cepat memotong ke atas/bawah MA lambat |
| **Divergensi** | Ketidakssearahan harga vs indikator (sinyal pembalikan) |

---

*Extension ini alat bantu analisa, bukan penasihat investasi. Semua deteksi bersifat
heuristik — selalu konfirmasi silang dan kelola risiko. Selamat trading! 📈*
