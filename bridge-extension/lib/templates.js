/**
 * templates.js — belajar bentuk request asli dari halaman Stockbit.
 *
 * MASALAHNYA: sebagian endpoint Exodus menolak request kalau satu saja nilai
 * enum-nya meleset ("Your request is invalid"), dan nama enum itu tidak
 * terdokumentasi serta berubah sewaktu-waktu. Menebaknya satu per satu adalah
 * pekerjaan yang tidak pernah selesai.
 *
 * SOLUSINYA: jangan menebak. interceptor.js sudah mencatat SETIAP URL API yang
 * dipanggil halaman Stockbit saat user browsing biasa. URL itu — menurut
 * definisi — memakai kombinasi parameter yang benar. Jadi collector cukup
 * menyalinnya sebagai template, lalu mengganti bagian yang memang perlu diganti:
 * kode emiten dan rentang tanggal. Seluruh parameter lain dibiarkan APA ADANYA.
 *
 * Ini pola yang sama yang sudah dipakai app.js untuk broker summary (`S.brokerUrl`)
 * dan candle harian (`S.dailyUrl`), sekarang digeneralisasi untuk semua endpoint.
 */
import { ENDPOINTS } from '../apiClient.js';
import { addLog } from './storage.js';

const KEY = 'tw_url_templates';

// Nama parameter tanggal yang boleh ditulis ulang. Selain yang ada di daftar
// ini, nilai parameter template tidak pernah disentuh.
const DATE_FROM_KEYS = ['from', 'date_from', 'start_date', 'period_start', 'startdate'];
const DATE_TO_KEYS = ['to', 'date_to', 'end_date', 'period_end', 'enddate'];
const DATE_SINGLE_KEYS = ['date'];
const SYMBOL_KEYS = ['symbol', 'symbols', 'symbols[]', 'company', 'companies', 'code', 'stock'];

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Template yang tersimpan divalidasi ULANG terhadap pola yang berlaku sekarang.
 * Pola bisa diperketat lewat update extension (pernah ada pola yang terlalu
 * longgar sehingga URL salah ikut terpelajari); template yang tidak lagi cocok
 * dibuang otomatis, jadi tidak ada sisa keliru yang menempel selamanya.
 */
export async function getTemplates() {
  const raw = (await chrome.storage.local.get(KEY))[KEY] || {};
  const valid = {};
  let dropped = 0;
  for (const [id, tpl] of Object.entries(raw)) {
    const ep = ENDPOINTS.find((e) => e.id === id);
    if (ep && ep.match && tpl && ep.match.test(tpl.url)) valid[id] = tpl;
    else dropped++;
  }
  if (dropped) {
    await setTemplates(valid);
    await addLog('warn', `${dropped} template lama dibuang karena tidak cocok lagi dengan pola endpoint.`);
  }
  return valid;
}

async function setTemplates(map) {
  await chrome.storage.local.set({ [KEY]: map });
}

/**
 * Cocokkan satu URL dengan endpoint di katalog — bisa lebih dari satu.
 * Contoh: /chartbit/BBCA/price/daily melayani `charts_daily` (per emiten)
 * SEKALIGUS `ihsg_daily` (global), jadi keduanya harus ikut belajar dari URL
 * yang sama.
 */
export function matchEndpoints(url) {
  const out = [];
  for (const ep of ENDPOINTS) {
    if (ep.match && ep.match.test(url)) out.push(ep.id);
  }
  return out;
}

/**
 * Pelajari URL yang tertangkap interceptor. Dipanggil dari background saat
 * content script mengirim daftar URL yang dilihatnya.
 * Mengembalikan daftar endpoint yang BARU dipelajari (untuk dicatat di log).
 */
export async function learnFromUrls(urls) {
  if (!Array.isArray(urls) || !urls.length) return [];
  const map = await getTemplates();
  const learned = [];

  for (const url of urls) {
    if (typeof url !== 'string' || !/stockbit\.com/i.test(url)) continue;
    for (const id of matchEndpoints(url)) {
      const prev = map[id];
      // template baru menang kalau belum ada, atau kalau yang lama sudah usang
      // (halaman bisa mengganti parameter setelah update aplikasi)
      if (prev && prev.url === url) continue;
      map[id] = { url, learnedAt: Date.now() };
      if (!prev) learned.push(id);
    }
  }

  if (Object.keys(map).length) await setTemplates(map);
  if (learned.length) {
    await addLog('info', `Template request dipelajari dari halaman: ${learned.join(', ')}`);
  }
  return learned;
}

