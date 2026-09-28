/**
 * pageAgent.js — eksekutor request di MAIN world halaman Stockbit.
 *
 * Berjalan di dalam konteks halaman, jadi setiap fetch yang dikirim dari sini
 * TIDAK BISA dibedakan dari request yang dibuat aplikasi Stockbit sendiri:
 * User-Agent, Referer, Origin, Sec-Fetch-Site/Mode/Dest, urutan header, sampai
 * TLS fingerprint-nya sama persis. Itulah inti strategi anti-deteksi di sini —
 * bukan memalsukan header, tapi memakai konteks yang memang asli.
 *
 * Protokol (window.postMessage, origin dikunci ke halaman ini):
 *   masuk : {__TW_AGENT:'req', id, req:{method,url,body,timeoutMs}}
 *   keluar: {__TW_AGENT:'res', id, result:{ok,status,json,text,error}}
 *   keluar: {__TW_AGENT:'auth', token}   (setiap token baru tertangkap)
 */
(() => {
  if (window.__TW_AGENT_READY) return;
  window.__TW_AGENT_READY = true;

  // interceptor.js dan pageAgent.js diinjeksi sebagai dua entri content_scripts
  // terpisah, jadi state-nya dibaca ulang tiap kali (bukan di-cache sekali di
  // awal) supaya tidak bergantung pada urutan injeksi.
  const state = () => window.__BM_STATE || null;

  const authHeader = () => {
    try {
      const S = state();
      if (S && S.auth) return S.auth;
    } catch (e) {}
    // cadangan: token yang tersimpan di localStorage aplikasi
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/tok|auth|access|jwt/i.test(k)) continue;
        const v = localStorage.getItem(k);
        if (v && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v)) return `Bearer ${v}`;
      }
    } catch (e) {}
    return null;
  };

  const post = (payload) => {
    try { window.postMessage(payload, location.origin); } catch (e) {}
  };

  // Teruskan token setiap kali interceptor menangkap yang baru. Kalau
  // interceptor belum sempat memasang state-nya, coba lagi beberapa kali.
  let hooked = false;
  const hookAuthEvents = () => {
    if (hooked) return true;
    const S = state();
    if (!S || !S.events) return false;
    S.events.addEventListener('auth', () => post({ __TW_AGENT: 'auth', token: S.auth }));
    hooked = true;
    post({ __TW_AGENT: 'auth', token: S.auth });
    return true;
  };
  if (!hookAuthEvents()) {
    let tries = 0;
    const iv = setInterval(() => {
      if (hookAuthEvents() || ++tries > 20) clearInterval(iv);
    }, 500);
  }

  async function run(req) {
    const url = String(req.url || '');
    const sameOrigin = (() => {
      try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
    })();

    const headers = { accept: 'application/json, text/plain, */*' };
    const auth = authHeader();
    if (auth) headers.authorization = auth;

    const init = {
      method: req.method || 'GET',
      headers,
      // exodus memakai CORS wildcard: request ber-cookie ditolak browser.
      // Untuk URL stockbit.com sendiri (mis. /_next/data) cookie justru wajib.
      credentials: sameOrigin ? 'same-origin' : 'omit',
      cache: 'no-store',
      referrer: location.href,
    };
    if (req.body && init.method !== 'GET') {
      init.headers['content-type'] = 'application/json';
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Number(req.timeoutMs) || 25000);
    init.signal = ctrl.signal;

    try {
      const res = await fetch(url, init);
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* bukan JSON */ }
      return {
        ok: res.ok,
        status: res.status,
        json,
        text: json ? undefined : text.slice(0, 4000),
      };
    } catch (e) {
      const aborted = e && e.name === 'AbortError';
      return { ok: false, status: 0, error: aborted ? 'TIMEOUT' : String((e && e.message) || e) };
    } finally {
      clearTimeout(timer);
    }
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__TW_AGENT !== 'req' || !d.id) return;
    run(d.req || {}).then((result) => {
      post({ __TW_AGENT: 'res', id: d.id, result });
    });
  });

  // beri tahu content script bahwa agent siap (sekaligus kirim token awal)
  post({ __TW_AGENT: 'ready', token: authHeader() });

  // ---- pelaporan URL yang terlihat (bahan belajar template) ----
  // interceptor.js mencatat setiap URL API Stockbit yang dipanggil halaman ke
  // S.seen. URL itu memakai kombinasi parameter yang PASTI benar, jadi
  // collector menyalinnya sebagai template alih-alih menebak nilai enum.
  // Yang dikirim hanya URL-nya — tanpa isi respons, tanpa header.
  let seenSent = 0;
  setInterval(() => {
    try {
      const S = state();
      if (!S || !Array.isArray(S.seen)) return;
      if (S.seen.length <= seenSent) {
        if (S.seen.length < seenSent) seenSent = 0;  // ring buffer sudah diputar
        return;
      }
      const batch = S.seen.slice(seenSent).map((r) => r.url).filter(Boolean);
      seenSent = S.seen.length;
      if (batch.length) post({ __TW_AGENT: 'seen', urls: batch });
    } catch (e) {}
  }, 5000);
})();
