/**
 * queue.js — Controlled Crawling Engine.
 *
 * Aturan main (semuanya bisa diatur dari halaman Options):
 *   - concurrency = 1. Satu request pada satu waktu, titik.
 *   - jitter 3–7 detik antar-request (acak, bukan interval tetap).
 *   - istirahat panjang 20–40 detik tiap 15–20 request.
 *   - kena 429/403 -> seluruh antrean tidur 2–5 menit lalu MENGULANG job yang
 *     sama (bukan melompatinya), dan UI diberi tahu.
 *   - kena 401 -> berhenti sementara dan minta user membuka/refresh Stockbit;
 *     token akan tertangkap ulang oleh Auth Interceptor secara pasif.
 *
 * Ketahanan: service worker MV3 bisa dimatikan Chrome kapan saja. Semua posisi
 * antrean ada di storage, jadwal berikutnya disimpan sebagai `nextRunAt`, dan
 * ada alarm watchdog yang membangunkan mesin kalau setTimeout ikut mati
 * bersama service worker-nya.
 */
import { ENGINE_STATUS } from './config.js';
import {
  getSettings, getState, saveState, clearState, addLog,
  mergeClass, getMarket, setMarket, getClasses,
} from './storage.js';
import {
  globalJobs, profileJobs, deepJobs, resolveSymbols, estimatePlan, todayISO, loadUniverse,
  symbolJobsForPass, maxPass,
} from './planner.js';
import { resolveJobUrl } from './templates.js';
import { currentAuth } from './auth.js';
import { fetchCoverage, shouldSkip, clearCoverageCache } from './coverage.js';
import { execRequest, broadcast, activePortCount } from './bridge.js';
import {
  relayResult, relayClassification, flushBuffer, toBars, harvestCompanyIds,
} from './relay.js';
import { URLS } from '../apiClient.js';
import {
  classify, matchesSelection, extractMarketCap, buildSpecialBoardIndex,
  buildMoverIndex, summarizeBrokerFlow, priceStatsFromBars,
} from '../stockCategorizer.js';

export const ALARM_TICK = 'tw_crawler_tick';
export const ALARM_WATCHDOG = 'tw_crawler_watchdog';

let ticking = false;       // kunci in-memory: cegah dua tick bersamaan
let timer = null;
let liquidityCache = { expiresAt: 0, symbols: null };

/**
 * PENYUSURAN CEPAT (fast-skip).
 *
 * Job yang datanya sudah ada di database tidak menembakkan request apa pun,
 * jadi tidak ada alasan ia memakai jeda anti-bot. Dulu tiap skip dijadwalkan
 * ulang 60 ms; pada antrean 570.000 job itu berarti ±9,5 jam HANYA untuk
 * menyusuri ulang data yang sudah lengkap.
 *
 * Sekarang skip dikerjakan borongan di dalam satu tick sampai ketemu job yang
 * benar-benar perlu ditembak. Dua pagar supaya service worker tidak diblokir
 * terlalu lama dan progres di popup tetap bergerak:
 */
const FAST_SKIP_MAX = 2000;   // maksimum job dilewati per tick
const FAST_SKIP_MS = 1500;    // atau maksimum lama satu rombongan

const rand = (min, max) => Math.floor(min + Math.random() * Math.max(1, max - min));

function freshState(symbols) {
  return {
    status: ENGINE_STATUS.RUNNING,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    symbols,
    phase: 'global',
    globalIndex: 0,
    // TAHAP: seluruh emiten diselesaikan tahap 1 dulu (data ringan), baru tahap
    // 2 (broker summary harian), lalu 3 (running trade). Disimpan di state, jadi
    // crawl yang terputus lanjut dari tahap & emiten yang sama.
    pass: 1,
    symbolIndex: 0,
    jobIndex: 0,
    gatePassed: false,
    scratch: {},
    retries: 0,
    batchCount: 0,
    batchTarget: 0,
    nextRunAt: Date.now(),
    cooldownUntil: 0,
    pausedReason: null,
    lastJob: null,
    lastError: null,
    counters: {
      requests: 0, ok: 0, failed: 0, skippedSymbols: 0, relayed: 0, rateLimits: 0,
      skippedExisting: 0,   // job yang datanya sudah ada di database
    },
  };
}

// ---------------------------------------------------------------------------
// Kontrol mesin
// ---------------------------------------------------------------------------

