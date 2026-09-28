/**
 * Auth Interceptor — penangkap Bearer token & cookie Stockbit secara PASIF.
 *
 * Tidak pernah login, tidak pernah menyentuh form, tidak pernah memancing
 * request tambahan. Token muncul dengan sendirinya saat user memakai Stockbit
 * seperti biasa; modul ini hanya menguping.
 *
 * Tiga sumber, digabung, yang paling segar menang:
 *   1. chrome.webRequest.onBeforeSendHeaders  -> header Authorization asli
 *      dari request halaman (paling andal, jalan walau tab di background).
 *   2. chrome.cookies                          -> cookie domain stockbit.com
 *      (dipakai untuk cek status login, bukan untuk dikirim manual).
 *   3. pesan dari content script                -> token hasil tangkapan
 *      interceptor.js di MAIN world (termasuk JWT segar dari frame WebSocket,
 *      yang justru paling awet karena diperbarui terus selama sesi).
 *
 * Semua fetch data TIDAK dijalankan dari sini — lihat lib/queue.js: request
 * dieksekusi di dalam tab Stockbit (MAIN world) supaya User-Agent, Sec-Fetch-*,
 * Origin, dan Referer identik dengan request asli halaman.
 */
import { getAuth, setAuth, addLog } from './storage.js';

const HOSTS = ['https://exodus.stockbit.com/*', 'https://*.stockbit.com/*', 'https://stockbit.com/*'];

// Header non-standar yang ikut dikirim aplikasi web Stockbit. Ditiru apa adanya
// saat replay supaya sidik jari request tidak berbeda dari milik halaman.
const MIRROR_HEADERS = [
  'authorization', 'x-app-version', 'x-platform', 'x-device-id',
  'x-request-id', 'x-source', 'x-api-key',
];

let lastPersist = 0;
let pending = null;

function decodeJwtExp(bearer) {
  try {
    const jwt = String(bearer || '').replace(/^bearer\s+/i, '');
    const part = jwt.split('.')[1];
    if (!part) return 0;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return Number(json.exp || 0) * 1000;
  } catch (e) {
    return 0;
  }
}

export function isExpired(auth, skewMs = 60000) {
  if (!auth || !auth.token) return true;
  if (!auth.exp) return false;  // token tanpa exp: anggap masih hidup
  return Date.now() + skewMs >= auth.exp;
}

/** Simpan token baru bila memang lebih segar dari yang tersimpan. */
export async function noteToken(token, source) {
  if (!token || !/^bearer\s+\S+/i.test(token)) return null;
  const exp = decodeJwtExp(token);
  const cur = await getAuth();
  if (cur && cur.token === token) return cur;
  // token lama (exp lebih kecil) tidak boleh menimpa yang lebih baru
  if (cur && cur.exp && exp && exp < cur.exp) return cur;
  const next = { ...(cur || {}), token, exp, source, capturedAt: Date.now() };
  await setAuth(next);
  await addLog('info', `Token Stockbit diperbarui (${source})${exp ? ` — kedaluwarsa ${new Date(exp).toLocaleString('id-ID')}` : ''}`);
  return next;
}

/** Simpan header tambahan hasil sadapan (dipakai untuk emulasi header). */
export async function noteHeaders(map) {
  if (!map || !Object.keys(map).length) return;
  const cur = (await getAuth()) || {};
  const headers = { ...(cur.headers || {}), ...map };
  await setAuth({ ...cur, headers });
}

export async function currentAuth() {
  return getAuth();
}

/** Cookie login (sb_sess / dsl / _ga dst) hanya dipakai sebagai indikator sesi. */
export async function hasSessionCookie() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: 'stockbit.com' });
    return cookies.some((c) => /sess|token|auth|sid/i.test(c.name) && c.value);
  } catch (e) {
    return false;
  }
}

/**
 * Pasang penyadap header. Dipanggil sekali saat service worker start.
 * Listener non-blocking (tanpa "blocking" di extraInfoSpec) — MV3 memang tidak
 * mengizinkan yang blocking, dan kita tidak butuh: cukup mengamati.
 */
export function installAuthInterceptor() {
  if (!chrome.webRequest || !chrome.webRequest.onBeforeSendHeaders) return;
  const spec = ['requestHeaders'];
  // extraHeaders diperlukan agar header Cookie/Authorization tidak disembunyikan
  // Chrome pada beberapa jenis request.
  try {
    if (chrome.webRequest.OnBeforeSendHeadersOptions &&
        chrome.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS) {
      spec.push('extraHeaders');
    }
  } catch (e) { /* versi Chrome lama: abaikan */ }

  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      try {
        const map = {};
        let token = null;
        for (const h of details.requestHeaders || []) {
          const name = String(h.name || '').toLowerCase();
          if (name === 'authorization') token = h.value;
          else if (MIRROR_HEADERS.includes(name) && h.value) map[name] = h.value;
        }
        if (token) queueToken(token, 'webRequest');
        if (Object.keys(map).length) noteHeaders(map).catch(() => {});
      } catch (e) { /* jangan pernah melempar dari listener */ }
    },
    { urls: HOSTS },
    spec,
  );
}

// Header disadap sangat sering (tiap request halaman). Tulis ke storage
// di-debounce supaya tidak membanjiri I/O storage.
function queueToken(token, source) {
  pending = { token, source };
  const now = Date.now();
  if (now - lastPersist < 2000) return;
  lastPersist = now;
  const p = pending;
  pending = null;
  noteToken(p.token, p.source).catch(() => {});
}
