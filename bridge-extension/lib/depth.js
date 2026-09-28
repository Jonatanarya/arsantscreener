/**
 * depth.js — kedalaman histori PER JENIS DATA.
 *
 * Sebelumnya semua endpoint memakai satu setelan `years`, padahal biayanya
 * jauh berbeda. Candle 5 tahun = 9 request; running trade 5 tahun = ±1.200
 * request berpaginasi. Menyamakannya berarti salah satu selalu salah: entah
 * candle-nya terlalu pendek, atau running trade-nya membakar antrean.
 *
 * Sekarang tiap kelompok data punya kedalaman sendiri, dan satuannya bebas —
 * hari / minggu / bulan / tahun, atau rentang tanggal eksplisit.
 */

export const DEPTH_KEYS = {
  chart: 'Candle & harga harian',
  historical: 'Ringkasan historis (daily/weekly/monthly)',
  broker: 'Broker summary & bandarmologi',
  runningTrade: 'Running trade (per cetakan transaksi)',
  ownership: 'Kepemilikan & insider',
  default: 'Endpoint lainnya',
};

export const DEPTH_UNITS = {
  days: { label: 'hari', perUnit: 1 },
  weeks: { label: 'minggu', perUnit: 7 },
  months: { label: 'bulan', perUnit: 30 },
  years: { label: 'tahun', perUnit: 365 },
};

/**
 * Bawaan yang masuk akal: harga & fundamental dalam, transaksi mentah pendek.
 * Semuanya bisa ditimpa dari halaman Options.
 */
export const DEFAULT_DEPTH = {
  chart: { mode: 'span', unit: 'years', value: 5 },
  historical: { mode: 'span', unit: 'years', value: 5 },
  broker: { mode: 'span', unit: 'years', value: 1 },
  runningTrade: { mode: 'span', unit: 'months', value: 1 },
  ownership: { mode: 'span', unit: 'years', value: 2 },
  default: { mode: 'span', unit: 'years', value: 5 },
};

const iso = (d) => d.toISOString().slice(0, 10);

/**
 * Kedalaman satu kelompok -> rentang tanggal konkret {from, to}.
 *
 * Tabel `settings.depth` adalah SATU-SATUNYA sumber kedalaman. Setelan lama
 * `settings.years` sudah tidak dipakai lagi — dulu ia jadi sumber kedua yang
 * bisa berbeda dari tabel ini, dan itu membingungkan.
 */
export function resolveDepth(key, settings = {}, todayISO) {
  const to = todayISO || iso(new Date());
  const table = { ...DEFAULT_DEPTH, ...(settings.depth || {}) };
  const d = table[key] || table.default || DEFAULT_DEPTH.default;

  if (d.mode === 'range') {
    // rentang eksplisit; kalau salah satu ujungnya kosong, jatuh ke default
    if (d.from && d.to) return { from: d.from, to: d.to, source: 'range' };
    if (d.from) return { from: d.from, to, source: 'range' };
  }

  const unit = DEPTH_UNITS[d.unit] ? d.unit : 'years';
  const n = Math.max(1, Number(d.value) || 1);
  const days = Math.max(1, Math.round(n * DEPTH_UNITS[unit].perUnit));

  const start = new Date(to);
  start.setDate(start.getDate() - days + 1);
  return { from: iso(start), to, days, source: 'span' };
}

/** Label ringkas untuk UI & log. */
export function describeDepth(key, settings = {}) {
  const table = { ...DEFAULT_DEPTH, ...(settings.depth || {}) };
  const d = table[key] || table.default;
  if (d.mode === 'range' && d.from) return `${d.from} s/d ${d.to || 'hari ini'}`;
  const unit = DEPTH_UNITS[d.unit] ? d.unit : 'years';
  return `${Math.max(1, Number(d.value) || 1)} ${DEPTH_UNITS[unit].label}`;
}