export async function startEngine() {
  const settings = await getSettings();
  const symbols = await resolveSymbols(settings);
  if (!symbols.length) {
    await addLog('error', 'Tidak ada emiten untuk di-crawl. Isi daftar kustom atau pastikan idx-universe.js terbaca.');
    return null;
  }
  const state = freshState(symbols);
  state.batchTarget = rand(settings.batchMin, settings.batchMax);
  clearCoverageCache();   // mulai bersih: baca ulang apa yang sudah ada di DB

  // Tanggal pencatatan dari idx-universe.js — gratis, tanpa request, dan
  // langsung memangkas jendela tanggal emiten yang baru IPO.
  try {
    const universe = await loadUniverse();
    const listedAt = {};
    for (const r of universe) {
      const code = String(r.code || '').toUpperCase();
      if (code && r.listed) listedAt[code] = String(r.listed).slice(0, 10);
    }
    if (Object.keys(listedAt).length) await setMarket({ listedAt });
  } catch (e) { /* tanpa daftar listing crawl tetap jalan, cuma kurang efisien */ }
  await saveState(state);
  const plan = estimatePlan(symbols, settings, await getMarket());
  await addLog('info',
    `Engine start — ${plan.symbols} emiten, ${plan.jobsPerSymbol} job/emiten, total ±${plan.requests} request ` +
    `(perkiraan ±${plan.estimatedHours} jam).`);
  emit(state);
  scheduleNext(state, 1200);
  return state;
}

export async function pauseEngine(reason) {
  const state = await getState();
  if (!state) return null;
  state.status = ENGINE_STATUS.PAUSED;
  state.pausedReason = reason || 'manual';
  await saveState(state);
  clearTimeout(timer);
  await addLog('info', `Engine dijeda (${state.pausedReason}).`);
  emit(state);
  return state;
}

export async function resumeEngine() {
  const state = await getState();
  if (!state) return null;
  state.status = ENGINE_STATUS.RUNNING;
  state.pausedReason = null;
  state.cooldownUntil = 0;
  await saveState(state);
  await addLog('info', 'Engine dilanjutkan.');
  emit(state);
  scheduleNext(state, 800);
  return state;
}

export async function stopEngine() {
  const state = await getState();
  clearTimeout(timer);
  try { await chrome.alarms.clear(ALARM_TICK); } catch (e) {}
  if (state) {
    state.status = ENGINE_STATUS.IDLE;
    state.pausedReason = 'stopped';
    await saveState(state);
    emit(state);
  }
  await addLog('info', 'Engine dihentikan.');
  await clearState();
  emit(null);
  return null;
}

/**
 * Apakah ada antrean tertunda yang layak DILANJUTKAN, bukan dimulai ulang?
 *
 * Dipakai popup sebelum menekan Start. `startEngine()` selalu membuat state
 * baru (`pass 1, symbolIndex 0, jobIndex 0`), jadi menekan Start pada crawl yang
 * baru separuh jalan berarti menyusuri ulang seluruh antrean dari awal —
 * datanya tidak duplikat, tapi waktunya terbuang. Karena itu popup wajib
 * bertanya dulu.
 *
 * `null` = tidak ada yang perlu ditanyakan (belum pernah jalan, sudah selesai,
 * atau kursornya masih di titik nol sehingga "lanjut" = "mulai baru").
 */
export async function resumableInfo() {
  const state = await getState();
  if (!state) return null;
  if (state.status === ENGINE_STATUS.DONE) return null;

  const c = state.counters || {};
  const touched = (c.requests || 0) + (c.skippedExisting || 0) + (state.globalIndex || 0);
  const moved = state.phase !== 'global' || (state.pass || 1) > 1 ||
    state.symbolIndex > 0 || state.jobIndex > 0;
  if (!touched && !moved) return null;

  const p = await getProgress();
  return {
    status: state.status,
    pausedReason: state.pausedReason || null,
    phase: state.phase,
    pass: p.pass, passTotal: p.passTotal,
    symbol: p.symbol, symbolIndex: p.symbolIndex, symbolTotal: p.symbolTotal,
    percent: p.percent,
    requests: c.requests || 0,
    skippedExisting: c.skippedExisting || 0,
    startedAt: state.startedAt || 0,
    updatedAt: state.updatedAt || 0,
  };
}

/** Dipanggil saat tab Stockbit baru terhubung — lanjutkan bila tadi menunggu tab. */
export async function onTabConnected() {
  const state = await getState();
  if (!state) return;
  if (state.status === ENGINE_STATUS.PAUSED && state.pausedReason === 'no-tab') {
    await addLog('info', 'Tab Stockbit terdeteksi — engine dilanjutkan otomatis.');
    await resumeEngine();
  } else {
    emit(state);
  }
}

