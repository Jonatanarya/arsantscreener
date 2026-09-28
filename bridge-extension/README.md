# 🛰 Arsant Screener Bridge — Stockbit Data Collector

Extension ini mengirim data pasar dari sesi Stockbit Anda ke backend Arsant Screener
yang berjalan di komputer lokal. Panduan lengkap cakupan data dan cara kerjanya ada di
**[COLLECTOR.md](COLLECTOR.md)**.

Extension browser (Chrome / Brave / Edge / browser Chromium lain) yang menggabungkan
**analisa teknikal + brokermology** langsung di halaman **Chartbit Stockbit**:

- 🟩 Deteksi otomatis **fase AKUMULASI** — harga sideways + ada broker yang net buy
  konsisten dengan clean buy tinggi → digambar sebagai **kotak hijau di chart**.
- 🟥 Deteksi otomatis **fase DISTRIBUSI** — harga turun/topping + ada broker yang net sell
  konsisten → **kotak merah di chart**.
- 💰 **Smart Money Detector** — mendeteksi broker yang konsisten akumulasi dengan
  **clean buy ≥ 80%**, menghitung **nilai rata-rata per transaksi dari frekuensi (freq)**
  untuk membedakan smart money vs ritel, ditambah klasifikasi tipe broker
  (asing / BUMN / institusi lokal / ritel online).
- Kotak fase digambar memakai API TradingView Chartbit sehingga **ikut bergerak saat
  chart di-zoom / di-pan**, dan **digambar ulang otomatis saat timeframe diganti**.
- 📏 **Support & Resistance otomatis** — deteksi pivot + clustering, digambar sebagai
  garis putus-putus (hijau = support, merah = resistance) lengkap dengan jumlah sentuhan.
- ⚙️ **Setelan MA & RSI dinamis** (preset Daytrade 9/21 & Swing 21/50, EMA/SMA) —
  dipakai oleh mesin sinyal & analisa teknikal. Untuk indikator visual di chart,
  pakai menu Indicators (ƒx) bawaan Chartbit yang tersimpan permanen di layout Anda.
- 🧠 **Analisa Teknikal lengkap (konfluensi)** — satu klik menghasilkan: struktur trend
  (HH/HL vs LH/LL) + posisi vs MA20/50/200, RSI + **divergensi bullish/bearish otomatis**,
  MACD, analisa volume (**spike** & **dry-up**), **foreign flow 20 hari** (deteksi asing
  akumulasi saat harga turun), posisi harga vs **avg cost bandar** dari fase terakhir,
  S/R terdekat + rasio R/R, **ATR(14)** + saran stop loss, dan **ARA/ARB besok**
  (tier & tick IDX) — dirangkum jadi skor bias bullish/bearish.
- ƒ **Fibonacci otomatis** — retracement digambar dari swing utama rentang analisa
  memakai objek fib asli TradingView (fallback garis 38.2/50/61.8).
- ⚡ **Sinyal Beli/Jual di chart** — panah ▲BUY/▼SELL digambar otomatis (golden/death
  cross, RSI keluar oversold/overbought, breakout/breakdown 20 hari + konfirmasi
  volume) lengkap dengan tabel riwayat: tanggal, harga, alasan, hasil per sinyal,
  dan win-rate rentang tersebut.
- ⚡ **Live Tape (scalping)** — polling orderbook realtime tiap ~1,5 detik: visualisasi
  kedalaman bid/offer (lot + jumlah order per level), gauge imbalance tekanan beli/jual,
  realisasi beli vs jual berjalan, **deteksi bid/offer palsu** (lot tebal + order sedikit
  + tidak dieksekusi = tembok rawan ditarik → beep + notifikasi), dan penanda transaksi
  besar (▲/▼ lot) otomatis di chart.
- 🔔 **Monitor Sinyal** — pengecekan otomatis tiap 60 detik selama jam bursa: begitu
  kondisi sinyal terpenuhi pada candle hari ini, alert langsung muncul (beep +
  notifikasi desktop + panah di chart + panel terbuka). Sinyal pada candle yang
  masih berjalan ditandai "belum konfirmasi" sampai close ±16:00 WIB.
- 🎯 **Rencana TP/SL di chart** — Entry, Stop Loss (di bawah support terdekat,
  dibatasi 2.5×ATR), dan TP1–TP3 (dari resistance terdekat, dilengkapi kelipatan ATR)
  digambar berlabel harga, %, dan R-multiple; semua dibulatkan ke tick IDX.
- 📊 **Price-Volume Analysis (VSA)** — klasifikasi effort-vs-result per candle
  (DEMAND KUAT, NO DEMAND, ABSORPSI SUPPLY/DEMAND, NO SUPPLY, SUPPLY KUAT),
  OBV 20 hari + divergensi vs harga, rasio volume hari naik/turun, dan deteksi
  selling/buying climax — dirangkum jadi bias PVA.
- 💰 **Avg harga bandar per fase** — setiap fase akumulasi/distribusi kini menampilkan
  harga rata-rata transaksi broker motornya (cost bandar).

## Mulai kirim data ke Arsant Screener

1. Buka `chrome://extensions` (atau `brave://extensions`).
2. Aktifkan **Developer mode**, lalu klik **Load unpacked**.
3. Pilih folder `C:\GITHUB\arsant screener\arsant screener\bridge-extension`.
4. Klik ikon extension **Arsant Screener Bridge**, pastikan Base URL bernilai
   `http://localhost:4000`, lalu aktifkan pengiriman data.
5. Buka https://stockbit.com dan login. Biarkan satu tab Stockbit terbuka, kemudian
   tekan **Start** pada popup extension.

