/**
 * Brokermology — interceptor (berjalan di MAIN world, document_start, semua frame)
 *
 * Tugas: menangkap dari lalu-lintas jaringan halaman Stockbit:
 *  1. Header Authorization (Bearer token)
 *  2. URL request Broker Summary sebagai template (untuk di-replay dengan tanggal lain)
 *  3. URL datafeed candle TradingView (/history?symbol=...)
 *  4. Respons OHLC pasif (bentuk UDF: {t,o,h,l,c,v})
 *
 * Tiga lapis penangkap agar tidak ada yang lolos:
 *  - patch window.fetch
 *  - patch XMLHttpRequest
 *  - PerformanceObserver (melihat SEMUA request frame ini, termasuk yang dibuat
 *    oleh service worker / kode yang menyimpan referensi fetch asli)
 *
 * Frame anak (iframe same-origin, mis. chart TradingView) memakai state milik
 * frame paling atas supaya semua tangkapan terkumpul di satu tempat.
 */
(() => {
  // pakai state frame teratas bila bisa diakses (same-origin)
  let S = null;
  try {
    if (window.top !== window && window.top.__BM_STATE) S = window.top.__BM_STATE;
  } catch (e) {}
  if (!S) S = window.__BM_STATE || null;
  if (!S) {
    S = {
      auth: null,          // nilai header Authorization terakhir
      brokerUrl: null,     // template URL broker summary
      historyUrl: null,    // template URL datafeed candle (gaya UDF, cadangan)
      dailyUrl: null,      // template URL candle harian chartbit (/price/daily)
      bars: {},            // simbol -> {resolution, bars:[...]} (tangkapan pasif)
      lastSummary: null,   // respons broker summary terakhir (debug)
      seen: [],            // ring buffer URL API stockbit yang terlihat (diagnosa)
      events: new EventTarget(),
    };
  }
  if (window.__BM_STATE === S && window.__BM_STATE.__patched) return;
  window.__BM_STATE = S;

  const emit = (name) => {
    try { S.events.dispatchEvent(new Event(name)); } catch (e) {}
  };

  const noteAuth = (val) => {
    if (val && /^bearer\s/i.test(String(val))) {
      if (S.auth !== val) { S.auth = val; emit('auth'); }
    }
  };

  const headerFrom = (headers, name) => {
    try {
      if (!headers) return null;
      if (typeof headers.get === 'function') return headers.get(name);
      if (Array.isArray(headers)) {
        const hit = headers.find((h) => String(h[0]).toLowerCase() === name);
        return hit ? hit[1] : null;
      }
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === name) return headers[k];
      }
    } catch (e) {}
    return null;
  };

  const isStockbit = (url) => /(^|\/\/)([a-z0-9-]+\.)*stockbit\.com/i.test(url || '') || (url || '').startsWith('/');

  // broker summary: exodus /marketdetectors/SYMBOL?... atau /findata-view/marketdetectors/brokers?...
  const isBrokerSummaryUrl = (url) =>
    /marketdetector/i.test(url) && !/activity|top-?broker|seasonality|hotlist/i.test(url);

  const noteUrl = (url, via) => {
    if (!url) return;
    try {
      const abs = new URL(url, location.href).toString();
      if (!/stockbit\.com/i.test(abs)) return;
      // ring buffer untuk diagnosa (hanya URL API, bukan aset statis)
      if (/exodus|api[.-]|findata|marketdetector|\/history\?|order-trade/i.test(abs)) {
        S.seen.push({ t: Date.now(), via, url: abs });
        if (S.seen.length > 250) S.seen.splice(0, 50);
      }
      if (isBrokerSummaryUrl(abs)) {
        S.brokerUrl = abs;
        emit('template');
      }
      if (/\/history\?/.test(abs) && /symbol=/.test(abs) && /resolution=/.test(abs)) {
        S.historyUrl = abs;
        emit('history');
      }
      if (/chartbit\/[A-Z0-9-]+\/price\/daily/i.test(abs)) {
        S.dailyUrl = abs;
        emit('daily');
      }
      if (/orderbook\/companies\/[A-Z0-9-]+/i.test(abs)) {
        S.orderbookUrl = abs;
        emit('orderbook');
      }
    } catch (e) {}
  };

  const noteJson = (url, json) => {
    try {
      if (!json) return;
      if (isBrokerSummaryUrl(url)) S.lastSummary = { url, json };
      // Respons candle harian chartbit: data.chartbit[{date, unixdate, open, ...}]
      const cb = json.data && Array.isArray(json.data.chartbit) ? json.data.chartbit : null;
      if (cb && cb.length && cb[0] && cb[0].date && cb[0].close != null) {
        const m = url.match(/chartbit\/([A-Z0-9-]+)\/price\/daily/i);
        if (m) {
          const bars = cb
            .map((r) => ({
              t: +r.unixdate, o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume || 0, iso: r.date,
              freq: +r.frequency || 0,
              fbuy: +r.foreignbuy || 0, fsell: +r.foreignsell || 0,
              fflow: +r.foreignflow || 0, // kumulatif, bukan harian
            }))
            .sort((a, b) => a.t - b.t);
          S.bars[m[1].toUpperCase()] = { resolution: 'D', bars };
          emit('bars');
        }
      }
      // Respons OHLC gaya UDF TradingView
      if (Array.isArray(json.t) && Array.isArray(json.c) && json.o && json.h && json.l) {
        const u = new URL(url, location.href);
        const sym = u.searchParams.get('symbol');
        const res = u.searchParams.get('resolution') || '';
        if (sym && json.t.length) {
          const bars = json.t.map((t, i) => ({
            t: Number(t), o: +json.o[i], h: +json.h[i], l: +json.l[i], c: +json.c[i],
            v: json.v ? +json.v[i] : 0,
          }));
          const prev = S.bars[sym];
          if (prev && prev.resolution === res) {
            const seenT = new Set(prev.bars.map((b) => b.t));
            for (const b of bars) if (!seenT.has(b.t)) prev.bars.push(b);
            prev.bars.sort((a, b) => a.t - b.t);
          } else {
            S.bars[sym] = { resolution: res, bars };
          }
          emit('bars');
        }
      }
      noteNews(url, json);
    } catch (e) {}
  };

  // Berita/post stream Stockbit: bentuk responsnya bervariasi (stream, news,
  // calendar, insight) dan bisa berubah sewaktu-waktu, jadi alih-alih
  // mencocokkan satu skema tertentu kita telusuri objek apa pun yang
  // "berbentuk berita" (punya judul + tanggal). Hanya dikumpulkan di state;
  // app.js yang mengirimkannya ke backend secara berkala.
  const NEWS_URL_RE = /(stream|news|timeline|insight|announcement|calendar|post)/i;
  const pickStr = (o, keys) => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  };
  const harvestNews = (node, depth, out) => {
    if (!node || depth > 5 || out.length > 60) return;
    if (Array.isArray(node)) {
      for (const x of node) harvestNews(x, depth + 1, out);
      return;
    }
    if (typeof node !== 'object') return;
    const title = pickStr(node, ['title', 'headline', 'subject', 'content', 'body', 'text', 'message']);
    const posted = pickStr(node, ['created_at', 'createdAt', 'published_at', 'publishedAt', 'date', 'datetime', 'timestamp', 'time']);
    if (title && title.length >= 12 && title.length <= 2000 && posted) {
      const id = pickStr(node, ['id', 'uuid', 'post_id', 'news_id', 'guid']);
      const url = pickStr(node, ['url', 'link', 'permalink', 'source_url']);
      let sym = pickStr(node, ['symbol', 'ticker', 'emiten', 'stock_code', 'code']);
      if (sym && !/^[A-Z]{2,5}$/.test(sym.toUpperCase())) sym = null;
      out.push({
        extId: String(id || url || title).slice(0, 64),
        symbol: sym ? sym.toUpperCase() : null,
        title: title.replace(/<[^>]*>/g, '').slice(0, 500),
        url: url || null,
        source: pickStr(node, ['source', 'publisher', 'author', 'username']),
        postedAt: posted,
      });
      return; // node ini sudah dihitung sebagai 1 item, tak perlu turun lagi
    }
    for (const k in node) harvestNews(node[k], depth + 1, out);
  };
  const noteNews = (url, json) => {
    try {
      if (!NEWS_URL_RE.test(String(url || ''))) return;
      const found = [];
      harvestNews(json, 0, found);
      if (!found.length) return;
      S.newsItems = S.newsItems || [];
      S.newsSeen = S.newsSeen || new Set();
      let added = 0;
      for (const it of found) {
        if (!it.extId || S.newsSeen.has(it.extId)) continue;
        S.newsSeen.add(it.extId);
        S.newsItems.push(it);
        added++;
      }
      if (S.newsItems.length > 500) S.newsItems.splice(0, S.newsItems.length - 500);
      if (added) emit('news');
    } catch (e) {}
  };

  // ---- lapis 1: patch fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isStockbit(url)) {
        noteUrl(url, 'fetch');
        noteAuth(headerFrom(init && init.headers, 'authorization'));
        if (input && typeof input === 'object' && input.headers) {
          noteAuth(headerFrom(input.headers, 'authorization'));
        }
      }
    } catch (e) {}
    const p = origFetch.apply(this, arguments);
    if (isStockbit(url)) {
      p.then((res) => {
        try {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) res.clone().json().then((j) => noteJson(res.url || url, j)).catch(() => {});
        } catch (e) {}
      }).catch(() => {});
    }
    return p;
  };

  // ---- lapis 2: patch XMLHttpRequest ----
  const XP = XMLHttpRequest.prototype;
  const origOpen = XP.open, origSend = XP.send, origSetHeader = XP.setRequestHeader;

  XP.open = function (method, url) {
    try { this.__bm_url = String(url || ''); } catch (e) {}
    return origOpen.apply(this, arguments);
  };
  XP.setRequestHeader = function (name, value) {
    try {
      if (String(name).toLowerCase() === 'authorization' && isStockbit(this.__bm_url)) noteAuth(value);
    } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };
  XP.send = function () {
    try {
      if (isStockbit(this.__bm_url)) {
        noteUrl(this.__bm_url, 'xhr');
        this.addEventListener('load', () => {
          try {
            const ct = this.getResponseHeader('content-type') || '';
            if (ct.includes('json') || /^[\[{]/.test(String(this.responseText || '').trim())) {
              noteJson(this.__bm_url, JSON.parse(this.responseText));
            }
          } catch (e) {}
        });
      }
    } catch (e) {}
    return origSend.apply(this, arguments);
  };

  // ---- lapis 3: PerformanceObserver (jaring pengaman) ----
  // Melihat URL semua request frame ini walau fetch/XHR-nya tidak lewat patch di
  // atas (worker, service worker, realm lain). Tidak bisa membaca header/isi —
  // hanya URL, tapi itu cukup untuk menangkap template.
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) noteUrl(entry.name, 'perf');
    });
    po.observe({ type: 'resource', buffered: true });
  } catch (e) {}

  // ---- lapis 4: hook WebSocket (wss-trading.stockbit.com) ----
  // Dua tujuan:
  //  a) menangkap JWT SEGAR dari frame subscribe (field 5) -> token REST tak pernah
  //     kadaluarsa sepanjang sesi (memecahkan "Token ditolak/kadaluarsa")
  //  b) mendekode tick transaksi realtime (field 9): last, change, volume, value, freq
  //     -> dipakai Live Tape agar harga/flow update tanpa polling & tanpa expiry
  try {
    const toU8 = (d) => {
      if (d instanceof ArrayBuffer) return new Uint8Array(d);
      if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      return null;
    };
    // pembaca protobuf ringan: kembalikan {fields, floats, strings} berindeks path
    const readVarint = (b, i) => { let v = 0, s = 0, x; do { x = b[i.p++]; v += (x & 0x7f) * Math.pow(2, s); s += 7; } while (x & 0x80); return v; };
    const walkPb = (b, path, o, depth) => {
      const i = { p: 0 };
      while (i.p < b.length) {
        const tag = readVarint(b, i), field = Math.floor(tag / 8), wire = tag & 7;
        if (wire === 0) { o[path + '.' + field] = readVarint(b, i); }
        else if (wire === 1) { const dv = new DataView(b.buffer, b.byteOffset + i.p, 8); o[path + '.' + field] = dv.getFloat64(0, true); i.p += 8; }
        else if (wire === 5) { i.p += 4; }
        else if (wire === 2) {
          const len = readVarint(b, i), sub = b.subarray(i.p, i.p + len);
          let printable = len > 0 && len < 60;
          for (let k = 0; k < sub.length && printable; k++) if (sub[k] < 32 || sub[k] > 126) printable = false;
          if (depth < 8) {
            const before = Object.keys(o).length;
            try { walkPb(sub, path + '.' + field, o, depth + 1); } catch (e) {}
            if (Object.keys(o).length === before && printable) o[path + '.' + field + '$'] = String.fromCharCode.apply(null, sub);
          } else if (printable) o[path + '.' + field + '$'] = String.fromCharCode.apply(null, sub);
          i.p += len;
        } else break;
      }
      return o;
    };
    // ekstraktor field top-level sbg string (untuk JWT/ws-key yang panjang &
    // tidak boleh direkursi sbg nested message)
    const topLevelStr = (b, target) => {
      const i = { p: 0 };
      while (i.p < b.length) {
        const tag = readVarint(b, i), field = Math.floor(tag / 8), wire = tag & 7;
        if (wire === 2) {
          const len = readVarint(b, i);
          if (field === target) { try { return String.fromCharCode.apply(null, b.subarray(i.p, i.p + len)); } catch (e) { return null; } }
          i.p += len;
        } else if (wire === 0) { readVarint(b, i); }
        else if (wire === 1) { i.p += 8; }
        else if (wire === 5) { i.p += 4; }
        else break;
      }
      return null;
    };
    const handleFrame = (u8, dir) => {
      if (!u8 || u8.length < 20) return;
      // SEND subscribe: field 5 = JWT segar -> jadikan Bearer token
      if (dir === 'send') {
        try {
          const jwt = topLevelStr(u8, 5);
          if (jwt && /^eyJ[\w-]+\.[\w-]+\./.test(jwt)) noteAuth('Bearer ' + jwt);
        } catch (e) {}
        return;
      }
      let o;
      try { o = walkPb(u8, '', {}, 0); } catch (e) { return; }
      // RECV tick (top field 9): simpan snapshot realtime PER SIMBOL
      if (dir === 'recv' && o['.9.12'] != null) {
        // simbol tick ada di field .9.1 (mis. "BBCA"); walkPb menyimpan string
        // dengan sufiks '$'. Ambil itu; fallback ke heuristik huruf kapital.
        let sym = o['.9.1$'];
        if (!sym || !/^[A-Z0-9]{2,6}$/.test(sym)) {
          sym = null;
          for (const k in o) { const v = o[k]; if (typeof v === 'string' && /^[A-Z]{3,5}$/.test(v)) { sym = v; break; } }
        }
        if (!sym) return; // tanpa simbol yang jelas, jangan simpan (hindari kontaminasi)
        const t = {
          symbol: sym,
          last: o['.9.12'], open: o['.9.2'], high: o['.9.4'], low: o['.9.5'],
          prev: o['.9.6'], avg: o['.9.10'], volume: o['.9.3'], value: o['.9.14'],
          freq: o['.9.7'], change: o['.9.15.1'], changePct: o['.9.15.2'], ts: Date.now(),
        };
        S.wsTicks = S.wsTicks || {};
        S.wsTicks[sym] = t;
        // riwayat tick per simbol (untuk membangun candle intraday sesuai timeframe)
        S.wsTickHist = S.wsTickHist || {};
        const h = (S.wsTickHist[sym] = S.wsTickHist[sym] || []);
        h.push([t.ts, t.last, t.volume || 0, t.freq || 0]);
        if (h.length > 3000) h.splice(0, h.length - 3000);
        emit('tick');
      }
    };
    const OrigWS = window.WebSocket;
    const Patched = function (url, proto) {
      const ws = proto !== undefined ? new OrigWS(url, proto) : new OrigWS(url);
      try {
        if (/wss-trading\.stockbit\.com/.test(String(url))) {
          ws.addEventListener('message', (e) => { try { handleFrame(toU8(e.data), 'recv'); } catch (er) {} });
          const origSend = ws.send.bind(ws);
          ws.send = function (d) { try { handleFrame(toU8(d), 'send'); } catch (er) {} return origSend(d); };
        }
      } catch (e) {}
      return ws;
    };
    Patched.prototype = OrigWS.prototype;
    try { Object.assign(Patched, OrigWS); } catch (e) {}
    window.WebSocket = Patched;
  } catch (e) {}

  S.__patched = true;
})();
