/**
 * Brokermology — mesin analisa + UI (berjalan di MAIN world, document_idle)
 *
 * Alur:
 *  1. Ambil data OHLC harian (replay datafeed /history yang ditangkap interceptor)
 *  2. Ambil broker summary per hari bursa (replay marketdetectors/brokers, di-cache)
 *  3. Analisa: jendela geser -> deteksi fase AKUMULASI (sideways + net buy konsisten
 *     oleh segelintir broker) dan DISTRIBUSI (harga turun/topping + net sell konsisten)
 *  4. Deteksi broker smart money: clean buy% >= 80% konsisten, nilai per transaksi
 *     besar (dari freq), dan klasifikasi tipe broker
 *  5. Gambar kotak fase langsung di chart TradingView Chartbit (fallback: timeline panel)
 */
(() => {
  // UI & analisa hanya di frame paling atas (interceptor tetap jalan di semua frame)
  if (window !== window.top) return;
  if (window.__BM_APP) return;
  window.__BM_APP = true;

  const S = window.__BM_STATE || { auth: null, brokerUrl: null, historyUrl: null, bars: {}, seen: [], events: new EventTarget() };

  // ============================================================
  // Klasifikasi broker IDX (kode -> [nama, tipe])
  // tipe: asing | bumn | lokal-inst | ritel | ritel-online | campuran | lain
  // ============================================================
  const BROKER_DB = {
    AK: ['UBS Sekuritas Indonesia', 'asing'],
    BK: ['J.P. Morgan Sekuritas Indonesia', 'asing'],
    ZP: ['Maybank Sekuritas Indonesia', 'asing'],
    RX: ['Macquarie Sekuritas Indonesia', 'asing'],
    KZ: ['CLSA Sekuritas Indonesia', 'asing'],
    YU: ['CGS International Sekuritas', 'asing'],
    CG: ['Citigroup Sekuritas Indonesia', 'asing'],
    MS: ['Morgan Stanley Sekuritas', 'asing'],
    AI: ['UOB Kay Hian Sekuritas', 'asing'],
    BB: ['Verdhana Sekuritas Indonesia', 'asing'],
    DR: ['RHB Sekuritas Indonesia', 'asing'],
    TP: ['OCBC Sekuritas Indonesia', 'asing'],
    DB: ['Deutsche Sekuritas Indonesia', 'asing'],
    CC: ['Mandiri Sekuritas', 'bumn'],
    NI: ['BNI Sekuritas', 'bumn'],
    OD: ['BRI Danareksa Sekuritas', 'bumn'],
    DX: ['Bahana Sekuritas', 'bumn'],
    LG: ['Trimegah Sekuritas', 'lokal-inst'],
    IF: ['Samuel Sekuritas', 'lokal-inst'],
    AZ: ['Sucor Sekuritas', 'lokal-inst'],
    SQ: ['BCA Sekuritas', 'lokal-inst'],
    DH: ['Sinarmas Sekuritas', 'lokal-inst'],
    MG: ['Semesta Indovest Sekuritas', 'lokal-inst'],
    HP: ['Henan Putihrai Sekuritas', 'lokal-inst'],
    KI: ['Ciptadana Sekuritas Asia', 'lokal-inst'],
    LS: ['Reliance Sekuritas', 'lokal-inst'],
    PC: ['FAC Sekuritas', 'lokal-inst'],
    YP: ['Mirae Asset Sekuritas', 'ritel-online'],
    PD: ['Indo Premier Sekuritas', 'ritel-online'],
    XL: ['Stockbit Sekuritas', 'ritel-online'],
    XC: ['Ajaib Sekuritas Asia', 'ritel-online'],
    AG: ['Kiwoom Sekuritas Indonesia', 'ritel-online'],
    EP: ['MNC Sekuritas', 'ritel'],
    KK: ['Phillip Sekuritas Indonesia', 'ritel'],
    GR: ['Panin Sekuritas', 'ritel'],
    AT: ['Phintraco Sekuritas', 'ritel'],
    CP: ['KAF Sekuritas Indonesia', 'ritel'],
    SA: ['Elit Sukses Sekuritas', 'ritel'],
    XA: ['NH Korindo Sekuritas', 'campuran'],
    BQ: ['Korea Investment & Sekuritas', 'campuran'],
    FS: ['Yuanta Sekuritas Indonesia', 'campuran'],
    IH: ['Pacific Sekuritas Indonesia', 'lain'],
    FZ: ['Waterfront Sekuritas', 'lain'],
    ZR: ['Bumiputera Sekuritas', 'lain'],
    AO: ['Erdikha Elit Sekuritas', 'lain'],
  };
  const SMART_WEIGHT = { asing: 1.0, bumn: 0.75, 'lokal-inst': 0.7, campuran: 0.45, lain: 0.35, ritel: 0.15, 'ritel-online': 0.1 };
  // klasifikasi domisili dari API (field "type": Lokal/Asing/Pemerintah) —
  // dipakai untuk broker yang tidak ada di BROKER_DB
  const DOM_MAP = {};
  const brokerName = (c) => (BROKER_DB[c] ? BROKER_DB[c][0] : c);
  const brokerType = (c) => {
    if (BROKER_DB[c]) return BROKER_DB[c][1];
    const d = (DOM_MAP[c] || '').toLowerCase();
    if (d.includes('asing') || d.includes('foreign')) return 'asing';
    if (d.includes('pemerintah') || d.includes('gov')) return 'bumn';
    return 'lain';
  };

  // ============================================================
  // Util
  // ============================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  function num(x) {
    if (x == null || x === '-' || x === '') return 0;
    if (typeof x === 'number') return isFinite(x) ? x : 0;
    let s = String(x).trim().replace(/,/g, '');
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([KMBT])$/i);
    if (m) {
      const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()];
      return parseFloat(m[1]) * mult;
    }
    const f = parseFloat(s.replace(/[^\d.eE+-]/g, ''));
    return isNaN(f) ? 0 : f;
  }

  function fmtRp(v) {
    const a = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (a >= 1e12) return sign + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return sign + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return sign + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return sign + (a / 1e3).toFixed(1) + 'K';
    return sign + a.toFixed(0);
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  function isoFromEpochSec(t) {
    const d = new Date(t * 1000);
    // pakai UTC: timestamp bar harian TradingView menunjuk 00:00 UTC tanggal bursa
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  function fmtTgl(iso) {
    const [y, m, d] = iso.split('-');
    return `${+d} ${BULAN[+m - 1]} ${y.slice(2)}`;
  }
  const todayISO = () => {
    const d = new Date(Date.now() + 7 * 3600e3); // WIB
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  };

  function getSymbol() {
    const m = location.pathname.match(/\/symbol\/([A-Za-z0-9-]+)/);
    return m ? m[1].toUpperCase() : null;
  }

  // ============================================================
  // Lapisan data
  // ============================================================
  const CACHE_PREFIX = '__bm3:'; // v3: data GROSS (cache versi lama diabaikan)

  function cacheGet(sym, iso) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${sym}:${iso}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function cacheSet(sym, iso, rows) {
    try {
      // jangan cache hari ini (data masih berubah intraday)
      if (iso >= todayISO()) return;
      const compact = rows.map((r) => [r.code, r.bval, r.blot, r.bfreq, r.sval, r.slot, r.sfreq, r.dom || '']);
      localStorage.setItem(`${CACHE_PREFIX}${sym}:${iso}`, JSON.stringify(compact));
    } catch (e) {
      // kuota penuh -> bersihkan cache brokermology lama
      try {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX));
        keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => localStorage.removeItem(k));
      } catch (e2) {}
    }
  }
  const rowsFromCompact = (arr) => arr.map((a) => {
    if (a[7]) DOM_MAP[a[0]] = a[7];
    return { code: a[0], bval: a[1], blot: a[2], bfreq: a[3], sval: a[4], slot: a[5], sfreq: a[6], dom: a[7] || '' };
  });

  // cari objek broker_summary di mana pun dalam respons
  function findBrokerSummary(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    if (Array.isArray(obj.brokers_buy) || Array.isArray(obj.brokers_sell)) return obj;
    for (const k of Object.keys(obj)) {
      const r = findBrokerSummary(obj[k], depth + 1);
      if (r) return r;
    }
    return null;
  }

  function extractRows(json) {
    const bs = findBrokerSummary(json);
    if (!bs) return null;
    const map = {};
    const get = (c) => (map[c] = map[c] || { code: c, bval: 0, blot: 0, bfreq: 0, sval: 0, slot: 0, sfreq: 0, dom: '' });
    // pada mode NET nilai jual negatif dan bval = nilai net; kita replay dengan
    // GROSS, tapi kalau tetap dapat respons NET, pakai kolom *v (gross) sbg fallback
    const pos = (utama, cadangan) => {
      let x = num(utama);
      if (x < 0) x = num(cadangan) || -x;
      return x;
    };
    for (const r of bs.brokers_buy || []) {
      const c = r.netbs_broker_code || r.broker_code || r.code;
      if (!c || c === '-') continue;
      const m = get(String(c).toUpperCase());
      m.bval += pos(r.bval != null ? r.bval : r.bvalv, r.bvalv);
      m.blot += pos(r.blot != null ? r.blot : r.blotv, null);
      m.bfreq += num(r.freq);
      if (r.type) m.dom = r.type;
    }
    for (const r of bs.brokers_sell || []) {
      const c = r.netbs_broker_code || r.broker_code || r.code;
      if (!c || c === '-') continue;
      const m = get(String(c).toUpperCase());
      m.sval += pos(r.sval != null ? r.sval : r.svalv, r.svalv);
      m.slot += pos(r.slot != null ? r.slot : r.slotv, null);
      m.sfreq += num(r.freq);
      if (r.type) m.dom = r.type;
    }
    const rows = Object.values(map);
    for (const r of rows) if (r.dom) DOM_MAP[r.code] = r.dom;
    return rows;
  }

  // format ulang nilai tanggal sesuai format contoh pada URL template
  function formatDateLike(sample, iso) {
    const [y, m, d] = iso.split('-');
    const s = String(sample || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return iso;
    if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return `${d}-${m}-${y}`;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return `${d}/${m}/${y}`;
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return `${y}/${m}/${d}`;
    if (/^\d{13}$/.test(s)) return String(Date.parse(`${iso}T00:00:00+07:00`));
    if (/^\d{9,11}$/.test(s)) return String(Math.floor(Date.parse(`${iso}T00:00:00+07:00`) / 1000));
    return iso;
  }

  function buildBrokerUrl(template, symbol, iso) {
    const u = new URL(template, location.origin);
    const p = u.searchParams;
    let dateReplaced = 0;
    for (const [k, v] of [...p.entries()]) {
      const kl = k.toLowerCase();
      if (kl === 'symbol' || kl === 'stock' || kl === 'emitten' || kl === 'stock_code') { p.set(k, symbol); continue; }
      if (/(^|_)(from|start|to|end)($|_)/.test(kl) || kl.includes('date')) { p.set(k, formatDateLike(v, iso)); dateReplaced++; }
    }
    // simbol di path: /marketdetectors/DSSA atau /brokers/DSSA
    u.pathname = u.pathname.replace(/\/(marketdetectors|brokers)\/[A-Z0-9-]{2,8}(?=\/|$)/i, `/$1/${symbol}`);
    // template tanpa parameter tanggal (mis. tampilan "latest") -> tambahkan sendiri
    if (!dateReplaced) { p.set('from', iso); p.set('to', iso); }
    // "period" menimpa from/to di API live -> harus dihapus agar tanggal dipakai
    p.delete('period');
    // limit bawaan halaman (25) memotong daftar broker; 0 = semua
    p.set('limit', '0');
    // wajib GROSS: mode NET memberi nilai jual negatif & bval = net,
    // padahal clean buy% dan avg/trx butuh nilai gross per sisi
    p.set('transaction_type', 'TRANSACTION_TYPE_GROSS');
    return u.toString();
  }

  // fallback: cari JWT di localStorage bila header Authorization tak pernah
  // terlihat (mis. request API dilakukan dari worker yang tak bisa disadap)
  function deepFindJwt(obj, depth = 0) {
    if (!obj || depth > 4) return null;
    if (typeof obj === 'string') return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(obj) ? obj : null;
    if (typeof obj !== 'object') return null;
    // prioritaskan kunci yang mengandung "access"
    const keys = Object.keys(obj).sort((a, b) => /access/i.test(b) - /access/i.test(a));
    for (const k of keys) {
      if (!/tok|auth|access|jwt|bearer/i.test(k) && typeof obj[k] !== 'object') continue;
      const r = deepFindJwt(obj[k], depth + 1);
      if (r) return r;
    }
    return null;
  }
  function scanStorageToken() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(CACHE_PREFIX)) continue;
        const v = localStorage.getItem(k);
        if (!v) continue;
        if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v) && /tok|auth|access|jwt/i.test(k)) return `Bearer ${v}`;
        if (v.length < 50000 && (v[0] === '{' || v[0] === '[')) {
          try {
            const jwt = deepFindJwt(JSON.parse(v));
            if (jwt) return `Bearer ${jwt}`;
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  function getAuth() {
    if (!S.auth) S.auth = scanStorageToken();
    return S.auth;
  }

  async function apiGet(url) {
    const headers = { accept: 'application/json' };
    const auth = getAuth();
    if (auth) headers.authorization = auth;
    // tanpa credentials: exodus memakai CORS wildcard, request ber-cookie ditolak
    // browser ("Failed to fetch"); autentikasi cukup lewat header Bearer
    const res = await fetch(url, { headers });
    if (res.status === 401 || res.status === 403) throw new Error('AUTH');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ============================================================
  // Relay ke backend Arsant Screener (opsional — extension tetap
  // berfungsi penuh berdiri sendiri kalau backend tidak jalan; kegagalan
  // relay tidak pernah menghentikan analisa di panel).
  // ============================================================
  const BRIDGE_API = 'http://localhost:4000';
  let bridgeOk = null; // null = belum dicoba, true/false = hasil percobaan terakhir

  async function relayPost(path, body) {
    try {
      const res = await fetch(`${BRIDGE_API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      bridgeOk = res.ok;
    } catch (e) {
      bridgeOk = false;
    }
  }

  function relayBars(symbol, bars) {
    relayPost('/ingest/bars', {
      symbol,
      source: 'stockbit_bridge',
      bars: bars.map((b) => ({
        date: b.iso || isoFromEpochSec(b.t),
        open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
        value: b.val || undefined,
        freq: b.freq || undefined,
        foreignBuy: b.fbuy || undefined,
        foreignSell: b.fsell || undefined,
        foreignFlow: b.fflow || undefined,
      })),
    });
  }

  function relayBrokerDay(symbol, iso, rows) {
    if (!rows || !rows.length) return;
    relayPost('/ingest/broker-summary', {
      symbol,
      date: iso,
      buyers: rows.filter((r) => r.bval > 0 || r.blot > 0)
        .map((r) => ({ brokerCode: r.code, value: r.bval, lot: r.blot, freq: r.bfreq })),
      sellers: rows.filter((r) => r.sval > 0 || r.slot > 0)
        .map((r) => ({ brokerCode: r.code, value: r.sval, lot: r.slot, freq: r.sfreq })),
    });
  }

  // dipanggil tiap tapeTick() sukses poll orderbook — backend menjalankan
  // analyzeBook versi Go sendiri (lihat internal/analytics/orderbook.go) dan
  // broadcast hasilnya ke panel Live Tape web terminal lewat WebSocket;
  // panel Live Tape lokal di halaman Stockbit ini tidak bergantung padanya.
  function relayOrderbook(symbol, snap) {
    relayPost('/ingest/orderbook', {
      symbol,
      last: snap.last,
      bid: snap.bid.map((l) => ({ price: l.price, lot: l.lot, orders: l.orders })),
      offer: snap.offer.map((l) => ({ price: l.price, lot: l.lot, orders: l.orders })),
      value: snap.value,
      volume: snap.volume,
      freq: snap.freq,
    });
  }

  async function fetchBrokerDay(symbol, iso) {
    const cached = cacheGet(symbol, iso);
    if (cached) return rowsFromCompact(cached);
    let json;
    if (S.brokerUrl) {
      try {
        json = await apiGet(buildBrokerUrl(S.brokerUrl, symbol, iso));
      } catch (e) {}
    }
    if (!json) {
      json = await apiGet(brokerRangeUrl(symbol, iso, iso));
    }
    const rows = extractRows(json) || [];
    cacheSet(symbol, iso, rows);
    return rows;
  }

  // ---- relay agregat broker se-rentang (hasil Scan Akumulasi/Screener) ----
  // Backend menyimpannya di tabel broker_range_agg sebagai fallback tampilan
  // broker untuk simbol yang belum pernah di-Analisa-1-Saham (yang per-hari).
  const relayedRangeKey = {};
  function relayBrokerRange(symbol, fromIso, toIso, rows) {
    if (!rows || !rows.length) return;
    const key = `${fromIso}:${toIso}:${rows.length}`;
    if (relayedRangeKey[symbol] === key) return;
    relayedRangeKey[symbol] = key;
    relayPost('/ingest/broker-range', {
      symbol, from: fromIso, to: toIso,
      buyers: rows.filter((r) => r.bval > 0 || r.blot > 0)
        .map((r) => ({ brokerCode: r.code, value: r.bval, lot: r.blot, freq: r.bfreq })),
      sellers: rows.filter((r) => r.sval > 0 || r.slot > 0)
        .map((r) => ({ brokerCode: r.code, value: r.sval, lot: r.slot, freq: r.sfreq })),
    });
  }

  function relayScreenerResults(results) {
    if (!results || !results.length) return;
    const payload = {
      date: todayISO(),
      results: results.map((r) => ({
        sym: r.sym,
        name: r.name || r.sym,
        category: r.category || 'second',
        scoreAccum: r.sc ? r.sc.accum : 0,
        scoreTech: r.sc ? r.sc.tech : 0,
        scorePva: r.sc ? r.sc.pva : 0,
        scoreLiq: r.sc ? r.sc.liq : 0,
        fitScalp: r.sc && r.sc.fit ? r.sc.fit.scalp : 0,
        fitDaytrade: r.sc && r.sc.fit ? r.sc.fit.daytrade : 0,
        fitSwing: r.sc && r.sc.fit ? r.sc.fit.swing : 0,
        tags: r.tags || [],
        topBuyers: r.topAcc || [],
        topSellers: r.topDist || [],
      })),
    };
    relayPost('/ingest/screener', payload);
  }

  function relayFinancialStatements(symbol, items) {
    if (!items || !items.length) return;
    relayPost('/ingest/financial-statements', { symbol, statements: items });
  }

  // ---- relay running trade: cetakan transaksi diturunkan dari DELTA tick WS ----
  // Tiap tick membawa volume/freq KUMULATIF harian; selisih antar tick =
  // volume yang benar-benar tereksekusi pada harga tick itu. Arah ditebak
  // uptick/downtick (harga naik = beli agresif, turun = jual) — indikasi
  // tekanan, bukan data bursa per-transaksi resmi. Watermark pakai timestamp
  // (bukan indeks) karena riwayat tick adalah ring-buffer yang di-splice.
  const tapeRelay = { prev: {}, lastDir: {}, queue: {} };
  function collectTradePrints() {
    const histAll = S.wsTickHist || {};
    for (const sym in histAll) {
      const h = histAll[sym];
      if (!h || !h.length) continue;
      let prev = tapeRelay.prev[sym];
      const out = (tapeRelay.queue[sym] = tapeRelay.queue[sym] || []);
      for (const e of h) {
        if (prev && e[0] <= prev[0]) continue;
        if (prev) {
          const dVol = (e[2] || 0) - (prev[2] || 0);
          const dFreq = Math.max((e[3] || 0) - (prev[3] || 0), 0);
          // volume WS dalam LEMBAR (sama seperti REST orderbook) -> /100 = lot
          const lot = Math.round(dVol / 100);
          if (dVol > 0 && lot > 0) {
            let dir = e[1] > prev[1] ? 'buy' : e[1] < prev[1] ? 'sell' : (tapeRelay.lastDir[sym] || 'unknown');
            tapeRelay.lastDir[sym] = dir;
            out.push({ ts: e[0], price: e[1], lot, freq: dFreq, direction: dir });
          }
        }
        prev = e;
      }
      tapeRelay.prev[sym] = prev;
    }
  }
  function flushTradePrints() {
    collectTradePrints();
    for (const sym in tapeRelay.queue) {
      const q = tapeRelay.queue[sym];
      if (!q.length) continue;
      relayPost('/ingest/trades', { symbol: sym, trades: q.splice(0, 500) });
    }
  }
  setInterval(flushTradePrints, 4000);

  // ---- relay realtime quote + candle harian IHSG dari Stockbit Exodus ----
  // CATATAN PENTING: endpoint lama `/company/COMPOSITE` sudah dimatikan
  // Stockbit (balas 404), dan karena error di-swallow diam-diam, relay IHSG
  // sempat mati tanpa jejak. Yang hidup sekarang:
  //   quote  -> /orderbook/companies/IHSG
  //   candle -> /chartbit/IHSG/price/daily
  // Simbol bursanya "IHSG", BUKAN "COMPOSITE" — chartbit/COMPOSITE juga 404.
  const IHSG_SYMBOL = 'IHSG';

  async function fetchIHSGFromStockbit() {
    try {
      const json = await apiGet(`https://exodus.stockbit.com/orderbook/companies/${IHSG_SYMBOL}`);
      const d = json && json.data;
      if (!d) return;
      const price = num(d.lastprice != null ? d.lastprice : d.close);
      const changePct = num(d.percentage_change != null ? d.percentage_change : d.change_percentage);
      if (price > 0) {
        relayPost('/ingest/macro', {
          ticker: '^JKSE',
          name: d.name || 'IHSG (Indeks Harga Saham Gabungan)',
          price,
          currency: 'IDR',
          changePercent: changePct,
        });
      }
    } catch (e) {}
  }
  setInterval(fetchIHSGFromStockbit, 10000);
  setTimeout(fetchIHSGFromStockbit, 2000);

  // Candle harian IHSG: dipakai panel Stock Profiler untuk kekuatan relatif
  // saham vs indeks, jadi harus ada di bars_daily seperti emiten biasa.
  // Jendela pendek di-refresh berkala supaya bar hari ini ikut terbarui;
  // histori panjangnya ditangani backfill (IHSG selalu ikut antrean).
  async function refreshIHSGBars() {
    try {
      const to = todayISO();
      const from = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      await fetchDailyBars(IHSG_SYMBOL, from, to);
    } catch (e) {}
  }
  setInterval(refreshIHSGBars, 10 * 60 * 1000);
  setTimeout(refreshIHSGBars, 6000);

  // ---- relay Market Movers (Top Gainer/Loser/Value/Volume/Foreign) ----
  const MOVER_TYPES = [
    'MOVER_TYPE_TOP_GAINER', 'MOVER_TYPE_TOP_LOSER', 'MOVER_TYPE_TOP_VALUE',
    'MOVER_TYPE_TOP_VOLUME', 'MOVER_TYPE_NET_FOREIGN_BUY', 'MOVER_TYPE_NET_FOREIGN_SELL'
  ];
  const BOARDS = [
    'FILTER_STOCKS_TYPE_MAIN_BOARD', 'FILTER_STOCKS_TYPE_DEVELOPMENT_BOARD',
    'FILTER_STOCKS_TYPE_ACCELERATION_BOARD', 'FILTER_STOCKS_TYPE_NEW_ECONOMY_BOARD'
  ].map((b) => `filter_stocks=${b}`).join('&');

  async function fetchMarketMoversFromStockbit() {
    for (const mt of MOVER_TYPES) {
      try {
        const url = `https://exodus.stockbit.com/order-trade/market-mover?mover_type=${mt}&${BOARDS}`;
        const json = await apiGet(url);
        const list = (json && json.data) || [];
        if (list.length) {
          const movers = list.map((item) => ({
            moverType: mt,
            symbol: item.code || item.symbol || '',
            name: item.name || item.code || '',
            price: Number(item.price || item.close || 0),
            changePct: Number(item.change_percentage != null ? item.change_percentage : item.change_pct || 0),
            volume: Number(item.volume || 0),
            value: Number(item.value || 0),
            netForeign: Number(item.net_foreign || 0),
          })).filter((m) => m.symbol);
          relayPost('/ingest/market-movers', { moverType: mt, movers });
        }
      } catch (e) {}
      await sleep(300);
    }
  }
  setInterval(fetchMarketMoversFromStockbit, 60000);
  setTimeout(fetchMarketMoversFromStockbit, 5000);

  // ---- relay Calendar Corporate Action Events ----
  async function fetchCalendarEventsFromStockbit() {
    try {
      const today = todayISO();
      const url = `https://exodus.stockbit.com/calendar/events?date=${today}`;
      const json = await apiGet(url);
      const list = (json && json.data) || [];
      if (list.length) {
        const events = list.map((e) => ({
          eventDate: e.date || today,
          symbol: e.code || e.symbol || '',
          eventType: e.type || e.category || 'CORPORATE_ACTION',
          title: e.title || e.name || '',
          description: e.description || e.summary || '',
        })).filter((e) => e.symbol);
        relayPost('/ingest/calendar-events', { events });
      }
    } catch (e) {}
  }
  setInterval(fetchCalendarEventsFromStockbit, 120000);
  setTimeout(fetchCalendarEventsFromStockbit, 8000);

  // ---- relay Insider / Major Holder Activity ----
  // ---- relay kepemilikan KSEI (SID & Scripless) ----
  // Endpoint shareholding network Stockbit mengembalikan GRAF: nodes
  // (emiten & investor) + edges (kepemilikan, lengkap dengan pecahan
  // scrip/scripless). Sumbernya laporan bulanan KSEI, jadi report_date-nya
  // akhir bulan — bukan harian.
  //
  // Stockbit tidak punya endpoint pencarian simbol -> company_id, jadi
  // pemetaannya DITEMUKAN dari graf itu sendiri: setiap node emiten
  // membawa {id, symbol}. Crawl BFS dari beberapa benih lalu menyimpan
  // pemetaan yang ditemukan ke localStorage, sehingga cakupan bertambah
  // tiap kali dijalankan alih-alih mulai dari nol.
  const SH_MAP_KEY = 'tw_shareholding_company_ids';
  const SH_DONE_KEY = 'tw_shareholding_crawled';

  function shLoadMap() {
    try { return JSON.parse(localStorage.getItem(SH_MAP_KEY) || '{}'); } catch (e) { return {}; }
  }
  function shSaveMap(m) {
    try { localStorage.setItem(SH_MAP_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function shLoadDone() {
    try { return JSON.parse(localStorage.getItem(SH_DONE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function shSaveDone(d) {
    try { localStorage.setItem(SH_DONE_KEY, JSON.stringify(d)); } catch (e) {}
  }

  // Benih company_id: /emitten/trending adalah satu-satunya endpoint yang
  // terbukti masih membawa company_id bersama simbolnya.
  async function shSeedCompanyIds() {
    const map = shLoadMap();
    try {
      const j = await apiGet('https://exodus.stockbit.com/emitten/trending');
      const arr = Array.isArray(j && j.data) ? j.data : [];
      for (const it of arr) {
        const sym = (it.symbol || '').toUpperCase();
        const cid = +it.company_id;
        if (sym && cid) map[sym] = cid;
      }
    } catch (e) {}
    shSaveMap(map);
    return map;
  }

  function shNodeNumericId(nodeId) {
    const m = /^(?:company|investor):(\d+)$/.exec(nodeId || '');
    return m ? +m[1] : 0;
  }

  async function shFetchNetwork(rootId, rootType, depth) {
    const url = `https://exodus.stockbit.com/insider/shareholding/network` +
      `?root_id=${rootId}&root_type=SHAREHOLDING_NETWORK_NODE_TYPE_${rootType}` +
      `&max_depth=${depth || 2}&max_edge_per_node=20`;
    const j = await apiGet(url);
    return (j && j.data) || null;
  }

  // Ratakan graf jadi baris investor x emiten. Arah edge bisa dua-duanya
  // (investor->company maupun sebaliknya), jadi keduanya diperiksa alih-alih
  // mengandalkan urutan yang kebetulan terlihat saat pengembangan.
  //
  // HANYA emiten ROOT yang dikembalikan. Emiten lain di graf cuma tersentuh
  // di tepi — Stockbit mengembalikan sebagian kecil pemegangnya saja, dan
  // menyimpannya akan membuat "jumlah pemegang" jadi 1-2 orang: angka yang
  // salah, bukan angka yang kurang lengkap. Nilai graf yang lebih luas tetap
  // dipanen, tapi sebagai pemetaan simbol -> company_id (lihat shHarvestIds),
  // supaya crawl berikutnya bisa menjadikan mereka root dan menarik data
  // pemegangnya yang utuh.
  function shFlatten(data, rootSymbol) {
    const nodes = {};
    for (const n of data.nodes || []) nodes[n.id] = n;

    const holdings = [];
    for (const e of data.edges || []) {
      const a = nodes[e.from_id], b = nodes[e.to_id];
      if (!a || !b) continue;
      let company = null, investor = null;
      if (a.node_type && a.node_type.endsWith('COMPANY') && b.node_type.endsWith('INVESTOR')) {
        company = a; investor = b;
      } else if (b.node_type && b.node_type.endsWith('COMPANY') && a.node_type.endsWith('INVESTOR')) {
        company = b; investor = a;
      } else {
        continue; // edge company<->company / investor<->investor tidak relevan
      }
      const cm = (company.metadata && company.metadata.company) || null;
      const iv = (investor.metadata && investor.metadata.investor) || null;
      if (!cm || !iv || !cm.symbol) continue;
      if (rootSymbol && String(cm.symbol).toUpperCase() !== rootSymbol) continue;

      const sh = e.shareholding || {};
      const raw = (o) => num(o && o.raw != null ? o.raw : 0);
      holdings.push({
        symbol: String(cm.symbol).toUpperCase(),
        companyId: +cm.id || 0,
        investorId: +iv.id || 0,
        investorName: iv.name || '',
        investorType: (iv.investor_type && iv.investor_type.formatted) || '',
        location: (iv.location && iv.location.formatted) || '',
        nationality: (iv.nationality && iv.nationality.formatted) || '',
        domicile: (iv.domicile && iv.domicile.formatted) || '',
        classification: (iv.investor_classification && iv.investor_classification.formatted) || '',
        scrip: raw(sh.scrip),
        scripless: raw(sh.scripless),
        totalShares: raw(sh.total_shares),
        percentage: num(sh.percentage && sh.percentage.raw),
      });
    }
    return holdings;
  }

  // Setiap respons graf juga MENGAJARKAN pemetaan simbol -> company_id baru,
  // jadi crawl berikutnya punya lebih banyak benih.
  function shHarvestIds(data, map) {
    let added = 0;
    for (const n of data.nodes || []) {
      const cm = n.metadata && n.metadata.company;
      if (cm && cm.symbol && cm.id) {
        const sym = String(cm.symbol).toUpperCase();
        if (map[sym] !== +cm.id) { map[sym] = +cm.id; added++; }
      }
    }
    return added;
  }

  const sh = { running: false, stop: false };

  async function runShareholdingCrawl(opts) {
    if (sh.running) return;
    opts = opts || {};
    const maxCompanies = opts.maxCompanies || 120;
    const setStatus = opts.onStatus || (() => {});

    sh.running = true; sh.stop = false;
    try {
      const map = await shSeedCompanyIds();
      const done = shLoadDone();

      // Antrean: simbol watchlist/universe yang company_id-nya sudah dikenal,
      // didahulukan yang belum pernah di-crawl bulan ini.
      const universe = ((typeof window !== 'undefined' && window.__IDX_UNIVERSE__) || []).map((s) => s.code);
      const known = Object.keys(map);
      const ordered = [...new Set([...universe.filter((s) => map[s]), ...known])];

      let okCount = 0, rows = 0, reportDate = '';
      for (const symbol of ordered) {
        if (sh.stop || okCount >= maxCompanies) break;
        const cid = map[symbol];
        if (!cid) continue;

        setStatus(`⏳ Kepemilikan KSEI… ${okCount}/${Math.min(ordered.length, maxCompanies)} emiten — sedang: ${symbol}`);
        try {
          const data = await shFetchNetwork(cid, 'COMPANY', 2);
          if (!data) continue;
          shHarvestIds(data, map);
          const rootNode = (data.nodes || []).find(
            (n) => n.min_depth === 0 && n.metadata && n.metadata.company
          );
          const rootSymbol = rootNode ? String(rootNode.metadata.company.symbol).toUpperCase() : symbol;
          const holdings = shFlatten(data, rootSymbol);
          if (holdings.length && data.report_date) {
            reportDate = data.report_date;
            // Dedup per (bulan, emiten): crawl ulang bulan yang sama tidak
            // dikirim lagi. Upsert di backend membuatnya tetap aman kalau
            // toh terkirim.
            const key = `${symbol}:${data.report_date}`;
            if (done[key] !== 1) {
              relayPost('/ingest/shareholding', { reportDate: data.report_date, holdings });
              done[key] = 1;
              rows += holdings.length;
            }
            okCount++;
          }
        } catch (e) {
          if (e.message === 'AUTH') {
            setStatus('✖ Token Stockbit expired — refresh halaman Stockbit, lalu jalankan lagi.');
            break;
          }
        }
        shSaveMap(map);
        shSaveDone(done);
        await sleep(350);
      }
      setStatus(`✔ Selesai. ${okCount} emiten, ${rows} baris kepemilikan${reportDate ? ` (laporan ${reportDate})` : ''}. Pemetaan simbol dikenal: ${Object.keys(map).length}.`);
    } finally {
      sh.running = false;
    }
  }

  function stopShareholdingCrawl() {
    if (!sh.running) return;
    sh.stop = true;
  }

  async function fetchShareholdingSingle(symbol) {
    if (!symbol) return;
    try {
      const comp = await apiGet(`https://exodus.stockbit.com/insider/shareholding/composition/companies/${symbol}`);
      const list = (comp && comp.data) || (comp && comp.composition) || [];
      if (list && list.length) {
        const holdings = list.map((b) => ({
          symbol: symbol.toUpperCase(),
          holderName: b.name || b.holder_name || b.shareholder_name || 'PEMEGANG SAHAM',
          shareCount: Math.round(Number(b.total_share || b.shares || b.share_count || 0)),
          pct: Number(b.percentage || b.pct || b.percent || 0),
          investorType: b.investor_type || 'RETAIL',
        }));
        const reportDate = comp.report_date || comp.date || todayISO();
        relayPost('/ingest/shareholding', { reportDate, holdings });
      }
    } catch (e) {}

    try {
      const map = await shSeedCompanyIds();
      const cid = map[symbol.toUpperCase()];
      if (cid) {
        const data = await shFetchNetwork(cid, 'COMPANY', 2);
        if (data && data.report_date) {
          shHarvestIds(data, map);
          shSaveMap(map);
          const holdings = shFlatten(data, symbol.toUpperCase());
          if (holdings.length) {
            relayPost('/ingest/shareholding', { reportDate: data.report_date, holdings });
          }
        }
      }
    } catch (e) {}
  }

  async function fetchHistoricalSummaryAllPeriods(symbol, fromIso, toIso) {
    if (!symbol) return;
    const periods = ['HS_PERIOD_DAILY', 'HS_PERIOD_WEEKLY', 'HS_PERIOD_MONTHLY'];
    for (const period of periods) {
      try {
        const url = `https://exodus.stockbit.com/company-price-feed/historical/summary/${symbol}?period=${period}&start_date=${fromIso}&end_date=${toIso}&limit=250&page=1`;
        const res = await apiGet(url);
        if (res) {
          relayPost('/ingest/raw', {
            source: 'stockbit_collector',
            endpoint: '/company-price-feed/historical/summary',
            symbol: symbol.toUpperCase(),
            variant: period,
            url: url,
            params: { period, symbol: symbol.toUpperCase(), startDate: fromIso, endDate: toIso },
            payload: res,
            fetchedAt: todayISO(),
          });
        }
      } catch (e) {}
      await sleep(150);
    }
  }

  async function fetchInsiderTransactionsFromStockbit() {
    try {
      const today = todayISO();
      const d = new Date(); d.setMonth(d.getMonth() - 1);
      const start = isoFromEpochSec(Math.floor(d.getTime() / 1000));
      const url = `https://exodus.stockbit.com/insider/company/majorholder?date_start=${start}&date_end=${today}&page=1&limit=50`;
      const json = await apiGet(url);
      const list = (json && json.data) || [];
      if (list.length) {
        const txs = list.map((item) => ({
          symbol: item.symbol || item.code || '',
          holderName: item.holder_name || item.name || '',
          actionType: item.action_type || item.action || 'TRANSACTION',
          shares: Number(item.shares || item.volume || 0),
          price: Number(item.price || 0),
          txDate: item.date || today,
        })).filter((t) => t.symbol);
        relayPost('/ingest/insider-transactions', { transactions: txs });
      }
    } catch (e) {}
  }
  setInterval(fetchInsiderTransactionsFromStockbit, 180000);
  setTimeout(fetchInsiderTransactionsFromStockbit, 12000);

  // ---- relay KeyStats & Dividend History per Symbol ----
  async function fetchSymbolKeyStatsAndDividends(symbol) {
    if (!symbol) return;
    try {
      const kJson = await apiGet(`https://exodus.stockbit.com/keystats/ratio/v1/${symbol}?year_limit=10`);
      const kData = kJson && kJson.data;
      if (kData) {
        relayPost('/ingest/keystats', {
          symbol,
          peRatio: Number(kData.pe_ratio || kData.pe || 0),
          pbvRatio: Number(kData.pbv_ratio || kData.pbv || 0),
          roe: Number(kData.roe || 0),
          roa: Number(kData.roa || 0),
          der: Number(kData.der || 0),
          dividendYield: Number(kData.dividend_yield || 0),
          marketCap: Number(kData.market_cap || 0),
        });
      }
    } catch (e) {}

    try {
      const dJson = await apiGet(`https://exodus.stockbit.com/corpaction/dividend?symbol=${symbol}`);
      const dList = (dJson && dJson.data) || [];
      if (dList.length) {
        const divs = dList.map((item) => ({
          symbol,
          cumDate: item.cum_date || item.date || '',
          exDate: item.ex_date || '',
          paymentDate: item.payment_date || '',
          amount: Number(item.amount || item.cash_dividend || 0),
        })).filter((d) => d.cumDate);
        relayPost('/ingest/dividends', { dividends: divs });
      }
    } catch (e) {}
  }

  // ---- Laporan Keuangan (findata-view): Laba Rugi/Neraca/Arus Kas x
  // Kuartalan/Tahunan — 6 kombinasi per simbol, dipanggil ON-DEMAND dari tab
  // Push Data (bukan auto-backfill semua saham; datanya cukup besar/jarang
  // berubah). Mengembalikan jumlah item yang berhasil ditarik+direlay.
  const FS_REPORT_TYPES = [
    { code: 1, key: 'income' },
    { code: 2, key: 'balance' },
    { code: 3, key: 'cashflow' },
  ];
  const FS_STATEMENT_TYPES = [
    { code: 1, key: 'quarterly' },
    { code: 2, key: 'annual' },
  ];

  async function fetchFinancialStatements(symbol) {
    if (!symbol) return 0;
    const allItems = [];
    for (const rt of FS_REPORT_TYPES) {
      for (const st of FS_STATEMENT_TYPES) {
        try {
          const url = `https://exodus.stockbit.com/findata-view/company/financial` +
            `?symbol=${symbol}&data_type=1&report_type=${rt.code}&statement_type=${st.code}`;
          const json = await apiGet(url);
          const d = json && json.data;
          const items = d && Array.isArray(d.items) ? d.items : [];
          for (const it of items) {
            allItems.push({
              symbol,
              reportType: rt.key,
              statementType: st.key,
              period: d.period || '',
              currency: d.currency || 'IDR',
              itemId: Number(it.item_id || 0),
              itemName: it.item_name || '',
              value: Number(it.value || 0),
            });
          }
        } catch (e) {
          if (e.message === 'AUTH') throw e;
        }
        await sleep(120);
      }
    }
    if (allItems.length) relayFinancialStatements(symbol, allItems);
    return allItems.length;
  }

  // ---- relay running trade dari fetchRunningTrade() (data transaksi ASLI,
  // bukan tebakan delta tick) — dipakai Jalankan Analisa 1 Saham + deep-dive
  // setelah scan, ganti opsi "date" pada fetchRunningTrade bila mau hari
  // lampau ----
  // 100 transaksi/batch, jeda 55ms/batch (dari fetchRunningTrade sendiri).
  // Loop berhenti SENDIRI begitu wholeDay=true (batch tak penuh / cursor
  // tak maju lagi) — angka di bawah cuma pagar pengaman, bukan target yang
  // sengaja dibatasi. Riwayat: 12-15 batch (1.200-1.500) habis dalam
  // menit-menit pertama buka pasar; lalu dinaikkan ke 80 batch (8.000) tapi
  // untuk saham super likuid (BBCA, ASII, TPIA, dll) itu pun ternyata cuma
  // menutupi ~25 menit pertama saja — jadi dinaikkan lagi jauh lebih tinggi
  // supaya benar-benar sampai penutupan bursa untuk semua saham, bukan cuma
  // yang sepi transaksi.
  const RUNNING_TRADE_BATCHES = 2000;
  function rtTimeToTs(timeStr, dateIso) {
    const s = String(timeStr || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const t = Date.parse(s); return isNaN(t) ? Date.now() : t; }
    if (/^\d{12,13}$/.test(s)) return Number(s);
    if (/^\d{9,10}$/.test(s)) return Number(s) * 1000;
    const m = s.match(/^(\d{1,2}):(\d{2})(:(\d{2}))?/);
    if (m) {
      const ref = dateIso || todayISO();
      const t = Date.parse(`${ref}T${m[1].padStart(2, '0')}:${m[2]}:${m[4] || '00'}+07:00`);
      return isNaN(t) ? Date.now() : t;
    }
    return Date.now();
  }
  function relayRunningTrade(symbol, trades, dateIso) {
    if (!trades || !trades.length) return;
    const items = trades
      .map((t) => ({
        ts: rtTimeToTs(t.time, dateIso), price: t.price, lot: t.lot, freq: 1,
        direction: t.action === 'buy' ? 'buy' : t.action === 'sell' ? 'sell' : 'unknown',
        buyerBroker: t.buyer || undefined, sellerBroker: t.seller || undefined,
        // buy_order_number+sell_order_number = id transaksi asli dari
        // Stockbit (unik per eksekusi) -> backend pakai ini utk upsert,
        // supaya scan/analisa yang diulang di hari yang sama tidak
        // menggandakan baris di tabel trades.
        extTradeId: (t.buyOrd != null && t.sellOrd != null)
          ? `${t.buyOrd}-${t.sellOrd}`
          : `${symbol}:${dateIso || todayISO()}:${t.time || ''}:${t.price}:${t.lot}:${t.buyer || ''}:${t.seller || ''}`,
      }))
      .filter((t) => t.price > 0 && t.lot > 0);
    for (let i = 0; i < items.length; i += 500) {
      relayPost('/ingest/trades', { symbol, trades: items.slice(i, i + 500) });
    }
  }

  // ---- deep-dive: broker summary PER HARI, hanya untuk kandidat skor
  // teratas hasil Scan Akumulasi/Screener (bukan semua saham) — dapat
  // rincian harian tanpa mengulang masalah spam saat semua saham di-fetch
  // per-hari sekaligus. Pola sama dgn worker "Jalankan Analisa": 1 request
  // pada satu waktu + jeda + jitter. ----
  async function deepDiveBrokerDaily(symbol, fromIso, toIso, onProgress) {
    const bars = await fetchDailyBars(symbol, fromIso, toIso);
    if (!bars || bars.length < 3) return;
    const isoList = bars.map((b) => b.iso || isoFromEpochSec(b.t));
    let done = 0;
    for (const iso of isoList) {
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          const rows = await fetchBrokerDay(symbol, iso);
          relayBrokerDay(symbol, iso, rows);
          ok = true;
        } catch (e) {
          if (e.message === 'AUTH') throw e;
          await sleep(900 * attempt);
        }
      }
      done++;
      if (onProgress) onProgress(done, isoList.length);
      await sleep(450 + Math.random() * 250);
    }
  }

  // deep-dive broker harian untuk sekumpulan kandidat (dipakai baik oleh
  // Scan Akumulasi maupun TAHAP 2 Screener, yang running trade-nya sudah
  // ditangani terpisah lewat fetchRunningTrade + relayRunningTrade sendiri).
  const DEEP_DIVE_TOP_N = 12;
  async function deepDiveBrokerDailyBatch(top, days, setStatus) {
    if (!top.length) return;
    const today = todayISO();
    const from = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - Math.ceil(days * 1.4)); return isoFromEpochSec(Math.floor(d.getTime() / 1000)); })();
    let done = 0;
    for (const r of top) {
      const sym = r.sym;
      if (!sym) continue;
      done++;
      try {
        await deepDiveBrokerDaily(sym, from, today, (d, t) =>
          setStatus(`Deep-dive broker harian ${done}/${top.length} (${sym}): ${d}/${t} hari…`));
      } catch (e) {}
    }
    setStatus(`✔ Deep-dive broker harian selesai untuk ${top.length} kandidat teratas.`);
  }

  // orkestrasi deep-dive penuh (running trade + broker harian): dipakai oleh
  // Scan Akumulasi Pasar, yang tidak punya TAHAP 2 sendiri seperti Screener.
  // Hanya top N (skor tertinggi) yang dapat rincian penuh — sisanya cukup
  // data agregat dari scan itu sendiri (sudah relay lewat fetchBrokerRange).
  const deepDiveState = { running: false };
  async function runDeepDive(results, days, scoreOf, setStatus) {
    if (!results || !results.length || deepDiveState.running) return;
    const top = results.slice().sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, DEEP_DIVE_TOP_N);
    deepDiveState.running = true;
    const today = todayISO();
    let done = 0;
    try {
      for (const r of top) {
        const sym = r.sym;
        if (!sym) continue;
        done++;
        setStatus(`Deep-dive ${done}/${top.length} (${sym}): running trade…`);
        try {
          const rt = await fetchRunningTrade(sym, { maxBatches: RUNNING_TRADE_BATCHES });
          relayRunningTrade(sym, rt, today);
          if (!r.txSummary) { const tx = analyzeTransactions(rt); if (tx) { r.txSummary = tx; r.txWholeDay = rt.wholeDay; } }
        } catch (e) {}
      }
      await deepDiveBrokerDailyBatch(top, days, setStatus);
    } finally {
      deepDiveState.running = false;
    }
  }

  // ---- relay berita/post stream yang ditangkap pasif oleh interceptor ----
  let newsRelayed = 0;
  setInterval(() => {
    const items = S.newsItems || [];
    if (items.length <= newsRelayed) return;
    const batch = items.slice(newsRelayed);
    newsRelayed = items.length;
    relayPost('/ingest/news', {
      items: batch.map((it) => {
        let postedAt;
        try { const d = new Date(it.postedAt); if (!isNaN(d)) postedAt = d.toISOString(); } catch (e) {}
        return {
          extId: it.extId, symbol: it.symbol || undefined, title: it.title,
          url: it.url || undefined, source: it.source || undefined, postedAt,
        };
      }),
    });
  }, 8000);

  // URL broker summary rentang — pola langsung (terverifikasi), tidak bergantung
  // pada template yang tertangkap (yang belum tentu ada saat screener jalan)
  function brokerRangeUrl(symbol, fromIso, toIso) {
    return `https://exodus.stockbit.com/marketdetectors/${symbol}` +
      `?transaction_type=TRANSACTION_TYPE_GROSS&market_board=MARKET_BOARD_REGULER` +
      `&investor_type=INVESTOR_TYPE_ALL&limit=0&from=${fromIso}&to=${toIso}`;
  }

  // satu query untuk seluruh rentang — angka total per broker (identik panel
  // Stockbit). SEMUA pemanggil (screener, scan akumulasi, analisa) lewat
  // wrapper ini, jadi relay agregat ke backend cukup di satu titik.
  async function fetchBrokerRange(symbol, fromIso, toIso) {
    const rows = await fetchBrokerRangeRaw(symbol, fromIso, toIso);
    if (rows && rows.length) relayBrokerRange(symbol, fromIso, toIso, rows);
    return rows;
  }

  async function fetchBrokerRangeRaw(symbol, fromIso, toIso) {
    // 1) pola langsung (andal, tidak butuh template tertangkap)
    try {
      const rows = extractRows(await apiGet(brokerRangeUrl(symbol, fromIso, toIso)));
      if (rows && rows.length) return rows;
    } catch (e) {}
    // 2) fallback: transform template yang tertangkap (bila pola berubah)
    try {
      if (!S.brokerUrl) return null;
      const u = new URL(buildBrokerUrl(S.brokerUrl, symbol, fromIso));
      if (!u.searchParams.has('to')) return null;
      u.searchParams.set('to', formatDateLike(u.searchParams.get('to'), toIso));
      return extractRows(await apiGet(u.toString()));
    } catch (e) { return null; }
  }

  const MAX_TRADING_DAYS = 250;

  // SEMUA jalur pengambilan candle (analisa 1 saham, screener, scan akumulasi
  // pasar, research, scalping) lewat satu pintu ini, jadi relay ke backend
  // Relay dilakukan DI SINI — bukan di masing-masing pemanggil — supaya
  // tidak ada fitur yang datanya terlewat. Dedup per sesi: rentang yang sama
  // untuk simbol yang sama hanya dikirim sekali (scan ulang tidak membebani
  // backend dengan data identik; upsert di backend membuat kiriman ulang
  // lintas sesi tetap aman).
  const relayedBarsKey = {};
  async function fetchDailyBars(symbol, fromIso, toIso) {
    const bars = await fetchDailyBarsRaw(symbol, fromIso, toIso);
    if (bars && bars.length) {
      const key = `${bars[0].iso || bars[0].t}:${bars[bars.length - 1].iso || bars[bars.length - 1].t}:${bars.length}`;
      if (relayedBarsKey[symbol] !== key) {
        relayedBarsKey[symbol] = key;
        relayBars(symbol, bars);
      }
    }
    return bars;
  }

  // PENTING: parseChartbit (di bawah) selalu memotong hasil ke MAX_TRADING_DAYS
  // (250) hari bursa TERAKHIR dari rentang yang diminta — jadi fetchDailyBars
  // dengan rentang panjang (mis. sejak listing 1997) TETAP hanya mengembalikan
  // ~250 hari terakhir, bukan seluruh histori. Untuk backfill historis penuh,
  // pecah rentang jadi window mundur yang masing2 di bawah batas itu.
  const BACKFILL_WINDOW_DAYS = 220; // hari kalender/window (~150 hari bursa, aman di bawah 250)

  function splitDateWindows(fromIso, toIso, windowDays) {
    const windows = [];
    const fromDate = new Date(`${fromIso}T00:00:00Z`);
    let curTo = new Date(`${toIso}T00:00:00Z`);
    if (isNaN(fromDate) || isNaN(curTo) || curTo < fromDate) return windows;
    while (curTo >= fromDate) {
      const curFrom = new Date(curTo);
      curFrom.setUTCDate(curFrom.getUTCDate() - windowDays);
      const winFrom = curFrom < fromDate ? fromDate : curFrom;
      windows.push({ from: winFrom.toISOString().slice(0, 10), to: curTo.toISOString().slice(0, 10) });
      curTo = new Date(winFrom);
      curTo.setUTCDate(curTo.getUTCDate() - 1);
    }
    return windows;
  }

  // Backfill candle harian PENUH satu simbol: pecah rentang jadi beberapa
  // window (lihat BACKFILL_WINDOW_DAYS), tiap window di-retry beberapa kali
  // sebelum menyerah — supaya kegagalan jaringan sesaat tidak bikin data
  // sepotong-sepotong. relay ke backend tetap terjadi otomatis lewat
  // fetchDailyBars di tiap window. Lambat tidak masalah, yang penting lengkap.
  async function backfillSymbolBars(symbol, fromIso, toIso, opts) {
    opts = opts || {};
    const retries = opts.retries != null ? opts.retries : 2;
    const gapMs = opts.gapMs != null ? opts.gapMs : 150;
    const windows = splitDateWindows(fromIso, toIso, BACKFILL_WINDOW_DAYS);
    let totalBars = 0, okWindows = 0, failedWindows = 0;
    for (const w of windows) {
      let ok = false;
      for (let attempt = 0; attempt <= retries && !ok; attempt++) {
        try {
          const bars = await fetchDailyBars(symbol, w.from, w.to);
          if (bars) totalBars += bars.length;
          ok = true;
        } catch (e) {
          if (e.message === 'AUTH') throw e;
          if (attempt < retries) await sleep(400 * (attempt + 1));
        }
      }
      if (ok) okWindows++; else failedWindows++;
      if (opts.onWindow) { try { opts.onWindow(w, ok); } catch (e) {} }
      await sleep(gapMs);
    }
    return { symbol, totalBars, windows: windows.length, okWindows, failedWindows };
  }

  async function fetchDailyBarsRaw(symbol, fromIso, toIso) {
    // endpoint candle harian chartbit: data.chartbit[{date, unixdate, open, ...}]
    // catatan: pada versi live, "from" = tanggal terbaru dan "to" = tanggal terlama;
    // dicoba dua arah agar tahan bila semantiknya berubah
    const inRange = (iso) => iso >= fromIso && iso <= toIso;
    const parseChartbit = (j) => {
      const arr = j && j.data && Array.isArray(j.data.chartbit) ? j.data.chartbit : null;
      if (!arr) return null;
      const bars = arr
        .map((r) => ({
          t: +r.unixdate, o: +r.open, h: +r.high, l: +r.low, c: +r.close,
          v: +r.volume || 0, iso: r.date,
          freq: +r.frequency || 0,
          fbuy: +r.foreignbuy || 0, fsell: +r.foreignsell || 0,
          fflow: +r.foreignflow || 0, // PERHATIAN: kumulatif, bukan harian
          val: +r.value || 0,
          mcap: +r.soxclose || 0,   // kapitalisasi pasar = close × saham beredar
          so: +r.shareoutstanding || 0,
        }))
        .filter((b) => inRange(b.iso))
        .sort((a, b) => a.t - b.t)
        .slice(-MAX_TRADING_DAYS);
      return bars.length >= 3 ? bars : null;
    };

    const candidates = [];
    if (S.dailyUrl) {
      // pakai template asli halaman, ganti simbol di path + rentang tanggal
      try {
        const u = new URL(S.dailyUrl, location.origin);
        u.pathname = u.pathname.replace(/chartbit\/[A-Z0-9-]+\/price\/daily/i, `chartbit/${symbol}/price/daily`);
        if (u.searchParams.has('from')) u.searchParams.set('from', toIso);
        if (u.searchParams.has('to')) u.searchParams.set('to', fromIso);
        u.searchParams.set('limit', '0');
        candidates.push(u.toString());
      } catch (e) {}
    }
    candidates.push(
      `https://exodus.stockbit.com/chartbit/${symbol}/price/daily?from=${toIso}&to=${fromIso}&limit=0`,
      `https://exodus.stockbit.com/chartbit/${symbol}/price/daily?from=${fromIso}&to=${toIso}&limit=0`
    );
    for (const url of candidates) {
      try {
        const bars = parseChartbit(await apiGet(url));
        if (bars) return bars;
      } catch (e) {
        if (e.message === 'AUTH') throw e;
      }
    }

    // fallback 1: tangkapan pasif dari interceptor
    const cap = S.bars[symbol];
    if (cap && cap.bars.length > 5) {
      const daily = cap.bars
        .filter((b, i, arr) => i === 0 || b.t - arr[i - 1].t < 5 * 86400)
        .filter((b) => inRange(b.iso || isoFromEpochSec(b.t)));
      if (daily.length >= 3) return daily.slice(-MAX_TRADING_DAYS);
    }
    // fallback 2: datafeed gaya UDF bila pernah tertangkap
    if (S.historyUrl) {
      for (const reso of ['D', '1D']) {
        try {
          const u = new URL(S.historyUrl, location.origin);
          const p = u.searchParams;
          p.set('symbol', symbol);
          if (p.has('resolution')) p.set('resolution', reso);
          if (p.has('from')) p.set('from', String(Math.floor(Date.parse(`${fromIso}T00:00:00+07:00`) / 1000)));
          if (p.has('to')) p.set('to', String(Math.floor(Date.parse(`${toIso}T23:59:59+07:00`) / 1000)));
          const j = await apiGet(u.toString());
          if (j && Array.isArray(j.t) && j.t.length >= 3) {
            return j.t.map((t, i) => ({ t: +t, o: +j.o[i], h: +j.h[i], l: +j.l[i], c: +j.c[i], v: j.v ? +j.v[i] : 0 }))
              .sort((a, b) => a.t - b.t)
              .slice(-MAX_TRADING_DAYS);
          }
        } catch (e) {
          if (e.message === 'AUTH') throw e;
        }
      }
    }
    throw new Error('BARS');
  }

  // ============================================================
  // Mesin analisa
  // ============================================================
  const SENS = {
    rendah: { comp: 0.07, flow: 0.18, persist: 0.7, clean: 0.7 },
    sedang: { comp: 0.10, flow: 0.12, persist: 0.6, clean: 0.6 },
    tinggi: { comp: 0.14, flow: 0.07, persist: 0.5, clean: 0.5 },
  };

  function analyze(bars, dayRows, opts, rangeRows) {
    const th = SENS[opts.sens] || SENS.sedang;
    const W = opts.win;

    // hari bursa yang punya data broker
    const days = [];
    for (const b of bars) {
      const iso = b.iso || isoFromEpochSec(b.t);
      const rows = dayRows[iso];
      if (!rows || !rows.length) continue;
      let totalBuy = 0, totalSell = 0;
      const net = {};
      for (const r of rows) {
        totalBuy += r.bval; totalSell += r.sval;
        net[r.code] = (net[r.code] || 0) + r.bval - r.sval;
      }
      days.push({ ...b, iso, rows, net, totalVal: Math.max(totalBuy, totalSell) });
    }
    if (days.length < W + 2) return { days, phases: [], brokers: brokerStats(days, rangeRows), reconciled: !!(rangeRows && rangeRows.length), error: days.length ? 'Data terlalu sedikit untuk deteksi fase.' : 'Tidak ada data broker summary pada rentang ini.' };

    // scan jendela geser
    const wins = [];
    for (let i = 0; i + W <= days.length; i++) {
      const seg = days.slice(i, i + W);
      const hi = Math.max(...seg.map((d) => d.h));
      const lo = Math.min(...seg.map((d) => d.l));
      const avgC = seg.reduce((s, d) => s + d.c, 0) / W;
      const comp = (hi - lo) / avgC;
      const chg = seg[W - 1].c / seg[0].c - 1;
      const totalVal = seg.reduce((s, d) => s + d.totalVal, 0) || 1;

      // statistik per broker di jendela ini
      const agg = {};
      for (const d of seg) {
        for (const r of d.rows) {
          const a = (agg[r.code] = agg[r.code] || { b: 0, s: 0, buyDays: 0, sellDays: 0, days: 0 });
          a.b += r.bval; a.s += r.sval; a.days++;
          const n = r.bval - r.sval;
          if (n > 0) a.buyDays++; else if (n < 0) a.sellDays++;
        }
      }
      let accFlow = 0, dstFlow = 0, accSmart = 0, dstSmart = 0;
      const accBrokers = [], dstBrokers = [];
      for (const [code, a] of Object.entries(agg)) {
        const n = a.b - a.s;
        const w = SMART_WEIGHT[brokerType(code)];
        if (n > 0 && a.buyDays >= th.persist * W && a.b > 0 && n / a.b >= th.clean) {
          accFlow += n; accSmart += n * w; accBrokers.push({ code, net: n });
        }
        if (n < 0 && a.sellDays >= th.persist * W && a.s > 0 && -n / a.s >= th.clean) {
          dstFlow += -n; dstSmart += -n * w; dstBrokers.push({ code, net: n });
        }
      }
      wins.push({
        i, comp, chg,
        accRatio: accFlow / totalVal, dstRatio: dstFlow / totalVal,
        accFlow, dstFlow, accSmart, dstSmart,
        accBrokers: accBrokers.sort((x, y) => y.net - x.net),
        dstBrokers: dstBrokers.sort((x, y) => x.net - y.net),
      });
    }

    // klasifikasi jendela -> kandidat fase
    // tie-break memakai bobot smart money: fase ditentukan oleh sisi yang diisi
    // broker institusi/asing, bukan sekadar besar flow (ritel jual != distribusi bandar)
    const marks = wins.map((w) => {
      // SIMETRIS: fase ditentukan oleh sisi mana smart money dominan.
      // Akumulasi = net beli dominan & harga belum rally besar (belum markup).
      // Distribusi = net jual dominan & harga belum jatuh dalam (distribusi di atas/sideways).
      const isAcc = w.accRatio >= th.flow && w.accSmart > w.dstSmart && w.chg <= 0.12;
      const isDst = w.dstRatio >= th.flow && w.dstSmart > w.accSmart && w.chg >= -0.12;
      return isAcc ? 'A' : isDst ? 'D' : null;
    });

    // gabungkan jendela bertipe sama yang bertumpuk/berdekatan (jeda <= 2 hari)
    const phases = [];
    let cur = null;
    for (let i = 0; i < wins.length; i++) {
      const t = marks[i];
      if (t && cur && cur.mark === t && i <= cur.lastWin + 3) {
        cur.lastWin = i;
      } else if (t) {
        if (cur) phases.push(cur);
        cur = { mark: t, firstWin: i, lastWin: i };
      }
    }
    if (cur) phases.push(cur);

    const result = phases.map((p) => {
      const i1 = p.firstWin, i2 = p.lastWin + W - 1;
      const seg = days.slice(i1, i2 + 1);
      const agg = {};
      for (const d of seg) for (const [c, n] of Object.entries(d.net)) agg[c] = (agg[c] || 0) + n;
      const sorted = Object.entries(agg).sort((a, b) => (p.mark === 'A' ? b[1] - a[1] : a[1] - b[1]));
      const top = sorted
        .filter(([, net]) => (p.mark === 'A' ? net > 0 : net < 0))
        .slice(0, 3)
        .map(([code, net]) => ({ code, net }));
      const flow = top.reduce((s, b) => s + Math.abs(b.net), 0);
      // porsi smart vs ritel dari sisi flow fase
      let smart = 0, all = 0;
      for (const [c, n] of sorted) {
        const rel = p.mark === 'A' ? Math.max(n, 0) : Math.max(-n, 0);
        all += rel; smart += rel * (SMART_WEIGHT[brokerType(c)] >= 0.45 ? 1 : 0);
      }
      // harga rata-rata + FREQ para broker motor (untuk deteksi aktor: smart vs ritel)
      let sumVal = 0, sumLot = 0, sumFreq = 0;
      const topCodes = new Set(top.map((b) => b.code));
      for (const d of seg) {
        for (const r of d.rows) {
          if (!topCodes.has(r.code)) continue;
          if (p.mark === 'A') { sumVal += r.bval; sumLot += r.blot; sumFreq += r.bfreq; }
          else { sumVal += r.sval; sumLot += r.slot; sumFreq += r.sfreq; }
        }
      }
      const avgPrice = sumLot > 0 ? sumVal / (sumLot * 100) : 0;
      // avg nilai per transaksi: smart money = order besar (nilai/freq tinggi);
      // ritel = banyak transaksi kecil (nilai/freq rendah)
      const avgTrx = sumFreq > 0 ? sumVal / sumFreq : 0;
      const smartShare = all > 0 ? smart / all : 0;
      // AKTOR: smart money bila mayoritas broker tipe institusi/asing ATAU
      // rata-rata order besar (>= 15 juta/transaksi); selain itu ritel
      const actor = smartShare >= 0.55 || avgTrx >= 15e6 ? 'SMART MONEY' : 'RITEL';

      return {
        type: p.mark === 'A' ? 'AKUMULASI' : 'DISTRIBUSI',
        actor, avgTrx, avgPrice,
        fromIso: seg[0].iso, toIso: seg[seg.length - 1].iso,
        t1: seg[0].t, t2: seg[seg.length - 1].t,
        pLow: Math.min(...seg.map((d) => d.l)) * 0.995,
        pHigh: Math.max(...seg.map((d) => d.h)) * 1.005,
        topBrokers: top, flow,
        smartShare,
        nDays: seg.length,
      };
    });

    return { days, phases: result, brokers: brokerStats(days, rangeRows), reconciled: !!(rangeRows && rangeRows.length) };
  }

  // statistik per broker sepanjang periode -> deteksi smart money
  function brokerStats(days, rangeRows) {
    const agg = {};
    let totalMarket = 0;
    for (const d of days) {
      totalMarket += d.totalVal;
      for (const r of d.rows) {
        const a = (agg[r.code] = agg[r.code] || { b: 0, s: 0, bf: 0, sf: 0, days: 0, cleanBuyDays: 0, cleanSellDays: 0, buyDays: 0, sellDays: 0 });
        a.b += r.bval; a.s += r.sval; a.bf += r.bfreq; a.sf += r.sfreq; a.days++;
        if (r.bval > 0 && (r.bval - r.sval) / r.bval >= 0.8) a.cleanBuyDays++;
        if (r.sval > 0 && (r.sval - r.bval) / r.sval >= 0.8) a.cleanSellDays++;
        if (r.bval - r.sval > 0) a.buyDays++; else if (r.sval - r.bval > 0) a.sellDays++;
      }
    }
    const list = Object.entries(agg).map(([code, a]) => {
      const net = a.b - a.s;
      const cleanBuy = a.b > 0 ? net / a.b : 0;           // % beli yang "bersih" (tidak dicuci jual)
      const cleanSell = a.s > 0 ? -net / a.s : 0;
      const avgTrx = (a.b + a.s) / Math.max(a.bf + a.sf, 1); // nilai rata-rata per transaksi (proxy smart vs ritel)
      return {
        code, name: brokerName(code), type: brokerType(code),
        b: a.b, s: a.s, net,
        cleanBuy, cleanSell,
        buyConsist: a.days ? a.cleanBuyDays / a.days : 0,
        sellConsist: a.days ? a.cleanSellDays / a.days : 0,
        activeDays: a.days, avgTrx,
      };
    });

    // rekonsiliasi: kalau ada hasil query rentang penuh, pakai itu sebagai angka
    // total per broker (identik dengan panel Stockbit) — data harian tetap dipakai
    // untuk konsistensi. Ini juga menambal bias bila ada hari yang gagal terambil.
    if (rangeRows && rangeRows.length) {
      const rmap = {};
      for (const r of rangeRows) rmap[r.code] = r;
      totalMarket = Math.max(
        rangeRows.reduce((s, r) => s + r.bval, 0),
        rangeRows.reduce((s, r) => s + r.sval, 0)
      );
      for (const x of list) {
        const r = rmap[x.code];
        if (!r) continue;
        x.b = r.bval; x.s = r.sval; x.net = r.bval - r.sval;
        x.cleanBuy = x.b > 0 ? x.net / x.b : 0;
        x.cleanSell = x.s > 0 ? -x.net / x.s : 0;
        x.avgTrx = (r.bval + r.sval) / Math.max(r.bfreq + r.sfreq, 1);
        delete rmap[x.code];
      }
      // broker yang seluruh datanya harian gagal terambil tetap muncul dari rentang
      for (const r of Object.values(rmap)) {
        const net = r.bval - r.sval;
        list.push({
          code: r.code, name: brokerName(r.code), type: brokerType(r.code),
          b: r.bval, s: r.sval, net,
          cleanBuy: r.bval > 0 ? net / r.bval : 0,
          cleanSell: r.sval > 0 ? -net / r.sval : 0,
          buyConsist: 0, sellConsist: 0, activeDays: days.length,
          avgTrx: (r.bval + r.sval) / Math.max(r.bfreq + r.sfreq, 1),
        });
      }
    }

    // ambang "transaksi besar": persentil-75 avgTrx broker aktif
    const sizes = list.filter((x) => x.activeDays >= 3).map((x) => x.avgTrx).sort((a, b) => a - b);
    const p75 = sizes.length ? sizes[Math.floor(sizes.length * 0.75)] : Infinity;
    const minVal = totalMarket * 0.01; // minimal 1% dari total nilai periode agar signifikan

    for (const x of list) {
      const smartClass = SMART_WEIGHT[x.type] >= 0.45;
      const bigTicket = x.avgTrx >= p75;
      x.verdict = '';
      if (x.net > 0 && x.b >= minVal && x.cleanBuy >= 0.8 && x.buyConsist >= 0.6) {
        x.verdict = smartClass || bigTicket ? 'SMART ACCUM' : 'AKUM RITEL';
      } else if (x.net < 0 && x.s >= minVal && x.cleanSell >= 0.8 && x.sellConsist >= 0.6) {
        x.verdict = smartClass || bigTicket ? 'SMART DIST' : 'DIST RITEL';
      } else if (x.net > 0 && x.b >= minVal && x.cleanBuy >= 0.5) {
        x.verdict = 'NET BUY';
      } else if (x.net < 0 && x.s >= minVal && x.cleanSell >= 0.5) {
        x.verdict = 'NET SELL';
      }
      x.bigTicket = bigTicket;
    }
    return list.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }

  // ============================================================
  // Menggambar di chart TradingView
  // ============================================================
  // Cari objek chart yang bisa digambari (punya createMultipointShape).
  // Widget bisa berada di frame utama ATAU di iframe chart same-origin;
  // juga dikenali API internal library (tradingViewApi) selain objek widget resmi.
  function findChart() {
    const hasDraw = (o) => { try { return o && typeof o.createMultipointShape === 'function'; } catch (e) { return false; } };
    const fromCand = (v) => {
      try {
        if (!v || (typeof v !== 'object' && typeof v !== 'function')) return null;
        if (hasDraw(v)) return v;
        if (typeof v.activeChart === 'function') { const c = v.activeChart(); if (hasDraw(c)) return c; }
        if (typeof v.chart === 'function' && typeof v.onChartReady === 'function') { const c = v.chart(); if (hasDraw(c)) return c; }
      } catch (e) {}
      return null;
    };
    const scan = (win) => {
      for (const n of ['tvWidget', 'tradingViewWidget', 'tvChartWidget', 'tradingViewApi', 'TradingViewApi', 'widget']) {
        try { const r = fromCand(win[n]); if (r) return r; } catch (e) {}
      }
      let props = [];
      try { props = Object.getOwnPropertyNames(win); } catch (e) {}
      for (const k of props) {
        try { const r = fromCand(win[k]); if (r) return r; } catch (e) {}
      }
      return null;
    };
    const walk = (win, depth) => {
      try { const r = scan(win); if (r) return r; } catch (e) {}
      if (depth >= 3) return null;
      let n = 0;
      try { n = win.frames.length; } catch (e) {}
      for (let i = 0; i < n; i++) {
        try { const r = walk(win.frames[i], depth + 1); if (r) return r; } catch (e) {} // frame lintas-origin dilewati
      }
      return null;
    };
    return walk(window, 0);
  }

  const drawnIds = [];

  const safeShapes = (chart) => {
    try { return typeof chart.getAllShapes === 'function' ? chart.getAllShapes() || [] : []; } catch (e) { return []; }
  };

  async function drawPhaseRaw(chart, ph, out) {
    const green = ph.type === 'AKUMULASI';
    const line = green ? '#00b47e' : '#eb4d4b';
    const fill = green ? 'rgba(0,180,126,0.15)' : 'rgba(235,77,75,0.15)';
    const pts = [{ time: ph.t1, price: ph.pLow }, { time: ph.t2 + 43200, price: ph.pHigh }];
    let drew = false;
    // createMultipointShape/createShape bisa mengembalikan Promise (Chartbit live)
    try {
      const id = await Promise.resolve(chart.createMultipointShape(pts, {
        shape: 'rectangle', lock: true, disableSave: true,
        overrides: { backgroundColor: fill, color: line, linecolor: line, linewidth: 1, transparency: 85, fillBackground: true },
      }));
      if (id) out.push(id);
      drew = true;
    } catch (e) {
      try {
        const id = await Promise.resolve(chart.createMultipointShape(pts, { shape: 'rectangle', lock: true }));
        if (id) out.push(id);
        drew = true;
      } catch (e2) { return false; }
    }
    try {
      if (typeof chart.createShape === 'function') {
        const label = `${ph.type} oleh ${ph.actor || (ph.smartShare >= 0.5 ? 'SMART MONEY' : 'RITEL')} • ${ph.topBrokers.map((b) => b.code).join(',')} • ${fmtRp(ph.flow)}`;
        const id = await Promise.resolve(chart.createShape(
          { time: ph.t1, price: ph.pHigh },
          { shape: 'text', text: label, lock: true, disableSave: true, overrides: { color: line, fontsize: 12, bold: true } }
        ));
        if (id) out.push(id);
      }
    } catch (e) {}
    return drew;
  }

  // jalankan fungsi penggambar sambil melacak ID objek baru dengan membandingkan
  // getAllShapes sebelum/sesudah (return value create* tidak selalu ID yang valid)
  async function trackDraw(chart, fn) {
    const hasApi = typeof chart.getAllShapes === 'function';
    const before = hasApi ? new Set(safeShapes(chart).map((s) => String(s.id))) : null;
    const returned = [];
    await fn(returned);
    if (hasApi) {
      await sleep(250);
      for (const s of safeShapes(chart)) if (!before.has(String(s.id))) drawnIds.push(s.id);
    } else {
      drawnIds.push(...returned); // tanpa getAllShapes: andalkan return value create*
    }
  }

  async function drawPhases(phases) {
    const chart = findChart();
    if (!chart) return 0;
    let ok = 0;
    await trackDraw(chart, async (out) => {
      for (const ph of phases) if (await drawPhaseRaw(chart, ph, out)) ok++;
    });
    if (ok) { autoRedraw.phases = phases; autoRedraw.sym = getSymbol(); }
    return ok;
  }

  // garis Support/Resistance horizontal (putus-putus) + tetap digambar ulang
  async function drawSRLevels(levels) {
    const chart = findChart();
    if (!chart) return 0;
    let ok = 0;
    await trackDraw(chart, async (out) => {
      for (const lv of levels) {
        try {
          const id = await Promise.resolve(chart.createShape(
            { time: lv.t, price: lv.p },
            {
              shape: 'horizontal_line', lock: true, disableSave: true,
              overrides: { linecolor: lv.type === 'S' ? '#00b47e' : '#eb4d4b', linestyle: 2, linewidth: 1 },
            }
          ));
          if (id) out.push(id);
          ok++;
        } catch (e) {}
      }
    });
    if (ok) { autoRedraw.sr = levels; autoRedraw.sym = getSymbol(); }
    return ok;
  }

  function clearDrawings() {
    autoRedraw.phases = null;
    autoRedraw.sr = null;
    autoRedraw.signals = null;
    autoRedraw.tp = null;
    const chart = findChart();
    if (!chart) return;
    for (const id of drawnIds.splice(0)) {
      try { chart.removeEntity(id); } catch (e) {}
    }
  }

  // ============================================================
  // Gambar ulang otomatis saat timeframe/chart berubah
  // (Chartbit menghapus objek gambar ketika resolusi diganti)
  // ============================================================
  const autoRedraw = { phases: null, sr: null, signals: null, tp: null, sym: null, lastReso: null, busy: false };

  setInterval(async () => {
    try {
      if (autoRedraw.busy || (!autoRedraw.phases && !autoRedraw.sr && !autoRedraw.signals && !autoRedraw.tp)) return;
      if (getSymbol() !== autoRedraw.sym) return; // pindah saham: jangan gambar fase saham lain
      const chart = findChart();
      if (!chart || typeof chart.getAllShapes !== 'function') return;
      const reso = typeof chart.resolution === 'function' ? chart.resolution() : '';
      if (autoRedraw.lastReso === null) { autoRedraw.lastReso = reso; return; }
      const resoChanged = reso !== autoRedraw.lastReso;
      autoRedraw.lastReso = reso;
      // gambar hilang? (ID yang kita lacak tidak ada lagi di chart)
      const existing = new Set(safeShapes(chart).map((s) => String(s.id)));
      const alive = drawnIds.filter((id) => existing.has(String(id))).length;
      if (!resoChanged && alive >= drawnIds.length && drawnIds.length > 0) return;
      if (alive === drawnIds.length && drawnIds.length > 0) return;
      autoRedraw.busy = true;
      await sleep(1000); // beri waktu chart selesai memuat resolusi baru
      // bersihkan sisa lama lalu gambar ulang
      for (const id of drawnIds.splice(0)) { try { chart.removeEntity(id); } catch (e) {} }
      const phases = autoRedraw.phases, sr = autoRedraw.sr, sigs = autoRedraw.signals, tp = autoRedraw.tp;
      if (phases) await drawPhases(phases);
      if (sr) await drawSRLevels(sr);
      if (sigs) await drawSignalMarks(sigs);
      if (tp) await drawTradePlanShapes(tp);
    } catch (e) {} finally { autoRedraw.busy = false; }
  }, 2500);

  // ============================================================
  // Indikator (MA / RSI) & Support-Resistance
  // ============================================================
  function calcSMA(vals, n) {
    const out = new Array(vals.length).fill(null);
    let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      sum += vals[i];
      if (i >= n) sum -= vals[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }
  function calcEMA(vals, n) {
    const out = new Array(vals.length).fill(null);
    const k = 2 / (n + 1);
    let e = null;
    for (let i = 0; i < vals.length; i++) {
      e = e === null ? vals[i] : vals[i] * k + e * (1 - k);
      if (i >= n - 1) out[i] = e;
    }
    return out;
  }
  // RSI metode Wilder
  function calcRSI(closes, n) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) g += d; else l -= d;
    }
    g /= n; l /= n;
    out[n] = 100 - 100 / (1 + (l === 0 ? 100 : g / l));
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n;
      l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l));
    }
    return out;
  }

  // Support/Resistance: pivot fractal -> cluster level berdekatan -> ranking sentuhan
  function findSR(bars, maxLevels = 6) {
    const k = 3;
    const piv = [];
    for (let i = k; i < bars.length - k; i++) {
      const seg = bars.slice(i - k, i + k + 1);
      if (bars[i].h >= Math.max(...seg.map((b) => b.h))) piv.push({ p: bars[i].h, t: bars[i].t });
      if (bars[i].l <= Math.min(...seg.map((b) => b.l))) piv.push({ p: bars[i].l, t: bars[i].t });
    }
    if (!piv.length) return [];
    const lastC = bars[bars.length - 1].c;
    const tol = lastC * 0.015; // level berjarak <1.5% digabung
    piv.sort((a, b) => a.p - b.p);
    const clusters = [];
    for (const pv of piv) {
      const c = clusters[clusters.length - 1];
      if (c && pv.p - c.hi <= tol) {
        c.sum += pv.p; c.n++; c.hi = Math.max(c.hi, pv.p);
        c.t = Math.min(c.t, pv.t); c.lastT = Math.max(c.lastT, pv.t);
      } else {
        clusters.push({ sum: pv.p, n: 1, hi: pv.p, t: pv.t, lastT: pv.t });
      }
    }
    const recentT = bars[Math.max(bars.length - 20, 0)].t;
    let levels = clusters
      .map((c) => ({ p: c.sum / c.n, touches: c.n, t: c.t, lastT: c.lastT }))
      .filter((l) => Math.abs(l.p - lastC) / lastC <= 0.35); // abaikan level terlalu jauh
    let strong = levels.filter((l) => l.touches >= 2);
    if (strong.length < 3) strong = levels; // saham sepi: terima level 1 sentuhan
    return strong
      .map((l) => ({ ...l, score: l.touches * 2 + (l.lastT >= recentT ? 2 : 0), type: l.p <= lastC ? 'S' : 'R' }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxLevels)
      .sort((a, b) => b.p - a.p);
  }

  function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
    const ef = calcEMA(closes, fast), es = calcEMA(closes, slow);
    const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const signal = new Array(line.length).fill(null);
    const start = line.findIndex((v) => v != null);
    if (start >= 0) {
      const tail = calcEMA(line.slice(start), sig);
      for (let k = 0; k < tail.length; k++) signal[start + k] = tail[k];
    }
    const hist = line.map((v, i) => (v == null || signal[i] == null ? null : v - signal[i]));
    return { line, signal, hist };
  }

  function calcATR(bars, n = 14) {
    if (bars.length < n + 1) return null;
    const trs = [];
    for (let i = 1; i < bars.length; i++) {
      const pc = bars[i - 1].c;
      trs.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc)));
    }
    let atr = trs.slice(0, n).reduce((a, b) => a + b, 0) / n;
    for (let i = n; i < trs.length; i++) atr = (atr * (n - 1) + trs[i]) / n;
    return atr;
  }

  // tick size & auto reject IDX (papan utama/pengembangan, aturan simetris)
  function roundTick(p, up) {
    const tick = p < 200 ? 1 : p < 500 ? 2 : p < 2000 ? 5 : p < 5000 ? 10 : 25;
    return (up ? Math.ceil(p / tick) : Math.floor(p / tick)) * tick;
  }
  function araArb(close) {
    const pct = close > 5000 ? 0.20 : close >= 200 ? 0.25 : 0.35;
    return {
      pct: pct * 100,
      ara: roundTick(close * (1 + pct), false),
      arb: Math.max(roundTick(close * (1 - pct), true), 50),
    };
  }

  // pivot harga (dipakai divergensi & struktur trend)
  function pricePivots(bars, k = 3) {
    const hi = [], lo = [];
    for (let i = k; i < bars.length - k; i++) {
      const seg = bars.slice(i - k, i + k + 1);
      if (bars[i].h >= Math.max(...seg.map((b) => b.h))) hi.push(i);
      if (bars[i].l <= Math.min(...seg.map((b) => b.l))) lo.push(i);
    }
    return { hi, lo };
  }

  // divergensi RSI klasik dari dua pivot terakhir
  function detectDivergence(bars, rsiArr) {
    const { hi, lo } = pricePivots(bars, 3);
    const res = [];
    const last = bars.length - 1;
    const lo2 = lo.filter((i) => last - i <= 60).slice(-2);
    if (lo2.length === 2 && rsiArr[lo2[0]] != null && rsiArr[lo2[1]] != null) {
      const [a, b] = lo2;
      if (bars[b].l < bars[a].l && rsiArr[b] > rsiArr[a] && rsiArr[b] < 50) {
        res.push({ type: 'bullish', iso: bars[b].iso || isoFromEpochSec(bars[b].t) });
      }
    }
    const hi2 = hi.filter((i) => last - i <= 60).slice(-2);
    if (hi2.length === 2 && rsiArr[hi2[0]] != null && rsiArr[hi2[1]] != null) {
      const [a, b] = hi2;
      if (bars[b].h > bars[a].h && rsiArr[b] < rsiArr[a] && rsiArr[b] > 50) {
        res.push({ type: 'bearish', iso: bars[b].iso || isoFromEpochSec(bars[b].t) });
      }
    }
    return res;
  }

  // struktur trend dari dua pasang pivot terakhir: HH/HL, LH/LL, atau campuran
  function trendStructure(bars) {
    const { hi, lo } = pricePivots(bars, 3);
    if (hi.length < 2 || lo.length < 2) return null;
    const [h1, h2] = hi.slice(-2).map((i) => bars[i].h);
    const [l1, l2] = lo.slice(-2).map((i) => bars[i].l);
    const hh = h2 > h1, hl = l2 > l1;
    if (hh && hl) return { arah: 'UPTREND', detail: 'higher high + higher low' };
    if (!hh && !hl) return { arah: 'DOWNTREND', detail: 'lower high + lower low' };
    return { arah: 'SIDEWAYS/TRANSISI', detail: hh ? 'higher high tapi lower low' : 'lower high tapi higher low' };
  }

  // swing utama utk fibonacci: titik tertinggi & terendah dalam rentang
  function fibSwing(bars) {
    let iHi = 0, iLo = 0;
    bars.forEach((b, i) => {
      if (b.h > bars[iHi].h) iHi = i;
      if (b.l < bars[iLo].l) iLo = i;
    });
    const up = iLo < iHi; // swing naik: retracement diukur dari low ke high
    const hi = bars[iHi].h, lo = bars[iLo].l, rng = hi - lo;
    const ratios = [0.382, 0.5, 0.618];
    const levels = ratios.map((r) => ({ r, p: up ? hi - rng * r : lo + rng * r }));
    return { up, hi, lo, tHi: bars[iHi].t, tLo: bars[iLo].t, levels };
  }

  // ============================================================
  // SCREENER — outlook saham per kategori & profil risiko
  // ============================================================
  // Satu standar dengan Data Collector (lib/config.js): kategori ditentukan
  // dari market cap, sedangkan status "gorengan" adalah flag perilaku
  // terpisah dan tidak mengubah tier ini.
  function mcapCategory(mcap) {
    if (mcap > 10e12) return 'bluechip';
    if (mcap >= 500e9) return 'second';
    return 'third';
  }
  const CAT_LABEL = { bluechip: '💎 Blue Chip', second: '🔷 Second Liner', third: '🔸 Third Liner' };

  // klasifikasi retail vs smart dari kode broker (dipakai analisa ritel berkurang)
  const isRetailBroker = (c) => ['ritel', 'ritel-online'].includes(brokerType(c));

  // Klasifikasi PERAN broker berdasarkan PERILAKU transaksi, bukan cuma kode.
  // Kunci: broker ritel (mis. XL) yang menunjukkan ORDER BESAR (nilai/transaksi tinggi)
  // = sedang dipakai smart money → JANGAN dihitung sebagai ritel.
  function brokerFlowContext(rows) {
    const avgs = rows.map((r) => { const f = (r.bfreq || 0) + (r.sfreq || 0); return f > 0 ? (r.bval + r.sval) / f : 0; })
      .filter((a) => a > 0).sort((a, b) => a - b);
    const med = avgs.length ? avgs[Math.floor(avgs.length / 2)] : 0;
    // "order besar" = ≥ 2,5× median avg/trx pasar broker DAN ≥ 12 juta/transaksi absolut
    return { med, bigTh: Math.max(med * 2.5, 12e6) };
  }
  function brokerRole(r, ctx) {
    const f = (r.bfreq || 0) + (r.sfreq || 0);
    const avgTrx = f > 0 ? (r.bval + r.sval) / f : 0;
    const codeSmart = (SMART_WEIGHT[brokerType(r.code)] || 0) >= 0.45;
    const codeRetail = isRetailBroker(r.code);
    const big = avgTrx >= ctx.bigTh; // pola order besar (institusi)
    let role;
    if (codeRetail && big) role = 'smart-via-retail';  // XL/YP dipakai smart money
    else if (codeRetail) role = 'retail';               // ritel asli (order kecil)
    else if (codeSmart) role = 'smart';
    else if (big) role = 'smart-big';                   // broker lain tapi order besar
    else role = 'lain';
    return { avgTrx, big, role, isSmart: role !== 'retail' && role !== 'lain', isRetail: role === 'retail' };
  }

  // skoring murni dari metrik (0..100 per dimensi) — dapat diuji terpisah
  function scoreStock(m) {
    const clamp = (x) => Math.max(0, Math.min(100, x));
    // AKUMULASI SENYAP: smart money net beli signifikan + terkonsentrasi (segelintir broker)
    //   + clean tinggi + barang kering (volume mengering) + ritel berkurang (net jual)
    let accum = 0;
    if (m.smartNet > 0 && m.totVal > 0) accum += clamp((m.smartNet / m.totVal) * 260); // porsi net smart
    accum += clamp(m.topConc * 55);          // konsentrasi top akumulator
    accum += clamp((m.cleanBuy - 0.5) * 90);  // clean buy di atas 50%
    if (m.dryUp) accum += 22;                  // barang kering
    if (m.retailNet < 0) accum += 16;          // ritel net jual (berkurang) -> ke smart money
    if (m.silent) accum += 30;                 // akumulasi senyap (harga belum lari)
    accum = clamp(accum / 2.35);

    // PVA
    const pva = clamp(50 + m.pvaSkor * 5);
    // TEKNIKAL: trend + RSI sehat + dekat breakout
    let tech = 50;
    if (m.trend === 'UPTREND') tech += 22; else if (m.trend === 'DOWNTREND') tech -= 22;
    if (m.aboveMA50) tech += 10; if (m.aboveMA200) tech += 8;
    if (m.rsi >= 45 && m.rsi <= 68) tech += 8; else if (m.rsi > 78) tech -= 12; else if (m.rsi < 32) tech += 6;
    if (m.nearBreakout) tech += 12;
    tech = clamp(tech);
    // LIKUIDITAS (untuk scalping): nilai transaksi harian + frekuensi
    let liq = 0;
    liq += clamp(Math.log10(Math.max(m.valDay, 1) / 1e9) * 26); // miliar Rp/hari
    liq += clamp(Math.log10(Math.max(m.freqDay, 1)) * 16);
    liq = clamp(liq);
    // FOREIGN flow
    const foreign = clamp(50 + (m.totVal > 0 ? (m.foreignNet / m.totVal) * 300 : 0));

    // FIT per gaya trading (0..100)
    const scalp = clamp(0.42 * liq + 0.30 * tech + 0.18 * Math.abs(m.imbalance * 100) + 0.10 * pva);
    const daytrade = clamp(0.38 * tech + 0.32 * accum + 0.30 * pva);
    const swing = clamp(0.42 * accum + 0.30 * tech + 0.28 * foreign);

    return { accum: Math.round(accum), pva: Math.round(pva), tech: Math.round(tech), liq: Math.round(liq), foreign: Math.round(foreign),
      fit: { scalp: Math.round(scalp), daytrade: Math.round(daytrade), swing: Math.round(swing) } };
  }

  function stockBadges(m, sc) {
    const b = [];
    if (m.silent) b.push('🐋 Akumulasi senyap');
    else if (sc.accum >= 60 && m.smartNet > 0) b.push('🐋 Akumulasi');
    if (m.dryUp) b.push('🔥 Barang kering');
    if (m.retailNet < 0 && m.smartNet > 0) b.push('👋 Ritel berkurang');
    if (m.trend === 'UPTREND') b.push('📈 Uptrend');
    if (m.nearBreakout) b.push('🚀 Dekat breakout');
    if (sc.liq >= 65) b.push('💧 Likuid');
    if (m.foreignNet > 0 && m.totVal > 0 && m.foreignNet / m.totVal > 0.05) b.push('🌊 Foreign inflow');
    if (m.pvaSkor >= 4) b.push('📊 Demand kuat');
    if (m.rsi >= 78) b.push('⚠ Overbought');
    return b;
  }

  // ambil metrik satu saham (3 request: candle harian, orderbook, broker rentang)
  async function scanSymbol(sym, days, name) {
    name = name || sym;
    const today = todayISO();
    const from = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - Math.ceil((days + 30) * 1.6)); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; })();
    const bars = await fetchDailyBars(sym, from, today);
    if (!bars || bars.length < 15) throw new Error('candle kurang');
    fetchSymbolKeyStatsAndDividends(sym);
    const last = bars[bars.length - 1];
    const closes = bars.map((b) => b.c);
    const i = closes.length - 1;

    // teknikal
    const ma50 = calcSMA(closes, 50)[i], ma200 = calcSMA(closes, 200)[i];
    const rsi = calcRSI(closes, 14)[i] || 50;
    const struk = trendStructure(bars);
    const hi20 = Math.max(...bars.slice(-21, -1).map((b) => b.h));
    const nearBreakout = last.c >= hi20 * 0.985 && last.c <= hi20 * 1.02;
    // volume dry-up: rata2 5 hari terakhir < 60% rata2 20 hari, harga tidak jatuh
    const vols = bars.map((b) => b.v);
    const v5 = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const v20 = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length);
    const chg20 = closes.length > 20 ? closes[i] / closes[i - 20] - 1 : 0;
    const dryUp = v20 > 0 && v5 / v20 < 0.6 && chg20 > -0.08;
    // PVA
    const pva = pvaAnalysis(bars);
    // foreign net (Σ fbuy−fsell) periode
    const foreignNet = bars.reduce((a, b) => a + (b.fbuy || 0) - (b.fsell || 0), 0);
    const valDay = bars.slice(-5).reduce((a, b) => a + (b.val || 0), 0) / 5;
    const freqDay = bars.slice(-5).reduce((a, b) => a + (b.freq || 0), 0) / 5;

    // orderbook realtime (imbalance, likuiditas intraday)
    let imbalance = 0;
    try {
      const ob = parseOrderbook(await apiGet(orderbookUrl(sym)));
      if (ob) {
        const a = analyzeBook(ob, []);
        imbalance = a.imbalance;
        relayOrderbook(sym, ob); // snapshot screener juga dikirim ke backend (dulu hanya jalur scalping/tape)
      }
    } catch (e) {}

    // broker summary rentang PENUH (akumulasi smart money sepanjang periode 1/3/6 bln)
    // — akumulasi butuh jendela panjang, bukan cuma beberapa hari
    let smartNet = 0, retailNet = 0, totVal = 0, topConc = 0, cleanBuy = 0.5;
    let topAcc = [], topDist = [];
    try {
      const fromB = bars[0].iso;
      const rows = await fetchBrokerRange(sym, fromB, today);
      if (rows && rows.length) {
        totVal = rows.reduce((a, r) => a + r.bval + r.sval, 0) / 2 || 1;
        const ctx = brokerFlowContext(rows);
        const nets = rows.map((r) => { const role = brokerRole(r, ctx); return { code: r.code, net: r.bval - r.sval, bval: r.bval, sval: r.sval, type: brokerType(r.code), role: role.role, isSmart: role.isSmart, isRetail: role.isRetail }; });
        for (const n of nets) {
          // smart = berperilaku institusi (termasuk broker ritel yg ordernya besar)
          if (n.net > 0 && n.isSmart) smartNet += n.net;
          if (n.isRetail) retailNet += n.net; // ritel asli (order kecil) saja
        }
        const accBrokers = nets.filter((n) => n.net > 0).sort((a, b) => b.net - a.net);
        const totAccum = accBrokers.reduce((a, n) => a + n.net, 0) || 1;
        topConc = accBrokers.slice(0, 3).reduce((a, n) => a + n.net, 0) / totAccum;
        const top = accBrokers[0];
        if (top && top.bval > 0) cleanBuy = top.net / top.bval;
        topAcc = accBrokers.slice(0, 3).map((n) => ({ code: n.code, net: n.net, type: n.type }));
        topDist = nets.filter((n) => n.net < 0).sort((a, b) => a.net - b.net).slice(0, 3).map((n) => ({ code: n.code, net: n.net, type: n.type }));
      }
    } catch (e) {}

    // level kunci untuk research
    const srAll = findSR(bars, 6);
    const sup = srAll.filter((l) => l.type === 'S').sort((a, b) => b.p - a.p)[0];
    const res = srAll.filter((l) => l.type === 'R').sort((a, b) => a.p - b.p)[0];
    const atr = calcATR(bars, 14) || last.c * 0.02;
    const ar = araArb(last.c);

    // AKUMULASI SENYAP: smart money net beli besar TAPI harga belum lari (masih murah)
    const chgPeriod = (closes[i] / closes[0] - 1) * 100;
    const silent = smartNet > 0 && totVal > 0 && smartNet / totVal > 0.06 && chgPeriod < 12;

    const m = {
      mcap: last.mcap, last: last.c, chg: closes.length > 1 ? (closes[i] / closes[i - 1] - 1) * 100 : 0,
      smartNet, retailNet, totVal, topConc, cleanBuy, dryUp, silent, chgPeriod, nBars: bars.length,
      periodTxt: `${days} hari (~${Math.round(days / 21)} bln)`, topAcc, topDist,
      pvaSkor: pva.skor, pvaKlas: pva.rows.length ? pva.rows[pva.rows.length - 1].k : '-',
      klimaks: pva.klimaks, obvSinyal: pva.obvSinyal,
      trend: struk ? struk.arah : '-', trendDetail: struk ? struk.detail : '',
      ma50: ma50 != null && last.c >= ma50, ma200: ma200 != null && last.c >= ma200,
      rsi, nearBreakout, foreignNet, valDay, freqDay, imbalance,
      support: sup ? Math.round(sup.p) : null, resistance: res ? Math.round(res.p) : null,
      atr: Math.round(atr), ara: ar.ara, arb: ar.arb, hi20,
    };
    m.aboveMA50 = m.ma50; m.aboveMA200 = m.ma200; // alias utk scoreStock
    const sc = scoreStock(m);
    return { sym, name, category: mcapCategory(last.mcap), mcap: last.mcap, last: m.last, chg: m.chg, m, sc, badges: stockBadges(m, sc) };
  }

  // ============================================================
  // SCAN AKUMULASI PASAR — cari saham yg diakumulasi BEBERAPA bandar smart money
  // (ringan: 2 request/saham — candle + broker rentang; tanpa orderbook/teknikal)
  // ============================================================
  async function scanBandarStock(sym, days) {
    const today = todayISO();
    const from = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - Math.ceil((days + 20) * 1.6)); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; })();
    const bars = await fetchDailyBars(sym, from, today);
    if (!bars || bars.length < 10) throw new Error('candle kurang');
    const last = bars[bars.length - 1];
    const chgPeriod = (last.c / bars[0].c - 1) * 100;
    const rows = await fetchBrokerRange(sym, bars[0].iso, today);
    if (!rows || !rows.length) throw new Error('broker kosong');
    const totVal = rows.reduce((a, r) => a + r.bval + r.sval, 0) / 2 || 1;

    // bandar akumulator = broker berperilaku SMART MONEY (institusi/asing ATAU
    // broker mana pun—termasuk XL/YP—yg ordernya BESAR) yg net beli signifikan.
    // Ritel = HANYA broker ritel yg benar-benar order kecil (verifikasi via freq).
    const ctx = brokerFlowContext(rows);
    const bandars = [];
    let smartNet = 0, retailNet = 0, sumVal = 0, sumFreq = 0, viaRetailN = 0;
    for (const r of rows) {
      const net = r.bval - r.sval;
      const role = brokerRole(r, ctx);
      if (net > 0 && role.isSmart && net >= totVal * 0.008) { // net beli ≥ 0,8% nilai transaksi
        bandars.push({ code: r.code, net, type: brokerType(r.code), avgTrx: role.avgTrx, viaRetail: role.role === 'smart-via-retail' });
        smartNet += net; sumVal += r.bval; sumFreq += r.bfreq;
        if (role.role === 'smart-via-retail') viaRetailN++;
      }
      if (role.isRetail) retailNet += net; // ritel asli saja (order kecil)
    }
    bandars.sort((a, b) => b.net - a.net);
    const avgTrx = sumFreq > 0 ? sumVal / sumFreq : 0;
    const smartShareVal = smartNet / totVal;
    // senyap = akumulasi di harga SIDEWAYS (belum lari & belum jatuh dalam) — sinyal terbaik
    const silent = smartShareVal > 0.05 && chgPeriod >= -10 && chgPeriod < 12;
    const serokBawah = smartShareVal > 0.05 && chgPeriod < -10; // institusi beli saat turun
    // SKOR KEKUATAN AKUMULASI 0–100:
    //   konsensus (jumlah bandar, maks 8) + kekuatan net smart + senyap + ritel keluar
    let score = Math.min(bandars.length, 8) * 7   // konsensus: maks 56
      + Math.min(smartShareVal * 200, 30);         // kekuatan: maks 30
    if (silent) score += 8;                        // akumulasi di harga tenang
    if (retailNet < 0) score += 4;                 // ritel melepas ke bandar
    if (avgTrx >= 15e6) score += 2;                // order besar (institusi)
    score = Math.min(Math.round(score), 100);
    return {
      sym, category: mcapCategory(last.mcap), mcap: last.mcap, last: last.c, chgPeriod,
      nBandar: bandars.length, bandars: bandars.slice(0, 5), smartNet, retailNet, totVal,
      smartShareVal, avgTrx, silent, serokBawah, viaRetailN, score,
    };
  }

  const accScan = { running: false, results: [] };

  async function scanAccumulationMarket() {
    if (accScan.running) return;
    const days = Math.max(15, Math.min(200, Math.round(+ui.accDays.value || 63)));
    ui.accDays.value = days;
    const minBandar = Math.max(1, Math.min(6, Math.round(+ui.accMin.value || 2)));
    ui.accMin.value = minBandar;
    const maxN = +ui.accN.value || 80;

    accScan.running = true; ui.accBtn.disabled = true; accScan.results = [];
    ui.accProg.textContent = 'Mengambil daftar saham…';
    let syms = await fetchUniverse(maxN);
    const manual = (ui.scrSyms.value || '').toUpperCase().match(/[A-Z]{2,5}/g);
    if (manual) syms = [...new Set([...manual, ...syms])];
    syms = syms.slice(0, maxN);

    let done = 0, fail = 0;
    const queue = [...syms];
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        try { const r = await scanBandarStock(s, days); if (r.nBandar >= minBandar && r.smartNet > 0) accScan.results.push(r); }
        catch (e) { fail++; }
        done++;
        ui.accProg.textContent = `Memindai ${done}/${syms.length} emiten… (${s}) — ketemu ${accScan.results.length}`;
        await sleep(90);
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
      renderAccumulation();
      ui.accProg.textContent = `✔ Selesai. ${accScan.results.length} saham diakumulasi ≥${minBandar} bandar (dari ${syms.length} emiten${fail ? `, ${fail} gagal` : ''}).`;
      // deep-dive latar belakang: running trade asli + broker summary harian
      // untuk kandidat skor teratas saja — tidak menunggu (tombol scan sudah
      // bisa dipakai lagi), progres menimpa ui.accProg sampai selesai.
      if (accScan.results.length) runDeepDive(accScan.results, days, (r) => r.score, (msg) => { ui.accProg.textContent = msg; });
    } catch (e) {
      ui.accProg.textContent = `✖ Gagal: ${e.message}`;
    } finally {
      accScan.running = false; ui.accBtn.disabled = false;
    }
  }

  function renderAccumulation() {
    const list = accScan.results.slice().sort((a, b) => b.score - a.score);
    if (!list.length) { ui.accOut.innerHTML = '<div class="status">Tidak ada saham yang diakumulasi beberapa bandar pada kriteria ini. Coba kurangi "min bandar" atau ubah periode.</div>'; return; }
    const html = list.slice(0, 40).map((r) => {
      const col = r.score >= 70 ? '#00d69a' : r.score >= 45 ? '#f2c14e' : '#8b93a3';
      const kuat = r.score >= 75 ? 'sangat kuat' : r.score >= 55 ? 'kuat' : r.score >= 40 ? 'sedang' : 'lemah';
      const bandarStr = r.bandars.map((b) => `<b>${b.code}</b>`).join(' ');
      return `<div class="phase" style="padding:7px 9px;margin-bottom:6px" data-acc="${r.sym}">
        <div style="display:flex;align-items:center;gap:6px">
          <b style="font-size:13px">${r.sym}</b>
          <span class="vd nb" style="font-size:9px">${CAT_LABEL[r.category]}</span>
          <span class="${r.chgPeriod >= 0 ? 'pos' : 'neg'}" style="font-size:11px">${r.chgPeriod >= 0 ? '+' : ''}${r.chgPeriod.toFixed(0)}%</span>
          <span style="margin-left:auto;text-align:right" title="Skor kekuatan akumulasi 0–100">
            <b style="font-size:15px;color:${col}">${r.score}</b><span class="hint" style="font-size:9px">/100 ${kuat}</span></span>
        </div>
        <div class="meta" style="margin-top:3px">
          <b class="pos">${r.nBandar} bandar</b> akumulasi: ${bandarStr} · net ${fmtRp(r.smartNet)}
          ${r.silent ? ' · 🐋 <span class="pos">senyap</span>' : r.serokBawah ? ' · 🎣 <span style="color:#f2c14e">serok bawah</span>' : ''}${r.retailNet < 0 ? ' · 👋 ritel keluar' : ''}${r.viaRetailN ? ' · 🕵️ <span style="color:#f2c14e">smart via broker ritel</span>' : ''} · avg ${fmtRp(r.avgTrx)}/trx
        </div>
      </div>`;
    }).join('');
    ui.accOut.innerHTML = `<div class="gt" style="margin:8px 0 3px">💎 ${list.length} saham diakumulasi <span class="hint">(klik → outlook)</span></div>
      <div class="hint" style="margin-bottom:7px">Angka besar = <b>skor kekuatan akumulasi (0–100)</b>: makin banyak bandar sepakat + net besar + senyap → makin tinggi.</div>
      <div class="cardgrid">${html}</div>`;
    const days = Math.max(15, Math.min(200, Math.round(+ui.accDays.value || 63)));
    ui.accOut.querySelectorAll('[data-acc]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.onclick = () => openBandarResearch(el.dataset.acc, days);
    });
  }

  // ============================================================
  // ANALISA TRANSAKSI — dari running trade (tick per tick)
  // ============================================================
  const rtBrokerCode = (s) => { const m = String(s || '').match(/^([A-Z]{2})/); return m ? m[1] : '??'; };
  const rtNum = (s) => { const n = parseFloat(String(s || '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

  // PENTING: pagination running trade = CURSOR via trade_number terakhir
  // (param `page` TIDAK berfungsi — mengembalikan 100 transaksi sama berulang).
  // order_by=1 = urut waktu naik (dari pembukaan). date=YYYY-MM-DD utk historis.
  async function fetchRunningTrade(sym, opts) {
    opts = opts || {};
    const maxBatches = opts.maxBatches || 2000;   // 2000×100 = 200.000 transaksi (menjangkau seluruh hari bursa dari jam 08:58)
    const dateParam = opts.date ? `&date=${opts.date}` : '';
    const limit = opts.limit || 1000;
    const all = [];
    let cursor = null, wholeDay = false;
    for (let b = 0; b < maxBatches; b++) {
      let rt;
      try {
        const url = `https://exodus.stockbit.com/order-trade/running-trade?symbols[]=${sym}&sort=ASC&order_by=RUNNING_TRADE_ORDER_BY_TIME&limit=${limit}${dateParam}` + (cursor ? `&trade_number=${cursor}` : '');
        const j = await apiGet(url);
        rt = (j && j.data && j.data.running_trade) || [];
      } catch (e) { break; }
      if (!rt.length) { wholeDay = true; break; }
      for (const t of rt) {
        all.push({
          time: t.time, action: t.action, price: rtNum(t.price), lot: rtNum(t.lot),
          val: (t.value && t.value.raw) || 0,
          buyer: rtBrokerCode(t.buyer), seller: rtBrokerCode(t.seller),
          buyOrd: t.buy_order_number, sellOrd: t.sell_order_number,
        });
      }
      const nc = rt[rt.length - 1].trade_number;
      if (nc === cursor) { wholeDay = true; break; }  // tidak maju lagi
      cursor = nc;
      if (opts.onProgress) opts.onProgress(all.length);
      await sleep(55);
    }
    all.wholeDay = wholeDay;
    return all;
  }

  // analisa cara smart money bertransaksi (split/iceberg, agresor, broker borong)
  function analyzeTransactions(trades) {
    if (!trades.length) return null;
    let aggrBuyVal = 0, aggrSellVal = 0, aggrBuyLot = 0, aggrSellLot = 0;
    const byBuyer = {}, bySeller = {}, buyOrders = {}, sellOrders = {};
    for (const t of trades) {
      const buyAggr = t.action === 'buy';
      if (buyAggr) { aggrBuyVal += t.val; aggrBuyLot += t.lot; byBuyer[t.buyer] = (byBuyer[t.buyer] || 0) + t.val; }
      else { aggrSellVal += t.val; aggrSellLot += t.lot; bySeller[t.seller] = (bySeller[t.seller] || 0) + t.val; }
      // agregasi per nomor order (deteksi split/iceberg)
      const bo = (buyOrders[t.buyOrd] = buyOrders[t.buyOrd] || { n: 0, val: 0, brk: t.buyer });
      bo.n++; bo.val += t.val;
      const so = (sellOrders[t.sellOrd] = sellOrders[t.sellOrd] || { n: 0, val: 0, brk: t.seller });
      so.n++; so.val += t.val;
    }
    // order split = satu nomor order dieksekusi di banyak transaksi (menyembunyikan ukuran)
    const splitBuys = Object.values(buyOrders).filter((o) => o.n >= 4).sort((a, b) => b.val - a.val);
    const splitSells = Object.values(sellOrders).filter((o) => o.n >= 4).sort((a, b) => b.val - a.val);
    const splitBuyVal = splitBuys.reduce((a, o) => a + o.val, 0);
    const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([code, val]) => ({ code, val }));
    const totVal = aggrBuyVal + aggrSellVal || 1;

    // PERILAKU PER BROKER (untuk deteksi smart money yg menyamar via broker ritel):
    // agregasi order beli tiap broker + berapa yg di-split (iceberg)
    const brokerBuy = {};
    for (const o of Object.values(buyOrders)) {
      const b = (brokerBuy[o.brk] = brokerBuy[o.brk] || { code: o.brk, buyVal: 0, orders: 0, splitOrders: 0, splitVal: 0, maxN: 0 });
      b.buyVal += o.val; b.orders++;
      if (o.n >= 4) { b.splitOrders++; b.splitVal += o.val; b.maxN = Math.max(b.maxN, o.n); }
    }
    // broker ritel yg SEBENARNYA institusi: net beli besar + banyak order di-split (iceberg)
    const smartViaRetail = Object.values(brokerBuy)
      .filter((b) => isRetailBroker(b.code) && b.splitOrders >= 2 && (b.splitVal >= aggrBuyVal * 0.06 || b.maxN >= 8))
      .sort((a, b) => b.splitVal - a.splitVal)
      .map((b) => ({ ...b, avgPerOrder: b.buyVal / Math.max(b.orders, 1) }));
    // rentang waktu cuplikan (running trade terurut terbaru->lama)
    const times = trades.map((t) => t.time).filter(Boolean);
    const spanTxt = times.length >= 2 ? `${times[times.length - 1]}–${times[0]}` : (times[0] || '');
    return {
      nTrades: trades.length, spanTxt,
      aggrBuyVal, aggrSellVal, aggrBuyLot, aggrSellLot,
      buyRatio: aggrBuyVal / totVal,
      topBuyers: top(byBuyer), topSellers: top(bySeller),
      splitBuyCount: splitBuys.length, splitBuyVal, biggestSplit: splitBuys[0] || null,
      splitSellCount: splitSells.length,
      smartViaRetail,
      avgTrade: totVal / trades.length,
    };
  }

  // ============================================================
  // UI
  // ============================================================
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
    .fab {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
      width: 46px; height: 46px; border-radius: 14px; border: none; cursor: pointer;
      background: linear-gradient(135deg,#00c88a,#00996e); color: #fff; font-weight: 800; font-size: 14px;
      box-shadow: 0 6px 18px rgba(0,0,0,.5); transition: transform .12s;
    }
    .fab:hover { transform: scale(1.06); }
    .panel {
      position: fixed; right: 18px; bottom: 74px; z-index: 2147483000;
      width: 388px; height: 580px; min-width: 320px; min-height: 260px;
      max-width: 96vw; max-height: 92vh; display: none; flex-direction: column;
      background: #14171d; color: #e4e8ef; border: 1px solid #2a2f3a; border-radius: 14px;
      box-shadow: 0 16px 44px rgba(0,0,0,.62); font-size: 12.5px; overflow: hidden;
      resize: both;
    }
    .panel.open { display: flex; }
    /* full-screen: penuhi layar */
    .panel.full { left: 2vw !important; top: 2vh !important; right: auto !important; bottom: auto !important; width: 96vw !important; height: 96vh !important; max-width: 96vw; max-height: 96vh; resize: none; border-radius: 12px; }
    /* minimize: hanya header */
    .panel.min { height: auto !important; min-height: 0; resize: none; }
    .panel.min .tabs, .panel.min .body { display: none; }
    /* header */
    .hd { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #191d25; cursor: move; user-select: none; border-bottom: 1px solid #262c37; flex: 0 0 auto; }
    .hd .logo { font-size: 14px; }
    .hd b { color: #00d69a; font-size: 13px; letter-spacing: .2px; }
    .hd .sym { color: #f2c14e; font-weight: 800; font-size: 13px; }
    .hd .sp { margin-left: auto; }
    .hd .ic { cursor: pointer; background: none; border: none; color: #8b93a3; font-size: 15px; padding: 2px 4px; border-radius: 5px; }
    .hd .ic:hover { color: #e4e8ef; background: #262c37; }
    /* tabs */
    .tabs { display: flex; background: #191d25; border-bottom: 1px solid #262c37; flex: 0 0 auto; }
    .tab { flex: 1; text-align: center; padding: 8px 4px; font-size: 11.5px; font-weight: 600; color: #8b93a3; cursor: pointer; border-bottom: 2px solid transparent; user-select: none; }
    .tab:hover { color: #c3cad6; }
    .tab.active { color: #00d69a; border-bottom-color: #00d69a; background: #14171d; }
    /* body */
    .body { overflow-y: auto; overflow-x: hidden; padding: 12px; flex: 1 1 auto; position: relative; }
    .pane { display: none; }
    .pane.active { display: block; }
    /* full-screen: outlook 1-saham dipusatkan (enak dibaca), tapi daftar kartu
       & kontrol memakai LEBAR PENUH layar */
    .panel.full .rov > .rovwrap { max-width: 860px; margin: 0 auto; }
    .panel.full .fullwide { max-width: 1100px; margin: 0 auto 10px; } /* kontrol scan tetap rapi */
    /* grid kartu hasil: 1 kolom saat sempit, sebanyak mungkin saat lebar/full */
    .cardgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 7px; }
    /* research overlay (outlook) menutupi area body */
    .rov { position: absolute; inset: 0; background: #14171d; overflow-y: auto; padding: 12px; display: none; }
    .rov.open { display: block; }
    .row { display: flex; gap: 7px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
    .row label { color: #8b93a3; min-width: 70px; font-size: 11.5px; }
    select, .btn, input[type="number"], input[type="date"] {
      background: #232833; color: #e4e8ef; border: 1px solid #343b48; border-radius: 7px; padding: 6px 9px; font-size: 12px;
    }
    input[type="number"] { width: 62px; } input:focus, select:focus { outline: none; border-color: #00b47e; }
    input[type="date"] { width: 130px; color-scheme: dark; }
    .hint { color: #6d7585; font-size: 10.5px; }
    .chip { cursor: pointer; font-size: 10.5px; color: #aeb6c4; background: #232833; border: 1px solid #343b48; border-radius: 20px; padding: 3px 10px; user-select: none; }
    .chip:hover { border-color: #00b47e; color: #00d69a; }
    .help { background: #1b212c; border: 1px solid #2c3550; border-radius: 9px; padding: 10px 12px; margin: 4px 0 10px; font-size: 11.5px; line-height: 1.6; color: #aeb6c4; }
    .help b { color: #e4e8ef; }
    .btn { cursor: pointer; font-weight: 600; transition: filter .1s; }
    .btn:hover { filter: brightness(1.15); }
    .btn.primary { background: linear-gradient(135deg,#00b47e,#009068); border-color: #00b47e; color: #fff; }
    .btn.warn { background: transparent; color: #eb6b69; border-color: #5a3336; }
    .btn.big2 { flex: 1; text-align: center; padding: 9px; }
    .btn:disabled { opacity: .45; cursor: default; }
    .btn.on { background: linear-gradient(135deg,#f2a03e,#e07b1a); border-color: #f2a03e; color: #1a1204; }
    .status { font-size: 11.5px; color: #8b93a3; margin: 6px 0; line-height: 1.5; }
    .status .ok { color: #00d69a; } .status .no { color: #eb6b69; }
    .prog { font-size: 11.5px; color: #f2c14e; margin: 6px 0; min-height: 15px; }
    .grp { background: #171b22; border: 1px solid #242a34; border-radius: 10px; padding: 10px; margin-bottom: 10px; }
    .grp > .gt { font-size: 10.5px; color: #78808f; font-weight: 700; letter-spacing: .5px; margin-bottom: 8px; text-transform: uppercase; }
    .sec { margin-top: 12px; border-top: 1px solid #262c37; padding-top: 10px; }
    .sec h4 { margin: 0 0 8px; font-size: 12px; color: #aeb6c4; letter-spacing: .4px; }
    .phase { border: 1px solid #2a2f3a; border-radius: 9px; padding: 8px 10px; margin-bottom: 8px; background: #171b22; }
    .phase .tag { font-weight: 800; font-size: 11px; padding: 2px 7px; border-radius: 4px; }
    .tag.A { background: rgba(0,180,126,.16); color: #00d69a; }
    .tag.D { background: rgba(235,77,75,.16); color: #ff7b79; }
    .phase .meta { color: #8b93a3; font-size: 11.5px; margin-top: 4px; line-height: 1.55; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th { text-align: left; color: #78808f; font-weight: 600; padding: 4px 5px; border-bottom: 1px solid #262c37; }
    td { padding: 4px 5px; border-bottom: 1px solid #20252e; }
    td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
    .pos { color: #00d69a; } .neg { color: #ff7b79; }
    .vd { font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; white-space: nowrap; }
    .vd.sa { background: rgba(0,180,126,.18); color: #00d69a; }
    .vd.sd { background: rgba(235,77,75,.18); color: #ff7b79; }
    .vd.nb { background: rgba(0,180,126,.08); color: #57b893; }
    .vd.ns { background: rgba(235,77,75,.08); color: #c97b7a; }
    .vd.rt { background: rgba(242,193,78,.14); color: #f2c14e; }
    /* orderbook ladder */
    .lad { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 11.5px; }
    .lad td { padding: 0; border: none; height: 20px; position: relative; }
    .lad .cell { position: relative; height: 20px; display: flex; align-items: center; overflow: hidden; }
    .lad .cell.b { justify-content: flex-end; padding-right: 6px; }
    .lad .cell.o { justify-content: flex-start; padding-left: 6px; }
    .lad .dbar { position: absolute; top: 1px; bottom: 1px; border-radius: 2px; z-index: 0; }
    .lad .dbar.b { right: 0; background: rgba(0,180,126,.22); }
    .lad .dbar.o { left: 0; background: rgba(235,77,75,.22); }
    .lad .v { position: relative; z-index: 1; color: #c8cfda; }
    .lad .q { position: relative; z-index: 1; color: #6d7585; font-size: 10px; padding: 0 5px; }
    .lad .px { text-align: center; font-weight: 800; width: 58px; }
    .lad .px.b { color: #00d69a; } .lad .px.o { color: #ff7b79; }
    .lad tr.fake .dbar { outline: 1.5px solid #f2c14e; }
    .lad tr.fake .px::after { content: '⚠'; margin-left: 3px; color: #f2c14e; }
    .lad .hdr td { color: #6d7585; font-size: 9.5px; font-weight: 700; text-transform: uppercase; text-align: center; padding-bottom: 3px; height: auto; }
    .quote { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
    .quote .p { font-size: 22px; font-weight: 800; }
    .quote .c { font-size: 13px; font-weight: 700; }
    .quote .live { font-size: 9px; font-weight: 800; color: #14171d; background: #00d69a; padding: 1px 5px; border-radius: 4px; }
    .gauge { height: 18px; border-radius: 5px; background: #eb4d4b; position: relative; overflow: hidden; margin: 6px 0; display: flex; align-items: center; }
    .gauge .fill { height: 100%; background: #00b47e; position: absolute; left: 0; }
    .gauge .mid { position: absolute; left: 50%; top: 0; height: 100%; width: 1px; background: rgba(255,255,255,.5); }
    .gauge .lbl { position: relative; z-index: 1; width: 100%; text-align: center; font-size: 10px; font-weight: 800; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
    .kv { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #20252e; }
    .kv .k { color: #8b93a3; } .kv .v { font-variant-numeric: tabular-nums; font-weight: 600; }
    .big { font-size: 15px; font-weight: 800; }
    .timeline { display: flex; height: 14px; border-radius: 4px; overflow: hidden; margin: 6px 0 2px; background: #232833; }
    .timeline div { height: 100%; }
    .tl-lbl { display: flex; justify-content: space-between; color: #78808f; font-size: 10.5px; }
    .note { color: #6d7585; font-size: 10.5px; margin-top: 10px; line-height: 1.5; }
    .concl { background: #1c2230; border: 1px solid #2c3550; border-radius: 9px; padding: 8px 10px; margin-bottom: 10px; line-height: 1.55; }
    .grip { position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px; z-index: 3; pointer-events: none; color: #4a5262; font-size: 11px; line-height: 14px; text-align: right; }
  `;

  let ui = null;

  function buildUI() {
    const host = document.createElement('div');
    host.id = '__bm_host';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.textContent = 'BM';
    fab.title = 'Brokermology';
    root.appendChild(fab);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="hd">
        <span class="logo">📊</span><b>Brokermology</b><span class="sym" id="sym"></span>
        <span class="sp"></span>
        <button class="ic" id="minBtn" title="Minimize">—</button>
        <button class="ic" id="fullBtn" title="Layar penuh">⛶</button>
        <button class="ic x" title="Tutup">✕</button>
      </div>
      <div class="tabs">
        <div class="tab active" data-tab="screener">🔍 Screener</div>
        <div class="tab" data-tab="toppick">🚀 Top Pick</div>
        <div class="tab" data-tab="bandar">🐋 Bandar</div>
        <div class="tab" data-tab="teknik">📈 Teknikal</div>
        <div class="tab" data-tab="scalp">⚡ Scalping</div>
        <div class="tab" data-tab="pushdata">📥 Push Data</div>
        <div class="tab" data-tab="info">ℹ️ Info</div>
      </div>
      <div class="body">
        <!-- ===== TAB SCREENER ===== -->
        <div class="pane active" id="pane-screener">
          <div class="grp">
            <div class="gt">Cari saham potensial</div>
            <div class="row"><label>Sumber</label>
              <select id="scrSrc">
                <option value="trending">Saham teraktif pasar + input</option>
                <option value="watchlist">Hanya input saya</option>
              </select>
            </div>
            <div class="row"><label>Jumlah</label>
              <select id="scrN">
                <option value="25">25 saham (cepat)</option>
                <option value="50" selected>50 saham</option>
                <option value="100">100 saham (menyeluruh, ±5 mnt)</option>
              </select>
            </div>
            <div class="row"><label>Simbol</label>
              <input type="text" id="scrSyms" placeholder="BBCA BBRI TLKM…" style="flex:1;min-width:120px">
            </div>
            <div class="row"><label>Berapa hari</label>
              <input type="number" id="scrDays" min="15" max="200" value="63" style="width:64px">
              <span class="hint">hari bursa akumulasi</span>
              <span class="chip" data-days="21">21</span>
              <span class="chip" data-days="63">63</span>
              <span class="chip" data-days="126">126</span>
            </div>
            <div class="row"><label>Profil</label>
              <select id="scrProfile">
                <option value="all">Semua (skor gabungan)</option>
                <option value="scalp">⚡ Scalping</option>
                <option value="daytrade">📊 Daytrade</option>
                <option value="swing">🌊 Swing</option>
              </select>
              <select id="scrCat">
                <option value="all">Semua kategori</option>
                <option value="bluechip">💎 Blue chip</option>
                <option value="second">🔷 Second</option>
                <option value="third">🔸 Third</option>
              </select>
            </div>
          </div>
          <div class="row"><button class="btn primary big2" id="scrRun">🔍 Scan Saham</button></div>
          <div class="prog" id="scrProg"></div>
          <div id="scrOut"></div>
          <div class="note">1 klik = outlook lengkap. Tahap 1: scan akumulasi+teknikal+PVA+likuiditas semua saham. Tahap 2: rekap transaksi otomatis untuk 12 kandidat teratas (🔬 di kartu). Klik saham → outlook penuh + transaksi seluruh hari (bisa ganti tanggal). A=Akumulasi T=Teknikal V=PVA L=Likuiditas. Bukan rekomendasi.</div>
        </div>
        <!-- ===== TAB TOP PICK ===== -->
        <div class="pane" id="pane-toppick">
          <div class="grp">
            <div class="gt">🚀 Top Pick — Potensi Naik Tinggi</div>
            <div class="hint" style="margin-bottom:8px">Bukan daftar panjang — cuma saham yang lolos SEMUA syarat ketat sekaligus: akumulasi smart money, tren/momentum sehat, demand nyata, foreign flow mendukung, dan belum overbought. Sedikit tapi meyakinkan. Bukan rekomendasi jual/beli.</div>
            <div class="row"><label>Sumber</label>
              <select id="tpSrc">
                <option value="trending">Saham teraktif pasar + input</option>
                <option value="watchlist">Hanya input saya</option>
              </select>
            </div>
            <div class="row"><label>Jumlah scan</label>
              <select id="tpN">
                <option value="80">80 saham (cepat)</option>
                <option value="150" selected>150 saham</option>
                <option value="250">250 saham (menyeluruh, lebih lama)</option>
              </select>
            </div>
            <div class="row"><label>Simbol</label>
              <input type="text" id="tpSyms" placeholder="BBCA BBRI TLKM…" style="flex:1;min-width:120px">
            </div>
            <div class="row"><label>Maks hasil</label>
              <input type="number" id="tpMax" min="3" max="15" value="8" style="width:56px">
              <span class="hint">saham teratas saja — bukan daftar panjang</span>
            </div>
          </div>
          <div class="row"><button class="btn primary big2" id="tpRun">🚀 Cari Top Pick</button></div>
          <div class="prog" id="tpProg"></div>
          <div id="tpOut"></div>
          <div class="note">Syarat lolos (semua wajib): skor komposit ≥ ambang tinggi · tren tidak turun · RSI belum overbought · likuiditas cukup · DAN minimal 2 dari (akumulasi senyap / barang kering / dekat breakout / foreign inflow / demand kuat / ritel keluar). Klik saham → outlook lengkap.</div>
        </div>
        <!-- ===== TAB BANDAR ===== -->
        <div class="pane" id="pane-bandar">
          <div class="grp">
            <div class="gt">🔍 Scan akumulasi pasar</div>
            <div class="hint" style="margin-bottom:8px">Cari saham yang sedang diakumulasi <b>beberapa bandar smart money</b> sekaligus, dari seluruh emiten likuid.</div>
            <div class="row"><label>Periode</label>
              <input type="number" id="accDays" min="15" max="200" value="63" style="width:60px"><span class="hint">hari</span>
              <label style="min-width:auto">Min bandar</label>
              <input type="number" id="accMin" min="1" max="6" value="2" style="width:48px">
            </div>
            <div class="row"><label>Jumlah</label>
              <select id="accN">
                <option value="50">50 emiten</option>
                <option value="80" selected>80 emiten</option>
                <option value="130">130 emiten (menyeluruh)</option>
              </select>
            </div>
            <div class="row"><button class="btn primary big2" id="accBtn">🐋 Scan Saham Diakumulasi</button></div>
            <div class="prog" id="accProg"></div>
            <div id="accOut"></div>
          </div>
          <div class="grp">
            <div class="gt">Analisa 1 saham (fase akumulasi/distribusi)</div>
            <div class="hint" style="margin-bottom:6px">Buka halaman saham lalu jalankan analisa fase di chart.</div>
            <div class="row"><label>Tanggal</label>
              <input type="date" id="dateFrom"><span class="hint">s/d</span><input type="date" id="dateTo">
            </div>
            <div class="row"><label></label>
              <span class="chip" data-range="31">1 bln</span>
              <span class="chip" data-range="92">3 bln</span>
              <span class="chip" data-range="183">6 bln</span>
              <span class="chip" data-range="366">1 thn</span>
            </div>
            <div class="row"><label>Jendela fase</label>
              <select id="win">
                <option value="5">5 hari</option><option value="7">7 hari</option>
                <option value="10" selected>10 hari</option><option value="15">15 hari</option><option value="20">20 hari</option>
              </select>
            </div>
            <div class="row"><label>Sensitivitas</label>
              <select id="sens">
                <option value="rendah">Rendah</option><option value="sedang" selected>Sedang</option><option value="tinggi">Tinggi</option>
              </select>
            </div>
          </div>
          <div class="row">
            <button class="btn primary big2" id="run">▶ Jalankan Analisa</button>
          </div>
          <div class="row">
            <button class="btn" id="draw" disabled>🖊 Gambar fase</button>
            <button class="btn warn" id="clear">Hapus marka</button>
          </div>
          <div class="status" id="status"></div>
          <div class="prog" id="prog"></div>
          <div id="out"></div>
        </div>
        <!-- ===== TAB TEKNIKAL ===== -->
        <div class="pane" id="pane-teknik">
          <div class="grp">
            <div class="gt">Setelan indikator</div>
            <div class="row"><label>MA</label>
              <select id="maType"><option value="EMA" selected>EMA</option><option value="SMA">SMA</option></select>
              <input type="number" id="maFast" min="2" max="200" value="9" title="MA cepat">
              <input type="number" id="maSlow" min="3" max="400" value="21" title="MA lambat">
            </div>
            <div class="row"><label></label>
              <span class="chip" data-ma="9,21">Daytrade 9/21</span>
              <span class="chip" data-ma="21,50">Swing 21/50</span>
            </div>
            <div class="row"><label>RSI</label>
              <input type="number" id="rsiLen" min="2" max="50" value="14">
              <span class="hint">dipakai 🧠 & ⚡</span>
            </div>
          </div>
          <div class="row">
            <button class="btn primary" id="teknikBtn">🧠 Analisa</button>
            <button class="btn primary" id="sinyalBtn">⚡ Sinyal</button>
            <button class="btn primary" id="pvaBtn">📊 Vol</button>
          </div>
          <div class="row">
            <button class="btn" id="srBtn">📏 S/R</button>
            <button class="btn" id="tpBtn">🎯 TP/SL</button>
            <button class="btn" id="fibBtn">ƒ Fib</button>
          </div>
          <div id="indiOut"></div>
        </div>
        <!-- ===== TAB SCALPING ===== -->
        <div class="pane" id="pane-scalp">
          <div class="row">
            <button class="btn primary big2" id="tapeBtn">⚡ Live Tape: OFF</button>
          </div>
          <div class="hint" style="margin:-2px 0 8px">Sinyal scalp realtime: konfluensi imbalance + HAKA/HAKI + VWAP + momentum + ARA/ARB.</div>
          <div id="tapeOut"></div>
          <div class="grp" style="margin-top:10px">
            <div class="gt">🇮🇩 IDX Scalper (strategi Pine)</div>
            <div class="row"><label>Timeframe</label>
              <select id="idxTf"><option value="1m">1m</option><option value="5m" selected>5m</option><option value="15m">15m</option></select>
              <button class="btn primary" id="idxBtn" style="margin-left:auto">🇮🇩 IDX Scalper: OFF</button>
            </div>
            <div class="hint">EMA7/21 + VWAP + tren HTF + volume + RSI/EMA/ORB, fee-aware TP, filter ARA & sesi IDX. Gambar BUY/EXIT + TP/SL di Chartbit. Butuh Live Tape nyala (candle dari tick).</div>
            <div id="idxOut"></div>
          </div>
          <div class="grp" style="margin-top:10px">
            <div class="gt">Monitor sinyal (multi timeframe)</div>
            <div class="row"><label>Timeframe</label>
              <select id="monTf">
                <option value="1m">1m — scalping</option>
                <option value="5m">5m — scalping</option>
                <option value="15m" selected>15m — daytrade</option>
                <option value="1h">1h — daytrade</option>
                <option value="1D">1D — swing</option>
              </select>
            </div>
            <div class="row">
              <button class="btn big2" id="monBtn">🔔 Monitor Sinyal: OFF</button>
            </div>
            <div class="hint">Sinyal MA/RSI/breakout pada timeframe pilihan. Intraday dibangun dari tick realtime (nyalakan Live Tape agar tick mengalir).</div>
            <div id="monOut"></div>
          </div>
        </div>
        <!-- ===== TAB PUSH DATA ===== -->
        <div class="pane" id="pane-pushdata">
          <div class="grp">
            <div class="gt">📥 Tarik & Push Data ke Terminal Server</div>
            <div class="hint" style="margin-bottom:8px">Tarik data historis dari Stockbit dan push ke database MySQL server tanpa duplikasi data.</div>
            
            <div class="row"><label>Tipe Data</label>
              <select id="pushDataType">
                <option value="runningTrade">⚡ Running Trade (Print Transaksi Broker)</option>
                <option value="brokerSummary">📊 Broker Summary Harian</option>
                <option value="dailyBars">📈 Candle Harian (OHLCV)</option>
                <option value="keystats">💎 KeyStats & Dividen</option>
                <option value="marketMovers">🔥 Market Movers Pasar</option>
                <option value="insider">👔 Insider / Major Holder</option>
                <option value="calendar">📅 Kalender Aksi Korporasi</option>
                <option value="financialStatements">📑 Laporan Keuangan (Laba Rugi/Neraca/Arus Kas)</option>
              </select>
            </div>

            <div class="row"><label>Simbol</label>
              <input type="text" id="pushSymbol" placeholder="misal: PSAB, BBCA, GOTO" value="PSAB" style="flex:1">
            </div>

            <div class="row"><label>Tanggal</label>
              <input type="date" id="pushDate" style="flex:1">
              <button class="chip" id="pushDateYesterday">Kemarin</button>
              <button class="chip" id="pushDateToday">Hari Ini</button>
            </div>

            <div class="row" style="margin-top:8px">
              <button class="btn primary big2" id="pushRun">▶ PUSH DATA KE SERVER</button>
            </div>
          </div>

          <div id="pushProg" style="font-size:11px;color:#aeb6c4;line-height:1.5;margin-top:6px"></div>
          <div id="pushOut" style="margin-top:8px"></div>

          <div class="grp" style="margin-top:14px">
            <div class="gt">🗄️ Backfill Massal Candle Harian — SEMUA Saham BEI</div>
            <div class="hint" style="margin-bottom:8px">
              Tarik & simpan histori candle harian ke server untuk seluruh saham tercatat BEI
              (±956 emiten), dari tanggal listing masing-masing sampai hari ini. Sengaja dibuat
              PELAN & sopan ke Stockbit (throttle antar-request) — boleh dibiarkan berjalan lama,
              yang penting semua data masuk. Progres otomatis tersimpan; kalau terhenti
              (tab ditutup/koneksi putus), klik "Mulai Backfill" lagi untuk melanjutkan dari
              saham yang belum selesai, bukan mulai dari nol.
            </div>
            <div class="row"><label>Mulai dari</label>
              <input type="date" id="bfFrom" style="flex:1">
              <span class="hint" style="white-space:nowrap">kosong = tgl listing tiap saham</span>
            </div>
            <div class="row"><label>Universe</label>
              <select id="bfUniverse">
                <option value="all">Semua saham BEI (±956 emiten)</option>
                <option value="watchlist">Watchlist manual (kolom simbol di tab Screener)</option>
              </select>
            </div>
            <div class="row" style="margin-top:8px;gap:8px">
              <button class="btn primary big2" id="bfStart">▶ Mulai Backfill</button>
              <button class="btn big2" id="bfStop" disabled>⏸ Stop</button>
              <button class="btn" id="bfReset">↺ Reset progres</button>
            </div>
            <div id="bfProg" style="font-size:11px;color:#aeb6c4;line-height:1.5;margin-top:6px">Belum pernah dijalankan.</div>
            <div id="bfBar" style="height:6px;border-radius:3px;background:#232833;margin-top:4px;overflow:hidden"><div id="bfBarFill" style="height:100%;width:0%;background:#00d69a"></div></div>
          </div>

          <div class="grp" style="margin-top:14px">
            <div class="gt">🏛️ Kepemilikan KSEI (SID &amp; Scripless)</div>
            <div class="hint" style="margin-bottom:8px">
              Menarik graf kepemilikan (investor per emiten, pecahan scrip/scripless) dari
              endpoint shareholding network Stockbit. Sumbernya laporan BULANAN KSEI, jadi
              cukup dijalankan sekali tiap bulan — bulan yang sudah ditarik otomatis dilewati.
              Cakupan tumbuh tiap kali dijalankan: tiap graf mengajarkan pemetaan simbol baru.
            </div>
            <div class="row" style="gap:8px">
              <button class="btn primary big2" id="shStart">▶ Tarik Kepemilikan</button>
              <button class="btn big2" id="shStop" disabled>⏸ Stop</button>
            </div>
            <div id="shProg" style="font-size:11px;color:#aeb6c4;line-height:1.5;margin-top:6px">Belum pernah dijalankan.</div>
          </div>

          <div class="grp" style="margin-top:14px">
            <div class="gt">📼 Backfill Running Trade (Tape Transaksi Lengkap)</div>
            <div class="hint" style="margin-bottom:8px">
              Tarik SEMUA cetakan transaksi (bukan cuma top-12 kandidat hasil scan) untuk saham &
              rentang tanggal pilihan Anda, lalu simpan ke server — supaya broker footprint per
              hari bisa diolah lintas hari, bukan cuma hari yang kebetulan sedang discan.
              Sengaja dibatasi ke saham yang Anda pilih sendiri (BUKAN otomatis 956 saham BEI) —
              data tape jauh lebih besar & berat dari candle harian; scoping ke watchlist sendiri
              mengikuti prinsip yang sama dengan Scan Akumulasi/Screener supaya tidak terlihat
              seperti bot spam ke Stockbit.
            </div>
            <div class="row"><label>Simbol</label>
              <input type="text" id="rtSyms" placeholder="misal: PSAB BBCA GOTO" style="flex:1">
            </div>
            <div class="row"><label>Dari tanggal</label>
              <input type="date" id="rtFrom" style="flex:1">
              <span class="hint">s/d</span>
              <input type="date" id="rtTo" style="flex:1">
            </div>
            <div class="row" style="margin-top:8px;gap:8px">
              <button class="btn primary big2" id="rtStart">▶ Mulai Backfill Tape</button>
              <button class="btn big2" id="rtStop" disabled>⏸ Stop</button>
              <button class="btn" id="rtReset">↺ Reset progres</button>
            </div>
            <div id="rtProg" style="font-size:11px;color:#aeb6c4;line-height:1.5;margin-top:6px">Belum pernah dijalankan.</div>
            <div id="rtBar" style="height:6px;border-radius:3px;background:#232833;margin-top:4px;overflow:hidden"><div id="rtBarFill" style="height:100%;width:0%;background:#00d69a"></div></div>
          </div>
        </div>

        <!-- ===== TAB INFO ===== -->
        <div class="pane" id="pane-info">
          <div class="grp">
            <div class="gt">Penjelasan pengaturan</div>
            <div style="font-size:11.5px;line-height:1.6;color:#aeb6c4">
              <b style="color:#e4e8ef">📅 Periode</b> — rentang tanggal dianalisa. Panjang = lihat akumulasi bandar yang dicicil; pendek = momentum terkini. Maks ±250 hari bursa.<br><br>
              <b style="color:#e4e8ef">🔲 Jendela fase</b> — lebar "kaca pembesar" pendeteksi fase. Pendek (5–7) untuk fase cepat/swing; panjang (15–20) untuk fase besar yang rapi.<br><br>
              <b style="color:#e4e8ef">🎚 Sensitivitas</b> — ketatnya ambang. Rendah = sedikit tapi meyakinkan; Tinggi = banyak sinyal + noise. Mulai Sedang, naikkan bila tak ada fase.<br><br>
              <b style="color:#e4e8ef">⚡ Live Tape</b> — baca orderbook realtime, deteksi bid/offer palsu & HAKA besar. <b style="color:#e4e8ef">🐋 Bandar</b> — deteksi fase akumulasi/distribusi + smart money.
            </div>
          </div>
          <div class="row"><button class="btn" id="diag">🔧 Diagnosa koneksi</button></div>
          <div id="diagOut"></div>
          <div class="note">Heuristik brokermology — bukan rekomendasi jual/beli. Clean Buy% = (Buy−Sell)/Buy. Avg/Trx = nilai per transaksi dari frekuensi. Klasifikasi broker indikatif. Lot = lembar ÷ 100.</div>
        </div>
        <!-- ===== RESEARCH OVERLAY (outlook, dipanggil dari Screener & Bandar) ===== -->
        <div class="rov" id="researchOverlay"></div>
      </div>
      <div class="grip">◢</div>`;
    root.appendChild(panel);

    fab.onclick = () => panel.classList.toggle('open');
    panel.querySelector('.x').onclick = () => panel.classList.remove('open');

    // tab switching (juga menutup overlay research)
    panel.querySelectorAll('.tab').forEach((t) => {
      t.onclick = () => {
        closeResearch();
        panel.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
        panel.querySelectorAll('.pane').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        panel.querySelector('#pane-' + t.dataset.tab).classList.add('active');
      };
    });

    // full-screen toggle
    panel.querySelector('#fullBtn').onclick = () => {
      panel.classList.remove('min');
      const on = panel.classList.toggle('full');
      panel.querySelector('#fullBtn').textContent = on ? '❐' : '⛶';
      panel.querySelector('#fullBtn').title = on ? 'Keluar layar penuh' : 'Layar penuh';
    };
    // minimize toggle (kolapskan ke header)
    panel.querySelector('#minBtn').onclick = () => {
      panel.classList.remove('full');
      panel.querySelector('#fullBtn').textContent = '⛶';
      panel.classList.toggle('min');
    };

    // panel bisa digeser lewat header; posisi jadi eksplisit agar resize (grip) tumbuh ke kanan-bawah
    const hd = panel.querySelector('.hd');
    const anchorTopLeft = () => {
      const r = panel.getBoundingClientRect();
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    };
    let anchored = false;
    let drag = null;
    hd.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ic')) return;
      if (!anchored) { anchorTopLeft(); anchored = true; }
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      panel.style.left = `${Math.max(0, e.clientX - drag.dx)}px`;
      panel.style.top = `${Math.max(0, e.clientY - drag.dy)}px`;
    });
    window.addEventListener('mouseup', () => (drag = null));
    // saat pertama dibuka, jadikan posisi eksplisit supaya native resize (pojok kanan-bawah) enak
    fab.addEventListener('click', () => { if (panel.classList.contains('open') && !anchored) { anchorTopLeft(); anchored = true; } }, { once: false });

    ui = {
      panel,
      sym: panel.querySelector('#sym'),
      dateFrom: panel.querySelector('#dateFrom'),
      dateTo: panel.querySelector('#dateTo'),
      win: panel.querySelector('#win'),
      sens: panel.querySelector('#sens'),
      maType: panel.querySelector('#maType'),
      maFast: panel.querySelector('#maFast'),
      maSlow: panel.querySelector('#maSlow'),
      rsiLen: panel.querySelector('#rsiLen'),
      srBtn: panel.querySelector('#srBtn'),
      indiOut: panel.querySelector('#indiOut'),
      teknikBtn: panel.querySelector('#teknikBtn'),
      fibBtn: panel.querySelector('#fibBtn'),
      sinyalBtn: panel.querySelector('#sinyalBtn'),
      monBtn: panel.querySelector('#monBtn'),
      monTf: panel.querySelector('#monTf'),
      monOut: panel.querySelector('#monOut'),
      idxTf: panel.querySelector('#idxTf'),
      idxBtn: panel.querySelector('#idxBtn'),
      idxOut: panel.querySelector('#idxOut'),
      tapeBtn: panel.querySelector('#tapeBtn'),
      tapeOut: panel.querySelector('#tapeOut'),
      tpBtn: panel.querySelector('#tpBtn'),
      pvaBtn: panel.querySelector('#pvaBtn'),
      run: panel.querySelector('#run'),
      draw: panel.querySelector('#draw'),
      clear: panel.querySelector('#clear'),
      scrSrc: panel.querySelector('#scrSrc'),
      scrN: panel.querySelector('#scrN'),
      scrSyms: panel.querySelector('#scrSyms'),
      scrDays: panel.querySelector('#scrDays'),
      scrProfile: panel.querySelector('#scrProfile'),
      scrCat: panel.querySelector('#scrCat'),
      scrRun: panel.querySelector('#scrRun'),
      scrProg: panel.querySelector('#scrProg'),
      scrOut: panel.querySelector('#scrOut'),
      tpSrc: panel.querySelector('#tpSrc'),
      tpN: panel.querySelector('#tpN'),
      tpSyms: panel.querySelector('#tpSyms'),
      tpMax: panel.querySelector('#tpMax'),
      tpRun: panel.querySelector('#tpRun'),
      tpProg: panel.querySelector('#tpProg'),
      tpOut: panel.querySelector('#tpOut'),
      accDays: panel.querySelector('#accDays'),
      accMin: panel.querySelector('#accMin'),
      accN: panel.querySelector('#accN'),
      accBtn: panel.querySelector('#accBtn'),
      accProg: panel.querySelector('#accProg'),
      accOut: panel.querySelector('#accOut'),
      diag: panel.querySelector('#diag'),
      diagOut: panel.querySelector('#diagOut'),
      pushDataType: panel.querySelector('#pushDataType'),
      pushSymbol: panel.querySelector('#pushSymbol'),
      pushDate: panel.querySelector('#pushDate'),
      pushDateYesterday: panel.querySelector('#pushDateYesterday'),
      pushDateToday: panel.querySelector('#pushDateToday'),
      pushRun: panel.querySelector('#pushRun'),
      pushProg: panel.querySelector('#pushProg'),
      pushOut: panel.querySelector('#pushOut'),
      bfFrom: panel.querySelector('#bfFrom'),
      bfUniverse: panel.querySelector('#bfUniverse'),
      bfStart: panel.querySelector('#bfStart'),
      bfStop: panel.querySelector('#bfStop'),
      bfReset: panel.querySelector('#bfReset'),
      bfProg: panel.querySelector('#bfProg'),
      bfBarFill: panel.querySelector('#bfBarFill'),
      shStart: panel.querySelector('#shStart'),
      shStop: panel.querySelector('#shStop'),
      shProg: panel.querySelector('#shProg'),
      rtSyms: panel.querySelector('#rtSyms'),
      rtFrom: panel.querySelector('#rtFrom'),
      rtTo: panel.querySelector('#rtTo'),
      rtStart: panel.querySelector('#rtStart'),
      rtStop: panel.querySelector('#rtStop'),
      rtReset: panel.querySelector('#rtReset'),
      rtProg: panel.querySelector('#rtProg'),
      rtBarFill: panel.querySelector('#rtBarFill'),
      rov: panel.querySelector('#researchOverlay'),
      status: panel.querySelector('#status'),
      prog: panel.querySelector('#prog'),
      out: panel.querySelector('#out'),
    };

    ui.run.onclick = runAnalysis;
    ui.clear.onclick = clearDrawings;
    ui.diag.onclick = showDiagnostics;
    ui.scrRun.onclick = runScreener;
    ui.tpRun.onclick = runTopPick;
    ui.accBtn.onclick = scanAccumulationMarket;
    ui.pushRun.onclick = runPushData;
    ui.bfStart.onclick = runBackfillAll;
    ui.bfStop.onclick = stopBackfillAll;
    ui.bfReset.onclick = resetBackfillProgress;
    ui.shStart.onclick = async () => {
      ui.shStart.disabled = true; ui.shStop.disabled = false;
      try {
        await runShareholdingCrawl({ onStatus: (t) => { ui.shProg.textContent = t; } });
      } finally {
        ui.shStart.disabled = false; ui.shStop.disabled = true;
      }
    };
    ui.shStop.onclick = () => {
      stopShareholdingCrawl();
      ui.shProg.textContent = '⏳ Menghentikan setelah emiten yang sedang berjalan selesai…';
    };
    bfRenderProgress(bfLoadProgress());
    ui.rtStart.onclick = runRunningTradeBackfill;
    ui.rtStop.onclick = stopRunningTradeBackfill;
    ui.rtReset.onclick = resetRunningTradeBackfill;
    rtRenderProgress(rtLoadProgress());
    (() => {
      const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 6);
      ui.rtTo.value = `${to.getFullYear()}-${pad2(to.getMonth() + 1)}-${pad2(to.getDate())}`;
      ui.rtFrom.value = `${from.getFullYear()}-${pad2(from.getMonth() + 1)}-${pad2(from.getDate())}`;
    })();
    ui.pushDateToday.onclick = () => { ui.pushDate.value = todayISO(); };
    ui.pushDateYesterday.onclick = () => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      ui.pushDate.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    };
    (() => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      ui.pushDate.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    })();
    ui.scrProfile.onchange = () => { if (screener.results.length) renderScreener(); };
    ui.scrCat.onchange = () => { if (screener.results.length) renderScreener(); };
    panel.querySelectorAll('.chip[data-days]').forEach((ch) => { ch.onclick = () => { ui.scrDays.value = ch.dataset.days; }; });

    // default: 3 bulan terakhir; chip mengatur rentang cepat mundur dari hari ini
    const isoMinus = (calDays) => {
      const d = new Date(Date.now() + 7 * 3600e3 - calDays * 86400e3);
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    };
    ui.dateTo.value = todayISO();
    ui.dateFrom.value = isoMinus(92);
    panel.querySelectorAll('.chip[data-range]').forEach((ch) => {
      ch.onclick = () => {
        ui.dateFrom.value = isoMinus(+ch.dataset.range);
        ui.dateTo.value = todayISO();
      };
    });
    panel.querySelectorAll('.chip[data-ma]').forEach((ch) => {
      ch.onclick = () => {
        const [f, s] = ch.dataset.ma.split(',');
        ui.maFast.value = f;
        ui.maSlow.value = s;
      };
    });
    ui.srBtn.onclick = drawSupportResistance;
    ui.teknikBtn.onclick = technicalReadout;
    ui.fibBtn.onclick = drawFibonacci;
    ui.sinyalBtn.onclick = showSignals;
    ui.monBtn.onclick = monitorToggle;
    ui.tapeBtn.onclick = tapeToggle;
    ui.idxBtn.onclick = idxScalperToggle;
    ui.tpBtn.onclick = showTradePlan;
    ui.pvaBtn.onclick = showPVA;
    ui.draw.onclick = async () => {
      if (!lastResult) return;
      clearDrawings();
      const ok = await drawPhases(lastResult.phases);
      ui.prog.textContent = ok
        ? `✔ ${ok} fase digambar di chart. Klik "Hapus Marka" untuk membersihkan.`
        : '✖ Chart tidak ditemukan — lihat timeline di panel ini.';
    };

    setInterval(refreshStatus, 1500);
    refreshStatus();
  }

  function refreshStatus() {
    if (!ui) return;
    const sym = getSymbol();
    ui.sym.textContent = sym ? ` ${sym}` : '';
    const y = (b) => (b ? '<span class="ok">✔</span>' : '<span class="no">✖</span>');
    const bridgeBadge = bridgeOk === null
      ? '<span style="color:#8b93a3">·</span> bridge (belum dicoba)'
      : `${y(bridgeOk)} bridge`;
    const hasBrokerApi = !!(S.brokerUrl || getAuth());
    ui.status.innerHTML =
      `${y(!!getAuth())} token &nbsp; ${y(hasBrokerApi)} API broker summary &nbsp; ${y(!!getAuth())} data candle &nbsp; ${bridgeBadge}` +
      (!getAuth() ? '<br><span class="no">Belum ada token — pastikan sudah login & halaman selesai memuat.</span>' : '') +
      (bridgeOk === false ? '<br><span class="no">Backend Arsant Screener tidak terjangkau di localhost:4000 — data tetap tampil di panel, hanya tidak tersimpan ke database.</span>' : '');
  }

  // tampilkan apa saja yang berhasil/tidak berhasil ditangkap interceptor
  function showDiagnostics() {
    const seen = S.seen || [];
    const tail = seen.slice(-15).map((s) => {
      let short;
      try { const u = new URL(s.url); short = u.host + u.pathname + (u.search ? '?…' : ''); } catch (e) { short = s.url; }
      return `<div style="color:#8b93a3">[${s.via}] ${esc(short.slice(0, 90))}</div>`;
    }).join('');
    const chart = findChart();
    ui.diagOut.innerHTML = `<div class="grp" style="margin-top:8px">
      <div class="status">
        token: <b>${S.auth ? 'tertangkap' : (scanStorageToken() ? 'dari localStorage' : 'TIDAK ADA')}</b><br>
        template broker summary: <b>${S.brokerUrl ? esc(S.brokerUrl.slice(0, 110)) : 'TIDAK ADA'}</b><br>
        candle harian: <b>${S.dailyUrl ? 'template tertangkap' : 'pakai endpoint bawaan (chartbit/price/daily)'}</b><br>
        chart untuk digambari: <b>${chart ? 'ketemu' : 'tidak ketemu (fallback: timeline panel)'}</b><br>
        URL API terlihat: <b>${seen.length}</b> (15 terakhir di bawah, lengkap di console)
      </div>${tail || '<div class="status no">Belum ada satu pun URL API stockbit terlihat — interceptor kemungkinan tidak jalan; cek versi browser & muat ulang extension.</div>'}
      <div class="note">Daftar lengkap juga dicetak ke DevTools console (F12) sebagai <code>__BM_STATE.seen</code>.</div></div>`;
    try { console.log('[Brokermology] state:', { auth: !!S.auth, brokerUrl: S.brokerUrl, historyUrl: S.historyUrl, bars: Object.keys(S.bars || {}), seen }); } catch (e) {}
  }

  // ============================================================
  // Aksi indikator & S/R
  // ============================================================
  function panelRange() {
    const to = ui.dateTo.value || todayISO();
    let from = ui.dateFrom.value;
    if (!from || from >= to) from = null;
    return { from, to };
  }

  async function barsForIndicators(minBars) {
    const symbol = getSymbol();
    if (!symbol) throw new Error('SYMBOL');
    let { from, to } = panelRange();
    // indikator butuh riwayat cukup (>= periode MA terpanjang + buffer)
    const needCal = Math.ceil((minBars + 10) * 1.6);
    const minFrom = (() => {
      const d = new Date(Date.parse(`${to}T00:00:00Z`) - needCal * 86400e3);
      return d.toISOString().slice(0, 10);
    })();
    if (!from || from > minFrom) from = minFrom;
    return { symbol, bars: await fetchDailyBars(symbol, from, to) };
  }

  async function drawSupportResistance() {
    ui.indiOut.innerHTML = '<div class="status">Menghitung support & resistance…</div>';
    try {
      const { bars } = await barsForIndicators(120);
      const levels = findSR(bars, 6);
      if (!levels.length) { ui.indiOut.innerHTML = '<div class="status">Tidak ada level S/R yang meyakinkan pada rentang ini.</div>'; return; }
      const n = await drawSRLevels(levels);
      const lastC = bars[bars.length - 1].c;
      const rows = levels.map((l) => `<tr>
        <td>${l.type === 'S' ? '<span class="pos">SUPPORT</span>' : '<span class="neg">RESISTANCE</span>'}</td>
        <td class="r"><b>${Math.round(l.p)}</b></td>
        <td class="r">${(((l.p - lastC) / lastC) * 100).toFixed(1)}%</td>
        <td class="r">${l.touches}x</td>
      </tr>`).join('');
      ui.indiOut.innerHTML = `<div class="status">${n ? `✔ ${n} garis digambar di chart (ikut hilang lewat "Hapus Marka").` : '⚠ Chart tidak ditemukan — level tetap tampil di bawah.'}</div>
        <table style="margin-top:6px">
          <tr><th>Level</th><th class="r">Harga</th><th class="r">Jarak</th><th class="r">Sentuh</th></tr>
          ${rows}
        </table>`;
    } catch (e) {
      ui.indiOut.innerHTML = `<div class="status"><span class="no">✖ Gagal: ${esc(e.message)}</span></div>`;
    }
  }

  // ============================================================
  // Mesin sinyal beli/jual (berbasis skor, dengan alasan)
  // ============================================================
  function generateSignals(bars, cfg) {
    const closes = bars.map((b) => b.c);
    const maFn = cfg.maType === 'SMA' ? calcSMA : calcEMA;
    const f = maFn(closes, cfg.fast), s = maFn(closes, cfg.slow);
    const r = calcRSI(closes, cfg.rsiLen);
    const vma = calcSMA(bars.map((b) => b.v), 20);
    const COOLDOWN = 6, LOOKBACK = 20, BREAK_COOLDOWN = 15;
    const signals = [];
    let lastBuy = -99, lastSell = -99, lastBreakBuy = -99, lastBreakSell = -99;

    for (let i = Math.max(cfg.slow, 21); i < bars.length; i++) {
      const buyR = [], sellR = [];
      // cross MA
      if (f[i] != null && s[i] != null && f[i - 1] != null && s[i - 1] != null) {
        if (f[i] > s[i] && f[i - 1] <= s[i - 1]) buyR.push(`golden cross ${cfg.maType}${cfg.fast}/${cfg.slow}`);
        if (f[i] < s[i] && f[i - 1] >= s[i - 1]) sellR.push(`death cross ${cfg.maType}${cfg.fast}/${cfg.slow}`);
      }
      // RSI keluar zona jenuh
      if (r[i] != null && r[i - 1] != null) {
        if (r[i - 1] <= 30 && r[i] > 30) buyR.push('RSI keluar oversold');
        if (r[i - 1] >= 70 && r[i] < 70) sellR.push('RSI keluar overbought');
      }
      // breakout / breakdown 20 hari
      const win = bars.slice(i - LOOKBACK, i);
      if (bars[i].c > Math.max(...win.map((b) => b.h))) buyR.push('breakout high 20 hari');
      if (bars[i].c < Math.min(...win.map((b) => b.l))) sellR.push('breakdown low 20 hari');
      // konfirmasi volume (hanya sebagai penguat, bukan pemicu)
      const spike = vma[i - 1] && bars[i].v >= 2 * vma[i - 1];
      if (spike && buyR.length && bars[i].c >= bars[i].o) buyR.push('volume spike');
      if (spike && sellR.length && bars[i].c < bars[i].o) sellR.push('volume spike');

      const iso = bars[i].iso || isoFromEpochSec(bars[i].t);
      // breakout/breakdown beruntun di trend kuat = sinyal ulangan; beri jeda lebih panjang
      const hanyaBreakB = buyR.length && buyR.every((x) => x.startsWith('breakout') || x === 'volume spike');
      const hanyaBreakS = sellR.length && sellR.every((x) => x.startsWith('breakdown') || x === 'volume spike');
      const buyOk = buyR.length && i - lastBuy >= COOLDOWN && (!hanyaBreakB || i - lastBreakBuy >= BREAK_COOLDOWN);
      const sellOk = sellR.length && i - lastSell >= COOLDOWN && (!hanyaBreakS || i - lastBreakSell >= BREAK_COOLDOWN);
      if (buyOk && buyR.length >= sellR.length) {
        signals.push({ i, iso, t: bars[i].t, type: 'BUY', price: bars[i].c, low: bars[i].l, high: bars[i].h, reasons: buyR });
        lastBuy = i;
        if (hanyaBreakB) lastBreakBuy = i;
      } else if (sellOk) {
        signals.push({ i, iso, t: bars[i].t, type: 'SELL', price: bars[i].c, low: bars[i].l, high: bars[i].h, reasons: sellR });
        lastSell = i;
        if (hanyaBreakS) lastBreakSell = i;
      }
    }
    // hasil tiap sinyal: return sampai sinyal berlawanan berikutnya (atau close terakhir)
    const lastC = closes[closes.length - 1];
    for (let k = 0; k < signals.length; k++) {
      const sg = signals[k];
      const nxt = signals.slice(k + 1).find((x) => x.type !== sg.type);
      const exitP = nxt ? nxt.price : lastC;
      sg.result = (sg.type === 'BUY' ? exitP / sg.price - 1 : sg.price / exitP - 1) * 100;
      sg.open = !nxt;
    }
    return signals;
  }

  async function drawSignalMarks(signals) {
    const chart = findChart();
    if (!chart || typeof chart.createShape !== 'function') return 0;
    let n = 0;
    await trackDraw(chart, async (out) => {
      for (const sg of signals.slice(-12)) {
        const buy = sg.type === 'BUY';
        const opts = [
          { shape: buy ? 'arrow_up' : 'arrow_down', text: sg.type, lock: true, disableSave: true, overrides: { color: buy ? '#00b47e' : '#eb4d4b', fontsize: 11, bold: true } },
          { shape: 'text', text: buy ? '▲ BUY' : '▼ SELL', lock: true, disableSave: true, overrides: { color: buy ? '#00b47e' : '#eb4d4b', fontsize: 11, bold: true } },
        ];
        for (const o of opts) {
          try {
            const id = await Promise.resolve(chart.createShape({ time: sg.t, price: buy ? sg.low * 0.985 : sg.high * 1.015 }, o));
            if (id) { out.push(id); n++; break; }
          } catch (e) {}
        }
      }
    });
    if (n) { autoRedraw.signals = signals; autoRedraw.sym = getSymbol(); }
    return n;
  }

  async function showSignals() {
    ui.indiOut.innerHTML = '<div class="status">Menghitung sinyal beli/jual…</div>';
    try {
      const fast = Math.max(2, Math.min(200, Math.round(+ui.maFast.value || 9)));
      const slow = Math.max(3, Math.min(400, Math.round(+ui.maSlow.value || 21)));
      const rsiLen = Math.max(2, Math.min(50, Math.round(+ui.rsiLen.value || 14)));
      const { bars } = await barsForIndicators(slow + 60);
      const sigs = generateSignals(bars, { maType: ui.maType.value, fast, slow, rsiLen });
      if (!sigs.length) { ui.indiOut.innerHTML = '<div class="status">Tidak ada sinyal pada rentang ini.</div>'; return; }
      const n = await drawSignalMarks(sigs);
      const tampil = sigs.slice(-10).reverse();
      const rows = tampil.map((sg) => `<tr>
        <td>${sg.type === 'BUY' ? '<span class="vd sa">▲ BUY</span>' : '<span class="vd sd">▼ SELL</span>'}</td>
        <td>${fmtTgl(sg.iso)}</td>
        <td class="r">${Math.round(sg.price)}</td>
        <td class="r ${sg.result >= 0 ? 'pos' : 'neg'}">${sg.result >= 0 ? '+' : ''}${sg.result.toFixed(1)}%${sg.open ? '*' : ''}</td>
        <td style="font-size:10px;color:#8b93a3">${sg.reasons.join(', ')}</td>
      </tr>`).join('');
      const menang = sigs.filter((x) => x.result > 0).length;
      const aktif = sigs[sigs.length - 1];
      ui.indiOut.innerHTML = `
        <div class="concl">⚡ Sinyal terakhir: <b class="${aktif.type === 'BUY' ? 'pos' : 'neg'}">${aktif.type}</b> @ ${Math.round(aktif.price)}
          (${fmtTgl(aktif.iso)}) — ${aktif.reasons.join(', ')}
          <br>Riwayat rentang ini: ${sigs.length} sinyal, ${menang} profit (${((menang / sigs.length) * 100).toFixed(0)}% win rate)</div>
        <div class="status">${n ? `✔ ${Math.min(sigs.length, 12)} penanda digambar di chart (hapus lewat "Hapus Marka").` : '⚠ Chart tidak ditemukan.'}</div>
        <table style="margin-top:6px">
          <tr><th>Sinyal</th><th>Tanggal</th><th class="r">Harga</th><th class="r">Hasil</th><th>Alasan</th></tr>
          ${rows}
        </table>
        <div class="note">*masih berjalan (belum ada sinyal berlawanan). Hasil = return sampai sinyal berlawanan berikutnya.
        Sinyal mengikuti setelan MA/RSI di atas — bukan rekomendasi, selalu konfirmasi dengan brokermology & PVA.</div>`;
    } catch (e) {
      ui.indiOut.innerHTML = `<div class="status"><span class="no">✖ Gagal: ${esc(e.message)}</span></div>`;
    }
  }

  // ============================================================
  // Live Orderbook Tape (scalping) — bid/offer, imbalance, deteksi order palsu
  // ============================================================
  function parseOrderbook(json) {
    const d = json && json.data ? json.data : null;
    if (!d || !d.bid || !d.offer) return null;
    // API mengembalikan volume dalam LEMBAR (shares); IDX 1 lot = 100 lembar
    const side = (s) => {
      const lv = [];
      for (let n = 1; n <= 10; n++) {
        const price = +d[s]['price' + n] || 0;
        const lot = (+d[s]['volume' + n] || 0) / 100; // lembar -> lot
        const orders = +d[s]['que_num' + n] || 0;
        if (price > 0 && lot > 0) lv.push({ price, lot, orders, lotPerOrder: lot / Math.max(orders, 1) });
      }
      return lv;
    };
    const parseNum = (x) => { const n = parseFloat(String(x == null ? '' : x).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
    return {
      ts: Date.now(),
      status: d.status,
      last: +d.lastprice || +d.close || 0,
      bid: side('bid'),
      offer: side('offer'),
      value: +d.value || 0,
      volume: (+d.volume || 0) / 100, // lembar -> lot
      freq: +d.frequency || 0,
      fnet: +d.fnet || +d.net_foreign || 0,
      vwap: +d.average || 0,             // harga rata-rata hari ini (VWAP)
      prev: +d.previous || 0, open: +d.open || 0, high: +d.high || 0, low: +d.low || 0,
      pct: +d.percentage_change || 0,
      ara: parseNum(d.ara && d.ara.value), arb: parseNum(d.arb && d.arb.value),
    };
  }

  // fraksi harga (tick size) IDX
  function tickSize(p) { return p < 200 ? 1 : p < 500 ? 2 : p < 2000 ? 5 : p < 5000 ? 10 : 25; }

  // sinyal scalp actionable dari konfluensi orderbook + tape + VWAP + ARA
  function scalpSignal(snap, a, tp) {
    const bull = [], bear = [];
    let score = 0;
    // 1) imbalance antrean
    const imb = a.imbalance;
    if (imb > 0.25) { score += 2; bull.push('antrean bid dominan'); }
    else if (imb < -0.25) { score -= 2; bear.push('antrean offer dominan'); }
    // 2) agresor 20 dtk (HAKA vs HAKI)
    const win = tp.flow.filter((f) => snap.ts - f.ts <= 20000);
    const wBuy = win.reduce((s, f) => s + f.buyLot, 0), wSell = win.reduce((s, f) => s + f.sellLot, 0);
    if (wBuy > wSell * 1.5 && wBuy > 0) { score += 2; bull.push('HAKA dominan'); }
    else if (wSell > wBuy * 1.5 && wSell > 0) { score -= 2; bear.push('HAKI dominan'); }
    // 3) posisi vs VWAP
    const vwap = snap.vwap || 0;
    if (vwap && snap.last > vwap) { score += 1; bull.push('di atas VWAP'); }
    else if (vwap && snap.last < vwap) { score -= 1; bear.push('di bawah VWAP'); }
    // 4) momentum akselerasi (10 dtk terakhir vs 10 dtk sebelumnya)
    const w1 = tp.flow.filter((f) => snap.ts - f.ts <= 10000).reduce((s, f) => s + f.buyLot + f.sellLot, 0);
    const w2 = tp.flow.filter((f) => { const d = snap.ts - f.ts; return d > 10000 && d <= 20000; }).reduce((s, f) => s + f.buyLot + f.sellLot, 0);
    const accel = w2 > 0 && w1 > w2 * 1.3;
    if (accel) { if (score > 0) { score += 1; bull.push('momentum akselerasi'); } else if (score < 0) { score -= 1; bear.push('momentum akselerasi'); } }
    // 5) jarak ARA/ARB
    const toAra = snap.ara && snap.last ? (snap.ara / snap.last - 1) * 100 : null;
    const toArb = snap.arb && snap.last ? (1 - snap.arb / snap.last) * 100 : null;
    if (toAra != null && toAra <= 3 && score > 0) { score += 1; bull.push('dekat ARA'); }
    if (toArb != null && toArb <= 3 && score < 0) { score -= 1; bear.push('dekat ARB'); }
    // level & spread
    const b1 = snap.bid[0], o1 = snap.offer[0];
    const spreadTick = b1 && o1 ? Math.round((o1.price - b1.price) / tickSize(snap.last)) : 0;
    const verdict = a.pasarSepi ? 'SEPI' : score >= 3 ? 'BELI SCALP' : score <= -3 ? 'JUAL SCALP' : 'TAHAN';
    return { verdict, score, bull, bear, vwap, toAra, toArb, spreadTick, b1, o1, tick: tickSize(snap.last) };
  }

  // ============================================================
  // IDX SCALPER — port strategi Pine ke Chartbit (candle intraday dari tick WS)
  // ============================================================
  // ARA/ARB berbasis close kemarin (tier IDX): ≤200→35%, ≤5000→25%, >5000→20%
  function araArbPrev(prevClose) {
    const pct = prevClose <= 200 ? 0.35 : prevClose <= 5000 ? 0.25 : 0.20;
    return { pct: pct * 100, ara: roundTick(prevClose * (1 + pct), false), arb: Math.max(roundTick(prevClose * (1 - pct), true), 50) };
  }
  function calcVWAP(bars) {
    let pv = 0, vv = 0;
    for (const b of bars) { const tp = (b.h + b.l + b.c) / 3; pv += tp * (b.v || 0); vv += (b.v || 0); }
    return vv > 0 ? pv / vv : (bars.length ? bars[bars.length - 1].c : 0);
  }
  function calcOBVarr(closes, vols) {
    const o = [0];
    for (let k = 1; k < closes.length; k++) o.push(o[k - 1] + (closes[k] > closes[k - 1] ? vols[k] : closes[k] < closes[k - 1] ? -vols[k] : 0));
    return o;
  }
  // sesi bursa IDX (WIB) — lewati 15 mnt pertama (09:00–09:15) yg liar
  function idxSession(nowWIB) {
    const day = nowWIB.getUTCDay(), hm = nowWIB.getUTCHours() * 60 + nowWIB.getUTCMinutes();
    if (day < 1 || day > 5) return { open: false, label: 'akhir pekan' };
    const fri = day === 5;
    // sesi 1: 09:15–11:30 (Jum 11:00), sesi 2: 13:30–15:00 (Sen-Kam) / 14:00–15:00 (Jum)
    const s1 = hm >= 9 * 60 + 15 && hm <= (fri ? 11 * 60 : 11 * 60 + 30);
    const s2 = hm >= (fri ? 14 * 60 : 13 * 60 + 30) && hm <= 15 * 60;
    const preOpen = hm >= 9 * 60 && hm < 9 * 60 + 15;
    return { open: s1 || s2, preOpen, label: s1 ? 'sesi 1' : s2 ? 'sesi 2' : preOpen ? 'pra-buka (15mnt liar)' : 'di luar sesi' };
  }

  async function idxScalperAnalyze(sym, tfSec, cfg) {
    const bars = buildTickCandles(sym, tfSec, 120);
    if (bars.length < 25) return { warmup: bars.length, need: 25 };
    const closes = bars.map((b) => b.c), vols = bars.map((b) => b.v || 0);
    const i = closes.length - 1;
    const emaFarr = calcEMA(closes, cfg.emaFast), emaSarr = calcEMA(closes, cfg.emaSlow);
    const emaF = emaFarr[i], emaS = emaSarr[i], emaFp = emaFarr[i - 1], emaSp = emaSarr[i - 1];
    const rsiArr = calcRSI(closes, cfg.rsiLen), rsi = rsiArr[i];
    const atr = calcATR(bars, cfg.atrLen) || closes[i] * 0.01;
    const volAvg = calcSMA(vols, cfg.volMaLen)[i] || 0;
    const volOk = !cfg.useVol || vols[i] > volAvg * cfg.volMult;
    const vwap = calcVWAP(bars);
    const obvArr = calcOBVarr(closes, vols);
    const obvOk = !cfg.useObv || obvArr[i] > (calcSMA(obvArr, 10)[i] || 0);
    // HTF trend (timeframe ~4× atau min 15m)
    const htfBars = buildTickCandles(sym, Math.max(tfSec * 4, 900), 60);
    let htfUp = true, htfOkData = false;
    if (htfBars.length >= 22) { const hc = htfBars.map((b) => b.c); const j = hc.length - 1; htfUp = calcEMA(hc, cfg.emaFast)[j] > calcEMA(hc, cfg.emaSlow)[j]; htfOkData = true; }
    const htfOk = !cfg.useHtf || htfUp;
    // prevClose & ARA/ARB (dari candle harian)
    let prevClose = 0, ara = 0, arb = 0, arPct = 0;
    try {
      const today = todayISO();
      const from = new Date(Date.now() - 12 * 86400e3).toISOString().slice(0, 10);
      const db = await fetchDailyBars(sym, from, today);
      if (db && db.length >= 2) { prevClose = db[db.length - 2].c; const a = araArbPrev(prevClose); ara = a.ara; arb = a.arb; arPct = a.pct; }
    } catch (e) {}
    const last = closes[i];
    const distAra = ara ? (ara / last - 1) * 100 : null;
    const nearAra = distAra != null && distAra < 3;
    const gocap = prevClose > 0 && prevClose <= 50;
    // ORB (opening range 09:00–09:15 hari ini)
    let orH = null, orL = null;
    const todayStr = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    for (const b of bars) {
      const t = new Date(b.t * 1000); const hm = t.getUTCHours() * 60 + t.getUTCMinutes();
      if (b.iso === todayStr && hm >= 9 * 60 && hm < 9 * 60 + 15) { orH = orH == null ? b.h : Math.max(orH, b.h); orL = orL == null ? b.l : Math.min(orL, b.l); }
    }
    const orbBreakUp = cfg.useOrb && orH != null && closes[i] > orH && closes[i - 1] <= orH;
    // sesi
    const ses = idxSession(new Date(Date.now() + 7 * 3600e3));
    const inSession = !cfg.useSession || ses.open;
    // sinyal
    const trendUp = emaF > emaS && last > vwap && htfOk;
    const rsiCrossUp = rsiArr[i - 1] <= 50 && rsi > 50;
    const emaCrossUp = emaFp <= emaSp && emaF > emaS;
    const trigger = rsiCrossUp || emaCrossUp || orbBreakUp;
    const buy = trendUp && trigger && volOk && obvOk && inSession && !nearAra && !gocap;
    const exit = (emaFp >= emaSp && emaF < emaS) || (closes[i - 1] >= vwap && last < vwap);
    // fee-aware TP/SL (dibulatkan ke fraksi)
    const be = (cfg.feeBuy + cfg.feeSell);
    const tick = tickSize(last);
    const minDist = Math.max(last * be / 100 * cfg.feeSafety, 2 * tick);
    const tpsl = {
      entry: last,
      sl: roundTick(last - atr * cfg.slMult, false),
      tp1: roundTick(last + Math.max(atr * cfg.tp1Mult, minDist), false),
      tp2: roundTick(last + Math.max(atr * cfg.tp2Mult, minDist * 2), false),
      tick,
    };
    return {
      bars, i, last, emaF, emaS, rsi, atr, vwap, aboveVwap: last > vwap,
      volOk, volAvg, vol: vols[i], obvOk, htfUp, htfOkData, htfOk,
      trendUp, trigger, rsiCrossUp, emaCrossUp, orbBreakUp, orH, orL,
      prevClose, ara, arb, arPct, distAra, nearAra, gocap,
      ses, inSession, be, buy, exit, tpsl, tfSec,
    };
  }

  // analisa satu snapshot + riwayat -> imbalance, order palsu, realisasi delta
  function analyzeBook(snap, hist) {
    const totBid = snap.bid.reduce((a, b) => a + b.lot, 0);
    const totOffer = snap.offer.reduce((a, b) => a + b.lot, 0);
    const imbalance = totBid + totOffer > 0 ? (totBid - totOffer) / (totBid + totOffer) : 0;

    // ambang lot/order "tebal tak wajar": > 4x median lot/order seluruh buku
    const all = [...snap.bid, ...snap.offer].map((l) => l.lotPerOrder).sort((a, b) => a - b);
    const median = all.length ? all[Math.floor(all.length / 2)] : 0;
    const thick = median * 4;

    // realisasi bergerak? bandingkan value/freq dgn snapshot 4-6 detik lalu
    // (khusus utk deteksi pasar sepi & order palsu — butuh jendela beberapa detik)
    const ref = hist.filter((h) => snap.ts - h.ts >= 4000).slice(-1)[0];
    const refValMoved = ref ? snap.value - ref.value : null;
    const refFreqMoved = ref ? snap.freq - ref.freq : null;
    const pasarSepi = refValMoved != null && refValMoved <= 0 && refFreqMoved != null && refFreqMoved <= 0;

    // deteksi order palsu: lot tebal + order sedikit + realisasi tak bergerak +
    // level bertahan (ada di beberapa snapshot terakhir tanpa berkurang signifikan)
    const persist = (price, s) => {
      const recent = hist.filter((h) => snap.ts - h.ts <= 8000);
      if (recent.length < 2) return 0;
      let seen = 0;
      for (const h of recent) {
        const lv = (s === 'bid' ? h.bid : h.offer).find((x) => x.price === price);
        if (lv) seen++;
      }
      return seen / recent.length;
    };
    const flagSide = (levels, s) => levels.filter((l) => {
      const tebal = l.lotPerOrder >= thick && l.orders <= 10 && l.lot >= totBid * 0.05;
      return tebal && pasarSepi && persist(l.price, s) >= 0.6;
    }).map((l) => ({ ...l, side: s }));
    const fake = [...flagSide(snap.bid, 'bid'), ...flagSide(snap.offer, 'offer')];

    // realisasi PER TICK (sejak snapshot TEPAT sebelumnya, non-overlap) agar tidak
    // double-count. Klasifikasi agresor: last di/atas offer = HAKA (beli agresif),
    // di/bawah bid = HAKI (jual agresif). Simpan lot & nilai Rp.
    let realBuyLot = 0, realSellLot = 0, realBuyVal = 0, realSellVal = 0, aggressor = null;
    let volMoved = 0;
    const prev1 = hist[hist.length - 1];
    if (prev1) {
      const dVol = snap.volume - prev1.volume;   // lot tereksekusi ~1 dtk terakhir
      const dVal = Math.max(snap.value - prev1.value, 0); // Rp tereksekusi
      volMoved = dVol;
      if (dVol > 0) {
        const bestBid = snap.bid[0] ? snap.bid[0].price : 0;
        const bestOffer = snap.offer[0] ? snap.offer[0].price : Infinity;
        let isBuy;
        if (snap.last >= bestOffer) isBuy = true;
        else if (snap.last <= bestBid) isBuy = false;
        else isBuy = prev1.last ? snap.last >= prev1.last : true;
        if (isBuy) { realBuyLot = dVol; realBuyVal = dVal; aggressor = 'BUY'; }
        else { realSellLot = dVol; realSellVal = dVal; aggressor = 'SELL'; }
      }
    }

    // ---- deteksi ORDER DICABUT (spoofing terkonfirmasi) ----
    // tembok besar yang ADA di snapshot sebelumnya lalu HILANG/menyusut >70% TANPA
    // dieksekusi (harga tidak menembusnya) = order palsu yang ditarik.
    const pulls = [];
    const prev = hist[hist.length - 1];
    if (prev && snap.ts - prev.ts < 4000) {
      const check = (prevLevels, curLevels, s) => {
        const curMap = new Map(curLevels.map((l) => [l.price, l.lot]));
        const bigWall = Math.max(totBid, totOffer) * 0.06;
        for (const pl of prevLevels) {
          if (pl.lot < bigWall || pl.lot < 200) continue; // hanya tembok signifikan
          const nowLot = curMap.get(pl.price) || 0;
          if (nowLot >= pl.lot * 0.3) continue; // masih ada -> bukan cabut
          // dieksekusi? harga menembus level ini?
          const executed = s === 'bid' ? snap.last <= pl.price : snap.last >= pl.price;
          if (executed) continue; // habis karena kena transaksi, bukan dicabut
          pulls.push({ side: s, price: pl.price, lot: pl.lot - nowLot, orders: pl.orders });
        }
      };
      check(prev.bid, snap.bid, 'bid');
      check(prev.offer, snap.offer, 'offer');
    }

    return { totBid, totOffer, imbalance, fake, pulls, volMoved,
      realBuyLot, realSellLot, realBuyVal, realSellVal, aggressor, pasarSepi };
  }

  // --- polling orderbook cepat + render tape ---
  const tape = { on: false, sym: null, timer: null, hist: [], cumBuy: 0, cumSell: 0, cumBuyVal: 0, cumSellVal: 0, lastVol: null, alerted: {}, bigPrints: [], flow: [], hakaAlertT: 0, hakaBanner: null, pullBanner: null };

  function orderbookUrl(sym) {
    if (S.orderbookUrl) {
      try { return S.orderbookUrl.replace(/orderbook\/companies\/[A-Z0-9-]+/i, `orderbook/companies/${sym}`); } catch (e) {}
    }
    return `https://exodus.stockbit.com/orderbook/companies/${sym}`;
  }

  function tapeToggle() {
    if (tape.on) {
      tape.on = false;
      clearTimeout(tape.timer);
      ui.tapeBtn.textContent = '⚡ Live Tape: OFF';
      ui.tapeBtn.classList.remove('on'); ui.tapeBtn.classList.add('primary');
      ui.tapeOut.innerHTML = '';
      return;
    }
    tape.on = true;
    tape.sym = getSymbol();
    tape.hist = []; tape.cumBuy = 0; tape.cumSell = 0; tape.cumBuyVal = 0; tape.cumSellVal = 0; tape.lastVol = null; tape.alerted = {}; tape.bigPrints = []; tape.flow = []; tape.hakaAlertT = 0; tape.hakaBanner = null; tape.pullBanner = null;
    ui.tapeBtn.textContent = '⚡ Live Tape: ON';
    ui.tapeBtn.classList.remove('primary'); ui.tapeBtn.classList.add('on');
    try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
    ui.tapeOut.innerHTML = '<div class="status">⚡ Menyalakan orderbook realtime…</div>';
    tapeTick();
  }

  async function tapeTick() {
    if (!tape.on) return;
    let interval = 1000; // depth via REST ~1 dtk; harga/change dari WS realtime
    try {
      const sym = getSymbol() || tape.sym;
      if (sym !== tape.sym) { tape.sym = sym; tape.hist = []; tape.cumBuy = 0; tape.cumSell = 0; tape.cumBuyVal = 0; tape.cumSellVal = 0; tape.lastVol = null; tape.alerted = {}; tape.flow = []; tape.hakaAlertT = 0; tape.hakaBanner = null; tape.pullBanner = null; }
      const snap = parseOrderbook(await apiGet(orderbookUrl(sym)));
      if (!snap) { ui.tapeOut.innerHTML = '<div class="status"><span class="no">✖ Orderbook tidak tersedia untuk simbol ini.</span></div>'; interval = 5000; }
      else {
        tape.authWait = 0; // token OK
        // tumpangkan tick WebSocket realtime HANYA jika simbolnya cocok (hindari
        // kontaminasi harga saat baru pindah saham — tick simbol lama masih mengalir)
        const wt = S.wsTicks && S.wsTicks[sym];
        if (wt && wt.last && wt.symbol === sym && Date.now() - wt.ts < 6000) {
          snap.last = wt.last; snap.wsChange = wt.changePct; snap.wsLive = true;
        }
        const a = analyzeBook(snap, tape.hist);
        relayOrderbook(sym, snap);
        // akumulasi realisasi beli/jual (per-tick, non-overlap) — lot & Rp
        tape.cumBuy += a.realBuyLot; tape.cumSell += a.realSellLot;
        tape.cumBuyVal += a.realBuyVal; tape.cumSellVal += a.realSellVal;

        // ---- deteksi HAKA (beli agresif) & HAKI (jual agresif) besar-besaran ----
        tape.flow.push({ ts: snap.ts, buyLot: a.realBuyLot, sellLot: a.realSellLot, buyVal: a.realBuyVal, sellVal: a.realSellVal });
        tape.flow = tape.flow.filter((f) => snap.ts - f.ts <= 15000); // jendela 15 dtk
        const wBuyLot = tape.flow.reduce((s, f) => s + f.buyLot, 0);
        const wSellLot = tape.flow.reduce((s, f) => s + f.sellLot, 0);
        const wBuyVal = tape.flow.reduce((s, f) => s + f.buyVal, 0);
        const wSellVal = tape.flow.reduce((s, f) => s + f.sellVal, 0);
        // ambang: agresif 1 sisi dalam 15 dtk ≥ 0,3% volume harian DAN ≥ 2× sisi lawan
        const ambang = Math.max((snap.volume || 0) * 0.003, 200); // min 200 lot
        const haka = wBuyLot >= ambang && wBuyLot >= wSellLot * 2;
        const haki = wSellLot >= ambang && wSellLot >= wBuyLot * 2;
        if ((haka || haki) && snap.ts - tape.hakaAlertT > 20000) { // cooldown 20 dtk
          tape.hakaAlertT = snap.ts;
          const isBuy = haka;
          const lot = isBuy ? wBuyLot : wSellLot, val = isBuy ? wBuyVal : wSellVal;
          const nm = isBuy ? 'HAKA' : 'HAKI', act = isBuy ? 'diborong di offer' : 'dilego di bid';
          tape.hakaBanner = { buy: isBuy, txt: `<b>${fmtLot(lot)} lot</b> (Rp ${fmtRp(val)}) ${act} dalam 15 dtk @ ${snap.last}` };
          beepHaka();
          notifyDesktop(`${isBuy ? '🟢' : '🔴'} ${nm} BESAR ${sym} @ ${snap.last}`, `${fmtLot(lot)} lot (Rp ${fmtRp(val)}) ${isBuy ? 'beli' : 'jual'} agresif / 15 dtk`);
          drawTapeMarker({ t: Math.floor(snap.ts / 1000), aggressor: isBuy ? 'BUY' : 'SELL', lot, val, price: snap.last, haka: true, low: snap.bid[0] ? snap.bid[0].price : snap.last, high: snap.offer[0] ? snap.offer[0].price : snap.last });
        } else if (tape.hakaBanner && snap.ts - tape.hakaAlertT > 12000) {
          tape.hakaBanner = null; // banner hilang 12 dtk setelah alert
        }
        // big print: transaksi besar dalam satu tick (> 0.25% volume harian) -> tandai
        if (a.volMoved && snap.volume && a.volMoved > snap.volume * 0.0025 && a.aggressor) {
          const ev = { t: Math.floor(snap.ts / 1000), aggressor: a.aggressor, lot: a.volMoved, val: a.realBuyVal + a.realSellVal, price: snap.last, low: snap.bid[0] ? snap.bid[0].price : snap.last, high: snap.offer[0] ? snap.offer[0].price : snap.last };
          tape.bigPrints.push(ev);
          if (tape.bigPrints.length > 40) tape.bigPrints.shift();
          drawTapeMarker(ev);
        }
        // alert: bid/offer palsu baru terdeteksi (tembok menggantung tak dieksekusi)
        for (const f of a.fake) {
          const key = `${sym}:${f.side}:${f.price}`;
          if (!tape.alerted[key]) {
            tape.alerted[key] = snap.ts;
            beep();
            notifyDesktop(`⚠ ${f.side === 'bid' ? 'BID' : 'OFFER'} PALSU ${sym} @ ${f.price}`, `${fmtLot(f.lot)} lot / hanya ${f.orders} order, tidak dieksekusi`);
          }
        }
        // alert: ORDER DICABUT (spoofing terkonfirmasi — tembok hilang tanpa dieksekusi)
        if (a.pulls && a.pulls.length) {
          for (const p of a.pulls) {
            const key = `pull:${sym}:${p.side}:${p.price}:${Math.round(snap.ts / 3000)}`;
            if (!tape.alerted[key]) {
              tape.alerted[key] = snap.ts;
              beepHaka();
              const lbl = p.side === 'bid' ? 'BID DICABUT' : 'OFFER DICABUT';
              notifyDesktop(`🚨 ${lbl} ${sym} @ ${p.price}`, `${fmtLot(p.lot)} lot ditarik tanpa dieksekusi — spoofing`);
            }
          }
          tape.pullBanner = { txt: a.pulls.map((p) => `${p.side === 'bid' ? 'BID' : 'OFFER'} ${p.price} (${fmtLot(p.lot)} lot)`).join(', '), ts: snap.ts };
        } else if (tape.pullBanner && snap.ts - tape.pullBanner.ts > 10000) {
          tape.pullBanner = null;
        }
        // bersihkan flag lama (level sudah hilang)
        for (const k of Object.keys(tape.alerted)) if (snap.ts - tape.alerted[k] > 60000) delete tape.alerted[k];
        renderTape(snap, a);
        tape.hist.push(snap);
        if (tape.hist.length > 20) tape.hist.shift();
      }
    } catch (e) {
      if (e.message === 'AUTH') {
        // JANGAN matikan tape — token akan disegarkan otomatis oleh hook WebSocket
        // (JWT dari frame subscribe halaman). Tunggu sebentar lalu coba lagi.
        tape.authWait = (tape.authWait || 0) + 1;
        ui.tapeOut.innerHTML = `<div class="status"><span style="color:#f2c14e">⏳ Menunggu token segar dari WebSocket… (${tape.authWait})</span><br>
          <span class="hint">Otomatis pulih tanpa refresh. Jika lama, klik orderbook/chart Stockbit sekali.</span></div>`;
        interval = 2000;
      } else { interval = 4000; }
    }
    tape.timer = setTimeout(tapeTick, marketOpen() ? interval : 8000);
  }

  function renderTape(snap, a) {
    const maxLot = Math.max(1, ...snap.bid.map((l) => l.lot), ...snap.offer.map((l) => l.lot));
    const fakeSet = new Set(a.fake.map((f) => `${f.side}:${f.price}`));
    const N = 6; // jumlah level per sisi
    const bids = snap.bid.slice(0, N);
    const offs = snap.offer.slice(0, N);
    // ladder: tiap baris = 1 level, sisi bid & offer sejajar (offer di atas, bid di bawah)
    // ditata baris demi baris: offer[N-1..0] lalu bid[0..N-1] — tapi agar mudah dibaca,
    // pakai layout dua kolom simetris: baris i = offer[i] (kiri kosong) & terpisah.
    // Gunakan tabel: kolom kiri = bid, tengah = harga, kanan = offer, per baris index.
    const rows = [];
    for (let i = N - 1; i >= 0; i--) {
      const o = offs[i];
      if (!o) continue;
      const palsu = fakeSet.has(`offer:${o.price}`);
      const w = (o.lot / maxLot) * 100;
      rows.push(`<tr class="${palsu ? 'fake' : ''}">
        <td></td><td class="px o">${o.price}</td>
        <td><div class="cell o"><div class="dbar o" style="width:${w}%"></div><span class="v">${fmtLotFull(o.lot)}</span><span class="q">${o.orders}x</span></div></td></tr>`);
    }
    for (let i = 0; i < N; i++) {
      const b = bids[i];
      if (!b) continue;
      const palsu = fakeSet.has(`bid:${b.price}`);
      const w = (b.lot / maxLot) * 100;
      rows.push(`<tr class="${palsu ? 'fake' : ''}">
        <td><div class="cell b"><div class="dbar b" style="width:${w}%"></div><span class="q">${b.orders}x</span><span class="v">${fmtLotFull(b.lot)}</span></div></td>
        <td class="px b">${b.price}</td><td></td></tr>`);
    }

    const imbPct = a.imbalance * 100;
    const fill = (a.imbalance + 1) / 2 * 100;
    const tekanan = imbPct > 20 ? 'TEKANAN BELI' : imbPct < -20 ? 'TEKANAN JUAL' : 'SEIMBANG';
    const cum = tape.cumBuy - tape.cumSell;
    const chg = snap.wsChange != null ? snap.wsChange : (snap.pct || 0);
    const chgCls = chg > 0 ? 'pos' : chg < 0 ? 'neg' : '';
    const bp = tape.bigPrints.slice(-6).reverse().map((e) =>
      `<span class="${e.aggressor === 'BUY' ? 'pos' : 'neg'}">${e.aggressor === 'BUY' ? '▲' : '▼'}${fmtLot(e.lot)}</span>`).join(' · ');

    // ---- SINYAL SCALP (konfluensi) ----
    const sig = scalpSignal(snap, a, tape);
    const sigCol = sig.verdict === 'BELI SCALP' ? { c: '#00d69a', bg: '#0f2a1e' } : sig.verdict === 'JUAL SCALP' ? { c: '#eb6b69', bg: '#241417' } : sig.verdict === 'SEPI' ? { c: '#8b93a3', bg: '#1b1f27' } : { c: '#f2c14e', bg: '#241f12' };
    const reasons = sig.verdict === 'JUAL SCALP' ? sig.bear : sig.bull;
    // saran level scalp
    let plan = '';
    if (sig.verdict === 'BELI SCALP' && sig.b1 && sig.o1) {
      plan = `Entry ~${sig.o1.price} (angkat offer) / antre bid ${sig.b1.price} · TP +${sig.tick} (${sig.o1.price + sig.tick}) · cut < ${sig.b1.price - sig.tick}`;
    } else if (sig.verdict === 'JUAL SCALP' && sig.b1 && sig.o1) {
      plan = `Lepas di bid ${sig.b1.price} · cut > ${sig.o1.price + sig.tick}`;
    }
    // posisi VWAP & ARA
    const vwapTxt = sig.vwap ? `VWAP ${Math.round(sig.vwap)} <span class="${snap.last >= sig.vwap ? 'pos' : 'neg'}">(${snap.last >= sig.vwap ? '↑ di atas' : '↓ di bawah'})</span>` : 'VWAP -';
    const araTxt = sig.toAra != null ? `ARA +${sig.toAra.toFixed(1)}%` : '';
    const arbTxt = sig.toArb != null ? `ARB −${sig.toArb.toFixed(1)}%` : '';

    ui.tapeOut.innerHTML = `
      <div class="quote">
        <span class="p ${chgCls}">${snap.last}</span>
        <span class="c ${chgCls}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>
        ${snap.wsLive ? '<span class="live">LIVE</span>' : `<span class="hint">${snap.status}</span>`}
      </div>
      <div style="background:${sigCol.bg};border:1px solid ${sigCol.c}66;border-radius:10px;padding:9px 11px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <b style="font-size:15px;color:${sigCol.c}">${sig.verdict === 'BELI SCALP' ? '🟢 ' : sig.verdict === 'JUAL SCALP' ? '🔴 ' : sig.verdict === 'SEPI' ? '⏸ ' : '⚪ '}${sig.verdict}</b>
          <span class="hint" style="margin-left:auto">skor ${sig.score >= 0 ? '+' : ''}${sig.score}</span>
        </div>
        ${reasons.length ? `<div style="font-size:10.5px;color:#aeb6c4;margin-top:3px">${reasons.join(' · ')}</div>` : ''}
        ${plan ? `<div style="font-size:10.5px;color:#c8cfda;margin-top:4px">🎯 ${plan}</div>` : ''}
      </div>
      <div class="status" style="margin:-2px 0 6px;font-size:10.5px">${vwapTxt} · spread ${sig.spreadTick} tick${araTxt ? ' · ' + araTxt : ''}${arbTxt ? ' · ' + arbTxt : ''}</div>
      ${tape.hakaBanner ? `<div class="concl" style="border-color:${tape.hakaBanner.buy ? '#1f7a4d' : '#8a4444'};background:${tape.hakaBanner.buy ? '#12241a' : '#241417'}">
        ${tape.hakaBanner.buy ? '🟢 <b class="pos">HAKA — BELI AGRESIF BESAR!</b>' : '🔴 <b class="neg">HAKI — JUAL AGRESIF BESAR!</b>'}<br>
        <span style="font-size:11px">${tape.hakaBanner.txt}</span></div>` : ''}
      ${tape.pullBanner ? `<div class="concl" style="border-color:#8a4444;background:#241417">🚨 <b class="neg">ORDER DICABUT (spoofing)</b><br><span style="font-size:11px">${tape.pullBanner.txt} ditarik tanpa dieksekusi</span></div>` : ''}
      <table class="lad">
        <tr class="hdr"><td>Bid (lot)</td><td>Harga</td><td>Offer (lot)</td></tr>
        ${rows.join('')}
      </table>
      <div class="gauge"><div class="fill" style="width:${fill.toFixed(1)}%"></div><div class="mid"></div>
        <div class="lbl">${imbPct >= 0 ? '🟢 ' : '🔴 '}${tekanan} ${imbPct >= 0 ? '+' : ''}${imbPct.toFixed(0)}%</div></div>
      <div class="grp" style="margin-top:8px;padding:8px 10px">
        <div class="kv"><span class="k">Antrean bid / offer</span><span class="v"><span class="pos">${fmtLot(a.totBid)}</span> / <span class="neg">${fmtLot(a.totOffer)}</span> lot</span></div>
        <div class="kv"><span class="k">HAKA (beli agresif)</span><span class="v pos">${fmtLot(tape.cumBuy)} lot · Rp ${fmtRp(tape.cumBuyVal)}</span></div>
        <div class="kv"><span class="k">HAKI (jual agresif)</span><span class="v neg">${fmtLot(tape.cumSell)} lot · Rp ${fmtRp(tape.cumSellVal)}</span></div>
        <div class="kv" style="border:none"><span class="k">Net agresif</span><span class="v ${cum >= 0 ? 'pos' : 'neg'}">${cum >= 0 ? '+' : ''}${fmtLot(cum)} lot ${a.pasarSepi ? '<span class="hint">· sepi</span>' : ''}</span></div>
      </div>
      ${bp ? `<div class="status">Transaksi besar: ${bp}</div>` : ''}
      ${a.fake.length ? `<div class="concl" style="border-color:#8a7a3a;background:#2a2618">⚠ <b>${a.fake.length} order palsu</b> (⚠ di ladder) — lot tebal, order sedikit, tak dieksekusi.</div>` : ''}
      <div class="note">Sinyal scalp = konfluensi (imbalance + agresor 20 dtk + VWAP + momentum + ARA). BELI/JUAL butuh skor ±3. Lot=lembar÷100. Bukan rekomendasi — kelola risiko, spread & likuiditas penentu.</div>`;
  }

  // ringkas (untuk total/realisasi yang bisa besar) — dalam LOT
  function fmtLot(v) {
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'M';   // miliar lot (sangat jarang)
    if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'jt';
    if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'rb';
    return s + Math.round(a);
  }
  // angka lot penuh dengan pemisah ribuan (seperti panel orderbook Stockbit)
  function fmtLotFull(v) {
    return Math.round(v).toLocaleString('id-ID');
  }

  // tandai transaksi besar/HAKA/HAKI di chart — panah DILETAKKAN DI LUAR candle
  // (di bawah bid utk beli, di atas offer utk jual) agar tidak menutupi candle.
  let lastMarkerT = 0;
  async function drawTapeMarker(ev) {
    if (!ev.haka && ev.t - lastMarkerT < 30) return; // dedupe 30 dtk (HAKA/HAKI selalu digambar)
    lastMarkerT = ev.t;
    const chart = findChart();
    if (!chart || typeof chart.createShape !== 'function') return;
    const buy = ev.aggressor === 'BUY';
    // offset ~0,4% dari harga acuan agar panah tidak menempel di badan candle
    const ref = buy ? (ev.low || ev.price) : (ev.high || ev.price);
    const price = buy ? ref * 0.996 : ref * 1.004;
    // label: pakai nilai Rp bila ada (angka besar & bermakna), fallback lot
    const amount = ev.val && ev.val > 0 ? 'Rp ' + fmtRp(ev.val) : fmtLot(ev.lot) + ' lot';
    const label = ev.haka ? `${buy ? '🟢HAKA' : '🔴HAKI'} ${amount}` : `${buy ? '▲' : '▼'} ${amount}`;
    await trackDraw(chart, async (out) => {
      try {
        const id = await Promise.resolve(chart.createShape(
          { time: ev.t, price },
          { shape: buy ? 'arrow_up' : 'arrow_down', text: label, lock: true, disableSave: true,
            overrides: { color: buy ? '#00b47e' : '#eb4d4b', fontsize: ev.haka ? 12 : 10, bold: !!ev.haka } }
        ));
        if (id) out.push(id);
      } catch (e) {}
    });
  }

  // ============================================================
  // Monitor sinyal live — cek berkala, alert saat kondisi terpenuhi HARI INI
  // ============================================================
  // bangun candle intraday dari riwayat tick WebSocket (S.wsTickHist)
  // tfSec = detik per candle; volume/freq per candle = selisih nilai kumulatif harian
  function buildTickCandles(sym, tfSec, maxBars) {
    const hist = (S.wsTickHist && S.wsTickHist[sym]) || [];
    if (hist.length < 3) return [];
    const buckets = new Map();
    for (const [ts, last, vol, freq] of hist) {
      const b = Math.floor(ts / 1000 / tfSec) * tfSec;
      let c = buckets.get(b);
      if (!c) { c = { t: b, o: last, h: last, l: last, c: last, cumV: vol, cumF: freq, startV: vol }; buckets.set(b, c); }
      else { c.h = Math.max(c.h, last); c.l = Math.min(c.l, last); c.c = last; c.cumV = vol; c.cumF = freq; }
    }
    const arr = [...buckets.values()].sort((a, b) => a.t - b.t);
    // volume per candle = cumV candle ini − cumV candle sebelumnya (kumulatif harian, reset tiap hari)
    for (let i = 0; i < arr.length; i++) {
      const prev = arr[i - 1];
      const sameDay = prev && new Date(prev.t * 1000).getUTCDate() === new Date(arr[i].t * 1000).getUTCDate();
      arr[i].v = sameDay ? Math.max(arr[i].cumV - prev.cumV, 0) : Math.max(arr[i].cumV - arr[i].startV, 0);
      arr[i].iso = isoFromEpochSec(arr[i].t);
    }
    return arr.slice(-maxBars);
  }

  const TF_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 };
  const TF_POLL = { '1m': 10e3, '5m': 20e3, '15m': 30e3, '1h': 60e3, '1D': 60e3 };

  // ============================================================
  // IDX Scalper — orchestrator (refresh + gambar di Chartbit)
  // ============================================================
  const IDX_CFG = { emaFast: 7, emaSlow: 21, rsiLen: 7, atrLen: 14, volMaLen: 20, volMult: 1.2, slMult: 1.5, tp1Mult: 1.0, tp2Mult: 2.0, feeBuy: 0.15, feeSell: 0.25, feeSafety: 1.5, useVol: true, useObv: true, useHtf: true, useOrb: true, useSession: true };
  const idxScalp = { on: false, timer: null, sym: null, lastSig: null };

  function idxScalperToggle() {
    if (idxScalp.on) {
      idxScalp.on = false; clearTimeout(idxScalp.timer);
      ui.idxBtn.textContent = '🇮🇩 IDX Scalper: OFF';
      ui.idxBtn.classList.remove('on'); ui.idxBtn.classList.add('primary');
      ui.idxOut.innerHTML = '';
      return;
    }
    idxScalp.on = true; idxScalp.sym = getSymbol(); idxScalp.lastSig = null;
    ui.idxBtn.textContent = '🇮🇩 IDX Scalper: ON';
    ui.idxBtn.classList.remove('primary'); ui.idxBtn.classList.add('on');
    ui.idxOut.innerHTML = '<div class="status">⏳ Menghitung IDX Scalper…</div>';
    idxScalperTick();
  }

  async function idxScalperTick() {
    if (!idxScalp.on) return;
    const tf = (ui.idxTf && ui.idxTf.value) || '5m';
    try {
      const sym = getSymbol() || idxScalp.sym;
      if (sym !== idxScalp.sym) { idxScalp.sym = sym; idxScalp.lastSig = null; }
      const st = await idxScalperAnalyze(sym, TF_SEC[tf], IDX_CFG);
      if (st.warmup != null) {
        ui.idxOut.innerHTML = `<div class="status"><span style="color:#f2c14e">⏳ Mengumpulkan candle ${tf} dari tick… (${st.warmup}/${st.need}). Nyalakan ⚡ Live Tape & biarkan halaman terbuka.</span></div>`;
      } else {
        renderIdxScalper(st, tf, sym);
        // alert + gambar saat sinyal BUY/EXIT baru
        const sigKey = st.buy ? 'BUY:' + st.bars[st.i].t : st.exit ? 'EXIT:' + st.bars[st.i].t : null;
        if (sigKey && sigKey !== idxScalp.lastSig) {
          idxScalp.lastSig = sigKey;
          if (st.buy) { beepHaka(); notifyDesktop(`🟢 IDX BUY ${sym} @ ${st.last}`, `${tf} · TP1 ${st.tpsl.tp1} · SL ${st.tpsl.sl}`); }
          else { beep(); notifyDesktop(`🔴 IDX EXIT ${sym} @ ${st.last}`, `${tf} · tren mikro patah / bawah VWAP`); }
          try { await drawIdxScalperSignal(st); } catch (e) {}
          ui.panel.classList.add('open');
        }
      }
    } catch (e) {
      ui.idxOut.innerHTML = `<div class="status"><span class="no">✖ Gagal: ${esc(e.message)}</span></div>`;
    }
    idxScalp.timer = setTimeout(idxScalperTick, marketOpen() ? (TF_POLL[tf] || 20e3) : 60e3);
  }

  function renderIdxScalper(st, tf, sym) {
    const verdict = st.buy ? { t: '🟢 BUY', c: '#00d69a', bg: '#0f2a1e' } : st.exit ? { t: '🔴 EXIT / JUAL', c: '#eb6b69', bg: '#241417' } : st.trendUp ? { t: '⏳ TUNGGU TRIGGER', c: '#f2c14e', bg: '#241f12' } : { t: '⚪ BUKAN SETUP', c: '#8b93a3', bg: '#1b1f27' };
    const row = (k, v, col) => `<div class="kv"><span class="k">${k}</span><span class="v" style="color:${col || '#e4e8ef'}">${v}</span></div>`;
    const yn = (b, y, n) => b ? `<span class="pos">${y}</span>` : `<span class="neg">${n}</span>`;
    ui.idxOut.innerHTML = `
      <div style="background:${verdict.bg};border:1px solid ${verdict.c}66;border-radius:10px;padding:9px 11px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px"><b style="font-size:15px;color:${verdict.c}">${verdict.t}</b>
          <span class="hint" style="margin-left:auto">${esc(sym)} · ${tf} · ${st.last}</span></div>
        ${st.buy ? `<div style="font-size:10.5px;color:#c8cfda;margin-top:4px">🎯 TP1 <b>${st.tpsl.tp1}</b> (+${Math.round((st.tpsl.tp1 - st.last) / st.tpsl.tick)}tick) · TP2 <b>${st.tpsl.tp2}</b> · SL <b>${st.tpsl.sl}</b></div>` : ''}
      </div>
      <div class="grp" style="padding:8px 10px">
        ${row('Tren HTF (' + tf + '→besar)', st.htfOkData ? yn(st.htfUp, 'NAIK ▲', 'TURUN ▼') : '<span class="hint">data kurang</span>')}
        ${row('Tren mikro (EMA7/21)', yn(st.emaF > st.emaS, 'NAIK ▲', 'TURUN ▼'))}
        ${row('VWAP', yn(st.aboveVwap, 'DI ATAS ✓ ' + Math.round(st.vwap), 'DI BAWAH ✗ ' + Math.round(st.vwap)))}
        ${row('Volume', yn(st.volOk, 'TINGGI ✓', 'RENDAH ✗'))}
        ${row('Akumulasi (OBV)', yn(st.obvOk, 'AKUMULASI ✓', 'DISTRIBUSI ✗'))}
        ${row('RSI(' + IDX_CFG.rsiLen + ')', st.rsi.toFixed(0), st.rsi >= 50 ? '#00d69a' : '#eb6b69')}
        ${row('Fraksi / Breakeven', tickSize(st.last) + ' / ' + st.be.toFixed(2) + '%', '#f2c14e')}
        ${row('Jarak ke ARA', st.distAra != null ? st.distAra.toFixed(1) + '%' + (st.nearAra ? ' ⚠ BAHAYA' : '') : '-', st.nearAra ? '#eb6b69' : st.distAra != null && st.distAra < 8 ? '#f2a03e' : '#00d69a')}
        ${row('ARA / ARB', st.ara ? `${st.ara} / ${st.arb}` : '-')}
        ${st.orH ? row('Opening Range', `${Math.round(st.orL)}–${Math.round(st.orH)}${st.orbBreakUp ? ' 🚀 BREAK!' : ''}`) : ''}
        <div class="kv" style="border:none">${row('Sesi', st.gocap ? '<span class="neg">SAHAM GOCAP ⚠</span>' : st.inSession ? '<span class="pos">' + st.ses.label + ' ✓</span>' : '<span class="hint">' + st.ses.label + '</span>')}</div>
      </div>
      <div class="note">Sinyal BUY = tren naik + di atas VWAP + tren HTF naik + volume + trigger (RSI×50 / EMA× / ORB break), hindari dekat ARA & gocap. TP fee-aware, dibulatkan ke fraksi. Candle dari tick realtime (butuh Live Tape). Bukan rekomendasi.</div>`;
  }

  async function drawIdxScalperSignal(st) {
    const chart = findChart();
    if (!chart || typeof chart.createShape !== 'function') return;
    const t = st.bars[st.i].t;
    await trackDraw(chart, async (out) => {
      if (st.buy) {
        try { const id = await Promise.resolve(chart.createShape({ time: t, price: st.tpsl.sl * 0.997 }, { shape: 'arrow_up', text: 'BUY', lock: true, disableSave: true, overrides: { color: '#00b47e', fontsize: 12, bold: true } })); if (id) out.push(id); } catch (e) {}
        for (const lv of [{ p: st.tpsl.sl, c: '#eb4d4b', l: 'SL ' + st.tpsl.sl }, { p: st.tpsl.tp1, c: '#00b47e', l: 'TP1 ' + st.tpsl.tp1 }, { p: st.tpsl.tp2, c: '#00d69a', l: 'TP2 ' + st.tpsl.tp2 }]) {
          try { const id = await Promise.resolve(chart.createShape({ time: t, price: lv.p }, { shape: 'horizontal_line', lock: true, disableSave: true, overrides: { linecolor: lv.c, linestyle: 2, linewidth: 1 } })); if (id) out.push(id); } catch (e) {}
          try { const id2 = await Promise.resolve(chart.createShape({ time: t, price: lv.p }, { shape: 'text', text: lv.l, lock: true, disableSave: true, overrides: { color: lv.c, fontsize: 10 } })); if (id2) out.push(id2); } catch (e) {}
        }
      } else if (st.exit) {
        try { const id = await Promise.resolve(chart.createShape({ time: t, price: st.last * 1.003 }, { shape: 'arrow_down', text: 'EXIT', lock: true, disableSave: true, overrides: { color: '#eb4d4b', fontsize: 12, bold: true } })); if (id) out.push(id); } catch (e) {}
      }
    });
  }

  const liveMon = { on: false, sym: null, timer: null, alerted: {}, lastInfo: '', lastCheck: null };
  let audioCtx = null;

  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const mk = (t, f) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.12, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.25);
        o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.3);
      };
      mk(0, 880); mk(0.3, 1320);
    } catch (e) {}
  }

  // bunyi khusus HAKA: tiga nada naik cepat (lebih "urgent")
  function beepHaka() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const mk = (t, f) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'square';
        o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.1, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.15);
        o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.16);
      };
      mk(0, 784); mk(0.12, 988); mk(0.24, 1319); mk(0.36, 1568);
    } catch (e) {}
  }

  function notifyDesktop(judul, isi) {
    try {
      if (window.Notification && Notification.permission === 'granted') new Notification(judul, { body: isi });
    } catch (e) {}
  }

  // jam bursa IDX (WIB, Sen-Jum) dengan buffer pre/post
  function marketOpen() {
    const d = new Date(Date.now() + 7 * 3600e3);
    const day = d.getUTCDay(), hm = d.getUTCHours() * 60 + d.getUTCMinutes();
    return day >= 1 && day <= 5 && hm >= 8 * 60 + 55 && hm <= 16 * 60 + 10;
  }

  function monitorToggle() {
    if (liveMon.on) {
      liveMon.on = false;
      clearTimeout(liveMon.timer);
      ui.monBtn.textContent = '🔔 Monitor Sinyal: OFF';
      ui.monBtn.classList.remove('on');
      liveMon.lastInfo = '';
      ui.monOut.innerHTML = '';
      return;
    }
    liveMon.on = true;
    liveMon.sym = getSymbol();
    liveMon.alerted = {};
    ui.monBtn.textContent = '🔔 Monitor Sinyal: ON';
    ui.monBtn.classList.add('on');
    try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
    ui.monOut.innerHTML = '<div class="status">🔔 Monitor menyala — pengecekan pertama…</div>';
    liveMon.timer = setTimeout(monitorTick, 1500);
  }

  async function monitorTick() {
    if (!liveMon.on) return;
    const buka = marketOpen();
    const tf = (ui.monTf && ui.monTf.value) || '1D';
    let poll = TF_POLL[tf] || 60e3;
    try {
      const sym = getSymbol() || liveMon.sym;
      if (sym !== liveMon.sym) { liveMon.sym = sym; liveMon.alerted = {}; }
      const fast = Math.max(2, Math.min(200, Math.round(+ui.maFast.value || 9)));
      const slow = Math.max(3, Math.min(400, Math.round(+ui.maSlow.value || 21)));
      const rsiLen = Math.max(2, Math.min(50, Math.round(+ui.rsiLen.value || 14)));
      const need = slow + 30;
      liveMon.lastCheck = new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 19) + ' WIB';

      let bars, warmup = null;
      if (tf === '1D') {
        const to = todayISO();
        const from = new Date(Date.parse(`${to}T00:00:00Z`) - Math.ceil(need * 1.6) * 86400e3).toISOString().slice(0, 10);
        bars = await fetchDailyBars(sym, from, to);
      } else {
        // candle intraday dibangun dari stream tick WebSocket (butuh Live Tape / halaman aktif)
        bars = buildTickCandles(sym, TF_SEC[tf], need + 5);
        if (bars.length < Math.max(slow + 2, 12)) {
          warmup = `Mengumpulkan candle ${tf} dari tick realtime… (${bars.length}/${Math.max(slow + 2, 12)} bar). Nyalakan ⚡ Live Tape & biarkan halaman terbuka agar tick mengalir.`;
        }
      }

      if (warmup) {
        liveMon.lastInfo = `<div class="status"><span style="color:#f2c14e">⏳ ${warmup}</span></div>`;
      } else {
        const sigs = generateSignals(bars, { maType: ui.maType.value, fast, slow, rsiLen });
        const lastIdx = bars.length - 1;
        const forming = sigs.filter((s) => s.i === lastIdx);
        if (forming.length) {
          const sg = forming[0];
          const key = `${sym}:${tf}:${sg.iso}:${sg.type}`;
          if (!liveMon.alerted[key]) {
            liveMon.alerted[key] = true;
            beep();
            notifyDesktop(`⚡ ${sg.type} ${sym} (${tf}) @ ${Math.round(sg.price)}`, sg.reasons.join(', '));
            try { if (tf === '1D') await drawSignalMarks([sg]); } catch (e) {}
            ui.panel.classList.add('open');
          }
          const buy = sg.type === 'BUY';
          liveMon.lastInfo = `<div class="concl" style="border-color:${buy ? '#2b6e4f' : '#8a4444'}">
            ⚡ <b class="${buy ? 'pos' : 'neg'}">${sg.type} ${esc(sym)}</b> <span class="hint">${tf}</span> @ ${Math.round(sg.price)}<br>${sg.reasons.map(esc).join(', ')}
            <br><span style="color:#f2c14e">⏳ Candle ${tf} berjalan — konfirmasi saat candle close.</span></div>`;
        } else {
          const lastSig = sigs[sigs.length - 1];
          liveMon.lastInfo = `<div class="status">Belum ada sinyal ${esc(sym)} pada candle ${tf} berjalan.${lastSig ? ` Terakhir: <b class="${lastSig.type === 'BUY' ? 'pos' : 'neg'}">${lastSig.type}</b> @ ${Math.round(lastSig.price)}.` : ''}</div>`;
        }
      }
    } catch (e) {
      liveMon.lastInfo = `<div class="status"><span class="no">✖ Gagal cek: ${esc(e.message)}</span></div>`;
    }
    if (!buka) poll = Math.max(poll, 300e3);
    ui.monOut.innerHTML = `<div class="status">🔔 ${liveMon.sym ? esc(liveMon.sym) : ''} · TF ${tf} · cek ${liveMon.lastCheck || '-'} · ${buka ? `tiap ${Math.round(poll / 1000)} dtk` : 'pasar tutup'}</div>` + liveMon.lastInfo;
    liveMon.timer = setTimeout(monitorTick, poll);
  }

  // ============================================================
  // Rencana TP/SL di chart
  // ============================================================
  async function showTradePlan() {
    ui.indiOut.innerHTML = '<div class="status">Menyusun rencana TP/SL…</div>';
    try {
      const { bars } = await barsForIndicators(120);
      const c = bars[bars.length - 1].c;
      const atr = calcATR(bars, 14) || c * 0.02;
      const sr = findSR(bars, 8);
      const resAtas = sr.filter((l) => l.type === 'R' && l.p > c * 1.005).sort((a, b) => a.p - b.p);
      const supBawah = sr.filter((l) => l.type === 'S' && l.p < c * 0.995).sort((a, b) => b.p - a.p);
      // TP: resistance terdekat; kalau kurang, lengkapi dengan kelipatan ATR
      const tps = resAtas.slice(0, 3).map((l) => l.p);
      while (tps.length < 3) tps.push(c + atr * 1.5 * (tps.length + 1));
      // SL: sedikit di bawah support terdekat, dibatasi maks 2.5 ATR dari harga
      let sl = supBawah.length ? supBawah[0].p * 0.99 : c - 1.5 * atr;
      sl = Math.max(sl, c - 2.5 * atr);
      sl = roundTick(sl, false);
      const plan = { entry: c, sl, tps: tps.map((p) => roundTick(p, false)), atr, t: bars[Math.max(bars.length - 30, 0)].t };
      const n = await drawTradePlanShapes(plan);
      const risk = c - sl;
      const rows = plan.tps.map((tp, k) => `<tr>
        <td>TP${k + 1}</td><td class="r"><b>${tp}</b></td>
        <td class="r pos">+${(((tp - c) / c) * 100).toFixed(1)}%</td>
        <td class="r">${((tp - c) / risk).toFixed(1)}R</td>
      </tr>`).join('');
      ui.indiOut.innerHTML = `
        <div class="status">${n ? `✔ Rencana digambar di chart (hapus lewat "Hapus Marka").` : '⚠ Chart tidak ditemukan — rencana tampil di bawah.'}</div>
        <table style="margin-top:6px">
          <tr><th>Level</th><th class="r">Harga</th><th class="r">Jarak</th><th class="r">R multiple</th></tr>
          <tr><td>Entry</td><td class="r"><b>${Math.round(c)}</b></td><td class="r">—</td><td class="r">—</td></tr>
          <tr><td>SL</td><td class="r neg"><b>${plan.sl}</b></td><td class="r neg">−${(((c - plan.sl) / c) * 100).toFixed(1)}%</td><td class="r">1R = ${Math.round(risk)} poin</td></tr>
          ${rows}
        </table>
        <div class="note">TP dari resistance terdekat (dilengkapi kelipatan 1.5×ATR bila kurang), SL di bawah support terdekat
        dibatasi maks 2.5×ATR, semua dibulatkan ke tick IDX. ATR(14) = ${Math.round(atr)}.</div>`;
    } catch (e) {
      ui.indiOut.innerHTML = `<div class="status"><span class="no">✖ Gagal: ${esc(e.message)}</span></div>`;
    }
  }

  async function drawTradePlanShapes(plan) {
    const chart = findChart();
    if (!chart) return 0;
    let n = 0;
    await trackDraw(chart, async (out) => {
      const garis = [
        { p: plan.entry, warna: '#aeb6c4', label: `ENTRY ${Math.round(plan.entry)}` },
        { p: plan.sl, warna: '#eb4d4b', label: `SL ${plan.sl} (−${(((plan.entry - plan.sl) / plan.entry) * 100).toFixed(1)}%)` },
        ...plan.tps.map((tp, k) => ({ p: tp, warna: '#00b47e', label: `TP${k + 1} ${tp} (+${(((tp - plan.entry) / plan.entry) * 100).toFixed(1)}%)` })),
      ];
      for (const g of garis) {
        try {
          const id = await Promise.resolve(chart.createShape({ time: plan.t, price: g.p },
            { shape: 'horizontal_line', lock: true, disableSave: true, overrides: { linecolor: g.warna, linestyle: g.warna === '#aeb6c4' ? 0 : 2, linewidth: 1 } }));
          if (id) { out.push(id); n++; }
        } catch (e) {}
        try {
          const id2 = await Promise.resolve(chart.createShape({ time: plan.t, price: g.p },
            { shape: 'text', text: g.label, lock: true, disableSave: true, overrides: { color: g.warna, fontsize: 10, bold: true } }));
          if (id2) out.push(id2);
        } catch (e) {}
      }
    });
    if (n) { autoRedraw.tp = plan; autoRedraw.sym = getSymbol(); }
    return n;
  }

  // ============================================================
  // Price-Volume Analysis (VSA sederhana + OBV)
  // ============================================================
  function pvaAnalysis(bars) {
    const vma = calcSMA(bars.map((b) => b.v), 20);
    const rma = calcSMA(bars.map((b) => b.h - b.l), 20);
    const klasifikasi = (i) => {
      if (!vma[i - 1] || !rma[i - 1]) return null;
      const naik = bars[i].c >= bars[i - 1].c;
      const vRel = bars[i].v / vma[i - 1];
      const rRel = (bars[i].h - bars[i].l) / rma[i - 1];
      if (naik) {
        if (vRel >= 1.5 && rRel >= 1) return { k: 'DEMAND KUAT', d: 'naik + volume & range besar — pergerakan valid', s: +2 };
        if (vRel >= 1.5 && rRel < 0.7) return { k: 'ABSORPSI SUPPLY', d: 'volume besar tapi range sempit — ada yang jualan di atas, effort > result', s: -1 };
        if (vRel < 0.7) return { k: 'NO DEMAND', d: 'naik tanpa volume — kenaikan rapuh', s: -1 };
        return { k: 'naik normal', d: '', s: +1 };
      }
      if (vRel >= 1.5 && rRel >= 1) return { k: 'SUPPLY KUAT', d: 'turun + volume & range besar — tekanan jual nyata', s: -2 };
      if (vRel >= 1.5 && rRel < 0.7) return { k: 'ABSORPSI DEMAND', d: 'turun ditahan volume besar — ada yang menampung', s: +1 };
      if (vRel < 0.7) return { k: 'NO SUPPLY', d: 'turun tanpa volume — koreksi sehat', s: +1 };
      return { k: 'turun normal', d: '', s: -1 };
    };
    // OBV
    const obv = [0];
    for (let i = 1; i < bars.length; i++) {
      obv.push(obv[i - 1] + (bars[i].c > bars[i - 1].c ? bars[i].v : bars[i].c < bars[i - 1].c ? -bars[i].v : 0));
    }
    const i = bars.length - 1;
    const back = Math.min(20, i);
    const obvChg = obv[i] - obv[i - back];
    const priceChg = bars[i].c / bars[i - back].c - 1;
    let obvTxt = `OBV 20 hari ${obvChg >= 0 ? 'NAIK' : 'TURUN'}`;
    let obvSinyal = null;
    if (obvChg > 0 && priceChg < -0.02) { obvTxt += ' sementara harga turun — 🟢 <b>divergensi bullish: volume mengindikasikan akumulasi</b>'; obvSinyal = 'bull'; }
    else if (obvChg < 0 && priceChg > 0.02) { obvTxt += ' sementara harga naik — 🔴 <b>divergensi bearish: kenaikan tidak didukung volume</b>'; obvSinyal = 'bear'; }
    // rasio volume hari naik vs turun (20 hari)
    let vUp = 0, vDn = 0;
    for (let j = i - back + 1; j <= i; j++) {
      if (bars[j].c >= bars[j - 1].c) vUp += bars[j].v; else vDn += bars[j].v;
    }
    const rasioUD = vDn > 0 ? vUp / vDn : 99;
    // klimaks volume: volume terbesar 40 hari terakhir di dekat low/high ekstrem
    let klimaks = null;
    const w40 = bars.slice(-40);
    const iMaxV = w40.reduce((m, b, k) => (b.v > w40[m].v ? k : m), 0);
    const loMin = Math.min(...w40.map((b) => b.l)), hiMax = Math.max(...w40.map((b) => b.h));
    if (w40[iMaxV].l <= loMin * 1.03) klimaks = { jenis: 'SELLING CLIMAX', d: 'volume terbesar terjadi di area low — panic selling, sering jadi dasar', iso: w40[iMaxV].iso };
    else if (w40[iMaxV].h >= hiMax * 0.97) klimaks = { jenis: 'BUYING CLIMAX', d: 'volume terbesar di area high — euforia, rawan puncak/distribusi', iso: w40[iMaxV].iso };
    // baris 8 hari terakhir + skor
    const rows = [];
    let skor = 0;
    for (let j = Math.max(i - 7, 1); j <= i; j++) {
      const kl = klasifikasi(j);
      if (!kl) continue;
      skor += kl.s * (j > i - 4 ? 2 : 1); // hari terbaru berbobot lebih
      rows.push({ iso: bars[j].iso || isoFromEpochSec(bars[j].t), c: bars[j].c, chg: (bars[j].c / bars[j - 1].c - 1) * 100, vRel: vma[j - 1] ? bars[j].v / vma[j - 1] : 0, ...kl });
    }
    return { rows, obvTxt, obvSinyal, rasioUD, klimaks, skor };
  }

  async function showPVA() {
    ui.indiOut.innerHTML = '<div class="status">Menganalisa price-volume…</div>';
    try {
      const { bars } = await barsForIndicators(120);
      const p = pvaAnalysis(bars);
      const rows = p.rows.slice().reverse().map((r) => `<tr>
        <td>${fmtTgl(r.iso)}</td>
        <td class="r ${r.chg >= 0 ? 'pos' : 'neg'}">${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(1)}%</td>
        <td class="r">${r.vRel.toFixed(1)}x</td>
        <td><b>${r.k}</b>${r.d ? `<span style="color:#78808f;font-size:10px"> — ${r.d}</span>` : ''}</td>
      </tr>`).join('');
      const bias = p.skor >= 4 ? '🟢 <b>PVA BULLISH</b> — volume mendukung kenaikan/akumulasi'
        : p.skor <= -4 ? '🔴 <b>PVA BEARISH</b> — volume menunjukkan distribusi/tekanan jual'
        : '⚪ <b>PVA netral</b> — belum ada dominasi effort yang jelas';
      ui.indiOut.innerHTML = `
        <div class="concl">${bias}
          <div class="meta" style="margin-top:4px">
            ${p.obvTxt}<br>
            Volume hari naik vs turun (20 hari): <b>${p.rasioUD.toFixed(2)}</b> ${p.rasioUD >= 1.3 ? '— 🟢 demand dominan' : p.rasioUD <= 0.75 ? '— 🔴 supply dominan' : '— seimbang'}
            ${p.klimaks ? `<br>⚡ <b>${p.klimaks.jenis}</b> terdeteksi ${fmtTgl(p.klimaks.iso)} — ${p.klimaks.d}` : ''}
          </div></div>
        <table style="margin-top:6px">
          <tr><th>Tanggal</th><th class="r">Δ Harga</th><th class="r">Vol</th><th>Klasifikasi PVA</th></tr>
          ${rows}
        </table>
        <div class="note">Prinsip VSA: bandingkan <i>effort</i> (volume) dengan <i>result</i> (pergerakan harga).
        Vol = rasio terhadap rata-rata 20 hari. Gabungkan dengan brokermology: absorpsi demand + broker akumulasi = konfirmasi kuat.</div>`;
    } catch (e) {
      ui.indiOut.innerHTML = `<div class="status"><span class="no">✖ Gagal: ${esc(e.message)}</span></div>`;
    }
  }

  // ============================================================
  // Analisa Teknikal Lengkap (konfluensi) & Fibonacci
  // ============================================================
  async function technicalReadout() {
    ui.indiOut.innerHTML = '<div class="status">Menghitung analisa teknikal lengkap…</div>';
    try {
      const { bars } = await barsForIndicators(220);
      const closes = bars.map((b) => b.c);
      const i = closes.length - 1;
      const c = closes[i];
      const bull = [], bear = [], netral = [];

      // ---- 1. TREND ----
      const ma20 = calcSMA(closes, 20)[i], ma50 = calcSMA(closes, 50)[i], ma200 = calcSMA(closes, 200)[i];
      const maTxt = [
        ma20 != null ? `MA20 ${c >= ma20 ? 'di atas ✓' : 'di bawah ✗'}` : null,
        ma50 != null ? `MA50 ${c >= ma50 ? 'di atas ✓' : 'di bawah ✗'}` : null,
        ma200 != null ? `MA200 ${c >= ma200 ? 'di atas ✓' : 'di bawah ✗'}` : null,
      ].filter(Boolean).join(' · ');
      if (ma50 != null) (c >= ma50 ? bull : bear).push(`harga ${c >= ma50 ? 'di atas' : 'di bawah'} MA50`);
      if (ma200 != null) (c >= ma200 ? bull : bear).push(`harga ${c >= ma200 ? 'di atas' : 'di bawah'} MA200`);
      const struk = trendStructure(bars);
      if (struk) {
        if (struk.arah === 'UPTREND') bull.push('struktur HH+HL');
        else if (struk.arah === 'DOWNTREND') bear.push('struktur LH+LL');
        else netral.push('struktur transisi');
      }

      // ---- 2. MOMENTUM ----
      const rsiLen = Math.max(2, Math.min(50, Math.round(+ui.rsiLen.value || 14)));
      const r = calcRSI(closes, rsiLen);
      const rv = r[i];
      let rsiTxt = '-';
      if (rv != null) {
        rsiTxt = `RSI(${rsiLen}) = <b>${rv.toFixed(1)}</b>`;
        if (rv >= 70) { rsiTxt += ' <span class="vd sd">OVERBOUGHT</span>'; bear.push(`RSI overbought ${rv.toFixed(0)}`); }
        else if (rv <= 30) { rsiTxt += ' <span class="vd sa">OVERSOLD</span>'; bull.push(`RSI oversold ${rv.toFixed(0)}`); }
        else if (rv > r[i - 1]) { rsiTxt += ' (naik)'; }
      }
      const div = detectDivergence(bars, r);
      let divTxt = '';
      for (const d of div) {
        divTxt += `<br>${d.type === 'bullish' ? '🟢 <b>Divergensi bullish</b>' : '🔴 <b>Divergensi bearish</b>'} RSI vs harga (pivot ${fmtTgl(d.iso)})`;
        (d.type === 'bullish' ? bull : bear).push(`divergensi ${d.type}`);
      }
      const macd = calcMACD(closes);
      let macdTxt = '-';
      if (macd.hist[i] != null) {
        const h = macd.hist[i], hNaik = macd.hist[i - 1] != null && h > macd.hist[i - 1];
        macdTxt = `MACD ${macd.line[i] >= macd.signal[i] ? 'DI ATAS signal' : 'DI BAWAH signal'}, histogram ${hNaik ? 'menguat' : 'melemah'}${macd.line[i] >= 0 ? ', di atas nol' : ', di bawah nol'}`;
        (macd.line[i] >= macd.signal[i] ? bull : bear).push(`MACD ${macd.line[i] >= macd.signal[i] ? 'bullish' : 'bearish'}`);
      }

      // ---- 3. VOLUME ----
      const vols = bars.map((b) => b.v);
      const vmaArr = calcSMA(vols, 20);
      const vma20 = vmaArr[i - 1] || vmaArr[i]; // pembanding tanpa hari ini agar spike tidak terdilusi
      let volTxt = '-';
      if (vma20) {
        const rasio = vols[i] / vma20;
        const v5 = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const dryUp = v5 / vma20 < 0.55;
        volTxt = `hari ini <b>${rasio.toFixed(1)}x</b> rata-rata 20 hari`;
        if (rasio >= 2) {
          const naik = bars[i].c >= bars[i].o;
          volTxt += ` — <b>VOLUME SPIKE</b> candle ${naik ? 'hijau' : 'merah'}`;
          (naik ? bull : bear).push(`volume spike candle ${naik ? 'hijau' : 'merah'}`);
        } else if (dryUp) {
          volTxt += ' — <b>volume dry-up</b> (5 hari terakhir <55% normal): supply/demand mengering, rawan gerakan besar';
          netral.push('volume dry-up');
        }
      }

      // ---- 4. FOREIGN FLOW (dari data candle chartbit) ----
      // foreignbuy/foreignsell = nilai harian; foreignflow = KUMULATIF ->
      // net 20 hari = Σ(fbuy−fsell), fallback selisih kumulatif fflow
      let ffTxt = '';
      let ff20 = null;
      if (bars.some((b) => b.fbuy || b.fsell)) {
        ff20 = bars.slice(-20).reduce((a, b) => a + (b.fbuy || 0) - (b.fsell || 0), 0);
      } else if (bars.some((b) => b.fflow) && bars.length > 20) {
        ff20 = bars[i].fflow - bars[i - 20].fflow;
      }
      if (ff20 != null) {
        const chg20 = closes.length > 20 ? c / closes[i - 20] - 1 : 0;
        ffTxt = `akumulasi 20 hari: <b class="${ff20 >= 0 ? 'pos' : 'neg'}">${fmtRp(ff20)}</b>`;
        if (ff20 > 0 && chg20 < -0.03) { ffTxt += ' — 🟢 <b>asing akumulasi saat harga turun</b>'; bull.push('foreign inflow saat harga turun'); }
        else if (ff20 < 0 && chg20 > 0.03) { ffTxt += ' — 🔴 <b>asing distribusi saat harga naik</b>'; bear.push('foreign outflow saat harga naik'); }
        else (ff20 >= 0 ? bull : bear).push(`foreign ${ff20 >= 0 ? 'inflow' : 'outflow'} 20 hari`);
      }

      // ---- 5. RISK: ATR + ARA/ARB ----
      const atr = calcATR(bars, 14);
      const ar = araArb(c);
      const riskTxt = `${atr ? `ATR(14) = <b>${Math.round(atr)}</b> (${((atr / c) * 100).toFixed(1)}%/hari) · saran SL swing ±${Math.round(atr * 1.5)} poin (1.5×ATR)` : ''}
        <br>Besok: ARA <b>${ar.ara}</b> (+${ar.pct}%) · ARB <b>${ar.arb}</b> (−${ar.pct}%)`;

      // ---- 6. POSISI vs BANDAR & S/R ----
      let bandarTxt = '';
      if (lastResult && lastResult.phases && lastResult.phases.length) {
        const ph = lastResult.phases[lastResult.phases.length - 1];
        if (ph.avgPrice) {
          const jarak = (c / ph.avgPrice - 1) * 100;
          bandarTxt = `Fase ${ph.type} terakhir (${fmtTgl(ph.fromIso)}–${fmtTgl(ph.toIso)}): avg harga bandar ≈ <b>${Math.round(ph.avgPrice)}</b> → harga sekarang <b class="${jarak >= 0 ? 'pos' : 'neg'}">${jarak >= 0 ? '+' : ''}${jarak.toFixed(1)}%</b> dari cost bandar`;
          if (ph.type === 'AKUMULASI' && jarak < 10) bull.push('harga masih dekat cost akumulasi bandar');
          if (ph.type === 'AKUMULASI' && jarak > 25) bear.push('harga sudah jauh di atas cost bandar (rawan TP)');
        }
      }
      const sr = findSR(bars, 6);
      const sDekat = sr.filter((l) => l.type === 'S').sort((a, b) => b.p - a.p)[0];
      const rDekat = sr.filter((l) => l.type === 'R').sort((a, b) => a.p - b.p)[0];
      let srTxt = '';
      if (sDekat || rDekat) {
        srTxt = [
          sDekat ? `support terdekat <b>${Math.round(sDekat.p)}</b> (${(((sDekat.p - c) / c) * 100).toFixed(1)}%)` : null,
          rDekat ? `resistance terdekat <b>${Math.round(rDekat.p)}</b> (+${(((rDekat.p - c) / c) * 100).toFixed(1)}%)` : null,
        ].filter(Boolean).join(' · ');
        if (sDekat && rDekat) {
          const rr = (rDekat.p - c) / Math.max(c - sDekat.p, 1);
          srTxt += ` · R/R ke S-R ≈ <b>${rr.toFixed(1)}</b>`;
        }
      }

      // ---- KESIMPULAN ----
      const skor = bull.length - bear.length;
      const kesim = skor >= 3 ? '🟢 BIAS BULLISH KUAT' : skor >= 1 ? '🟢 bias bullish' : skor <= -3 ? '🔴 BIAS BEARISH KUAT' : skor <= -1 ? '🔴 bias bearish' : '⚪ netral / tunggu konfirmasi';

      ui.indiOut.innerHTML = `
        <div class="concl"><b>${kesim}</b> — ${bull.length} sinyal bullish vs ${bear.length} bearish
          <div class="meta" style="margin-top:4px">
            🟢 ${bull.length ? bull.join(', ') : '-'}<br>
            🔴 ${bear.length ? bear.join(', ') : '-'}${netral.length ? `<br>⚪ ${netral.join(', ')}` : ''}
          </div></div>
        <div class="phase"><b>Trend</b><div class="meta">${struk ? `<b>${struk.arah}</b> (${struk.detail})<br>` : ''}${maTxt}</div></div>
        <div class="phase"><b>Momentum</b><div class="meta">${rsiTxt}${divTxt}<br>${macdTxt}</div></div>
        <div class="phase"><b>Volume</b><div class="meta">${volTxt}</div></div>
        ${ffTxt ? `<div class="phase"><b>Foreign Flow</b><div class="meta">${ffTxt}</div></div>` : ''}
        ${bandarTxt ? `<div class="phase"><b>Posisi vs Bandar</b><div class="meta">${bandarTxt}</div></div>` : ''}
        ${srTxt ? `<div class="phase"><b>Level Kunci</b><div class="meta">${srTxt}</div></div>` : ''}
        <div class="phase"><b>Risk (khas IDX)</b><div class="meta">${riskTxt}</div></div>
        <div class="note">Basis candle harian. Jalankan analisa brokermology dulu agar bagian "Posisi vs Bandar" muncul.</div>`;
    } catch (e) {
      ui.indiOut.innerHTML = `<div class="status"><span class="no">✖ Gagal: ${esc(e.message)}</span></div>`;
    }
  }

  async function drawFibonacci() {
    ui.indiOut.innerHTML = '<div class="status">Menghitung fibonacci dari swing utama…</div>';
    try {
      const { bars } = await barsForIndicators(60);
      const fib = fibSwing(bars);
      const chart = findChart();
      let n = 0;
      if (chart) {
        await trackDraw(chart, async (out) => {
          // coba objek fib retracement asli TradingView
          try {
            const id = await Promise.resolve(chart.createMultipointShape(
              fib.up
                ? [{ time: fib.tLo, price: fib.lo }, { time: fib.tHi, price: fib.hi }]
                : [{ time: fib.tHi, price: fib.hi }, { time: fib.tLo, price: fib.lo }],
              { shape: 'fib_retracement', lock: true, disableSave: true }
            ));
            if (id) { out.push(id); n = 1; }
          } catch (e) {
            // fallback: garis horizontal di 38.2/50/61.8
            for (const lv of fib.levels) {
              try {
                const id = await Promise.resolve(chart.createShape(
                  { time: fib.up ? fib.tLo : fib.tHi, price: lv.p },
                  { shape: 'horizontal_line', lock: true, disableSave: true, overrides: { linecolor: '#f2c14e', linestyle: 2, linewidth: 1 } }
                ));
                if (id) { out.push(id); n++; }
              } catch (e2) {}
            }
          }
        });
      }
      const c = bars[bars.length - 1].c;
      const rows = fib.levels.map((lv) => `<tr><td>Fib ${(lv.r * 100).toFixed(1)}%</td><td class="r"><b>${Math.round(lv.p)}</b></td><td class="r">${(((lv.p - c) / c) * 100).toFixed(1)}%</td></tr>`).join('');
      ui.indiOut.innerHTML = `<div class="status">${n ? '✔ Fibonacci digambar di chart (hapus lewat "Hapus Marka").' : '⚠ Chart tidak ditemukan — level tampil di bawah.'}
        Swing ${fib.up ? 'NAIK' : 'TURUN'}: ${Math.round(fib.lo)} → ${Math.round(fib.hi)}</div>
        <table style="margin-top:6px"><tr><th>Level</th><th class="r">Harga</th><th class="r">Jarak</th></tr>${rows}</table>`;
    } catch (e) {
      ui.indiOut.innerHTML = `<div class="status"><span class="no">✖ Gagal: ${esc(e.message)}</span></div>`;
    }
  }

  // ============================================================
  // Orkestrasi analisa
  // ============================================================
  let lastResult = null;
  let running = false;

  async function runAnalysis() {
    if (running) return;
    const symbol = getSymbol();
    if (!symbol) { ui.prog.textContent = '✖ Buka halaman saham dulu (stockbit.com/symbol/XXXX).'; return; }

    // validasi rentang tanggal
    const today = todayISO();
    let fromIso = ui.dateFrom.value;
    let toIso = ui.dateTo.value || today;
    if (toIso > today) { toIso = today; ui.dateTo.value = today; }
    if (!fromIso || fromIso >= toIso) {
      ui.prog.textContent = '✖ Rentang tanggal tidak valid — tanggal "dari" harus sebelum tanggal "s/d".';
      return;
    }
    const calDays = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400e3);
    if (calDays < 21) {
      ui.prog.textContent = '✖ Rentang terlalu pendek — minimal ±3 minggu (15 hari bursa) agar fase bisa dideteksi.';
      return;
    }

    running = true;
    ui.run.disabled = true;
    ui.draw.disabled = true;
    ui.out.innerHTML = '';
    ui.prog.textContent = '';
    const estTrading = Math.round(calDays * 5 / 7);
    if (estTrading > MAX_TRADING_DAYS) {
      ui.prog.textContent = `Rentang ±${estTrading} hari bursa melebihi batas — dipakai ${MAX_TRADING_DAYS} hari bursa terakhir dari rentang itu…`;
    } else if (estTrading > 90) {
      ui.prog.textContent = `Rentang ±${estTrading} hari bursa — pengambilan pertama bisa beberapa menit (sengaja dipelankan agar tidak terdeteksi spam oleh Stockbit), berikutnya instan (cache)…`;
    } else if (estTrading > 40) {
      ui.prog.textContent = `Rentang ±${estTrading} hari bursa — pengambilan pertama bisa ±1 menit, berikutnya instan (cache)…`;
    }
    const opts = { win: +ui.win.value, sens: ui.sens.value };

    try {
      ui.prog.textContent = ui.prog.textContent || 'Mengambil data candle harian…';
      const bars = await fetchDailyBars(symbol, fromIso, toIso); // relay candle otomatis di dalamnya
      opts.win = Math.min(opts.win, Math.max(5, bars.length - 5));

      const isoList = bars.map((b) => b.iso || isoFromEpochSec(b.t));
      const dayRows = {};
      const failedDates = [];
      let done = 0;

      // 1 request pada satu waktu (bukan 3 paralel) + jeda lebih longgar antar hari;
      // ANALISA 1 SAHAM butuh broker summary PER HARI (bukan cuma total rentang) supaya
      // "Jendela Fase" bisa tahu di hari mana akumulasi/distribusi terjadi — tidak bisa
      // digantikan satu request rentang. Sengaja diperlambat (bukan diparalelkan) supaya
      // polanya tidak terlihat seperti bot nge-spam ke Stockbit; cache per simbol:tanggal
      // membuat run berikutnya di rentang yang sama tetap instan.
      const queue = [...isoList];
      const worker = async () => {
        while (queue.length) {
          const iso = queue.shift();
          let ok = false;
          for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
            try {
              dayRows[iso] = await fetchBrokerDay(symbol, iso);
              ok = true;
              relayBrokerDay(symbol, iso, dayRows[iso]);
            } catch (e) {
              if (e.message === 'AUTH') { queue.length = 0; throw e; }
              await sleep(900 * attempt); // mundur sejenak sebelum ulang
            }
          }
          if (!ok) failedDates.push(iso);
          done++;
          ui.prog.textContent = `Mengambil broker summary ${done}/${isoList.length} hari… (cache dipakai bila ada)`;
          await sleep(450 + Math.random() * 250); // jeda + jitter, meniru pola klik manusia
        }
      };
      // running trade ASLI (transaksi + broker pembeli/penjual per print) utk
      // simbol ini, hari terakhir — jalan BERSAMAAN dgn worker broker harian
      // (endpoint beda: order-trade/running-trade vs marketdetectors/brokers,
      // jadi tidak menumpuk beban di satu API yg sama). Direlay ke Arsant
      // Screener utk panel Running Trade / analisa transaksi.
      let rtCount = 0, rtWholeDay = false;
      const runningTradeTask = (async () => {
        try {
          const rt = await fetchRunningTrade(symbol, { maxBatches: RUNNING_TRADE_BATCHES });
          rtCount = rt.length;
          rtWholeDay = !!rt.wholeDay;
          relayRunningTrade(symbol, rt, today);
        } catch (e) {}
      })();
      const shareholdingTask = (async () => {
        try {
          await fetchShareholdingSingle(symbol);
        } catch (e) {}
      })();
      const histTask = (async () => {
        try {
          await fetchHistoricalSummaryAllPeriods(symbol, fromIso, toIso);
        } catch (e) {}
      })();
      await Promise.all([worker(), runningTradeTask, shareholdingTask, histTask]);
      if (rtCount) {
        ui.prog.textContent = `${ui.prog.textContent} · ${rtCount} running trade tersimpan${rtWholeDay ? ' (tuntas s/d penutupan)' : ' (belum tuntas, dibatasi pagar pengaman)'}.`;
      }

      // angka total otoritatif dari satu query rentang penuh (identik dgn panel Stockbit)
      ui.prog.textContent = 'Rekonsiliasi dengan query rentang penuh…';
      const rangeRows = await fetchBrokerRange(
        symbol,
        bars[0].iso || isoFromEpochSec(bars[0].t),
        bars[bars.length - 1].iso || isoFromEpochSec(bars[bars.length - 1].t)
      );

      // semua request sukses tapi tak ada satu pun baris broker -> kemungkinan
      // bentuk respons tidak dikenali parser; cetak sampel mentah untuk diagnosa
      const gotRows = Object.values(dayRows).some((r) => r && r.length);
      if (!gotRows && S.lastSummary) {
        console.warn('[Brokermology] Respons broker summary tidak dikenali parser. Sampel mentah:', S.lastSummary);
        ui.prog.textContent = '✖ Respons API tidak dikenali parser — sampel dicetak ke console (F12), kirimkan strukturnya.';
        return;
      }

      ui.prog.textContent = 'Menganalisa fase & broker…';
      const res = analyze(bars, dayRows, opts, rangeRows);
      lastResult = res;
      renderResult(symbol, res, bars, failedDates);
      ui.draw.disabled = !res.phases.length;
      ui.prog.textContent = res.phases.length
        ? `✔ Selesai. ${res.phases.length} fase terdeteksi — klik "Gambar di Chart".`
        : '✔ Selesai. Tidak ada fase yang memenuhi ambang — coba sensitivitas "Tinggi".';
    } catch (e) {
      ui.prog.textContent =
        e.message === 'AUTH' ? '✖ Token ditolak/kadaluarsa — muat ulang halaman lalu coba lagi.' :
        e.message === 'BARS' ? '✖ Data candle tidak tersedia — buka/refresh Chartbit dulu lalu coba lagi.' :
        `✖ Gagal: ${e.message}`;
    } finally {
      running = false;
      ui.run.disabled = false;
    }
  }

  // ============================================================
  // Render hasil
  // ============================================================
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderResult(symbol, res, bars, failedDates) {
    const out = [];
    const failed = failedDates ? failedDates.length : 0;

    if (failed) {
      out.push(`<div class="concl" style="border-color:#8a4444;background:#2a1c20">⚠ <b>${failed} hari gagal diambil</b> setelah 3x percobaan dan dilewati:
        ${failedDates.slice(0, 8).map(fmtTgl).join(', ')}${failed > 8 ? '…' : ''}.
        ${res.reconciled
          ? 'Total broker di tabel <b>tetap akurat</b> (dari query rentang penuh), tapi deteksi fase & konsistensi bisa sedikit bias — jalankan ulang untuk mencoba lagi.'
          : '<b>Angka bisa bias</b> — jalankan ulang untuk mencoba lagi.'}</div>`);
    }

    // ---- kesimpulan singkat ----
    const last = res.phases[res.phases.length - 1];
    const lastBarIso = res.days.length ? res.days[res.days.length - 1].iso : null;
    if (last && lastBarIso && last.toIso >= lastBarIso) {
      const b = last.topBrokers[0];
      out.push(`<div class="concl">📌 <b>Fase berjalan: <span class="${last.type === 'AKUMULASI' ? 'pos' : 'neg'}">${last.type} oleh ${last.actor || '-'}</span></b>
        sejak ${fmtTgl(last.fromIso)} — motor: <b>${last.topBrokers.map((x) => esc(x.code)).join(', ')}</b>
        (${esc(brokerName(b.code))}), flow ${fmtRp(last.flow)},
        smart money ${(last.smartShare * 100).toFixed(0)}% vs ritel ${(100 - last.smartShare * 100).toFixed(0)}% · avg ${fmtRp(last.avgTrx)}/transaksi.</div>`);
    }
    if (res.error) out.push(`<div class="concl">⚠ ${esc(res.error)}</div>`);

    // ---- timeline mini ----
    if (res.days.length) {
      const t0 = res.days[0].t, t1 = res.days[res.days.length - 1].t, span = Math.max(t1 - t0, 1);
      let segs = '';
      let cursor = t0;
      for (const ph of res.phases) {
        if (ph.t1 > cursor) segs += `<div style="width:${(((ph.t1 - cursor) / span) * 100).toFixed(2)}%"></div>`;
        const col = ph.type === 'AKUMULASI' ? '#00b47e' : '#eb4d4b';
        segs += `<div style="width:${(((ph.t2 - ph.t1) / span) * 100).toFixed(2)}%;background:${col}" title="${ph.type} ${fmtTgl(ph.fromIso)}–${fmtTgl(ph.toIso)}"></div>`;
        cursor = ph.t2;
      }
      out.push(`<div class="sec"><h4>TIMELINE FASE</h4>
        <div class="timeline">${segs}</div>
        <div class="tl-lbl"><span>${fmtTgl(res.days[0].iso)}</span><span>${fmtTgl(res.days[res.days.length - 1].iso)}</span></div></div>`);
    }

    // ---- daftar fase ----
    if (res.phases.length) {
      const items = res.phases.map((ph, i) => {
        const cls = ph.type === 'AKUMULASI' ? 'A' : 'D';
        const tops = ph.topBrokers.map((b) =>
          `<b>${esc(b.code)}</b> (${esc(brokerName(b.code))}) ${b.net >= 0 ? '+' : ''}${fmtRp(b.net)}`).join(' · ');
        const actorCls = ph.actor === 'SMART MONEY' ? 'pos' : 'neg';
        return `<div class="phase">
          <span class="tag ${cls}">${ph.type}</span>
          <span class="vd ${ph.actor === 'SMART MONEY' ? 'sa' : 'rt'}" style="margin-left:4px">oleh ${esc(ph.actor || '-')}</span>
          <b> ${fmtTgl(ph.fromIso)} → ${fmtTgl(ph.toIso)}</b> <span style="color:#78808f">(${ph.nDays} hari)</span>
          <button class="btn" style="float:right;padding:2px 8px" data-ph="${i}">Gambar</button>
          <div class="meta">Broker: ${tops}<br>
          Flow top-3: ${fmtRp(ph.flow)} · Smart money ${(ph.smartShare * 100).toFixed(0)}% / Ritel ${(100 - ph.smartShare * 100).toFixed(0)}% · avg <b>${fmtRp(ph.avgTrx)}/trx</b>
          · Rentang harga ${Math.round(ph.pLow)}–${Math.round(ph.pHigh)}${ph.avgPrice ? ` · Avg harga bandar ≈ <b>${Math.round(ph.avgPrice)}</b>` : ''}</div>
        </div>`;
      }).join('');
      out.push(`<div class="sec"><h4>FASE TERDETEKSI</h4>${items}</div>`);
    }

    // ---- tabel broker smart money ----
    const top = res.brokers.filter((b) => b.activeDays >= 2).slice(0, 14);
    if (top.length) {
      const vdCls = { 'SMART ACCUM': 'sa', 'SMART DIST': 'sd', 'NET BUY': 'nb', 'NET SELL': 'ns', 'AKUM RITEL': 'rt', 'DIST RITEL': 'rt' };
      const rows = top.map((b) => `
        <tr>
          <td><b>${esc(b.code)}</b><span style="color:#697184"> ${esc(b.type)}</span></td>
          <td class="r ${b.net >= 0 ? 'pos' : 'neg'}">${b.net >= 0 ? '+' : ''}${fmtRp(b.net)}</td>
          <td class="r">${b.net >= 0 ? (b.cleanBuy * 100).toFixed(0) : (b.cleanSell * 100).toFixed(0)}%</td>
          <td class="r">${((b.net >= 0 ? b.buyConsist : b.sellConsist) * 100).toFixed(0)}%</td>
          <td class="r">${fmtRp(b.avgTrx)}${b.bigTicket ? ' 💰' : ''}</td>
          <td>${b.verdict ? `<span class="vd ${vdCls[b.verdict] || 'nb'}">${b.verdict}</span>` : ''}</td>
        </tr>`).join('');
      out.push(`<div class="sec"><h4>BROKER — SMART MONEY DETECTOR (periode penuh)</h4>
        <table>
          <tr><th>Broker</th><th class="r">Net</th><th class="r">Clean%</th><th class="r">Konsist</th><th class="r">Avg/Trx</th><th>Verdict</th></tr>
          ${rows}
        </table>
        ${res.reconciled ? '<div class="status">Net & Clean% dari query rentang penuh — identik dengan panel Broker Summary Stockbit (papan Regular, gross).</div>' : ''}</div>`);
    }

    ui.out.innerHTML = out.join('');
    ui.out.querySelectorAll('[data-ph]').forEach((btn) => {
      btn.onclick = async () => {
        const ph = lastResult.phases[+btn.dataset.ph];
        if (await drawPhases([ph])) ui.prog.textContent = `✔ Fase ${ph.type} ${fmtTgl(ph.fromIso)} digambar.`;
        else ui.prog.textContent = '✖ Chart tidak ditemukan — pastikan berada di halaman Chartbit.';
      };
    });
  }

  // ============================================================
  // PUSH DATA HANDLER — Tarik data spesifik & Push ke Database Server
  // ============================================================
  async function runPushData() {
    const dataType = ui.pushDataType.value;
    const symbol = (ui.pushSymbol.value || '').toUpperCase().trim();
    let date = ui.pushDate.value;
    if (!date) {
      const d = new Date(); d.setDate(d.getDate() - 1);
      date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      ui.pushDate.value = date;
    }

    ui.pushRun.disabled = true;
    ui.pushProg.textContent = `⏳ Memproses push data (${dataType}) untuk ${symbol || 'semua'} pada tanggal ${date}…`;
    ui.pushOut.innerHTML = '';

    try {
      if (dataType === 'runningTrade') {
        if (!symbol) throw new Error('Kode emiten wajib diisi untuk Running Trade (misal: PSAB).');
        ui.pushProg.textContent = `⏳ Mengambil data Running Trade ${symbol} tanggal ${date} dari Stockbit…`;
        const trades = await fetchRunningTrade(symbol, { date, maxBatches: RUNNING_TRADE_BATCHES });
        if (!trades || !trades.length) {
          ui.pushProg.textContent = `ℹ️ Tidak ada transaksi untuk ${symbol} pada tanggal ${date} (pasar libur / saham sepi).`;
          return;
        }
        ui.pushProg.textContent = `⏳ Mengirim ${trades.length} transaksi ${symbol} ke server database (dengan anti-duplikasi)…`;
        relayRunningTrade(symbol, trades, date);
        ui.pushOut.innerHTML = `<div class="concl" style="background:#0f2a1e;border-color:#00d69a">
          ✔ <b>BERHASIL PUSH RUNNING TRADE!</b><br>
          ${trades.length} transaksi <b>${symbol}</b> (tanggal ${date}) berhasil dikirim ke server database.
          <br><span class="hint">Database server otomatis mendeteksi & mencegah duplikasi data transaksi (upsert unique key).</span>
        </div>`;
        ui.pushProg.textContent = `✔ Selesai. ${trades.length} transaksi ${symbol} ter-deduplikasi di database server.`;
      } else if (dataType === 'brokerSummary') {
        if (!symbol) throw new Error('Kode emiten wajib diisi untuk Broker Summary (misal: PSAB).');
        ui.pushProg.textContent = `⏳ Mengambil Broker Summary ${symbol} tanggal ${date}…`;
        const rows = await fetchBrokerDay(symbol, date);
        if (!rows || !rows.length) {
          ui.pushProg.textContent = `ℹ️ Tidak ada data broker untuk ${symbol} pada tanggal ${date}.`;
          return;
        }
        relayBrokerDay(symbol, date, rows);
        ui.pushOut.innerHTML = `<div class="concl" style="background:#0f2a1e;border-color:#00d69a">
          ✔ <b>BERHASIL PUSH BROKER SUMMARY!</b><br>
          ${rows.length} ringkasan broker <b>${symbol}</b> (tanggal ${date}) berhasil di-push ke server database.
        </div>`;
        ui.pushProg.textContent = `✔ Selesai.`;
      } else if (dataType === 'dailyBars') {
        if (!symbol) throw new Error('Kode emiten wajib diisi untuk Candle Harian (misal: PSAB).');
        const d = new Date(date); d.setMonth(d.getMonth() - 6);
        const from = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        ui.pushProg.textContent = `⏳ Mengambil Candle Harian ${symbol} (${from} s/d ${date})…`;
        const bars = await fetchDailyBars(symbol, from, date);
        ui.pushOut.innerHTML = `<div class="concl" style="background:#0f2a1e;border-color:#00d69a">
          ✔ <b>BERHASIL PUSH CANDLE HARIAN!</b><br>
          ${bars.length} candle harian <b>${symbol}</b> berhasil di-push ke database.
        </div>`;
        ui.pushProg.textContent = `✔ Selesai.`;
      } else if (dataType === 'keystats') {
        if (!symbol) throw new Error('Kode emiten wajib diisi untuk KeyStats & Dividen (misal: PSAB).');
        ui.pushProg.textContent = `⏳ Mengambil KeyStats & Dividen ${symbol}…`;
        await fetchSymbolKeyStatsAndDividends(symbol);
        ui.pushOut.innerHTML = `<div class="concl" style="background:#0f2a1e;border-color:#00d69a">
          ✔ <b>BERHASIL PUSH KEYSTATS & DIVIDEN!</b><br>
          Rasio fundamental & riwayat dividen <b>${symbol}</b> berhasil di-push ke database.
        </div>`;
        ui.pushProg.textContent = `✔ Selesai.`;
      } else if (dataType === 'marketMovers') {
        ui.pushProg.textContent = `⏳ Mengambil Market Movers dari Stockbit…`;
        await fetchMarketMoversFromStockbit();
        ui.pushOut.innerHTML = `<div class="concl" style="background:#0f2a1e;border-color:#00d69a">
          ✔ <b>BERHASIL PUSH MARKET MOVERS!</b><br>
          Top Value, Volume, Gainer, Foreign Buy/Sell pasar BEI berhasil di-push ke database.
        </div>`;
        ui.pushProg.textContent = `✔ Selesai.`;
      } else if (dataType === 'insider') {
        ui.pushProg.textContent = `⏳ Mengambil transaksi Insider / Major Holder…`;
        await fetchInsiderTransactionsFromStockbit();
        ui.pushOut.innerHTML = `<div class="concl" style="background:#0f2a1e;border-color:#00d69a">
          ✔ <b>BERHASIL PUSH INSIDER TRANSACTIONS!</b><br>
          Transaksi direksi & pemegang saham utama berhasil di-push ke database.
        </div>`;
        ui.pushProg.textContent = `✔ Selesai.`;
      } else if (dataType === 'calendar') {
        ui.pushProg.textContent = `⏳ Mengambil Kalender Aksi Korporasi tanggal ${date}…`;
        await fetchCalendarEventsFromStockbit();
        ui.pushOut.innerHTML = `<div class="concl" style="background:#0f2a1e;border-color:#00d69a">
          ✔ <b>BERHASIL PUSH KALENDER KORPORASI!</b><br>
          Aksi korporasi (Dividen, RUPS, Rights Issue) berhasil di-push ke database.
        </div>`;
        ui.pushProg.textContent = `✔ Selesai.`;
      } else if (dataType === 'financialStatements') {
        if (!symbol) throw new Error('Kode emiten wajib diisi untuk Laporan Keuangan (misal: PSAB).');
        ui.pushProg.textContent = `⏳ Mengambil Laporan Keuangan ${symbol} (Laba Rugi/Neraca/Arus Kas × Kuartalan/Tahunan)…`;
        const n = await fetchFinancialStatements(symbol);
        if (!n) {
          ui.pushProg.textContent = `ℹ️ Tidak ada data laporan keuangan untuk ${symbol}.`;
          return;
        }
        ui.pushOut.innerHTML = `<div class="concl" style="background:#0f2a1e;border-color:#00d69a">
          ✔ <b>BERHASIL PUSH LAPORAN KEUANGAN!</b><br>
          ${n} baris item laporan keuangan (Laba Rugi/Neraca/Arus Kas, kuartalan & tahunan) <b>${symbol}</b> berhasil di-push ke database.
        </div>`;
        ui.pushProg.textContent = `✔ Selesai.`;
      }
    } catch (e) {
      ui.pushProg.textContent = `✖ Gagal push data: ${e.message}`;
    } finally {
      ui.pushRun.disabled = false;
    }
  }

  // ============================================================
  // BACKFILL MASSAL — candle harian utk SEMUA saham BEI, persisten via
  // localStorage (proses bisa berjam-jam; harus tahan tab ditutup/reload).
  // ============================================================
  const BF_PROGRESS_KEY = '__bm_backfill_progress_v1';
  const bf = { running: false, stop: false };

  function bfLoadProgress() {
    try { return JSON.parse(localStorage.getItem(BF_PROGRESS_KEY) || 'null'); } catch (e) { return null; }
  }
  function bfSaveProgress(state) {
    try { localStorage.setItem(BF_PROGRESS_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function bfBuildSymbolList(universe) {
    let list;
    if (universe === 'watchlist') {
      const manual = (ui.scrSyms.value || '').toUpperCase().match(/[A-Z]{2,5}/g) || [];
      list = [...new Set(manual)].map((s) => ({ code: s, listed: null }));
    } else {
      const uni = (typeof window !== 'undefined' && window.__IDX_UNIVERSE__) || [];
      list = uni.map((s) => ({ code: s.code, listed: s.listed }));
    }
    // IHSG selalu ikut dan selalu DULUAN: panel Stock Profiler membandingkan
    // tiap saham dengan indeks, jadi kalau baris indeksnya belum ada seluruh
    // blok kekuatan relatif mati — dan itu tidak boleh bergantung pada
    // apakah backfill sempat selesai sampai akhir antrean.
    if (!list.some((s) => s.code === IHSG_SYMBOL)) {
      list.unshift({ code: IHSG_SYMBOL, listed: null });
    }
    return list;
  }

  function bfRenderProgress(state) {
    if (!ui.bfProg) return;
    if (!state || !state.symbols || !state.symbols.length) {
      ui.bfProg.textContent = 'Belum pernah dijalankan.';
      if (ui.bfBarFill) ui.bfBarFill.style.width = '0%';
      return;
    }
    const total = state.symbols.length;
    const doneMap = state.doneMap || {};
    const attempted = Object.keys(doneMap).length;
    // "selesai" cuma yang SEMUA window-nya sukses — sebagian gagal tetap
    // dianggap belum tuntas supaya di-retry otomatis saat "Mulai Backfill"
    // diklik lagi (prioritas: data lengkap, bukan cepat).
    const complete = Object.values(doneMap).filter((d) => d.complete).length;
    const partial = attempted - complete;
    const pct = total ? Math.round((complete / total) * 100) : 0;
    if (ui.bfBarFill) ui.bfBarFill.style.width = `${pct}%`;
    ui.bfProg.textContent = bf.running
      ? `⏳ Backfill jalan… ${complete}/${total} saham tuntas (${pct}%)${state.current ? ` — sedang: ${state.current}` : ''}${partial ? ` · ${partial} sebagian gagal (akan di-retry)` : ''}`
      : complete >= total
        ? `✔ Selesai. ${complete}/${total} saham ter-backfill lengkap.`
        : `⏸ Berhenti di ${complete}/${total} saham tuntas (${pct}%)${partial ? `, ${partial} sebagian gagal` : ''}. Klik "Mulai Backfill" lagi untuk melanjutkan/retry.`;
  }

  async function runBackfillAll() {
    if (bf.running) return;
    const universe = ui.bfUniverse.value;
    const fromOverride = ui.bfFrom.value || null;
    const symbols = bfBuildSymbolList(universe);
    if (!symbols.length) { ui.bfProg.textContent = '✖ Universe kosong (untuk watchlist, isi dulu kolom simbol di tab Screener).'; return; }

    let state = bfLoadProgress();
    // progres lama cuma dipakai lagi kalau universe & rentang sama persis —
    // supaya "lanjutkan" tidak pernah mencampur backfill dengan setelan beda.
    const sameRun = state && state.universe === universe && state.from === fromOverride &&
      state.symbols.length === symbols.length && state.symbols.every((s, i) => s === symbols[i].code);
    if (!sameRun) {
      state = { universe, from: fromOverride, symbols: symbols.map((s) => s.code), doneMap: {}, startedAt: Date.now() };
    }
    bfSaveProgress(state);

    bf.running = true; bf.stop = false;
    ui.bfStart.disabled = true; ui.bfStop.disabled = false;
    bfRenderProgress(state);

    const bySym = {}; symbols.forEach((s) => { bySym[s.code] = s; });
    // resume: skip cuma simbol yg SEMUA window-nya pernah sukses penuh —
    // yang sebagian gagal ikut di-queue lagi supaya lengkap.
    const queue = symbols.filter((s) => !(state.doneMap[s.code] && state.doneMap[s.code].complete)).map((s) => s.code);
    const today = todayISO();
    let authFailed = false;

    const worker = async () => {
      while (queue.length && !bf.stop && !authFailed) {
        const sym = queue.shift();
        state.current = sym;
        bfRenderProgress(state);
        const from = fromOverride || (bySym[sym] && bySym[sym].listed) || '2015-01-01';
        try {
          const res = await backfillSymbolBars(sym, from, today, { gapMs: 180, retries: 2 });
          state.doneMap[sym] = { totalBars: res.totalBars, okWindows: res.okWindows, failedWindows: res.failedWindows, complete: res.failedWindows === 0, at: Date.now() };
        } catch (e) {
          if (e.message === 'AUTH') {
            authFailed = true;
            ui.bfProg.textContent = '✖ Token Stockbit expired/tidak valid — refresh halaman Stockbit & login ulang, lalu klik "Mulai Backfill" lagi untuk melanjutkan.';
            break;
          }
          state.doneMap[sym] = { totalBars: 0, okWindows: 0, failedWindows: 1, complete: false, error: e.message, at: Date.now() };
        }
        bfSaveProgress(state);
        bfRenderProgress(state);
      }
    };

    try {
      await Promise.all([worker(), worker()]);
    } finally {
      bf.running = false; state.current = null;
      ui.bfStart.disabled = false; ui.bfStop.disabled = true;
      bfSaveProgress(state);
      if (!authFailed) bfRenderProgress(state);
    }
  }

  function stopBackfillAll() {
    if (!bf.running) return;
    bf.stop = true;
    ui.bfProg.textContent = '⏳ Menghentikan setelah saham yang sedang berjalan selesai…';
  }

  function resetBackfillProgress() {
    if (bf.running) { ui.bfProg.textContent = '✖ Stop dulu sebelum reset progres.'; return; }
    localStorage.removeItem(BF_PROGRESS_KEY);
    bfRenderProgress(null);
  }

  // ============================================================
  // BACKFILL RUNNING TRADE — tape transaksi LENGKAP lintas hari, untuk
  // simbol pilihan sendiri (BUKAN otomatis seluruh 956 saham BEI — data
  // tape jauh lebih besar/berat per hari daripada candle harian, jadi
  // scoping ke watchlist sendiri mengikuti prinsip yang sama dengan Scan
  // Akumulasi/Screener: expensive path dibatasi, bukan dibebankan ke
  // seluruh market). fetchRunningTrade per hari sudah internally berat
  // (bisa puluhan request ber-cursor), jadi cuma 1 worker di sini —
  // bukan 2-3 seperti backfill bars.
  // ============================================================
  const RT_PROGRESS_KEY = '__bm_rt_backfill_progress_v1';
  const rtbf = { running: false, stop: false };

  function rtLoadProgress() {
    try { return JSON.parse(localStorage.getItem(RT_PROGRESS_KEY) || 'null'); } catch (e) { return null; }
  }
  function rtSaveProgress(state) {
    try { localStorage.setItem(RT_PROGRESS_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function rtTradingDays(fromIso, toIso) {
    const days = [];
    const from = new Date(`${fromIso}T00:00:00Z`);
    const to = new Date(`${toIso}T00:00:00Z`);
    if (isNaN(from) || isNaN(to) || to < from) return days;
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10)); // skip Sabtu/Minggu; libur bursa lain akan otomatis kosong & tetap ditandai selesai
    }
    return days;
  }

  function rtRenderProgress(state) {
    if (!ui.rtProg) return;
    if (!state || !state.tasks || !state.tasks.length) {
      ui.rtProg.textContent = 'Belum pernah dijalankan.';
      if (ui.rtBarFill) ui.rtBarFill.style.width = '0%';
      return;
    }
    const total = state.tasks.length;
    const doneMap = state.doneMap || {};
    const complete = Object.values(doneMap).filter((d) => d.complete).length;
    const partial = Object.keys(doneMap).length - complete;
    const pct = total ? Math.round((complete / total) * 100) : 0;
    if (ui.rtBarFill) ui.rtBarFill.style.width = `${pct}%`;
    ui.rtProg.textContent = rtbf.running
      ? `⏳ Backfill tape jalan… ${complete}/${total} hari-saham tuntas (${pct}%)${state.current ? ` — sedang: ${state.current}` : ''}${partial ? ` · ${partial} sebagian gagal (akan di-retry)` : ''}`
      : complete >= total
        ? `✔ Selesai. ${complete}/${total} kombinasi saham-tanggal ter-backfill lengkap.`
        : `⏸ Berhenti di ${complete}/${total} tuntas (${pct}%)${partial ? `, ${partial} sebagian gagal` : ''}. Klik "Mulai Backfill Tape" lagi untuk lanjut/retry.`;
  }

  async function runRunningTradeBackfill() {
    if (rtbf.running) return;
    const symbols = [...new Set((ui.rtSyms.value || '').toUpperCase().match(/[A-Z]{2,5}/g) || [])];
    const fromIso = ui.rtFrom.value, toIso = ui.rtTo.value;
    if (!symbols.length) { ui.rtProg.textContent = '✖ Isi dulu kode saham (pisah spasi), mis. PSAB BBCA GOTO.'; return; }
    if (!fromIso || !toIso) { ui.rtProg.textContent = '✖ Isi dulu rentang tanggal.'; return; }
    const days = rtTradingDays(fromIso, toIso);
    if (!days.length) { ui.rtProg.textContent = '✖ Rentang tanggal tidak valid / tidak ada hari kerja di dalamnya.'; return; }

    const tasks = [];
    for (const sym of symbols) for (const day of days) tasks.push(`${sym}|${day}`);

    let state = rtLoadProgress();
    const sameRun = state && state.tasks && state.tasks.length === tasks.length && state.tasks.every((t, i) => t === tasks[i]);
    if (!sameRun) {
      state = { symbols, from: fromIso, to: toIso, tasks, doneMap: {}, startedAt: Date.now() };
    }
    rtSaveProgress(state);

    rtbf.running = true; rtbf.stop = false;
    ui.rtStart.disabled = true; ui.rtStop.disabled = false;
    rtRenderProgress(state);

    // Re-queue jika belum complete atau jika dulu terpotong bug 100 baris
    const queue = tasks.filter((t) => {
      const d = state.doneMap[t];
      if (!d || !d.complete) return true;
      if (d.count > 0 && d.count <= 100) return true;
      return false;
    });
    let authFailed = false;

    const worker = async () => {
      while (queue.length && !rtbf.stop && !authFailed) {
        const task = queue.shift();
        const sep = task.indexOf('|');
        const sym = task.slice(0, sep), day = task.slice(sep + 1);
        state.current = task;
        rtRenderProgress(state);
        try {
          const trades = await fetchRunningTrade(sym, { date: day, maxBatches: RUNNING_TRADE_BATCHES });
          relayRunningTrade(sym, trades, day);
          state.doneMap[task] = { count: trades.length, complete: !!trades.wholeDay, at: Date.now() };
        } catch (e) {
          if (e.message === 'AUTH') {
            authFailed = true;
            ui.rtProg.textContent = '✖ Token Stockbit expired/tidak valid — refresh halaman Stockbit & login ulang, lalu klik "Mulai Backfill Tape" lagi untuk melanjutkan.';
            break;
          }
          state.doneMap[task] = { count: 0, complete: false, error: e.message, at: Date.now() };
        }
        rtSaveProgress(state);
        rtRenderProgress(state);
        await sleep(300);
      }
    };

    try {
      await worker(); // 1 worker saja — tiap hari-saham sudah berat sendiri
    } finally {
      rtbf.running = false; state.current = null;
      ui.rtStart.disabled = false; ui.rtStop.disabled = true;
      rtSaveProgress(state);
      if (!authFailed) rtRenderProgress(state);
    }
  }

  function stopRunningTradeBackfill() {
    if (!rtbf.running) return;
    rtbf.stop = true;
    ui.rtProg.textContent = '⏳ Menghentikan setelah kombinasi saham-tanggal yang sedang berjalan selesai…';
  }

  function resetRunningTradeBackfill() {
    if (rtbf.running) { ui.rtProg.textContent = '✖ Stop dulu sebelum reset progres.'; return; }
    localStorage.removeItem(RT_PROGRESS_KEY);
    rtRenderProgress(null);
  }

  // ============================================================
  // Screener — orchestrator, universe, render
  // ============================================================
  const nameMap = {};
  // daftar saham paling likuid IDX (LQ45/IDX80 + saham trading aktif) — fallback
  // yang SELALU tersedia, termasuk saat pasar tutup (endpoint top-stock kosong after-close)
  const LIQUID_UNIVERSE = (
    'BBCA BBRI BMRI BBNI BRIS ARTO BBTN BTPS BANK BJBR BJTM ' +
    'TLKM ASII UNTR ADRO ITMG PTBA HRUM INDY MEDC PGAS AKRA ELSA ENRG RAJA ' +
    'ANTM INCO TINS MDKA NCKL MBMA AMMN BRMS PSAB HRTA ARCI ' +
    'BRPT TPIA ESSA BREN PGEO CUAN BUMI DEWA DOID ' +
    'INDF ICBP UNVR HMSP GGRM MYOR KLBF SIDO CPIN JPFA MAIN AALI LSIP SGRO TBLA ' +
    'AMRT MAPI MAPA ACES RALS ERAA CTRA MIDI ' +
    'GOTO BUKA EMTK BELI DCII MTDL WIFI DMMX ' +
    'BSDE PWON SMRA APLN DMAS PANI ASRI CBDK ' +
    'SMGR INTP WTON WIKA PTPP ADHI WSKT JSMR ' +
    'INKP TKIM SRTG PNLF PNBN BFIN HEAL MIKA SILO PRDA ' +
    'RATU SSIA NISP MEGA BNGA TOWR MTEL ISAT EXCL ' +
    'LAPD BIPP NETV FUTR BULL RMKE PPRE HATM WIRG GOLD KOTA NASA'
  ).split(/\s+/);

  // universe: saham teraktif by value (saat pasar buka) + daftar likuid bawaan
  // (fallback 24/7) + trending. maxN membatasi kedalaman scan.
  async function fetchUniverse(maxN) {
    const syms = [];
    const seen = new Set();
    const add = (s, name) => { s = (s || '').toUpperCase(); if (/^[A-Z]{2,5}$/.test(s) && !seen.has(s)) { seen.add(s); syms.push(s); if (name) nameMap[s] = name; } };
    // 1) saham teraktif (top by value) — terurut likuiditas; KOSONG saat pasar tutup
    try {
      const j = await apiGet(`https://exodus.stockbit.com/order-trade/top-stock?limit=${Math.min(maxN + 20, 150)}`);
      for (const x of ((j && j.data && j.data.top_buy) || [])) add(x.code);
    } catch (e) {}
    // 2) trending
    try {
      const j = await apiGet('https://exodus.stockbit.com/emitten/trending');
      for (const x of ((j && j.data) || [])) add(x.symbol, x.name);
    } catch (e) {}
    // 3) fallback daftar likuid bawaan (selalu ada) — lengkapi sampai maxN
    for (const s of LIQUID_UNIVERSE) { if (syms.length >= maxN) break; add(s); }
    return syms;
  }

  const screener = { running: false, results: [], profile: 'all' };

  async function runScreener() {
    if (screener.running) return;
    const maxN = +ui.scrN.value || 50;
    let syms;
    const manual = (ui.scrSyms.value || '').toUpperCase().match(/[A-Z]{2,5}/g);
    if (ui.scrSrc.value === 'watchlist' && manual && manual.length) syms = [...new Set(manual)];
    else {
      ui.scrProg.textContent = 'Mengambil daftar saham teraktif pasar…';
      syms = await fetchUniverse(maxN);
      if (manual && manual.length) syms = [...new Set([...manual, ...syms])];
    }
    if (!syms || !syms.length) { ui.scrProg.textContent = '✖ Tidak ada saham untuk di-scan. Isi kolom simbol atau pastikan koneksi ok.'; return; }
    syms = syms.slice(0, maxN);

    screener.running = true;
    ui.scrRun.disabled = true;
    screener.results = [];
    const days = Math.max(15, Math.min(200, Math.round(+ui.scrDays.value || 63)));
    ui.scrDays.value = days;
    let done = 0, fail = 0;
    const queue = [...syms];
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        try { screener.results.push(await scanSymbol(s, days, nameMap[s])); }
        catch (e) { fail++; }
        done++;
        ui.scrProg.textContent = `Tahap 1/2 · men-scan ${done}/${syms.length} saham… (${s})`;
        await sleep(110);
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
      renderScreener();
      relayScreenerResults(screener.results);

      // TAHAP 2: rekap analisa transaksi OTOMATIS untuk kandidat teratas (1 klik = outlook lengkap)
      // + relay running trade asli ke Arsant Screener (buyer/seller broker per print)
      const prof = ui.scrProfile.value;
      const scoreOf = (r) => prof === 'all' ? Math.round((r.sc.accum + r.sc.tech + r.sc.pva + r.sc.liq) / 4) : r.sc.fit[prof];
      const topN = screener.results.slice().sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 12);
      const todayForTx = todayISO();
      let tdone = 0;
      for (const r of topN) {
        ui.scrProg.textContent = `Tahap 2/2 · rekap transaksi ${++tdone}/${topN.length}… (${r.sym})`;
        try {
          const trades = await fetchRunningTrade(r.sym, { maxBatches: RUNNING_TRADE_BATCHES });
          relayRunningTrade(r.sym, trades, todayForTx);
          const tx = analyzeTransactions(trades);
          if (tx) { r.txSummary = tx; r.txWholeDay = trades.wholeDay; }
        } catch (e) {}
      }
      renderScreener();
      relayScreenerResults(screener.results);
      ui.scrProg.textContent = `✔ Selesai. ${screener.results.length} saham + transaksi ${topN.filter((r) => r.txSummary).length} kandidat teratas${fail ? ` · ${fail} gagal` : ''}.`;
      // deep-dive latar belakang: broker summary HARIAN untuk kandidat yang
      // sama (running trade-nya sudah direlay di atas, tidak diulang).
      if (topN.length) deepDiveBrokerDailyBatch(topN, days, (msg) => { ui.scrProg.textContent = msg; });
    } catch (e) {
      ui.scrProg.textContent = `✖ Gagal: ${e.message}`;
    } finally {
      screener.running = false;
      ui.scrRun.disabled = false;
    }
  }

  function renderScreener() {
    const prof = ui.scrProfile.value; // all | scalp | daytrade | swing
    const catFilter = ui.scrCat.value; // all | bluechip | second | third
    let list = screener.results.slice();
    if (catFilter !== 'all') list = list.filter((r) => r.category === catFilter);
    const fitKey = prof === 'all' ? null : prof;
    // urutkan: kalau profil dipilih, by fit; else by skor gabungan
    const scoreOf = (r) => fitKey ? r.sc.fit[fitKey] : Math.round((r.sc.accum + r.sc.tech + r.sc.pva + r.sc.liq) / 4);
    list.sort((a, b) => scoreOf(b) - scoreOf(a));

    const cats = ['bluechip', 'second', 'third'];
    const bar = (v, col) => `<span style="display:inline-block;width:26px;height:5px;border-radius:3px;background:#232833;position:relative;vertical-align:middle"><span style="position:absolute;left:0;top:0;height:100%;border-radius:3px;width:${v}%;background:${col}"></span></span>`;
    let html = '';
    for (const cat of cats) {
      const rows = list.filter((r) => r.category === cat);
      if (!rows.length) continue;
      html += `<div class="gt" style="margin:10px 0 6px">${CAT_LABEL[cat]} <span class="hint">(${rows.length})</span></div><div class="cardgrid">`;
      for (const r of rows.slice(0, 30)) {
        const s = scoreOf(r);
        const col = s >= 65 ? '#00d69a' : s >= 45 ? '#f2c14e' : '#8b93a3';
        html += `<div class="phase" style="padding:7px 9px;margin-bottom:0" data-scr="${r.sym}">
          <div style="display:flex;align-items:center;gap:6px">
            <b style="font-size:13px">${r.sym}</b>
            <span class="hint">${(r.mcap / 1e12).toFixed(1)}T · ${r.last}</span>
            <span class="${r.chg >= 0 ? 'pos' : 'neg'}" style="font-size:11px">${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(1)}%</span>
            <span style="margin-left:auto;font-weight:800;color:${col}">${s}</span>
          </div>
          <div style="display:flex;gap:8px;font-size:10px;color:#8b93a3;margin-top:4px">
            <span title="Akumulasi">A ${bar(r.sc.accum, '#00b47e')}</span>
            <span title="Teknikal">T ${bar(r.sc.tech, '#4a90e2')}</span>
            <span title="PVA">V ${bar(r.sc.pva, '#9b6dd6')}</span>
            <span title="Likuiditas">L ${bar(r.sc.liq, '#f2a03e')}</span>
          </div>
          ${r.badges.length ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${r.badges.map((b) => `<span class="vd nb" style="font-size:9px">${b}</span>`).join('')}</div>` : ''}
          ${r.txSummary ? `<div style="margin-top:4px;font-size:10px;color:#8b93a3">🔬 Transaksi: ${r.txSummary.buyRatio >= 0.56 ? '<span class="pos">HAKA ' + (r.txSummary.buyRatio * 100).toFixed(0) + '%</span>' : r.txSummary.buyRatio <= 0.44 ? '<span class="neg">HAKI ' + ((1 - r.txSummary.buyRatio) * 100).toFixed(0) + '%</span>' : 'seimbang'}${r.txSummary.biggestSplit ? ` · 🧊 split ${r.txSummary.biggestSplit.brk}` : ''}</div>` : ''}
        </div>`;
      }
      html += `</div>`;
    }
    ui.scrOut.innerHTML = html || '<div class="status">Tidak ada saham cocok filter ini.</div>';
    // klik saham -> tampilkan outlook research
    ui.scrOut.querySelectorAll('[data-scr]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.onclick = () => {
        const r = screener.results.find((x) => x.sym === el.dataset.scr);
        if (r) renderResearch(r);
      };
    });
  }

  // ============================================================
  // TOP PICK — saringan ketat di atas mesin scanSymbol() yang sama:
  // bukan skor "cocok utk gaya tertentu" (fit.scalp/daytrade/swing), tapi
  // skor & syarat yang secara eksplisit condong ke "berpotensi naik" —
  // akumulasi senyap + demand + foreign inflow, BELUM overbought. Sengaja
  // dibuat ketat (semua syarat wajib) supaya hasil sedikit tapi meyakinkan,
  // bukan daftar panjang seperti tab Screener biasa.
  // ============================================================
  const TOP_PICK_DAYS = 63;
  const topPick = { running: false, results: [] };

  function topPickScoreOf(r) {
    const sc = r.sc;
    return Math.round(0.35 * sc.accum + 0.30 * sc.tech + 0.20 * sc.pva + 0.15 * sc.foreign);
  }

  function topPickReasons(r) {
    const m = r.m, sc = r.sc;
    const reasons = [];
    if (m.silent) reasons.push('🐋 Akumulasi senyap');
    else if (sc.accum >= 60 && m.smartNet > 0) reasons.push('🐋 Akumulasi smart money');
    if (m.dryUp) reasons.push('🔥 Barang kering');
    if (m.nearBreakout) reasons.push('🚀 Dekat breakout');
    if (m.foreignNet > 0 && m.totVal > 0 && m.foreignNet / m.totVal > 0.03) reasons.push('🌊 Foreign inflow');
    if (m.pvaSkor >= 4) reasons.push('📊 Demand kuat');
    if (m.retailNet < 0 && m.smartNet > 0) reasons.push('👋 Ritel keluar');
    return reasons;
  }

  // syarat LOLOS — semua wajib terpenuhi sekaligus.
  function topPickPass(r) {
    const m = r.m, sc = r.sc;
    if (topPickScoreOf(r) < 68) return false;
    if (m.trend === 'DOWNTREND') return false;
    if (m.rsi >= 78) return false;      // sudah overbought, risiko exhaustion
    if (sc.liq < 40) return false;      // likuiditas minimum, hindari saham seret
    return topPickReasons(r).length >= 2; // minimal 2 sinyal konfluensi
  }

  async function runTopPick() {
    if (topPick.running) return;
    const maxN = +ui.tpN.value || 150;
    let syms;
    const manual = (ui.tpSyms.value || '').toUpperCase().match(/[A-Z]{2,5}/g);
    if (ui.tpSrc.value === 'watchlist' && manual && manual.length) syms = [...new Set(manual)];
    else {
      ui.tpProg.textContent = 'Mengambil daftar saham teraktif pasar…';
      syms = await fetchUniverse(maxN);
      if (manual && manual.length) syms = [...new Set([...manual, ...syms])];
    }
    if (!syms || !syms.length) { ui.tpProg.textContent = '✖ Tidak ada saham untuk di-scan. Isi kolom simbol atau pastikan koneksi ok.'; return; }
    syms = syms.slice(0, maxN);

    topPick.running = true;
    ui.tpRun.disabled = true;
    topPick.results = [];
    const maxResults = Math.max(3, Math.min(15, Math.round(+ui.tpMax.value || 8)));
    let done = 0, fail = 0;
    const all = [];
    const queue = [...syms];
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        try {
          const r = await scanSymbol(s, TOP_PICK_DAYS, nameMap[s]);
          all.push(r);
          if (topPickPass(r)) topPick.results.push(r);
        } catch (e) { fail++; }
        done++;
        ui.tpProg.textContent = `Men-scan ${done}/${syms.length} saham… (${s}) — lolos ${topPick.results.length}`;
        await sleep(110);
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
      topPick.results.sort((a, b) => topPickScoreOf(b) - topPickScoreOf(a));
      topPick.results = topPick.results.slice(0, maxResults);
      renderTopPick();
      relayScreenerResults(all); // seluruh hasil scan tetap disimpan ke backend, bukan cuma yang lolos
      ui.tpProg.textContent = `✔ Selesai. ${topPick.results.length} saham lolos syarat ketat dari ${syms.length} di-scan${fail ? ` · ${fail} gagal` : ''}.`;
    } catch (e) {
      ui.tpProg.textContent = `✖ Gagal: ${e.message}`;
    } finally {
      topPick.running = false;
      ui.tpRun.disabled = false;
    }
  }

  function renderTopPick() {
    if (!topPick.results.length) {
      ui.tpOut.innerHTML = '<div class="status">Belum ada saham yang lolos syarat ketat. Coba perbesar jumlah scan, atau jalankan lagi saat pasar lebih aktif.</div>';
      return;
    }
    const bar = (v, col) => `<span style="display:inline-block;width:26px;height:5px;border-radius:3px;background:#232833;position:relative;vertical-align:middle"><span style="position:absolute;left:0;top:0;height:100%;border-radius:3px;width:${v}%;background:${col}"></span></span>`;
    const html = topPick.results.map((r, i) => {
      const score = topPickScoreOf(r);
      const reasons = topPickReasons(r);
      const col = score >= 82 ? '#00d69a' : '#57b893';
      return `<div class="phase" style="padding:9px 10px;margin-bottom:6px" data-tp="${r.sym}">
        <div style="display:flex;align-items:center;gap:6px">
          <b style="font-size:14px">#${i + 1} ${r.sym}</b>
          <span class="hint">${(r.mcap / 1e12).toFixed(1)}T · ${r.last}</span>
          <span class="${r.chg >= 0 ? 'pos' : 'neg'}" style="font-size:11px">${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(1)}%</span>
          <span style="margin-left:auto;text-align:right" title="Skor potensi naik (akumulasi+teknikal+PVA+foreign)">
            <b style="font-size:16px;color:${col}">${score}</b><span class="hint" style="font-size:9px">/100</span></span>
        </div>
        <div style="display:flex;gap:8px;font-size:10px;color:#8b93a3;margin-top:5px">
          <span title="Akumulasi">A ${bar(r.sc.accum, '#00b47e')}</span>
          <span title="Teknikal">T ${bar(r.sc.tech, '#4a90e2')}</span>
          <span title="PVA">V ${bar(r.sc.pva, '#9b6dd6')}</span>
          <span title="Foreign">F ${bar(r.sc.foreign, '#f2a03e')}</span>
        </div>
        ${reasons.length ? `<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:3px">${reasons.map((b) => `<span class="vd nb" style="font-size:9px">${b}</span>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
    ui.tpOut.innerHTML = html;
    ui.tpOut.querySelectorAll('[data-tp]').forEach((el) => {
      el.style.cursor = 'pointer';
      el.onclick = () => {
        const r = topPick.results.find((x) => x.sym === el.dataset.tp);
        if (r) renderResearch(r);
      };
    });
  }

  // ============================================================
  // Outlook Research — laporan analis per saham (dari hasil scan)
  // ============================================================
  function researchThesis(r) {
    const m = r.m, sc = r.sc;
    const parts = [];
    const smartRp = fmtRp(Math.abs(m.smartNet));
    // narasi utama berdasarkan cerita dominan
    if (sc.accum >= 60 && m.smartNet > 0) {
      parts.push(`<b>${r.sym}</b> memperlihatkan <b class="pos">indikasi akumulasi ${m.topConc >= 0.6 ? 'terkonsentrasi' : ''}</b> oleh smart money (net beli ${smartRp}${m.topAcc[0] ? `, dimotori ${m.topAcc.map((b) => b.code).join(', ')}` : ''})`);
      if (m.dryUp) parts.push(`disertai <b>volume yang mengering</b> — pola klasik bandar mengumpulkan barang secara senyap sebelum potensi markup`);
      if (m.retailNet < 0) parts.push(`sementara <b>ritel justru melepas</b>, mengalirkan barang ke tangan kuat`);
    } else if (m.smartNet < 0 || (m.topDist && m.topDist.length && m.trend === 'DOWNTREND')) {
      parts.push(`<b>${r.sym}</b> cenderung <b class="neg">dalam tekanan/distribusi</b>${m.topDist && m.topDist[0] ? ` (dilepas ${m.topDist.map((b) => b.code).join(', ')})` : ''} — kewaspadaan tinggi`);
    } else {
      parts.push(`<b>${r.sym}</b> berada dalam fase ${m.trend === 'UPTREND' ? '<b class="pos">tren naik</b>' : m.trend === 'DOWNTREND' ? '<b class="neg">tren turun</b>' : 'konsolidasi'}`);
    }
    if (m.trend === 'UPTREND' && m.nearBreakout) parts.push(`secara teknikal <b>dekat area breakout</b> (resistance ${m.resistance || '-'})`);
    if (m.foreignNet > 0 && m.totVal > 0 && m.foreignNet / m.totVal > 0.05) parts.push(`ditopang <b class="pos">arus masuk asing</b>`);
    if (m.foreignNet < 0 && m.totVal > 0 && m.foreignNet / m.totVal < -0.05) parts.push(`namun <b class="neg">asing masih keluar</b>`);
    return parts.join(', ') + '.';
  }

  function renderResearch(r) {
    const m = r.m, sc = r.sc;
    const bestStyle = ['scalp', 'daytrade', 'swing'].sort((a, b) => sc.fit[b] - sc.fit[a])[0];
    const styleLbl = { scalp: '⚡ Scalping', daytrade: '📊 Daytrade', swing: '🌊 Swing' };
    const overall = bestStyle ? sc.fit[bestStyle] : Math.round((sc.accum + sc.tech + sc.pva + sc.liq) / 4);
    const verdict = overall >= 70 ? { t: 'SANGAT MENARIK', c: '#00d69a', bg: '#0f2a1e' } : overall >= 55 ? { t: 'MENARIK', c: '#57b893', bg: '#14211a' } : overall >= 40 ? { t: 'NETRAL — PANTAU', c: '#f2c14e', bg: '#241f12' } : { t: 'KURANG MENARIK', c: '#eb6b69', bg: '#241417' };
    const bar = (v, col) => `<div style="flex:1;height:7px;border-radius:4px;background:#232833;position:relative;overflow:hidden"><div style="position:absolute;left:0;top:0;height:100%;width:${v}%;background:${col};border-radius:4px"></div></div>`;
    const dim = (icon, label, v, col) => `<div style="display:flex;align-items:center;gap:7px;margin:5px 0"><span style="width:82px;font-size:11px;color:#aeb6c4">${icon} ${label}</span>${bar(v, col)}<b style="width:24px;text-align:right;font-size:11px;color:${col}">${v}</b></div>`;

    // bandarmology
    const accTxt = m.topAcc && m.topAcc.length
      ? m.topAcc.map((b) => `<b>${b.code}</b> ${b.type} <span class="pos">+${fmtRp(b.net)}</span>`).join(' · ')
      : 'data broker terbatas';
    const retTxt = m.retailNet < 0 ? `Ritel <b class="neg">net jual ${fmtRp(Math.abs(m.retailNet))}</b> (barang mengalir ke smart money)` : m.retailNet > 0 ? `Ritel masih net beli ${fmtRp(m.retailNet)}` : 'Ritel netral';

    // level & rencana
    const sup = m.support, res = m.resistance, atr = m.atr;
    const rr = sup && res && m.last > sup ? ((res - m.last) / Math.max(m.last - sup, 1)).toFixed(1) : '-';

    ui.rov.innerHTML = `<div class="rovwrap">
      <div class="row" style="margin-bottom:8px"><button class="btn" id="rscBack">← Kembali</button>
        <button class="btn primary" id="rscOpen" style="margin-left:auto">Buka Chartbit ↗</button></div>
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
        <b style="font-size:18px">${r.sym}</b>
        <span class="vd nb">${CAT_LABEL[r.category]}</span>
        <span style="color:#8b93a3;font-size:11px">${esc(r.name || '')}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;margin:2px 0 8px">
        <span style="font-size:20px;font-weight:800">${m.last}</span>
        <span class="${r.chg >= 0 ? 'pos' : 'neg'}" style="font-weight:700">${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(2)}%</span>
        <span class="hint">Kapitalisasi ${(r.mcap / 1e12).toFixed(1)}T</span>
      </div>

      <div style="background:${verdict.bg};border:1px solid ${verdict.c}55;border-radius:11px;padding:11px 12px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="font-size:26px;font-weight:800;color:${verdict.c}">${overall}</div>
          <div><div style="font-weight:800;color:${verdict.c};font-size:13px">${verdict.t}</div>
            <div class="hint">Paling cocok: <b style="color:#e4e8ef">${styleLbl[bestStyle]}</b> · scalp ${sc.fit.scalp} / daytrade ${sc.fit.daytrade} / swing ${sc.fit.swing}</div></div>
        </div>
      </div>

      <div class="grp">
        <div class="gt">📌 Outlook</div>
        <div style="font-size:12px;line-height:1.6;color:#cdd3dd">${researchThesis(r)}</div>
      </div>

      <div class="grp">
        <div class="gt">Skor per dimensi</div>
        ${dim('🐋', 'Akumulasi', sc.accum, '#00b47e')}
        ${dim('📈', 'Teknikal', sc.tech, '#4a90e2')}
        ${dim('📊', 'Volume', sc.pva, '#9b6dd6')}
        ${dim('💧', 'Likuiditas', sc.liq, '#f2a03e')}
        ${dim('🌊', 'Foreign', sc.foreign, '#00b8d4')}
      </div>

      <div class="grp"><div class="gt">🐋 Bandarmology (${m.periodTxt})</div>
        <div style="font-size:11.5px;line-height:1.6;color:#aeb6c4">
          Smart money (asing/institusi): <b class="${m.smartNet >= 0 ? 'pos' : 'neg'}">${m.smartNet >= 0 ? 'net beli' : 'net jual'} ${fmtRp(Math.abs(m.smartNet))}</b>${m.dryUp ? ' · 🔥 <b>barang kering</b>' : ''}<br>
          Harga periode: <b class="${m.chgPeriod >= 0 ? 'pos' : 'neg'}">${m.chgPeriod >= 0 ? '+' : ''}${m.chgPeriod.toFixed(1)}%</b>${m.silent ? ' → <b class="pos">akumulasi senyap (belum lari)</b>' : ''}<br>
          Top akumulator: ${accTxt}<br>
          ${retTxt}
        </div>
      </div>

      <div class="grp"><div class="gt">📈 Teknikal</div>
        <div style="font-size:11.5px;line-height:1.6;color:#aeb6c4">
          Tren: <b class="${m.trend === 'UPTREND' ? 'pos' : m.trend === 'DOWNTREND' ? 'neg' : ''}">${m.trend}</b> ${m.trendDetail ? `(${m.trendDetail})` : ''}<br>
          Posisi: MA50 ${m.ma50 ? '<span class="pos">di atas ✓</span>' : '<span class="neg">di bawah</span>'} · MA200 ${m.ma200 ? '<span class="pos">di atas ✓</span>' : '<span class="neg">di bawah</span>'} · RSI <b>${m.rsi.toFixed(0)}</b>${m.rsi >= 70 ? ' ⚠' : m.rsi <= 30 ? ' (oversold)' : ''}<br>
          ${m.nearBreakout ? '🚀 <b>Dekat breakout</b> resistance ' + m.resistance : ''}
        </div>
      </div>

      <div class="grp"><div class="gt">📊 Volume (PVA)</div>
        <div style="font-size:11.5px;line-height:1.6;color:#aeb6c4">
          Kondisi terkini: <b>${esc(m.pvaKlas)}</b>${m.obvSinyal === 'bull' ? ' · 🟢 OBV divergen bullish' : m.obvSinyal === 'bear' ? ' · 🔴 OBV divergen bearish' : ''}
          ${m.klimaks ? `<br>⚡ <b>${m.klimaks.jenis}</b> terdeteksi` : ''}
        </div>
      </div>

      <div class="grp">
        <div class="gt">🔬 Analisa transaksi (running trade)</div>
        <div class="row" style="margin-bottom:6px"><label>Tanggal</label>
          <input type="date" id="rscTxDate" value="${todayISO()}">
          <button class="btn" id="rscTxBtn">Muat</button></div>
        <div id="rscTx"><div class="status">Memuat transaksi seharian…</div></div>
      </div>

      <div class="grp"><div class="gt">🎯 Level kunci & rencana</div>
        <div class="kv"><span class="k">Support</span><span class="v pos">${sup || '-'}</span></div>
        <div class="kv"><span class="k">Resistance</span><span class="v neg">${res || '-'}</span></div>
        <div class="kv"><span class="k">R/R (support→resistance)</span><span class="v">${rr}</span></div>
        <div class="kv"><span class="k">ATR (volatilitas)</span><span class="v">${atr} (${((atr / m.last) * 100).toFixed(1)}%)</span></div>
        <div class="kv" style="border:none"><span class="k">ARA / ARB besok</span><span class="v"><span class="pos">${m.ara}</span> / <span class="neg">${m.arb}</span></span></div>
        <div style="font-size:10.5px;color:#8b93a3;margin-top:6px;line-height:1.5">${sup && res ? `Ide: entry dekat support <b>${sup}</b>, stop bila tembus ${Math.round(sup * 0.985)} (±${Math.round(atr * 1.5)} = 1.5×ATR), target resistance <b>${res}</b>.` : 'Level belum jelas — tunggu konfirmasi.'}</div>
      </div>

      <div class="note">Outlook otomatis — heuristik, <b>bukan rekomendasi jual/beli</b>. Konfirmasi sendiri sebelum transaksi.</div>
    </div>`;
    ui.rov.classList.add('open');
    ui.rov.querySelector('#rscBack').onclick = () => closeResearch();
    ui.rov.querySelector('#rscOpen').onclick = () => { location.href = `/symbol/${r.sym}/chartbit`; };
    ui.rov.scrollTop = 0;

    // gambar hasil analisa transaksi ke box
    const paintTx = (box, tx, wholeDay) => {
      if (!tx) { box.innerHTML = '<div class="status">Belum ada transaksi pada tanggal ini (libur/saham sepi).</div>'; return; }
      const buyDom = tx.buyRatio >= 0.56, sellDom = tx.buyRatio <= 0.44;
      const cover = wholeDay
        ? `<span class="pos">seluruh hari</span> · ${tx.nTrades} transaksi · ${tx.spanTxt}`
        : `<span style="color:#f2c14e">sampel ${tx.nTrades} transaksi</span> · ${tx.spanTxt}`;
      const brokers = (arr) => arr.map((b) => `<b>${b.code}</b> <span class="hint">${esc(brokerName(b.code))}</span> ${fmtRp(b.val)}`).join('<br>') || '-';
      box.innerHTML = `
        <div class="hint" style="margin-bottom:6px">Cakupan: ${cover}</div>
        <div style="font-size:11.5px;line-height:1.6;color:#aeb6c4">
          Agresor: <b class="pos">beli ${fmtRp(tx.aggrBuyVal)}</b> vs <b class="neg">jual ${fmtRp(tx.aggrSellVal)}</b>
          → ${buyDom ? '<b class="pos">HAKA dominan</b> (pembeli agresif)' : sellDom ? '<b class="neg">HAKI dominan</b> (penjual agresif)' : 'seimbang'}
          <div style="margin-top:6px"><span class="hint">Paling agresif BELI (haka):</span><br>${brokers(tx.topBuyers)}</div>
          <div style="margin-top:5px"><span class="hint">Paling agresif JUAL (haki):</span><br>${brokers(tx.topSellers)}</div>
          ${tx.splitBuyCount ? `<div style="margin-top:6px">🧊 <b>${tx.splitBuyCount} order beli di-split</b> (iceberg, total ${fmtRp(tx.splitBuyVal)})${tx.biggestSplit ? ` — terbesar <b>${tx.biggestSplit.brk}</b> ${fmtRp(tx.biggestSplit.val)} dipecah ${tx.biggestSplit.n}×` : ''}<br><b>→ smart money menyembunyikan ukuran beli</b></div>` : '<div style="margin-top:6px" class="hint">Tidak ada order split besar terdeteksi.</div>'}
          ${tx.smartViaRetail && tx.smartViaRetail.length ? `<div class="concl" style="margin-top:8px;border-color:#8a7a3a;background:#26220f">🕵️ <b style="color:#f2c14e">Smart money menyamar via broker ritel!</b><br>${tx.smartViaRetail.map((b) => `<b>${b.code}</b> <span class="hint">${esc(brokerName(b.code))}</span> — beli ${fmtRp(b.buyVal)}, ${b.splitOrders} order dipecah (iceberg terbesar ${b.maxN}×). Ordernya besar & terpecah = <b>pola institusi</b>, bukan ritel biasa.`).join('<br><br>')}</div>` : ''}
        </div>`;
    };
    // muat analisa transaksi seharian penuh — bisa filter tanggal
    const loadTx = async (date) => {
      const box = ui.rov.querySelector('#rscTx');
      if (!box) return;
      box.innerHTML = '<div class="status">⏳ Memuat transaksi seharian… (0)</div>';
      try {
        const trades = await fetchRunningTrade(r.sym, {
          date, maxBatches: RUNNING_TRADE_BATCHES,
          onProgress: (n) => { box.innerHTML = `<div class="status">⏳ Memuat transaksi… (${n})</div>`; },
        });
        paintTx(box, analyzeTransactions(trades), trades.wholeDay);
      } catch (e) {
        box.innerHTML = '<div class="status"><span class="no">Gagal memuat running trade.</span></div>';
      }
    };
    ui.rov.querySelector('#rscTxBtn').onclick = () => loadTx(ui.rov.querySelector('#rscTxDate').value || undefined);
    // outlook lengkap 1 klik: kalau sudah di-rekap saat scan, tampilkan INSTAN;
    // tombol "Muat" memperdalam ke seluruh hari / tanggal lain
    if (r.txSummary) paintTx(ui.rov.querySelector('#rscTx'), r.txSummary, r.txWholeDay);
    else loadTx(undefined);
  }

  function closeResearch() { if (ui && ui.rov) ui.rov.classList.remove('open'); }

  // buka outlook research dari hasil scan Bandar (data ringan) — ambil data lengkap dulu
  async function openBandarResearch(sym, days) {
    ui.rov.innerHTML = `<div class="rovwrap"><div class="row" style="margin-bottom:8px"><button class="btn" id="rovBack2">← Kembali</button></div><div class="status">⏳ Menyusun outlook <b>${esc(sym)}</b>… (mengambil broker, teknikal, orderbook)</div></div>`;
    ui.rov.classList.add('open');
    ui.rov.querySelector('#rovBack2').onclick = () => closeResearch();
    try {
      const full = await scanSymbol(sym, days || 63, nameMap[sym]);
      renderResearch(full);
    } catch (e) {
      ui.rov.innerHTML = `<div class="rovwrap"><div class="row" style="margin-bottom:8px"><button class="btn" id="rovBack3">← Kembali</button></div><div class="status"><span class="no">Gagal menyusun outlook ${esc(sym)}: ${esc(e.message)}</span></div></div>`;
      ui.rov.querySelector('#rovBack3').onclick = () => closeResearch();
    }
  }

  // ============================================================
  // Hook debug (bisa dipakai dari console: window.__BM_DEBUG)
  // ============================================================
  window.__BM_DEBUG = { analyze, brokerStats, extractRows, buildBrokerUrl, formatDateLike, findChart, fetchDailyBars, fetchBrokerDay, fetchBrokerRange, calcEMA, calcSMA, calcRSI, calcMACD, calcATR, araArb, detectDivergence, trendStructure, fibSwing, findSR, generateSignals, pvaAnalysis, parseOrderbook, analyzeBook, scalpSignal, tickSize, araArbPrev, calcVWAP, idxScalperAnalyze, buildTickCandles, scanSymbol, scanBandarStock, scoreStock, mcapCategory, researchThesis, stockBadges, analyzeTransactions, fetchRunningTrade, renderTape, fmtLot, fmtLotFull, drawPhases, drawSRLevels, BROKER_DB };

  // ============================================================
  // Boot
  // ============================================================
  const boot = () => {
    if (document.getElementById('__bm_host')) return;
    buildUI();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