Untuk percobaan awal, gunakan mode kustom dengan beberapa saham terlebih dahulu,
misalnya `BBCA, BBRI, BMRI, TLKM, ASII`, sebelum menjalankan universe yang lebih besar.

## Cara pakai

1. Pastikan panel **Broker Summary** di Chartbit pernah terbuka sekali
   (di Chartbit biasanya sudah tampil otomatis di sisi kanan). Extension menangkap
   format API + token dari situ — tidak ada login/token tambahan yang diminta.
2. Klik tombol bulat hijau **BM** di pojok kanan bawah.
3. Cek baris status: `✔ token · ✔ API broker summary · ✔ data candle`.
4. Atur **Periode**, **Jendela fase**, dan **Sensitivitas** (klik tombol **❓** di panel
   untuk penjelasan lengkap setiap pengaturan), lalu klik **▶ Jalankan Analisa**.
   - **Periode** — rentang tanggal bebas (dari → s/d) dengan tombol cepat
     1 bln / 3 bln / 6 bln / 1 thn. Bisa rentang historis mana pun (maks ±250 hari
     bursa); 1 request per hari bursa, dibatasi 3 paralel (±3 bulan ≈ 30 detik
     pertama kali). Tanggal yang sudah pernah diambil di-cache, jadi analisa
     berikutnya jauh lebih cepat.
   - **Jendela fase** — panjang jendela geser (5–20 hari) untuk mendeteksi satu fase;
     pendek = menangkap fase cepat, panjang = hanya fase besar yang rapi.
   - **Sensitivitas** — ambang kompresi harga & flow broker (lihat tabel di bawah).
5. Setelah selesai, klik **🖊 Gambar di Chart** untuk menandai semua fase di Chartbit,
   atau tombol **Gambar** per fase. **Hapus Marka** membersihkan gambar.

> 📚 **Panduan lengkap semua fitur, konsep, rumus & roadmap**: [PANDUAN-LENGKAP.md](PANDUAN-LENGKAP.md)
> 📖 Penjelasan mendalam Jendela Fase & Sensitivitas dengan contoh perhitungan:
> lihat [PANDUAN.md](PANDUAN.md).

## Cara membaca hasil

### Fase
- **AKUMULASI**: dalam jendela N hari, rentang harga terkompresi (sideways) **dan**
  ada broker-broker yang net buy di ≥60% hari dengan clean buy ≥60%, dengan total
  net flow signifikan terhadap nilai transaksi. Label di chart:
  `AKUMULASI • AK,ZP,BK • 45.2B` (broker motor + nilai flow).
- **DISTRIBUSI**: cermin dari akumulasi, pada kondisi harga tidak naik / menurun.

### Tabel Smart Money Detector
| Kolom | Arti |
|---|---|
| **Net** | Total net buy (+) / net sell (−) sepanjang periode |
| **Clean%** | Clean Buy% = (Buy−Sell)/Buy — beli yang tidak "dicuci" dengan jualan (untuk net seller: Clean Sell%) |
| **Konsist** | % hari aktif di mana broker itu clean buy/sell ≥ 80% |
| **Avg/Trx** | Nilai rata-rata per transaksi = (Buy+Sell) / total freq — 💰 = di atas persentil-75 (indikasi order besar / bukan ritel) |
| **Verdict** | `SMART ACCUM` = akumulasi konsisten clean ≥80% oleh broker institusi/asing atau ber-ticket besar; `AKUM RITEL` = pola sama tapi profil ritel; `SMART DIST`/`DIST RITEL` = kebalikannya |

### Sensitivitas
- **Rendah** — hanya sinyal kuat: kompresi ≤7%, flow ≥18% dari nilai transaksi.
- **Sedang** (default) — kompresi ≤10%, flow ≥12%.
- **Tinggi** — kompresi ≤14%, flow ≥7% (lebih banyak sinyal, lebih banyak noise).

## Cara kerja (teknis)

- `interceptor.js` (jalan di konteks halaman) menyadap `fetch`/XHR Stockbit untuk
  menangkap: Bearer token yang sedang dipakai halaman, URL API
  `exodus.stockbit.com/findata-view/marketdetectors/brokers` (broker summary), dan
  URL datafeed candle TradingView `/history?symbol=…`.
- `app.js` me-replay URL tersebut per hari bursa (tanggal diganti otomatis mengikuti
  format aslinya), mem-parse `brokers_buy` / `brokers_sell`
  (`netbs_broker_code`, `bval`, `blot`, `freq`, `sval`, `slot`), lalu menjalankan
  deteksi fase dengan jendela geser dan statistik per broker.
- Menggambar kotak memakai `createMultipointShape` / `createShape` pada widget
  TradingView Chartbit. Kalau widget tidak ditemukan, hasil tetap tampil sebagai
  timeline + tabel di panel.
- Cache broker summary per `simbol:tanggal` di `localStorage` (hari berjalan tidak
  di-cache karena datanya masih berubah).

## Catatan & batasan

- Butuh **login Stockbit** dengan akses Broker Summary (fitur berbayar/paket Stockbit
  menentukan data apa yang tersedia — extension hanya memakai akses akun Anda sendiri).
- Jika Stockbit mengubah struktur API, buka tab Broker Summary sekali lagi agar
  template baru tertangkap; parser respons dibuat toleran terhadap perubahan kecil.
- Klasifikasi broker (asing/BUMN/ritel…) bersifat indikatif dan bisa diedit sendiri di
  `app.js` pada konstanta `BROKER_DB`.
- **Bukan rekomendasi jual/beli.** Semua deteksi bersifat heuristik statistik —
  gunakan sebagai alat bantu konfirmasi, bukan sinyal tunggal.