export async function getProgress() {
  const state = await getState();
  if (!state) return { status: ENGINE_STATUS.IDLE };
  const settings = await getSettings();
  const market = await getMarket();
  // Progres dihitung dari POSISI KURSOR, bukan jumlah request. Endpoint
  // berpaginasi (running trade, historical summary) menembakkan banyak request
  // untuk SATU job, jadi memakai jumlah request membuat progres melewati 100%
  // sementara antreannya masih jalan.
  const globals = globalJobs(settings, market).length;
  const lastPass = maxPass();
  const cur = state.symbols[state.symbolIndex] || 'XXXX';
  // jumlah job per emiten untuk tiap tahap
  const perPass = [];
  for (let p = 1; p <= lastPass; p++) perPass.push(symbolJobsForPass(cur, settings, market, p).length);

  const total = globals + state.symbols.length * perPass.reduce((a, b) => a + b, 0);
  const curPass = state.pass || 1;
  let done = state.phase === 'global' ? Math.min(state.globalIndex, globals) : globals;
  if (state.phase === 'done') {
    done = total;
  } else if (state.phase === 'symbols') {
    for (let p = 1; p < curPass; p++) done += state.symbols.length * perPass[p - 1];
    done += state.symbolIndex * perPass[curPass - 1] + Math.min(state.jobIndex, perPass[curPass - 1]);
  }

  const inCooldown = state.status === ENGINE_STATUS.RUNNING && state.cooldownUntil > Date.now();
  return {
    status: inCooldown ? ENGINE_STATUS.COOLDOWN : state.status,
    phase: state.phase,
    pass: curPass,
    passTotal: lastPass,
    pausedReason: state.pausedReason,
    symbol: state.symbols[state.symbolIndex] || null,
    symbolIndex: state.symbolIndex,
    symbolTotal: state.symbols.length,
    counters: state.counters,
    lastJob: state.lastJob,
    lastError: state.lastError,
    doneMessage: state.doneMessage || null,
    nextRunAt: state.nextRunAt,
    cooldownUntil: state.cooldownUntil,
    startedAt: state.startedAt,
    estimatedTotal: total,
    percent: total ? Math.min(100, Math.round((done / total) * 100)) : 0,
    tabs: activePortCount(),
  };
}

function emit(state) {
  getProgress().then((p) => broadcast({ type: 'PROGRESS', progress: p })).catch(() => {});
}

// ---------------------------------------------------------------------------
// Penjadwalan
// ---------------------------------------------------------------------------

function scheduleNext(state, ms) {
  state.nextRunAt = Date.now() + ms;
  saveState(state).catch(() => {});
  clearTimeout(timer);
  if (ms < 25000) {
    // service worker tetap hidup karena port content script mengirim keepalive
    timer = setTimeout(() => { tick().catch(() => {}); }, ms);
  } else {
    // jeda panjang: biarkan service worker mati, alarm yang membangunkan
    try { chrome.alarms.create(ALARM_TICK, { when: Date.now() + ms }); } catch (e) {}
  }
}

/** Dipanggil alarm watchdog: jalankan tick kalau memang sudah waktunya. */
export async function resumeIfDue() {
  const state = await getState();
  if (!state || state.status !== ENGINE_STATUS.RUNNING) return;
  if (state.cooldownUntil && Date.now() < state.cooldownUntil) return;
  if (state.nextRunAt && Date.now() < state.nextRunAt - 1500) return;
  await tick();
}

// ---------------------------------------------------------------------------
// Pemilihan job
// ---------------------------------------------------------------------------

function advanceSymbol(state) {
  state.symbolIndex++;
  state.jobIndex = 0;
  state.gatePassed = false;
  state.scratch = {};
  state.retries = 0;
}

/**
 * Gerbang kategori: dijalankan tepat setelah fase profil satu emiten selesai.
 * Emiten yang tidak masuk kategori pilihan dilewati SEBELUM job berat
 * (histori 5 tahun) dijalankan — inilah yang membuat crawl tidak membengkak
 * dari ratusan ribu request jadi puluhan ribu.
 */
async function passGate(state, settings, symbol) {
  const market = await getMarket();
  const classification = classify(symbol, {
    marketCap: state.scratch.marketCap,
    specialBoard: market.specialBoard,
    movers: market.movers,
    brokerFlow: state.scratch.brokerFlow,
    priceStats: state.scratch.priceStats,
    thresholds: settings.tierThresholds,
  });
  await mergeClass(symbol, classification);
  const ok = matchesSelection(classification, settings.categories);
  state.gatePassed = ok;
  if (!ok) {
    state.counters.skippedSymbols++;
    await addLog('debug', `${symbol} dilewati — ${classification.tier}${classification.gorengan.is ? '/gorengan' : ''} tidak termasuk kategori pilihan.`);
  }
  relayClassification(classification).catch(() => {});
  return ok;
}

/** Klasifikasi ulang setelah data mendalam terkumpul (lebih akurat). */
async function finalizeSymbol(state, settings, symbol) {
  if (!state.scratch || (!state.scratch.priceStats && !state.scratch.brokerFlow)) return;
  const market = await getMarket();
  const classification = classify(symbol, {
    marketCap: state.scratch.marketCap,
    specialBoard: market.specialBoard,
    movers: market.movers,
    brokerFlow: state.scratch.brokerFlow,
    priceStats: state.scratch.priceStats,
    thresholds: settings.tierThresholds,
  });
  await mergeClass(symbol, classification);
  relayClassification(classification).catch(() => {});
}