/**
 * Tulis ulang template jadi URL untuk emiten & jendela tanggal yang diminta.
 *
 * Yang diganti HANYA: segmen simbol di path, parameter simbol, dan parameter
 * tanggal. Sisanya (enum, limit, flag, apa pun) dibiarkan persis seperti yang
 * dikirim halaman — itulah inti dari pendekatan ini.
 */
export function applyTemplate(templateUrl, ctx) {
  let u;
  try {
    u = new URL(templateUrl);
  } catch (e) {
    return null;
  }

  const symbol = ctx.symbol ? String(ctx.symbol).toUpperCase() : null;

  // 1. simbol di path: /marketdetectors/BBCA -> /marketdetectors/AALI.
  //    Hanya segmen yang seluruhnya huruf kapital yang diganti; path Exodus
  //    lainnya selalu huruf kecil ("company-price-feed", "price", "daily"),
  //    jadi tidak ada yang salah sasaran. IHSG ikut diganti — template dari
  //    halaman indeks pun bisa dipakai ulang untuk emiten biasa.
  if (symbol) {
    u.pathname = u.pathname
      .split('/')
      .map((seg) => (/^[A-Z][A-Z0-9-]{1,5}$/.test(seg) ? symbol : seg))
      .join('/');
  }

  // 2. parameter simbol
  if (symbol) {
    for (const key of SYMBOL_KEYS) {
      if (u.searchParams.has(key)) {
        u.searchParams.delete(key);
        u.searchParams.append(key, symbol);
      }
    }
  }

  // 3. tanggal. Orientasi template dipertahankan: endpoint chartbit memakai
  //    from = tanggal TERBARU dan to = tanggal TERLAMA, endpoint lain sebaliknya.
  //    Alih-alih menghafal mana yang mana, arah aslinya dibaca dari template.
  if (ctx.window && ctx.window.start && ctx.window.end) {
    const origFrom = firstValue(u, DATE_FROM_KEYS);
    const origTo = firstValue(u, DATE_TO_KEYS);
    const reversed = ISO_RE.test(origFrom || '') && ISO_RE.test(origTo || '') && origFrom > origTo;
    const fromVal = reversed ? ctx.window.end : ctx.window.start;
    const toVal = reversed ? ctx.window.start : ctx.window.end;
    setIfPresent(u, DATE_FROM_KEYS, fromVal);
    setIfPresent(u, DATE_TO_KEYS, toVal);
  }
  if (ctx.today) setIfPresent(u, DATE_SINGLE_KEYS, ctx.today);

  return u.toString();
}

function firstValue(u, keys) {
  for (const k of keys) {
    const v = u.searchParams.get(k);
    if (v) return v;
  }
  return null;
}

function setIfPresent(u, keys, value) {
  for (const k of keys) {
    if (u.searchParams.has(k)) u.searchParams.set(k, value);
  }
}

/**
 * URL final satu job: pakai template bila ada, kalau tidak pakai bentukan
 * katalog. Endpoint bertanda `needsTemplate` TIDAK dijalankan tanpa template —
 * lebih baik dilewati daripada menghabiskan jatah request untuk error 400.
 */
export async function resolveJobUrl(job, ctx) {
  const ep = ENDPOINTS.find((e) => e.id === job.endpointId);
  const map = await getTemplates();
  const tpl = map[job.endpointId];

  if (tpl) {
    const url = applyTemplate(tpl.url, ctx);
    // Jaring pengaman: kalau job ini per-emiten, URL hasil template WAJIB
    // menyebut emitennya. Kalau tidak, template-nya salah cocok (pernah terjadi:
    // pola /marketdetectors/{SYM} ikut mencocoki /findata-view/marketdetectors/brokers,
    // sehingga collector menarik daftar broker untuk SETIAP emiten) — lebih baik
    // jatuh ke bentukan katalog daripada menyimpan data yang salah diam-diam.
    if (url && (!ctx.symbol || url.toUpperCase().includes(String(ctx.symbol).toUpperCase()))) {
      return { url, source: 'template' };
    }
  }
  if (ep && ep.needsTemplate) return { url: null, source: 'menunggu-template' };
  return { url: job.url, source: 'katalog' };
}

/** Endpoint yang masih menunggu template (ditampilkan di UI). */
export async function pendingTemplates() {
  const map = await getTemplates();
  return ENDPOINTS.filter((e) => e.needsTemplate && !map[e.id]).map((e) => ({ id: e.id, label: e.label }));
}
