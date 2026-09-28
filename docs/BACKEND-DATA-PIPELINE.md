# Arsant Backend Data Pipeline

Dokumen ini menjelaskan pusat kendali pembaruan data Arsant. Pipeline sengaja
dipisahkan dari proses API agar masalah pada satu penyedia data tidak membuat
website berhenti melayani pengguna.

## Komponen

- `arsant-api`: melayani website dan endpoint administrasi pipeline.
- `arsant-worker`: mengambil pekerjaan dari antrean MySQL dan menjalankannya.
- MySQL: menyimpan antrean, riwayat eksekusi, heartbeat, serta status kesegaran data.
- systemd: menjaga API dan worker sebagai service yang terpisah.

Worker dipasang terpisah dari API. Pipeline dapat dihentikan dari kontrol
backend tanpa mematikan website atau database.

## Migrasi database

`arsant-migrate` adalah satu-satunya jalur resmi untuk perubahan schema baru.
File SQL ditanam di binary sehingga versi aplikasi dan definisi schema selalu
berpasangan. Riwayatnya disimpan pada `arsant_schema_migrations` bersama checksum
setiap file. Perubahan pada file migrasi yang sudah pernah dipasang akan ditolak.

API dan worker menjalankan pemeriksaan berikut sebelum proses utama dimulai:

```bash
/opt/arsant-screener/bin/arsant-migrate -action up
```

Pemeriksaan memakai database lock agar dua service tidak memasang migrasi yang
sama. Migrasi yang gagal ditandai `dirty`; service tidak akan hidup sampai
schema dipulihkan atau diperbaiki. Database lama produksi sudah dibaseline pada
versi 17 setelah struktur tabel dicocokkan dan backup diverifikasi.

Perintah operasi:

```bash
sudo bash -c 'set -a; . /etc/arsant-screener.env; set +a; /opt/arsant-screener/bin/arsant-migrate -action status'
sudo bash -c 'set -a; . /etc/arsant-screener.env; set +a; /opt/arsant-screener/bin/arsant-migrate -action up'
```

Rollback schema dilakukan dengan mengembalikan backup MySQL yang dibuat sebelum
deploy, lalu mengembalikan binary API/worker dari `/srv/arsant-data/deploy-backups`.
Migrasi turun tidak dijalankan otomatis karena perubahan DDL bisa menghapus data.

## Tabel kontrol

| Tabel | Fungsi |
| --- | --- |
| `data_sources` | Daftar penyedia data dan status aktifnya |
| `data_jobs` | Antrean pekerjaan yang menunggu, berjalan, atau selesai |
| `data_runs` | Riwayat setiap percobaan eksekusi |
| `data_freshness` | Tanggal data terbaru per dataset dan emiten |
| `worker_heartbeats` | Status hidup, berhenti, dan pekerjaan aktif worker |
| `pipeline_settings` | Pengaturan global, termasuk pause/resume |

Pekerjaan diklaim dengan transaksi dan `FOR UPDATE SKIP LOCKED`. Desain ini
mencegah dua worker menjalankan pekerjaan yang sama jika kapasitas ditambah di
kemudian hari. Pekerjaan yang terputus lebih dari 15 menit dikembalikan ke
antrean secara otomatis.

## Endpoint administrasi

Semua endpoint berikut dilindungi header `X-API-Key` yang sama dengan endpoint
administrasi backend.

| Method | Path | Fungsi |
| --- | --- | --- |
| `GET` | `/admin/pipeline/status` | Ringkasan antrean, sumber, worker, dan eksekusi terakhir |
| `GET` | `/admin/pipeline/jobs` | Daftar pekerjaan; mendukung `status` dan `limit` |
| `GET` | `/admin/pipeline/freshness` | Kesegaran data; mendukung `dataset`, `symbol`, dan `limit` |
| `POST` | `/admin/pipeline/jobs` | Menambahkan pekerjaan manual |
| `POST` | `/admin/pipeline/jobs/{id}/retry` | Mengulang pekerjaan selesai atau gagal |
| `POST` | `/admin/pipeline/control` | Pause atau resume seluruh pipeline |
| `PATCH` | `/admin/pipeline/sources/{code}` | Mengaktifkan atau mematikan satu sumber |
| `GET` | `/admin/maintenance/preview` | Simulasi jumlah data operasional yang melewati masa retensi |
| `POST` | `/admin/maintenance/run` | Menjalankan simulasi atau pembersihan terkonfirmasi |
| `GET` | `/admin/maintenance/runs` | Riwayat pembersihan dan hasilnya |
| `GET` | `/admin/broker-summary/health` | Cakupan broker summary harian untuk saham likuid dan daftar gap |
| `GET` | `/admin/broker-session/status` | Status browser sesi dan masa berlaku autentikasi sumber broker |

Contoh payload pekerjaan pemeriksaan internal:

```json
{
  "sourceCode": "system",
  "jobType": "system.noop",
  "dedupeKey": "pipeline-check-2026-09-20"
}
```

Contoh kontrol pipeline:

```json
{ "paused": true }
```

## Status pekerjaan

- `pending`: menunggu waktu eksekusi.
- `running`: sudah dikunci oleh satu worker.
- `succeeded`: selesai dan hasilnya tercatat.
- `failed`: gagal setelah batas percobaan tercapai.
- `cancelled`: dihentikan oleh kontrol administratif.

Kegagalan sementara dijadwalkan ulang dengan jeda bertingkat. Setelah worker
mati mendadak, pekerjaan yang terkunci dipulihkan ke `pending` saat worker hidup
kembali.

## Operasi VPS

```bash
sudo systemctl status arsant-api
sudo systemctl status arsant-worker
sudo systemctl start arsant-worker
sudo systemctl stop arsant-worker
sudo journalctl -u arsant-worker -n 100 --no-pager
```

Retensi berjalan otomatis setiap hari setelah backup database. Kebijakan bawaan
menyimpan riwayat job sukses 30 hari, job gagal 90 hari, heartbeat worker 7 hari,
berita 365 hari, dan payload mentah 90 hari. Data pasar terstruktur, laporan
keuangan, broker summary, watchlist, posisi, dan akun pengguna tidak ikut dihapus.

Periksa dampak tanpa menghapus data:

```bash
/opt/arsant-screener/bin/arsant-maintenance
```

Worker memeriksa disk sistem dan disk data sebelum menjadwalkan atau mengambil
job. Saat salah satu mencapai 90%, status worker berubah menjadi
`storage_blocked` dan otomatis lanjut kembali setelah ruang tersedia.

Worker juga menjalankan `system.audit_broker_summary` setiap 15 menit. Audit
membandingkan 300 saham paling likuid dengan tanggal pasar terbaru di
`bars_daily`, lalu mencatat status global pada `data_freshness`. Hasil lengkap
setiap pemeriksaan tersimpan pada metadata `data_runs`; audit ini tidak
membutuhkan kredensial sumber data dan tidak melakukan pengambilan data.

Pengambilan harian dijalankan oleh `broker_activity.sync_symbol_day` melalui
agent lokal `127.0.0.1:4311`. Browser persisten dan agent berjalan sebagai
service terpisah; port browser, viewer login, dan agent hanya mendengarkan di
localhost VPS. Pengguna melakukan login sendiri melalui tunnel SSH. Password,
OTP, cookie, dan token tidak boleh dikirim lewat chat atau disimpan di source
code. Sumber `broker_activity` baru diaktifkan setelah sesi berstatus `ready`
dan satu pekerjaan uji berhasil.

Produksi mengambil broker summary satu saham pada satu waktu untuk 300 saham
paling likuid. Indeks `IHSG` dikeluarkan dari daftar emiten. Respons tanpa baris
broker dicatat sebagai gap sumber pada audit dan tidak diubah menjadi data
buatan; karena itu cakupan sesekali dapat berada sedikit di bawah 100%.

Jika sesi browser kedaluwarsa, job aktif dikembalikan ke antrean tanpa memakai
jatah percobaan dan seluruh job sumber sesi ditahan. Health check tetap berjalan
setiap 15 menit. Setelah pengguna login kembali dan agent berstatus `ready`,
worker membuka sumber serta melanjutkan job pada tanggal pasar yang sama secara
otomatis. Job lama yang sudah berstatus gagal karena HTTP 401, 403, 428, atau
pesan login juga dipulihkan. Kegagalan isi data, seperti respons broker kosong,
tidak diulang tanpa batas.

Admin dapat memeriksa dan memperbarui sesi dari dashboard. Jalur
`/api/account/data-session/viewer` meneruskan viewer browser VPS melalui HTTPS,
tetapi hanya setelah sesi Google diverifikasi sebagai email yang tercantum pada
`ROUTER_ADMIN_EMAILS`. Port browser dan agent tetap tertutup di localhost VPS;
SSH tunnel tidak diperlukan untuk login rutin dari dashboard.

Data Control Center tersedia di `/admin/data`. Halaman ini menampilkan status
pipeline, antrean, pekerjaan gagal, kesegaran dataset, cakupan broker dan
fundamental, heartbeat worker, sesi data, kapasitas disk, backup, dan service
VPS. Admin dapat menjeda atau melanjutkan pipeline, mengaktifkan atau
menonaktifkan sumber non-sistem, serta mengulang pekerjaan gagal. Halaman dan
seluruh endpoint `/admin/*` memakai sesi Google Arsant dan hanya dapat diakses
oleh email yang tercantum pada `ROUTER_ADMIN_EMAILS`; API key ingest tidak
digunakan oleh browser admin.

Menghidupkan service saja belum membuat pekerjaan berjalan jika pipeline masih
pause. Urutan aktivasi produksi adalah:

1. Aktifkan satu sumber data yang sudah lulus pengujian.
2. Jalankan satu pekerjaan manual dan periksa `data_runs`.
3. Jalankan service worker.
4. Ubah kontrol pipeline menjadi `paused=false`.
5. Pantau heartbeat, kegagalan, dan tanggal kesegaran data.