async function nextJob(state, settings) {
  const market = await getMarket();

  if (state.phase === 'global') {
    const jobs = globalJobs(settings, market);
    if (state.globalIndex < jobs.length) return jobs[state.globalIndex];
    state.phase = 'symbols';
    state.globalIndex = 0;
    await addLog('info', 'Fase discovery selesai — mulai crawling per emiten (tahap 1).');
  }

  if (state.phase === 'symbols') {
    const lastPass = maxPass();
    let guard = 0;
    while ((state.pass || 1) <= lastPass && guard++ < 20000) {
      const pass = state.pass || 1;

      if (state.symbolIndex >= state.symbols.length) {
        // satu tahap tuntas untuk SELURUH emiten -> naik ke tahap berikutnya
        if (pass >= lastPass) break;
        state.pass = pass + 1;
        state.symbolIndex = 0;
        state.jobIndex = 0;
        state.gatePassed = false;
        state.scratch = {};
        await addLog('info',
          `Tahap ${pass} selesai untuk ${state.symbols.length} emiten — lanjut tahap ${pass + 1} ` +
          `(${pass + 1 === 2 ? 'broker summary harian' : 'running trade'}).`);
        continue;
      }

      const symbol = state.symbols[state.symbolIndex];
      const all = symbolJobsForPass(symbol, settings, market, pass);

      if (state.jobIndex >= all.length) {
        if (pass === 1) await finalizeSymbol(state, settings, symbol);
        advanceSymbol(state);
        continue;
      }

      // Gerbang kategori. Di tahap 1 dijalankan setelah fase profil; di tahap
      // lanjutan hasil klasifikasinya dibaca dari database supaya emiten yang
      // sudah tersaring keluar tidak ditarik ulang datanya yang berat.
      if (pass === 1) {
        const profileCount = profileJobs(symbol, settings, market).length;
        if (state.jobIndex >= profileCount && !state.gatePassed) {
          const ok = await passGate(state, settings, symbol);
          if (!ok) { advanceSymbol(state); continue; }
        }
      } else if (!state.gatePassed) {
        const ok = await passGateFromStore(state, settings, symbol);
        if (!ok) { advanceSymbol(state); continue; }
      }

      return all[state.jobIndex];
    }
    state.phase = 'done';
  }

  return null;
}

/**
 * Gerbang kategori untuk tahap lanjutan: klasifikasi sudah dihitung di tahap 1,
 * jadi cukup dibaca. Emiten yang belum pernah diklasifikasi diloloskan — lebih
 * baik menarik data daripada melewatkannya karena catatan yang hilang.
 */
async function passGateFromStore(state, settings, symbol) {
  const classes = await getClasses();
  const c = classes[symbol];
  let ok = !c || matchesSelection(c, settings.categories);
  // Harga seluruh universe tetap dikumpulkan pada tahap 1. Filter ini sengaja
  // baru berlaku pada tahap 2/3 agar biaya broker flow & running trade hanya
  // dikeluarkan untuk saham yang sedang likuid/menarik perhatian.
  if (ok && settings.liquidityOnlyHeavy && (state.pass || 1) > 1) {
    const candidates = await getLiquidityCandidates(settings);
    if (candidates) ok = candidates.has(symbol);
  }
  state.gatePassed = ok;
  if (!ok) state.counters.skippedSymbols++;
  return ok;
}

async function getLiquidityCandidates(settings) {
  if (liquidityCache.symbols && Date.now() < liquidityCache.expiresAt) return liquidityCache.symbols;
  const base = String(settings.backendUrl || '').replace(/\/+$/, '');
  const limit = Math.max(10, Math.min(900, Number(settings.liquidityCandidateLimit) || 100));
  try {
    const res = await fetch(`${base}/screener/liquidity-candidates?limit=${limit}`, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    const symbols = new Set((Array.isArray(rows) ? rows : []).map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean));
    liquidityCache = { symbols, expiresAt: Date.now() + 15 * 60 * 1000 };
    await addLog('info', `Filter likuiditas: ${symbols.size} kandidat untuk tahap broker flow/running trade.`);
    return symbols;
  } catch (e) {
    // Jangan mendadak melewati universe karena jaringan backend sementara gagal.
    await addLog('warn', `Filter likuiditas tidak bisa dimuat (${e.message || e}); filter dilewati sementara.`);
    return null;
  }
}

function bumpCursor(state) {
  if (state.phase === 'global') state.globalIndex++;
  else state.jobIndex++;
  state.retries = 0;
}

