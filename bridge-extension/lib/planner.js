/**
 * planner.js — menerjemahkan setelan user menjadi daftar job konkret.
 *
 * Job TIDAK disimpan seluruhnya di storage. Untuk 900 emiten x 5 tahun x
 * puluhan endpoint, daftar utuhnya puluhan ribu baris dan berat ditulis-baca
 * tiap langkah. Sebagai gantinya state hanya menyimpan posisi kursor
 * (fase, indeks emiten, indeks job), lalu daftar job satu emiten dibangun ulang
 * secara deterministik saat dibutuhkan. Hasilnya sama persis tiap kali, jadi
 * crawl aman dilanjutkan setelah service worker dimatikan Chrome.
 */
import { ENDPOINTS, isEndpointEnabled } from '../apiClient.js';
import { resolveDepth } from './depth.js';

/** Universe emiten IDX dibaca dari idx-universe.js (dipakai bersama app.js). */
export async function loadUniverse() {
  try {
    const url = chrome.runtime.getURL('idx-universe.js');
    const text = await (await fetch(url)).text();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end < 0) return [];
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return [];
  }
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}



/**
 * Pecah rentang [from, to] jadi jendela selebar `days`, dari yang PALING BARU
 * ke paling lama. Jendela terakhir dipotong agar tidak melewati `from`.
 *
 * Menggantikan dayWindows/yearWindows yang berbasis "N tahun ke belakang":
 * dengan rentang eksplisit, kedalaman per jenis data dan mode custom tanggal
 * memakai jalur kode yang sama.
 */
export function windowsBetween(days, fromISO, toISO, tradingDaysOnly) {
  const out = [];
  if (!fromISO || !toISO || fromISO > toISO) return out;
  const floor = new Date(fromISO);
  for (const cur = new Date(toISO); cur >= floor; cur.setDate(cur.getDate() - days)) {
    // hari kalender yang bursa tutup dilewati (hanya relevan saat days === 1)
    if (tradingDaysOnly && days === 1) {
      const dw = cur.getDay();
      if (dw === 0 || dw === 6) continue;
    }
    const wEnd = cur.toISOString().slice(0, 10);
    const s = new Date(cur);
    s.setDate(s.getDate() - days + 1);
    out.push({ start: s < floor ? fromISO : s.toISOString().slice(0, 10), end: wEnd });
  }
  return out;
}

function baseCtx(settings, market) {
  return { settings, market: market || {}, today: todayISO() };
}

/**
 * Tanggal paling awal yang ADA DATANYA untuk satu emiten.
 *
 * Dua sumber, yang paling akhir menang:
 *   - `listedAt`  : tanggal pencatatan dari idx-universe.js (gratis, tanpa request)
 *   - `firstBar`  : bar tertua yang benar-benar dikembalikan chart (empiris,
 *                   menutup kasus emiten baru yang belum ada di daftar universe)
 *
 * Tanpa ini, emiten yang baru IPO (mis. JECX, Juli 2026) tetap ditarik broker
 * summary-nya sampai setahun ke belakang — ratusan request untuk tanggal yang
 * sahamnya bahkan belum tercatat.
 */
export function earliestDataDate(symbol, market) {
  const m = market || {};
  const a = (m.listedAt || {})[symbol] || '';
  const b = (m.firstBar || {})[symbol] || '';
  if (a && b) return a > b ? a : b;
  return a || b || '';
}


function expand(ep, ctx) {
  const variants = typeof ep.variants === 'function' ? ep.variants(ctx) : [null];

  let windows = [null];
  if (ep.windowDays || ep.perYear) {
    // Kedalaman diambil dari kelompok endpoint ini (chart / broker /
    // runningTrade / …), bukan dari satu setelan global. Lihat lib/depth.js.
    const depth = resolveDepth(ep.depthKey || 'default', ctx.settings, ctx.today);
    // Jangan menembak tanggal sebelum emitennya tercatat di bursa.
    const floor = ctx.symbol ? earliestDataDate(ctx.symbol, ctx.market) : '';
    const from = floor && floor > depth.from ? floor : depth.from;
    windows = windowsBetween(ep.windowDays || 365, from, depth.to, ep.tradingDaysOnly);
  }
  const jobs = [];
  for (const w of windows) {
    for (const v of variants) {
      const c = { ...ctx, window: w || undefined };
      let req;
      try {
        req = ep.build(c, v || undefined);
      } catch (e) {
        continue;
      }
      if (!req || !req.url) continue;
      jobs.push({
        endpointId: ep.id,
        label: ep.label,
        group: ep.group,
        relay: ep.relay || 'raw',
        symbol: ctx.symbol || (req.meta && req.meta.symbol) || null,
        method: req.method || 'GET',
        url: req.url,
        body: req.body || null,
        meta: { ...(req.meta || {}), ...(v && v.key ? { variant: v.key } : {}), ...(w ? { window: w } : {}) },
        window: w || null,
        needsShareholderToken: !!ep.needsShareholderToken,
        paginate: ep.paginate || null,
        needsTemplate: !!ep.needsTemplate,
      });
    }
  }
  return jobs;
}