## Market EOD

Adapter `market_eod.sync_symbol` memperbarui candle harian tanpa browser. Ia
memakai tanggal terakhir yang sudah tersimpan, mundur tujuh hari untuk menangkap
koreksi data, kemudian melakukan upsert berdasarkan `(symbol, date)`.

Scheduler memilih 300 saham dengan rata-rata nilai transaksi terbesar dalam
45 hari pasar terakhir. Setelah pukul 17.15 WIB pada hari kerja, ia membuat satu
pekerjaan per emiten dengan kunci deduplikasi berdasarkan tanggal pasar. Pada
akhir pekan atau ketika worker sempat mati, scheduler mengejar hari kerja
terakhir secara otomatis.

Pengaturan service:

| Environment | Nilai produksi | Fungsi |
| --- | --- | --- |
| `ARSANT_EOD_SYMBOL_LIMIT` | `300` | Jumlah saham likuid yang diperbarui |
| `ARSANT_EOD_AFTER_HOUR` | `17` | Jam mulai setelah pasar |
| `ARSANT_EOD_AFTER_MINUTE` | `15` | Menit mulai setelah pasar |
| `ARSANT_WORKER_POLL_SECONDS` | `2` | Jeda antarpekerjaan |
| `ARSANT_STORAGE_GUARD_PATHS` | `/,/srv/arsant-data` | Disk yang dipantau worker |
| `ARSANT_STORAGE_CRITICAL_PERCENT` | `90` | Ambang penghentian sementara worker |
| `ARSANT_BROKER_SYMBOL_LIMIT` | `300` | Jumlah saham likuid yang diaudit broker summary-nya |
| `ARSANT_BROKER_AGENT_URL` | `http://127.0.0.1:4311` | Agent sesi broker yang hanya tersedia secara lokal |
| `ARSANT_FUNDAMENTALS_SYMBOL_LIMIT` | `300` | Jumlah saham likuid dalam siklus fundamental mingguan |
| `ARSANT_FUNDAMENTALS_DELAY_SECONDS` | `30` | Jarak minimum antarpengambilan fundamental |

## Fundamental mingguan

Adapter `market_fundamentals.sync_symbol` memperbarui fundamental 300 saham
likuid sekali per minggu. Scheduler membuat pekerjaan setelah Senin pukul 18.30
WIB dan menyebarkannya dengan jeda 30 detik agar permintaan tidak mengganggu
pekerjaan harga, berita, dan broker. Kunci deduplikasi memakai minggu dan simbol,
sehingga restart worker tidak menggandakan pekerjaan.

Data lama tetap tersedia ketika sumber eksternal sedang membatasi permintaan.
Status per simbol dicatat sebagai dataset `fundamentals` pada
`data_freshness`.

## Berita pasar

Adapter `market_news.sync` mengambil metadata berita dari feed RSS resmi yang
sudah dikonfigurasi. Konten yang disimpan dibatasi pada judul, ringkasan pendek,
tautan asli, penerbit, dan waktu terbit. Scheduler membuat satu pekerjaan setiap
15 menit dengan kunci deduplikasi per jendela waktu.

Setiap artikel diklasifikasikan menjadi `POSITIF`, `NEGATIF`, atau `NETRAL` dan
diberi topik. Label emiten hanya dibuat ketika ticker atau identitas perusahaan
muncul pada judul, sehingga nama narasumber atau analis di ringkasan tidak ikut
dianggap sebagai emiten terdampak. Hasilnya disimpan di `news_impacts` beserta
tingkat keyakinan dan alasan klasifikasi.

Feed bawaan:

- ANTARA Bursa
- ANTARA Finansial
- ANTARA Bisnis

Daftar feed dapat diganti melalui `ARSANT_NEWS_FEEDS` dengan URL yang dipisahkan
koma. Hanya feed yang izin penggunaannya sudah diverifikasi yang boleh
dimasukkan ke konfigurasi produksi.

## Deployment frontend di Oracle Linux

Build frontend ditempatkan di `/srv/arsant-screener/web`. Setelah mengekstrak
atau menukar direktori build, pulihkan konteks SELinux sebelum reload nginx:

```sh
sudo restorecon -RF /srv/arsant-screener/web
sudo nginx -t
sudo systemctl reload nginx
```

Tanpa `restorecon`, nginx dapat mengembalikan HTTP 500 walaupun izin Unix pada
berkas sudah benar.

## Kondisi produksi

- Migrasi: sampai `000019_enable_market_fundamentals`.
- Pipeline: aktif.
- Service worker dan timer retensi: enabled dan berjalan.
- Sumber `system`: aktif untuk pemeriksaan internal.
- Sumber `market_eod`: aktif untuk 300 saham paling likuid.
- Sumber `market_news`: aktif setiap 15 menit.
- Sumber `market_fundamentals`: aktif mingguan untuk 300 saham paling likuid.
- Sumber `broker_activity`: aktif harian dan diaudit terhadap 300 saham likuid.
