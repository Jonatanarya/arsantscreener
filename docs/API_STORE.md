# Arsant API Store

Untuk domain `arsant.my.id`, halaman utama adalah landing/catalog paket token di `/` dan dashboard pelanggan ada di `/dashboard`. Dashboard pasar milik screener lama dipisahkan ke `/market-dashboard`, sementara terminal tetap di `/app`.

Domain `arsant.web.id` tidak disentuh dan tetap khusus screener saham. Routing frontend juga membedakan hostname tersebut, sehingga deploy build yang sama ke VPS tidak mengganti landing atau dashboard screener lama.

## Hasil pengecekan gateway

- `https://ai.arsant.my.id` aktif dan mengarah ke VPS `168.110.194.147`.
- Gateway terdeteksi sebagai 9Router `0.5.59`.
- Endpoint publik `/api/auth/status` menyatakan `requireLogin: true` dan `authenticated: false`.
- Endpoint admin seperti `/api/providers`, `/api/models`, dan `/api/proxy-pools` tidak dapat digunakan tanpa sesi login.

Kesimpulannya, base URL pelanggan dapat ditampilkan sebagai `https://ai.arsant.my.id`, tetapi browser pelanggan tidak boleh memanggil endpoint administrasi 9Router. Penerbitan key dan pembayaran perlu lewat backend milik Arsant.

## Kontrak endpoint dashboard pelanggan

Frontend `UserDashboardPage.tsx` mengharapkan endpoint berikut pada backend Arsant (bukan endpoint admin 9Router langsung):

- `GET /api/auth/session` — mengembalikan status login dan profil Google.
- `GET /api/account/summary` — credit tersisa, total, pemakaian, jumlah key aktif, paket, dan tanggal kedaluwarsa.
- `GET /api/account/keys` — daftar key milik user yang sudah dimasking.
- `POST /api/account/keys` — membuat key baru berdasarkan nama aplikasi.
- `GET /api/account/usage?period=30d` — seri pemakaian token untuk grafik.
- `POST /api/auth/logout` — menghapus session pelanggan.
- `GET /api/auth/google?returnTo=/dashboard` — memulai Google OAuth.

Setelah OAuth selesai, backend perlu memvalidasi identitas Google, membuat/memperbarui user berdasarkan `sub` Google, lalu memberi session cookie `HttpOnly`, `Secure`, dan `SameSite=Lax`.

## Tahap integrasi produksi

1. Tetapkan format key pelanggan, masa aktif, kuota token, dan aturan ketika kuota habis.
2. Tambahkan tabel `store_plans`, `store_orders`, `store_api_keys`, dan `store_usage` pada backend.
3. Pilih payment gateway Indonesia, lalu proses webhook secara idempotent sebelum menerbitkan key.
4. Buat service provisioning di backend yang menyimpan kredensial admin 9Router hanya di server.
5. Tambahkan middleware validasi key, pencatatan pemakaian, rate limit, dan endpoint dashboard pelanggan.
6. Ganti tombol checkout di `ApiStorePage.tsx` dari placeholder menjadi panggilan checkout backend.

Harga dan paket pada storefront mengikuti referensi yang dikirim untuk tahap awal. Verifikasi kembali margin, biaya provider, dan masa aktif sebelum pembayaran diaktifkan.

## Domain

Konfigurasi Nginx untuk domain baru ada di `deployment/nginx-arsant-my-id.conf`. DNS `arsant.my.id` sudah mengarah ke VPS, tetapi pemeriksaan publik menemukan TLS belum siap pada domain tersebut. Terbitkan sertifikat untuk `arsant.my.id` dan `www.arsant.my.id`, aktifkan konfigurasi, lalu reload Nginx.