// ---------------------------------------------------------------------------
// Eksekusi satu langkah
// ---------------------------------------------------------------------------

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const state = await getState();
    if (!state || state.status !== ENGINE_STATUS.RUNNING) return;

    if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
      scheduleNext(state, state.cooldownUntil - Date.now() + 500);
      return;
    }

    const settings = await getSettings();

    // Skip dicek di sini — SEBELUM gerbang tab & token — karena melewati job
    // tidak butuh tab Stockbit maupun Bearer token. Efek sampingnya bagus:
    // crawl yang seluruh sisanya sudah ada di DB bisa tuntas tanpa tab terbuka.
    const skipDeadline = Date.now() + FAST_SKIP_MS;
    let skippedNow = 0;
    let job = null;

    for (;;) {
      job = await nextJob(state, settings);
      if (!job || !settings.skipExisting) break;

      // job global (tanpa emiten) dicek terhadap cakupan symbol='' di backend
      const coverage = await fetchCoverage(job.symbol || '');
      const verdict = shouldSkip(job, coverage, settings);
      if (!verdict.skip) break;

      state.counters.skippedExisting++;
      skippedNow++;
      // log ditipiskan: 5 pertama, lalu tiap 500 — menulis log itu 3 operasi
      // storage, kalau per skip justru itu yang jadi hambatannya.
      if (state.counters.skippedExisting <= 5 || state.counters.skippedExisting % 500 === 0) {
        await addLog('debug',
          `${job.endpointId}${job.symbol ? ` (${job.symbol})` : ''} dilewati — ${verdict.reason}.`);
      }
      bumpCursor(state);

      if (skippedNow >= FAST_SKIP_MAX || Date.now() > skipDeadline) {
        // beri napas: simpan posisi, perbarui progres, lanjut di tick berikutnya
        await saveState(state);
        emit(state);
        scheduleNext(state, 0);
        return;
      }
    }
    if (skippedNow) { await saveState(state); emit(state); }

    if (!job) {
      state.status = ENGINE_STATUS.DONE;
      state.updatedAt = Date.now();
      await saveState(state);
      const c = state.counters;
      if (c.requests === 0 && c.skippedExisting > 0) {
        // Inilah "alert" yang diminta: user menjalankan ulang periode yang
        // datanya sudah lengkap, jadi tidak ada satu pun request yang perlu
        // ditembak. Dikatakan terang-terangan supaya tidak terbaca seperti
        // crawl yang gagal.
        state.doneMessage =
          `Semua data untuk periode ini SUDAH ADA di database — ${c.skippedExisting} job dilewati, ` +
          `tidak ada request yang perlu ditarik.`;
      } else if (c.skippedExisting > 0) {
        state.doneMessage =
          `Selesai. ${c.ok} request baru, ${c.skippedExisting} job dilewati karena datanya sudah ada, ` +
          `${c.failed} gagal.`;
      } else {
        state.doneMessage = `Selesai. ${c.ok} request sukses, ${c.failed} gagal.`;
      }
      await saveState(state);
      await addLog('info',
        `${state.doneMessage}${c.skippedSymbols ? ` ${c.skippedSymbols} emiten dilewati kategori.` : ''}`);
      emit(state);
      return;
    }

    if (!activePortCount()) {
      await saveState(state);
      await pauseEngine('no-tab');
      await addLog('warn', 'Tidak ada tab Stockbit yang terbuka. Buka https://stockbit.com lalu Resume.');
      return;
    }

    // GERBANG TOKEN. Tanpa ini, job-job pertama ditembak sebelum Auth
    // Interceptor sempat menangkap Bearer token: semuanya gagal, di-skip
    // permanen, dan datanya hilang untuk seluruh run — persis yang terjadi pada
    // endpoint discovery (special board, market mover, daftar broker) yang
    // kebetulan berada di urutan paling awal antrean.
    const auth = await currentAuth();
    if (!auth || !auth.token) {
      state.nextRunAt = Date.now() + 5000;
      await saveState(state);
      if (!state.waitingAuthLogged) {
        state.waitingAuthLogged = true;
        await addLog('info',
          'Menunggu token Stockbit. Buka/refresh tab Stockbit yang sudah login — ' +
          'token tertangkap otomatis, crawl lanjut sendiri.');
      }
      scheduleNext(state, 5000);
      return;
    }
    state.waitingAuthLogged = false;

    // URL final: template yang dipelajari dari halaman menang atas bentukan
    // katalog, karena parameternya dijamin diterima Exodus.
    const resolved = await resolveJobUrl(job, {
      symbol: job.symbol, window: job.window, today: todayISO(),
    });
    if (!resolved.url) {
      // endpoint yang parameternya belum diketahui — lewati tanpa menembak
      // request yang pasti dibalas 400
      await addLog('debug',
        `${job.endpointId} dilewati: menunggu template. Buka halaman Stockbit terkait sekali ` +
        `supaya bentuk request-nya terpelajari.`);
      bumpCursor(state);
      await saveState(state);
      scheduleNext(state, 250);
      return;
    }
    job.url = resolved.url;

    // token khusus shareholders chart: ambil dulu bila belum ada / sudah basi
    if (job.needsShareholderToken && (!state.scratch.shTokenAt || Date.now() - state.scratch.shTokenAt > 600000)) {
      const t = await execRequest({ method: 'POST', url: URLS.shareholdersToken(), body: {} }, settings.requestTimeoutMs);
      state.counters.requests++;
      if (t && t.ok) state.scratch.shTokenAt = Date.now();
    }

    state.lastJob = {
      endpointId: job.endpointId, label: job.label, symbol: job.symbol,
      url: job.url, at: Date.now(),
    };
    await saveState(state);   // supaya overlay/popup melihat job yang sedang jalan
    emit(state);

    let res;
    try {
      res = job.paginate === 'runningTrade'
        ? await execRunningTradePages(job, settings, state)
        : job.paginate === 'historicalSummary'
        ? await execHistoricalSummaryPages(job, settings, state)
        : await execRequest(
          { method: job.method, url: job.url, body: job.body },
          settings.requestTimeoutMs,
        );
    } catch (e) {
      res = { ok: false, status: 0, error: String(e.message || e) };
    }

    state.counters.requests++;
    state.updatedAt = Date.now();

    // ---- rate limit / blokir ----
    if (res && (res.status === 429 || res.status === 403)) {
      state.counters.rateLimits++;
      const wait = rand(settings.cooldownMinMs, settings.cooldownMaxMs);
      state.cooldownUntil = Date.now() + wait;
      state.lastError = `HTTP ${res.status} — rate limit. Istirahat ${Math.round(wait / 1000)} detik.`;
      // status tetap RUNNING; UI membaca cooldown dari cooldownUntil, sehingga
      // watchdog tetap boleh membangunkan antrean setelah jedanya habis.
      await saveState(state);
      await addLog('warn', `⚠ HTTP ${res.status} pada ${job.endpointId}${job.symbol ? ` (${job.symbol})` : ''}. ` +
        `Antrean tidur ${Math.round(wait / 1000)} detik, job diulang setelahnya (tidak dilewati).`);
      emit(state);
      scheduleNext(state, wait);
      return;
    }

    // ---- 401: milik endpoint ini saja, atau token sesi memang mati? ----
    // Sebagian endpoint butuh token TERSENDIRI di luar Bearer biasa (mis.
    // /emitten-metadata/shareholders/{s}/chart yang minta WebViewToken), dan
    // membalas 401 walau sesi Stockbit sehat. Dulu satu 401 semacam itu
    // MENGHENTIKAN seluruh antrean — crawl SSIA berhenti di 99% cuma karena
    // satu endpoint. Sekarang 401 yang berdiri sendiri dilewati; antrean baru
    // dijeda kalau 401-nya BERUNTUN, yang memang menandakan token kedaluwarsa.
    if (res && res.status === 401) {
      state.auth401 = (state.auth401 || 0) + 1;
      if (state.auth401 >= (settings.auth401Tolerance || 3)) {
        state.lastError = 'HTTP 401 beruntun — token Stockbit kedaluwarsa.';
        await saveState(state);
        await addLog('warn', `Token Stockbit ditolak ${state.auth401}x beruntun. Refresh tab Stockbit, lalu Resume.`);
        await pauseEngine('auth');
        return;
      }
      state.counters.failed++;
      state.lastError = `${job.endpointId}: HTTP 401 (endpoint ini butuh token khusus) — dilewati.`;
      await addLog('warn',
        `${job.endpointId}${job.symbol ? ` (${job.symbol})` : ''} dibalas 401 dan dilewati. ` +
        `Endpoint ini memakai token tersendiri di luar Bearer biasa.`);
      bumpCursor(state);
      await saveState(state);
      scheduleNext(state, rand(settings.minDelayMs, settings.maxDelayMs));
      return;
    }
    if (res && res.ok) state.auth401 = 0;

    if (res && res.ok) {
      state.counters.ok++;
      state.lastError = null;
      await absorb(state, settings, job, res.json);
      try {
        const r = await relayResult(job, res.json);
        if (r && r.ok) state.counters.relayed += r.ok;
      } catch (e) { /* relay tidak pernah menghentikan crawl */ }
      bumpCursor(state);
    } else {
      const err = (res && (res.error || `HTTP ${res.status}`)) || 'unknown';
      if (state.retries < settings.maxRetries) {
        state.retries++;
        await addLog('debug', `Gagal ${job.endpointId}${job.symbol ? ` (${job.symbol})` : ''}: ${err} — percobaan ${state.retries}/${settings.maxRetries}`);
      } else {
        state.counters.failed++;
        state.lastError = `${job.endpointId}: ${err}`;
        await addLog('warn', `Menyerah pada ${job.endpointId}${job.symbol ? ` (${job.symbol})` : ''}: ${err}`);
        bumpCursor(state);
      }
    }

    // ---- pacing ----
    state.batchCount++;
    let delay = rand(settings.minDelayMs, settings.maxDelayMs);
    if (state.batchCount >= state.batchTarget) {
      delay = rand(settings.longPauseMinMs, settings.longPauseMaxMs);
      state.batchCount = 0;
      state.batchTarget = rand(settings.batchMin, settings.batchMax);
      await addLog('debug', `Istirahat panjang ${Math.round(delay / 1000)} detik (${state.counters.requests} request terkirim).`);
      flushBuffer().catch(() => {});
    }

    await saveState(state);
    emit(state);
    scheduleNext(state, delay);
  } finally {
    ticking = false;
  }
}

