/**
 * Konfigurasi default Data Collector / Engine Scraper.
 *
 * Semua angka anti-deteksi ada di satu tempat supaya mudah diturunkan
 * (lebih pelan = lebih aman) tanpa menyentuh mesin antreannya.
 */

// Ambang klasifikasi kapitalisasi pasar (Rupiah).
// CATATAN: app.js (panel analisa lama) memakai ambang 40T/1T untuk screener
// harian. Ambang di bawah ini mengikuti definisi pasar yang diminta untuk
// collector (10T / 500M) dan sengaja dipisah supaya keduanya tidak saling
// mengganggu. Bisa diubah dari halaman Options.
import { DEFAULT_DEPTH } from './depth.js';

export const TIER_THRESHOLDS = {
  bluechip: 10e12,  // > Rp 10 Triliun
  second: 500e9,    // Rp 500 Miliar – Rp 10 Triliun
  // sisanya: third liner (< Rp 500 Miliar)
};

export const CATEGORIES = ['bluechip', 'second', 'third', 'gorengan'];

export const CATEGORY_LABEL = {
  bluechip: '💎 Bluechip / First Liner',
  second: '🔷 Second Liner',
  third: '🔸 Third Liner',
  gorengan: '🔥 Saham Gorengan / Volatil',
};

export const DEFAULTS = {
  // ---- backend REST API tujuan relay ----
  backendUrl: 'https://arsant.web.id/api',
  backendApiKey: '',          // dikirim sebagai header X-API-Key bila diisi
  rawPath: '/ingest/raw',     // penampung generik untuk endpoint tanpa route khusus
  classificationPath: '/ingest/classification',   // hasil segmentasi emiten
  relayEnabled: true,

  // ---- crawl inkremental ----
  // Lewati job yang datanya sudah tersimpan di backend. Jendela histori yang
  // sudah lewat tidak pernah ditarik ulang; yang menyentuh hari ini disegarkan
  // sekali sehari. Lihat lib/coverage.js.
  skipExisting: true,
  refreshAfterDays: 7,      // endpoint tanpa jendela (profil, rasio, rating)
  auth401Tolerance: 3,      // 401 beruntun sebelum antrean dijeda
  relayRaw: false,            // endpoint bertabel khusus tidak perlu diduplikasi sebagai payload mentah

  // ---- pemilihan universe ----
  categories: ['bluechip', 'second', 'third', 'gorengan'],
  customSymbols: [],          // mode kustom: daftar kode emiten manual
  customOnly: false,          // true = abaikan universe, pakai customSymbols saja
  maxSymbols: 0,              // 0 = tanpa batas
  // Tahap 2/3 mahal. Bila aktif, hanya kandidat likuid dari backend yang
  // menerima broker summary dan running trade; tahap 1 tetap membangun data harga.
  liquidityOnlyHeavy: false,
  liquidityCandidateLimit: 100,
  // kedalaman histori TIDAK lagi di sini — lihat `depth` di bawah (lib/depth.js)
  // Kalender aksi korporasi dipanggil per TANGGAL (1 request/hari bursa), jadi
  // rentangnya dipisah dari `years`: 90 hari sudah mencakup agenda yang relevan
  // tanpa membengkakkan antrean jadi ribuan request.
  // Running trade ditarik per TANGGAL dengan paginasi cursor. `runningTradeDays`
  // membatasi seberapa jauh ke belakang backfill-nya (bawaan 30 hari bursa);
  // `runningTradeMaxPages` membatasi jumlah halaman per hari.
  runningTradeDays: 30,
  // Broker summary juga per TANGGAL (1 request/hari bursa). Dibatasi terpisah
  // supaya tidak menghabiskan antrean seperti kejadian sebelumnya.
  brokerSummaryDays: 60,
  // Broker summary per rentang ditarik sekali per investor_type. Dari sini
  // ketahuan kasus seperti SSIA/YU: broker asing, investor lokal.
  brokerInvestorTypes: ['INVESTOR_TYPE_ALL', 'INVESTOR_TYPE_FOREIGN', 'INVESTOR_TYPE_DOMESTIC'],
  // historical/summary: limit maks 12 per halaman, jadi dipaginasi.
  historicalSummaryLimit: 12,
  historicalSummaryMaxPages: 40,
  runningTradeMaxPages: 500,
  // Kedalaman histori PER JENIS DATA (lihat lib/depth.js). Biaya tiap jenis
  // berbeda jauh, jadi tidak lagi disamakan oleh satu setelan `years`.
  depth: { ...DEFAULT_DEPTH },
  tierThresholds: { ...TIER_THRESHOLDS },

  // ---- parameter filter Stockbit ----
  // Enum ber-prefix; nilai pendek ("all_investor") ditolak 400 INVALID_PARAMETER.
  investorType: 'INVESTOR_TYPE_ALL',      // INVESTOR_TYPE_ALL | _FOREIGN | _DOMESTIC
  marketBoard: 'MARKET_BOARD_REGULER',    // satu-satunya papan yang terverifikasi
  transactionType: 'TRANSACTION_TYPE_GROSS',  // atau TRANSACTION_TYPE_NET

  // ---- anti-deteksi bot ----
  minDelayMs: 3000,           // jitter antar-request: 3 detik
  maxDelayMs: 7000,           // .. sampai 7 detik
  batchMin: 15,               // istirahat panjang tiap 15..20 request
  batchMax: 20,
  longPauseMinMs: 20000,      // istirahat panjang: 20..40 detik
  longPauseMaxMs: 40000,
  cooldownMinMs: 120000,      // kena 429/403: diam 2..5 menit
  cooldownMaxMs: 300000,
  maxRetries: 2,              // percobaan ulang per job (di luar cooldown)
  requestTimeoutMs: 25000,

  // ---- endpoint yang diaktifkan (id -> boolean); kosong = pakai defaultOn ----
  endpoints: {},

  // ---- lain-lain ----
  logLimit: 400,
  screenerTemplateId: '',     // opsional, untuk /screener/templates/{id}
};

// Kunci penyimpanan chrome.storage
export const KEYS = {
  settings: 'tw_crawler_settings',
  state: 'tw_crawler_state',
  logs: 'tw_crawler_logs',
  auth: 'tw_crawler_auth',
  classes: 'tw_crawler_classes',
  buffer: 'tw_relay_buffer',
  market: 'tw_crawler_market',   // hasil fase discovery (special board, movers, dll)
};

export const ENGINE_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COOLDOWN: 'cooldown',
  DONE: 'done',
  ERROR: 'error',
};
