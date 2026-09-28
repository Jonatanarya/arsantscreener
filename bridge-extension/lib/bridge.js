/**
 * bridge.js — jembatan service worker <-> tab Stockbit.
 *
 * KENAPA request tidak di-fetch langsung dari service worker:
 * fetch dari service worker berjalan atas nama origin extension. Origin,
 * Referer, urutan header, dan Sec-Fetch-* nya BERBEDA dengan request asli
 * aplikasi web Stockbit — persis pola yang dicari WAF (Cloudflare/Sentinel)
 * untuk menandai lalu lintas non-browser.
 *
 * Karena itu service worker hanya mengatur ANTREAN; eksekusi fetch-nya
 * dititipkan ke tab Stockbit yang sedang terbuka (content.js -> pageAgent.js di
 * MAIN world). Di sana request keluar dari konteks halaman itu sendiri:
 * User-Agent, Referer https://stockbit.com/, cookie, dan seluruh header
 * otomatis identik dengan request yang dibuat Stockbit sendiri.
 */

const ports = new Set();
const pending = new Map();
let seq = 0;

export function registerPort(port) {
  ports.add(port);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    // batalkan request yang menggantung di port ini
    for (const [id, p] of pending) {
      if (p.port === port) {
        pending.delete(id);
        p.reject(new Error('TAB_CLOSED'));
      }
    }
  });
}

export function activePortCount() {
  return ports.size;
}

/** Port yang paling belakang terdaftar biasanya tab yang paling baru aktif. */
function anyPort() {
  let last = null;
  for (const p of ports) last = p;
  return last;
}

export function handleExecResult(msg) {
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  p.resolve(msg.result);
}

/**
 * Jalankan satu request lewat tab Stockbit.
 * Mengembalikan {ok, status, json, text, error}.
 */
export function execRequest(req, timeoutMs = 25000) {
  const port = anyPort();
  if (!port) return Promise.reject(new Error('NO_STOCKBIT_TAB'));
  const id = `r${++seq}_${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, status: 0, error: 'TIMEOUT' });
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, port });
    try {
      port.postMessage({ type: 'EXEC', id, req });
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error('PORT_ERROR'));
    }
  });
}

/** Kirim status terbaru ke semua overlay yang terhubung. */
export function broadcast(message) {
  for (const p of ports) {
    try { p.postMessage(message); } catch (e) { /* port sudah mati */ }
  }
}