/**
 * Serap informasi dari respons yang dipakai untuk klasifikasi.
 * Hasil discovery disimpan di storage market (dipakai lintas emiten), hasil
 * per-emiten disimpan di scratch state (dibuang saat pindah emiten).
 */
/**
 * Simpan pemetaan simbol -> company_id. Bersifat menumpuk lintas run: makin
 * sering collector jalan, makin banyak emiten yang graf kepemilikannya bisa
 * ditarik.
 */
async function mergeCompanyIds(found) {
  const market = await getMarket();
  const map = { ...(market.companyIds || {}) };
  let added = 0;
  for (const [sym, cid] of Object.entries(found)) {
    if (map[sym] !== cid) { map[sym] = cid; added++; }
  }
  if (!added) return;
  await setMarket({ companyIds: map });
  await addLog('debug', `Pemetaan company_id bertambah ${added} (total ${Object.keys(map).length} emiten).`);
}

/**
 * Running trade: satu hari bursa TIDAK muat dalam satu respons.
 *
 * Paginasinya memakai CURSOR `trade_number` dari cetakan terakhir — parameter
 * `page` tidak berfungsi (mengembalikan batch yang sama berulang). Halaman
 * ditarik berurutan sampai batch tidak penuh atau cursor berhenti maju, lalu
 * seluruh cetakan digabung jadi satu respons untuk relay.
 *
 * Jeda antar-halaman tetap memakai jitter yang sama dengan antar-job, jadi
 * paginasi ini tidak melanggar pacing anti-bot.
 */
