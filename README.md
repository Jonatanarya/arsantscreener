# Arsant Screener

Arsip source code Arsant Screener, layanan analisis saham Indonesia yang pernah
dipublikasikan di `arsant.web.id`.

## Struktur

- `web/` — frontend React/Vite.
- `server/` — REST API, worker pipeline data, migrasi, dan maintenance.
- `agent/` — agent sesi browser untuk sumber data yang memerlukan autentikasi.
- `bridge-extension/` — collector Chrome versi awal.
- `deployment/` — contoh unit systemd, nginx, backup, dan operasi server.
- `docs/` — dokumentasi arsitektur dan pipeline data.

## Menjalankan secara lokal

1. Salin `server/.env.example` menjadi `server/.env` dan isi kredensial lokal.
2. Jalankan MySQL dengan `docker compose up -d mysql`.
3. Jalankan backend dari folder `server`.
4. Jalankan frontend dari folder `web` dengan `npm install` lalu `npm run dev`.

File environment, build, log, sesi browser, backup, serta kredensial produksi
tidak termasuk dalam repository.

## Status

Project ini diarsipkan dari deployment produksi pada September 2026. Source
dipertahankan sebagai referensi dan dapat dijalankan kembali dengan konfigurasi
baru.