/**
 * Endpoint diurutkan berdasarkan `order` (kecil = lebih dulu), bukan urutan
 * penulisannya di katalog. Tujuannya: yang RINGAN dikerjakan lebih dulu,
 * yang berat (broker summary harian, running trade berpaginasi) di akhir —
 * kalau crawl berhenti di tengah jalan, data pokoknya sudah masuk.
 */
function selectEndpoints(scope, phase, ctx, pass) {
  return ENDPOINTS.filter((ep) => {
    if (ep.scope !== scope) return false;
    if (phase && ep.phase !== phase) return false;
    if (pass !== undefined && (ep.pass || 1) !== pass) return false;
    if (!isEndpointEnabled(ep, ctx.settings)) return false;
    if (typeof ep.enabledIf === 'function' && !ep.enabledIf(ctx)) return false;
    return true;
  }).sort((a, b) => (a.order ?? 500) - (b.order ?? 500));
}

/** Job fase discovery + referensi (dijalankan sekali di awal run). */
export function globalJobs(settings, market) {
  const ctx = baseCtx(settings, market);
  const jobs = [];
  for (const ep of selectEndpoints('global', null, ctx)) jobs.push(...expand(ep, ctx));
  return jobs;
}

/** Job profil satu emiten — hasilnya dipakai untuk menentukan tier. */
export function profileJobs(symbol, settings, market) {
  const ctx = { ...baseCtx(settings, market), symbol };
  const jobs = [];
  for (const ep of selectEndpoints('symbol', 'profile', ctx)) jobs.push(...expand(ep, ctx));
  return jobs;
}

/**
 * Job histori mendalam satu emiten. `pass` menyaring tahapnya; tanpa argumen
 * itu, seluruh tahap dikembalikan (dipakai untuk perkiraan total).
 */
export function deepJobs(symbol, settings, market, pass) {
  const ctx = { ...baseCtx(settings, market), symbol };
  const jobs = [];
  for (const ep of selectEndpoints('symbol', 'deep', ctx, pass)) jobs.push(...expand(ep, ctx));
  return jobs;
}

/** Nomor tahap tertinggi yang ada di katalog (biasanya 3). */
export function maxPass() {
  return ENDPOINTS.reduce((m, ep) => Math.max(m, ep.pass || 1), 1);
}

/** Job satu emiten untuk SATU tahap. Fase profil hanya ada di tahap 1. */
export function symbolJobsForPass(symbol, settings, market, pass) {
  const profile = pass === 1 ? profileJobs(symbol, settings, market) : [];
  return [...profile, ...deepJobs(symbol, settings, market, pass)];
}

/** Semua job satu emiten, profil dulu lalu deep. */
export function symbolJobs(symbol, settings, market) {
  return [...profileJobs(symbol, settings, market), ...deepJobs(symbol, settings, market)];
}

export function profileJobCount(settings, market) {
  return profileJobs('XXXX', settings, market).length;
}

/** Perkiraan jumlah request & durasi total — ditampilkan sebelum Start. */
export function estimatePlan(symbols, settings, market) {
  const globals = globalJobs(settings, market).length;
  const profile = profileJobs('XXXX', settings, market).length;
  const deep = deepJobs('XXXX', settings, market).length;

  const avgDelay = ((settings.minDelayMs + settings.maxDelayMs) / 2) / 1000;
  const batchAvg = (settings.batchMin + settings.batchMax) / 2;
  const longAvg = ((settings.longPauseMinMs + settings.longPauseMaxMs) / 2) / 1000;
  const seconds = (n) => n * (avgDelay + 0.6) + (n / batchAvg) * longAvg;

  // Batas bawah: semua emiten tersaring keluar setelah fase profil.
  // Batas atas: semua emiten lolos kategori dan job deep-nya jalan penuh.
  const requestsMin = globals + symbols.length * profile;
  const requestsMax = globals + symbols.length * (profile + deep);

  return {
    symbols: symbols.length,
    globalJobs: globals,
    profileJobs: profile,
    deepJobs: deep,
    jobsPerSymbol: profile + deep,
    requests: requestsMax,
    requestsMin,
    requestsMax,
    estimatedSeconds: Math.round(seconds(requestsMax)),
    estimatedHours: +(seconds(requestsMax) / 3600).toFixed(1),
    estimatedHoursMin: +(seconds(requestsMin) / 3600).toFixed(1),
  };
}

/**
 * Susun daftar emiten yang akan di-crawl.
 * Mode kustom mengalahkan universe; kalau tidak, seluruh universe IDX dipakai
 * dan penyaringan kategori dilakukan belakangan (setelah market cap diketahui).
 */
export async function resolveSymbols(settings) {
  const custom = (settings.customSymbols || [])
    .map((s) => String(s).trim().toUpperCase())
    .filter((s) => /^[A-Z]{2,6}$/.test(s));

  if (settings.customOnly && custom.length) return custom;

  const universe = await loadUniverse();
  let list = universe.map((r) => String(r.code).toUpperCase());
  // emiten yang diketik manual selalu didahulukan
  const head = custom.filter((s) => list.includes(s) || true);
  list = [...new Set([...head, ...list])];
  if (settings.maxSymbols > 0) list = list.slice(0, settings.maxSymbols);
  return list;
}