async function execRunningTradePages(job, settings, state) {
  const maxPages = Number(settings.runningTradeMaxPages) || 500;
  const all = [];
  let cursor = null;
  let pages = 0;
  let last = null;

  for (let i = 0; i < maxPages; i++) {
    const url = cursor
      ? `${job.url}${job.url.includes('?') ? '&' : '?'}trade_number=${encodeURIComponent(cursor)}`
      : job.url;
    const res = await execRequest({ method: 'GET', url }, settings.requestTimeoutMs);
    last = res;
    if (i > 0) state.counters.requests++;   // halaman pertama dihitung tick()
    pages++;
    if (!res || !res.ok) break;

    const rows = (res.json && res.json.data && res.json.data.running_trade) || [];
    if (!rows.length) break;
    all.push(...rows);

    const next = rows[rows.length - 1] && rows[rows.length - 1].trade_number;
    if (!next || next === cursor) break;          // cursor tidak maju = akhir hari
    cursor = next;

    await sleep(rand(settings.minDelayMs, settings.maxDelayMs));
  }

  if (!all.length) return last || { ok: false, status: 0, error: 'KOSONG' };
  return {
    ok: true,
    status: 200,
    json: { data: { running_trade: all } },
    meta: { pages, prints: all.length },
  };
}

/**
 * historical/summary: `limit` di atas 12 dibalas 400 INVALID_PARAMETER, jadi
 * satu jendela tahun harus ditarik per halaman (`page=1,2,3,…`). Halaman
 * dijalankan berurutan sampai kosong / tidak penuh, lalu barisnya digabung.
 */
