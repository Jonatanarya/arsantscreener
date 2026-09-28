/**
 * coverage.js — crawl inkremental: jangan menarik ulang yang sudah ada.
 *
 * Sebelum sebuah emiten dikerjakan, collector menanyakan ke backend apa yang
 * SUDAH tersimpan untuk emiten itu (`GET /ingest/coverage?symbol=…`). Job yang
 * datanya sudah ada dilewati, sehingga:
 *
 *   - crawl yang terputus bisa dilanjutkan tanpa mengulang dari nol;
 *   - salah klik "ambil ulang" tidak membuang berjam-jam request;
 *   - jalan rutin harian cuma menarik yang benar-benar baru.
 *
 * ATURAN KESEGARAN — inilah inti keputusannya:
 *
 *   1. Jendela histori yang SUDAH LEWAT (window.end < hari ini) bersifat TETAP.
 *      Broker summary 3 Maret 2024 tidak akan pernah berubah lagi. Sekali
 *      tersimpan, tidak pernah ditarik ulang.
 *   2. Jendela yang MENYENTUH hari ini masih bisa berubah (bar hari ini belum
 *      selesai). Disegarkan sekali sehari.
 *   3. Endpoint tanpa jendela (profil, rasio, analyst rating) disegarkan tiap
 *      `refreshAfterDays` hari — bawaannya 7, karena isinya jarang berubah.
 *
 * Kalau backend tidak terjangkau, coverage dianggap kosong: crawl tetap jalan
 * penuh. Lebih baik menarik ulang daripada diam-diam melewatkan data.
 */
import { getSettings } from './storage.js';
import { variantKey } from './relay.js';

const cache = new Map();  // symbol -> {coverage, at}
const CACHE_TTL_MS = 5 * 60 * 1000;

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Ambil coverage satu emiten dari backend (dengan cache pendek). */
export async function fetchCoverage(symbol) {
  // '' = cakupan endpoint GLOBAL (market mover, papan khusus) yang disimpan
  // backend dengan symbol kosong. Bukan kasus error.
  const sym = String(symbol || '').toUpperCase();

  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.coverage;

  const settings = await getSettings();
  if (!settings.relayEnabled || !settings.skipExisting) return null;

  const base = String(settings.backendUrl || '').replace(/\/+$/, '');
  if (!base) return null;

  try {
    const headers = {};
    if (settings.backendApiKey) headers['X-API-Key'] = settings.backendApiKey;
    const res = await fetch(`${base}/ingest/coverage?symbol=${encodeURIComponent(sym)}`, {
      headers, credentials: 'omit',
    });
    if (!res.ok) return null;
    const coverage = await res.json();
    cache.set(sym, { coverage, at: Date.now() });
    return coverage;
  } catch (e) {
    return null;  // backend mati -> crawl penuh
  }
}

/** Buang cache satu emiten / semuanya (dipanggil saat engine start). */
export function clearCoverageCache(symbol) {
  if (symbol) cache.delete(String(symbol).toUpperCase());
  else cache.clear();
}

/**
 * Apakah job ini boleh dilewati karena datanya sudah ada & masih segar?
 * Mengembalikan {skip, reason}.
 */
export function shouldSkip(job, coverage, settings, today = todayISO()) {
  if (!coverage || !settings.skipExisting) return { skip: false };

  const win = job.window || (job.meta && job.meta.window) || null;

  // Untuk data broker, yang menentukan adalah TABEL HASILNYA — bukan sekadar
  // adanya baris di raw_ingest. Request broker pernah mendarat dengan payload
  // keliru (bug URL), sehingga raw_ingest terisi tapi broker_summary kosong.
  // Kalau patokannya raw_ingest, data rusak itu akan dilewati selamanya.
  if (job.relay === 'brokerDay') {
    const date = (job.meta && job.meta.date) || (win && win.start);
    const has = date && (coverage.brokerDays || []).includes(date);
    if (!has) return { skip: false };
    if (date < today) return { skip: true, reason: `broker ${date} sudah tersimpan` };
    return { skip: false };   // hari ini masih bisa berubah
  }
  if (job.relay === 'brokerRange') {
    const rng = win && `${win.start}..${win.end}`;
    const has = rng && (coverage.brokerRanges || []).includes(rng);
    if (!has) return { skip: false };
    if (win.end < today) return { skip: true, reason: `broker rentang ${rng} sudah tersimpan` };
    return { skip: false };
  }

  const key = `${job.endpointId}|${variantKey(job)}`;
  const fetchedAt = coverage.keys && coverage.keys[key];
  if (!fetchedAt) return { skip: false };

  // 1. jendela histori yang sudah lewat: datanya tidak akan berubah lagi
  if (win && win.end && win.end < today) {
    return { skip: true, reason: `sudah ada (${win.start}..${win.end}, histori tetap)` };
  }

  const fetchedDay = String(fetchedAt).slice(0, 10);

  // 2. jendela yang menyentuh hari ini: cukup sekali sehari
  if (win) {
    if (fetchedDay >= today) return { skip: true, reason: 'sudah diperbarui hari ini' };
    return { skip: false };
  }

  // 3a. endpoint GLOBAL (market mover, papan khusus, running trade pasar):
  //     isinya berubah tiap hari bursa, jadi patokannya harian — bukan
  //     refreshAfterDays yang dipakai data profil.
  if (!job.symbol) {
    if (fetchedDay >= today) return { skip: true, reason: 'data pasar sudah diambil hari ini' };
    return { skip: false };
  }

  // 3b. tanpa jendela: segarkan tiap refreshAfterDays hari
  const days = Number(settings.refreshAfterDays);
  if (!Number.isFinite(days) || days <= 0) return { skip: false };
  const ageMs = Date.now() - Date.parse(fetchedAt);
  if (Number.isFinite(ageMs) && ageMs < days * 86400000) {
    return { skip: true, reason: `masih segar (< ${days} hari)` };
  }
  return { skip: false };
}

/**
 * Ringkasan untuk UI: berapa banyak yang sudah tersimpan untuk emiten ini.
 * Dipakai popup untuk memberi tahu "data periode ini sudah ada".
 */
export function summarize(coverage) {
  if (!coverage) return null;
  return {
    symbol: coverage.symbol,
    endpoints: Object.keys(coverage.keys || {}).length,
    bars: (coverage.bars && coverage.bars.count) || 0,
    barsFrom: (coverage.bars && coverage.bars.min) || null,
    barsTo: (coverage.bars && coverage.bars.max) || null,
    brokerDays: (coverage.brokerDays || []).length,
  };
}
