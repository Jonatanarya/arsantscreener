# 📖 Panduan: Jendela Fase & Sensitivitas

Panduan ini menjelaskan dua pengaturan inti extension Brokermology dengan contoh
angka, supaya jelas *kenapa* sebuah kotak akumulasi/distribusi muncul (atau tidak
muncul) di chart Anda.

---

## Cara kerja detektor (gambaran besar)

Untuk setiap saham, extension bekerja 3 langkah:

1. Ambil candle harian + broker summary per hari bursa sepanjang **Periode**.
2. Geser sebuah "kaca pembesar" selebar **Jendela fase** (N hari) di sepanjang data,
   satu hari demi satu hari. Setiap posisi kaca pembesar diperiksa:
   *apakah potongan N hari ini terlihat seperti fase akumulasi/distribusi?*
3. Potongan-potongan yang lolos pemeriksaan dan saling bersambung digabung
   menjadi **satu kotak fase** di chart.

Yang menentukan "lolos atau tidak" pada langkah 2 adalah **Sensitivitas**.

---

## 🔲 Jendela Fase

### Apa itu

Panjang kaca pembesar tadi, dalam hari bursa. Dengan Periode 60 hari dan Jendela 10,
extension memeriksa: hari ke 1–10, lalu 2–11, lalu 3–12, … sampai 51–60.
Total 51 potongan yang diperiksa satu per satu.

### Kenapa ukurannya penting

Sebuah potongan hanya ditandai **AKUMULASI** kalau *di dalam potongan itu*:

- harga sideways (rentang high–low sempit), **dan**
- ada broker yang net buy di **≥60% hari** dalam potongan itu dengan clean buy tinggi.

Artinya jendela adalah "ukuran minimal fase yang bisa dilihat". Fase yang lebih
pendek dari jendela akan tenggelam; jendela yang terlalu pendek membuat gerakan
acak 3–4 hari ikut terdeteksi.

### Contoh konkret

Misal bandar mengakumulasi saham RATU selama **8 hari** (hari ke-20 s/d 27),
sebelum dan sesudahnya pasar acak:

```
hari :  15 16 17 18 19 | 20 21 22 23 24 25 26 27 | 28 29 30
bandar:  -  -  -  -  - | B  B  B  B  B  B  B  B  | -  -  -     (B = net buy bersih)
```

| Jendela | Yang terjadi | Hasil |
|---|---|---|
| **5 hari** | Potongan 20–24, 21–25, 22–26, 23–27 semuanya berisi 5/5 hari beli → lolos | ✅ Terdeteksi, kotak ±tanggal 20–27 (akurat) |
| **10 hari** | Potongan terbaik 19–28 hanya berisi 8/10 hari beli = 80% → masih lolos (syarat ≥60%), tapi potongan 15–24 hanya 5/10 = 50% → gagal | ✅ Terdeteksi, tapi kotak sedikit lebih lebar dari fase aslinya |
| **20 hari** | Potongan mana pun maksimal berisi 8/20 hari beli = 40% → di bawah 60% | ❌ TIDAK terdeteksi — fasenya "terlalu kecil" untuk kaca pembesar sebesar ini |

Sebaliknya, kalau bandar mengakumulasi pelan-pelan selama **1,5 bulan** dengan pola
beli 3 hari–istirahat 2 hari–beli lagi:

| Jendela | Hasil |
|---|---|
| **5 hari** | Terdeteksi terputus-putus jadi beberapa kotak kecil (berisik) |
| **15–20 hari** | ✅ Satu kotak besar yang rapi — pola cicilan justru terlihat jelas saat dilihat dari "jarak jauh" |

### Cara memilih

| Gaya Anda | Jendela |
|---|---|
| Swing cepat, cari fase pendek 1–2 minggu | 5–7 hari |
| Umum / default | 10 hari |
| Posisi besar, cari akumulasi berbulan-bulan | 15–20 hari (+ Periode ≥ 120) |

> 💡 Aturan praktis: jendela ≈ **setengah dari panjang fase yang ingin Anda tangkap**.
> Mau menangkap fase ±3 minggu (15 hari bursa)? Pakai jendela 7–10.

---

## 🎚 Sensitivitas

### Apa itu

Seketat apa ujian yang harus dilewati setiap potongan. Ada **dua ambang** yang
diuji sekaligus:

**Ambang 1 — Kompresi harga** (untuk akumulasi: harga harus sideways)

```
kompresi = (high tertinggi − low terendah dalam jendela) ÷ harga rata-rata
```

**Ambang 2 — Flow broker** (harus ada uang yang serius masuk/keluar)

```
flow = total net buy para "broker konsisten" ÷ total nilai transaksi dalam jendela
```

Broker konsisten = broker yang net buy di ≥60% hari jendela itu dengan clean buy ≥60%.

| Sensitivitas | Kompresi maks. | Flow min. | Karakter |
|---|---|---|---|
| **Rendah** | ≤ 7% | ≥ 18% | Sinyal langka tapi sangat meyakinkan |
| **Sedang** | ≤ 10% | ≥ 12% | Seimbang (default) |
| **Tinggi** | ≤ 14% | ≥ 7% | Banyak sinyal, termasuk yang samar |

### Contoh perhitungan 1 — kompresi

Saham sideways di kisaran 1.000. Dalam jendela 10 hari: high tertinggi 1.060,
low terendah 980, rata-rata close 1.020.

```
kompresi = (1060 − 980) / 1020 = 7,8%
```

- Rendah (≤7%): ❌ gagal — 7,8% dianggap "kurang rapat"
- Sedang (≤10%): ✅ lolos
- Tinggi (≤14%): ✅ lolos

Saham gorengan yang "sideways"-nya bergelombang 12% hanya akan lolos di Tinggi.

### Contoh perhitungan 2 — flow

Dalam jendela 10 hari, total nilai transaksi Rp 100 miliar. Broker AK net buy
Rp 9 M (beli di 8 dari 10 hari, clean buy 85%) dan ZP net buy Rp 6 M
(7 dari 10 hari, clean 78%). Keduanya memenuhi syarat "broker konsisten".

```
flow = (9 + 6) / 100 = 15%
```

- Rendah (≥18%): ❌ gagal — akumulasinya "kurang agresif"
- Sedang (≥12%): ✅ lolos
- Tinggi (≥7%): ✅ lolos

**Kedua ambang harus lolos bersamaan.** Contoh 1 + contoh 2 di atas → potongan itu
ditandai AKUMULASI pada Sedang dan Tinggi, tapi tidak pada Rendah.

### Satu syarat lagi (otomatis): siapa yang beli lebih penting dari berapa

Kalau di jendela yang sama ada arus beli *dan* jual yang sama-sama konsisten,
extension memihak sisi yang diisi **broker berbobot smart money** (asing/BUMN/
institusi > ritel). Ritel ramai-ramai jual ke satu bandar ≠ distribusi — justru
itu akumulasi.

### Contoh nyata (DSSA, Mei–Jul 2026, dari pengujian live)

| Setelan | Hasil |
|---|---|
| Sedang / jendela 10 | Tidak ada fase — distribusi ZP tidak cukup rapat untuk ambang 10% |
| **Sedang / jendela 7** | DISTRIBUSI 12–29 Jun (ZP, AI) + AKUMULASI 24 Jun–2 Jul (DH, SS) |
| **Tinggi / jendela 10** | DISTRIBUSI 10 Jun–2 Jul (ZP, AI) — satu kotak lebih panjang |

Fase yang sama terlihat atau tidak, tergantung kaca pembesar dan ketatnya ujian.
Tidak ada setelan yang "paling benar" — Rendah/jendela panjang untuk keyakinan,
Tinggi/jendela pendek untuk eksplorasi.

### Resep praktis

1. **Mulai: Sedang / 10 hari.**
2. Tidak ada fase padahal Anda curiga ada? → naikkan ke **Tinggi**, atau perkecil
   jendela ke **7**.
3. Terlalu banyak kotak sampai membingungkan? → turunkan ke **Rendah**, atau
   perbesar jendela ke **15**.
4. Screening cepat banyak saham? → **Rendah / 10** — hanya saham dengan fase paling
   meyakinkan yang memunculkan kotak.
5. Verifikasi silang: fase yang muncul di **beberapa kombinasi setelan sekaligus**
   (seperti distribusi ZP di contoh DSSA) jauh lebih layak dipercaya daripada yang
   hanya muncul di Tinggi.

---

*Semua deteksi bersifat heuristik statistik — alat bantu konfirmasi, bukan sinyal
jual/beli tunggal.*