async function execHistoricalSummaryPages(job, settings, state) {
  const maxPages = Number(settings.historicalSummaryMaxPages) || 40;
  const limit = Number(settings.historicalSummaryLimit) || 12;
  const rowsAll = [];
  let last = null;

  for (let page = 1; page <= maxPages; page++) {
    const url = job.url.replace(/([?&])page=\d+/, `$1page=${page}`);
    const res = await execRequest({ method: 'GET', url }, settings.requestTimeoutMs);
    last = res;
    if (page > 1) state.counters.requests++;   // halaman pertama dihitung tick()
    if (!res || !res.ok) break;

    const d = (res.json && res.json.data) || {};
    // `result` adalah kunci yang BENAR-BENAR dipakai Stockbit; sisanya cadangan.
    const rows = Array.isArray(d) ? d
      : (['result', 'results', 'items', 'historical_summary']
        .map((k) => d[k]).find((v) => Array.isArray(v) && v.length) || []);
    if (!rows.length) break;
    rowsAll.push(...rows);

    // Stockbit memberi cursor halaman berikutnya secara eksplisit; itu yang
    // dipakai. Panjang halaman cuma cadangan kalau paginate tidak dikirim.
    const next = d.paginate && Number(d.paginate.next_page);
    if (next) {
      if (next <= page) break;                 // tidak maju = habis
    } else if (rows.length < limit) {
      break;
    }

    await sleep(rand(settings.minDelayMs, settings.maxDelayMs));
  }

  if (!rowsAll.length) return last || { ok: false, status: 0, error: 'KOSONG' };
  // dibungkus ulang memakai kunci ASLI (`result`) supaya parser di backend
  // mengenalinya — dulu dibungkus sebagai `historical_summary` dan backend
  // tidak menemukan apa pun, sehingga tabelnya tetap kosong.
  return { ok: true, status: 200, json: { data: { result: rowsAll } } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function absorb(state, settings, job, payload) {
  if (!payload) return;
  try {
    switch (job.endpointId) {
      case 'special_board': {
        const idx = buildSpecialBoardIndex(payload);
        await setMarket({ specialBoard: idx });
        await addLog('info', `Papan Pemantauan Khusus: ${idx.symbols.length} emiten terdeteksi.`);
        break;
      }
      case 'market_mover': {
        const market = await getMarket();
        const merged = { ...(market.movers || {}) };
        const idx = buildMoverIndex([{ moverType: (job.meta && job.meta.moverType) || '', payload }]);
        for (const [sym, rec] of Object.entries(idx)) {
          const prev = merged[sym];
          merged[sym] = prev
            ? { ...prev, ...rec, moverTypes: [...new Set([...(prev.moverTypes || []), ...rec.moverTypes])] }
            : rec;
        }
        await setMarket({ movers: merged });
        break;
      }
      case 'trending': {
        // Satu-satunya endpoint yang membawa company_id bersama simbolnya.
        // Tanpa pemetaan ini, graf kepemilikan KSEI tidak bisa dipanggil sama
        // sekali — endpointnya di-key company_id, bukan simbol.
        const arr = Array.isArray(payload && payload.data) ? payload.data : [];
        const found = {};
        for (const it of arr) {
          const sym = String(it.symbol || '').toUpperCase();
          const cid = Number(it.company_id);
          if (sym && cid) found[sym] = cid;
        }
        if (Object.keys(found).length) await mergeCompanyIds(found);
        break;
      }
      case 'shareholding_network': {
        // Tiap graf mengajarkan company_id emiten lain yang tersentuh di tepi,
        // jadi cakupannya bertambah tiap crawl alih-alih mulai dari nol.
        const found = harvestCompanyIds(payload);
        if (Object.keys(found).length) await mergeCompanyIds(found);
        // Graf tanpa edge = emiten itu memang belum punya data KSEI di
        // Stockbit. Dicatat terang-terangan supaya "tabel shareholding kosong"
        // tidak terbaca sebagai kegagalan collector.
        const edges = ((payload && payload.data && payload.data.edges) || []).length;
        if (!edges) {
          await addLog('warn',
            `${job.symbol}: graf kepemilikan KSEI kosong (0 edge) — Stockbit belum punya data ` +
            `pemegang saham untuk emiten ini.`);
        }
        break;
      }
      case 'keystats': {
        const mcap = extractMarketCap(payload);
        if (mcap > 0) state.scratch.marketCap = mcap;
        break;
      }
      case 'info': {
        if (!state.scratch.marketCap) {
          const mcap = extractMarketCap(payload);
          if (mcap > 0) state.scratch.marketCap = mcap;
        }
        // `data.id` di endpoint info = company_id emiten ini. Sumber pemetaan
        // yang JAUH lebih andal daripada /emitten/trending (yang cuma memuat
        // segelintir saham trending) — tanpa ini graf kepemilikan KSEI tidak
        // pernah jalan untuk emiten di luar daftar trending.
        const cid = Number(payload && payload.data && payload.data.id);
        if (job.symbol && Number.isFinite(cid) && cid > 0) {
          await mergeCompanyIds({ [job.symbol]: cid });
        }
        break;
      }
      case 'charts_daily': {
        const bars = toBars(payload);
        const stats = priceStatsFromBars(bars);
        if (stats) state.scratch.priceStats = stats;
        // Bar tertua yang benar-benar dikembalikan = tanggal data paling awal.
        // Dipakai memangkas jendela endpoint berikutnya (broker summary harian,
        // running trade, dsb) supaya tidak menembak tanggal sebelum emiten IPO.
        if (bars.length && job.symbol) {
          const oldest = bars.reduce((a, b) => (a && a < b.date ? a : b.date), bars[0].date);
          const market = await getMarket();
          const firstBar = { ...(market.firstBar || {}) };
          if (!firstBar[job.symbol] || oldest > firstBar[job.symbol]) {
            firstBar[job.symbol] = oldest;
            await setMarket({ firstBar });
            await addLog('info', `${job.symbol}: data paling awal ${oldest} — jendela sebelum tanggal itu dilewati.`);
          }
        }
        break;
      }
      case 'marketdetectors': {
        const flow = summarizeBrokerFlow(payload);
        if (flow) state.scratch.brokerFlow = flow;
        break;
      }
      default:
        break;
    }
  } catch (e) { /* penyerapan bersifat bonus — jangan pernah menggagalkan job */ }
}

export { tick };
