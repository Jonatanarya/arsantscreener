/**
 * relay.js — DB Relay Forwarder.
 *
 * Menerjemahkan respons Stockbit ke bentuk yang dimengerti backend Arsant Screener
 * Terminal, lalu mengirimnya lewat REST. Endpoint yang belum punya route khusus
 * di backend dikirim apa adanya ke `rawPath` (default /ingest/raw) dengan
 * amplop {source, endpoint, symbol, params, payload} — jadi tidak ada data yang
 * hilang hanya karena backend belum sempat dibuatkan tabelnya.
 *
 * Kegagalan relay TIDAK PERNAH menghentikan crawling: payload masuk buffer di
 * storage dan dicoba lagi belakangan.
 */
import { getSettings, getBuffer, setBuffer, addLog } from './storage.js';

const MAX_BUFFER = 200;

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const pick = (o, keys) => {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};

const isoFromEpoch = (sec) => {
  const ms = sec > 1e12 ? sec : sec * 1000;
  return new Date(ms).toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Transform per jenis data
// ---------------------------------------------------------------------------

/**
 * Candle harian. Tiga bentuk yang pernah dipakai Stockbit ditangani sekaligus:
 *   a) data: [{timestamp, open, high, low, close, volume}]
 *   b) data.chartbit: [{date, unixdate, open, ..., foreignbuy, foreignsell}]
 *   c) UDF TradingView: {t:[], o:[], h:[], l:[], c:[], v:[]}
 */
export function toBars(payload) {
  if (!payload) return [];
  const d = payload.data !== undefined ? payload.data : payload;

  if (d && Array.isArray(d.chartbit)) {
    return d.chartbit.map((r) => ({
      date: r.date || (r.unixdate ? isoFromEpoch(num(r.unixdate)) : ''),
      open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close),
      volume: num(r.volume),
      value: num(r.value) || undefined,
      freq: num(r.frequency) || undefined,
      foreignBuy: num(r.foreignbuy) || undefined,
      foreignSell: num(r.foreignsell) || undefined,
      foreignFlow: num(r.foreignflow) || undefined,
    })).filter((b) => b.date && b.close > 0);
  }

  if (Array.isArray(d)) {
    return d.map((r) => {
      const ts = num(pick(r, ['timestamp', 'unixdate', 'time', 't']));
      return {
        date: r.date || (ts ? isoFromEpoch(ts) : ''),
        open: num(pick(r, ['open', 'o'])), high: num(pick(r, ['high', 'h'])),
        low: num(pick(r, ['low', 'l'])), close: num(pick(r, ['close', 'c'])),
        volume: num(pick(r, ['volume', 'v'])),
        value: num(pick(r, ['value'])) || undefined,
        freq: num(pick(r, ['frequency', 'freq'])) || undefined,
      };
    }).filter((b) => b.date && b.close > 0);
  }

  if (d && Array.isArray(d.t) && Array.isArray(d.c)) {
    return d.t.map((t, i) => ({
      date: isoFromEpoch(num(t)),
      open: num(d.o && d.o[i]), high: num(d.h && d.h[i]),
      low: num(d.l && d.l[i]), close: num(d.c && d.c[i]),
      volume: num(d.v && d.v[i]),
    })).filter((b) => b.date && b.close > 0);
  }

  return [];
}

/**
 * Broker summary /marketdetectors -> buyers & sellers.
 *
 * Logikanya disamakan dengan extractRows() di app.js yang sudah lama terbukti:
 *  - blok brokers_buy/brokers_sell dicari REKURSIF (letaknya pernah berpindah
 *    antar versi respons, kadang di data.broker_summary, kadang lebih dalam);
 *  - frekuensi ada di satu field `freq`, bukan bfreq/sfreq;
 *  - kalau respons ternyata mode NET (nilai bisa negatif), dipakai kolom gross
 *    `bvalv`/`svalv` sebagai cadangan;
 *  - baris dengan kode "-" (baris total) dibuang.
 */
function findBrokerSummary(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (Array.isArray(obj.brokers_buy) || Array.isArray(obj.brokers_sell)) return obj;
  for (const k of Object.keys(obj)) {
    const r = findBrokerSummary(obj[k], depth + 1);
    if (r) return r;
  }
  return null;
}

export function toBrokerRange(payload, requestedInvestorType) {
  // `requestedInvestorType` = enum yang DIMINTA (INVESTOR_TYPE_FOREIGN /
  // _DOMESTIC / _ALL). Kalau ada, itu yang dipakai: respons memang berisi
  // hanya aliran dana jenis itu, jadi lebih tegas daripada field `type` per
  // baris yang isinya tergantung Stockbit.
  const forced = String(requestedInvestorType || '').replace(/^INVESTOR_TYPE_/, '');
  const forcedLabel = forced === 'FOREIGN' ? 'Asing' : forced === 'DOMESTIC' ? 'Lokal' : '';
  const bs = findBrokerSummary(payload);
  if (!bs) return { buyers: [], sellers: [], detector: null };

  // nilai negatif = respons mode NET; pakai kolom gross bila ada
  const pos = (utama, cadangan) => {
    let x = num(utama);
    if (x < 0) x = num(cadangan) || -x;
    return x;
  };
  const mapSide = (list, side) => {
    const agg = {};
    for (const r of list || []) {
      const raw = pick(r, ['netbs_broker_code', 'broker_code', 'code', 'broker']);
      const code = String(raw || '').toUpperCase();
      if (!code || code === '-') continue;
      const row = agg[code] || (agg[code] = { brokerCode: code, value: 0, lot: 0, freq: 0, investorType: '' });
      // `type` di tiap baris = domisili ALIRAN DANA ("Asing"/"Lokal"), BUKAN
      // kebangsaan brokernya. Inilah yang membedakan "YU broker asing" dari
      // "yang beli lewat YU adalah investor lokal". Dulu field ini dibuang.
      const t = forcedLabel || String(pick(r, ['type', 'investor_type', 'domicile']) || '').trim();
      if (t) row.investorType = row.investorType && row.investorType !== t ? 'Campuran' : t;
      if (side === 'buy') {
        row.value += pos(r.bval != null ? r.bval : r.bvalv, r.bvalv);
        row.lot += pos(r.blot != null ? r.blot : r.blotv, null);
      } else {
        row.value += pos(r.sval != null ? r.sval : r.svalv, r.svalv);
        row.lot += pos(r.slot != null ? r.slot : r.slotv, null);
      }
      row.freq += num(pick(r, ['freq', 'frequency']));
    }
    return Object.values(agg);
  };

  const d = (payload && payload.data) || {};
  return {
    buyers: mapSide(bs.brokers_buy || bs.buyers, 'buy'),
    sellers: mapSide(bs.brokers_sell || bs.sellers, 'sell'),
    detector: d.bandar_detector || null,
  };
}

/**
 * KeyStats -> payload /ingest/keystats.
 *
 * Bentuk respons aslinya TIDAK datar seperti contoh dokumentasi. Yang dikirim
 * Stockbit:
 *   data.stats                     -> {market_cap: "7,505 B", free_float: "51.63%", …}
 *   data.closure_fin_items_results -> [{keystats_name: "Current Valuation",
 *                                       fin_name_results: [{fitem:{name, value}}]}]
 *
 * Jadi PULUHAN rasio bernama, bergrup. Tujuh di antaranya dipetakan ke kolom
 * tabel `keystats`; SELURUHNYA juga dikirim sebagai `ratios[]` supaya tidak ada
 * yang terbuang (tabel keystats_ratios).
 */
export function parseStatValue(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { value: 0, unit: '' };
  // "0.28%" -> 0.28 (persen disimpan apa adanya, bukan pecahan)
  if (s.endsWith('%')) return { value: num(s.slice(0, -1).replace(/,/g, '')), unit: '%' };
  // "7,505 B" / "4.71 B" / "1.2 T" -> dikalikan penggandanya
  const m = /^(-?[\d.,]+)\s*([BMTK])$/i.exec(s);
  if (m) {
    const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2].toLowerCase()] || 1;
    return { value: num(m[1].replace(/,/g, '')) * mult, unit: m[2].toUpperCase() };
  }
  return { value: num(s.replace(/,/g, '')), unit: '' };
}

/** Semua rasio bernama dari respons keystats, apa adanya beserta grupnya. */
export function toKeyStatsRatios(payload) {
  const d = (payload && payload.data) || {};
  const out = [];
  for (const [name, raw] of Object.entries(d.stats || {})) {
    const { value, unit } = parseStatValue(raw);
    out.push({ group: 'Stats', name: prettyStatName(name), value, rawValue: String(raw ?? ''), unit });
  }
  for (const g of d.closure_fin_items_results || []) {
    const group = g.keystats_name || '';
    for (const it of g.fin_name_results || []) {
      const f = it && it.fitem;
      if (!f || !f.name) continue;
      const { value, unit } = parseStatValue(f.value);
      out.push({ group, name: f.name, value, rawValue: String(f.value ?? ''), unit });
    }
  }
  return out;
}

const prettyStatName = (k) => String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Cari rasio berdasarkan nama (cocok persis dulu, lalu awalan). */
function findRatio(ratios, ...names) {
  for (const n of names) {
    const hit = ratios.find((r) => r.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit.value;
  }
  for (const n of names) {
    const hit = ratios.find((r) => r.name.toLowerCase().startsWith(n.toLowerCase()));
    if (hit) return hit.value;
  }
  return 0;
}

export function toKeyStats(symbol, payload) {
  const ratios = toKeyStatsRatios(payload);
  return {
    symbol,
    peRatio: findRatio(ratios, 'Current PE Ratio (TTM)', 'Current PE Ratio (Annualised)', 'PE Ratio'),
    pbvRatio: findRatio(ratios, 'Current Price to Book Value (Quarter)', 'Current Price to Book Value', 'Price to Book'),
    roe: findRatio(ratios, 'Return on Equity (TTM)', 'Return on Equity'),
    roa: findRatio(ratios, 'Return on Assets (TTM)', 'Return on Assets'),
    der: findRatio(ratios, 'Debt to Equity Ratio (Quarter)', 'Debt to Equity Ratio', 'Total Liabilities/Equity (Quarter)'),
    dividendYield: findRatio(ratios, 'Dividend Yield (TTM)', 'Dividend Yield'),
    marketCap: findRatio(ratios, 'Market Cap'),
    ratios,
  };
}

/**
 * Laporan keuangan findata-view -> baris statements.
 *
 * Responsnya TIDAK berbentuk {items:[...]} seperti dugaan awal. Yang dikirim
 * Stockbit adalah tabel HTML siap render di `data.html_report`, berisi SELURUH
 * periode sekaligus (SSIA: 73 periode) — satu kolom per periode. Bentuk
 * terstruktur `data.data_tables` ada tapi kosong pada respons yang diamati.
 *
 * Jadi urutannya: pakai data_tables kalau terisi, kalau tidak parse HTML-nya.
 */
export function toFinancialStatements(symbol, payload, meta) {
  const d = (payload && payload.data) || {};
  const reportType = (meta && meta.reportType) || '';
  const statementType = (meta && meta.statementType) || '';
  const currency = Array.isArray(d.currency) ? (d.currency[0] || 'IDR') : (d.currency || 'IDR');
  const row = (period, itemName, value, idx) => ({
    symbol, reportType, statementType, period, currency,
    itemId: stableItemId(itemName, idx),
    itemName, value,
  });

  // 1) bentuk terstruktur klasik
  if (Array.isArray(d.items) && d.items.length) {
    return d.items.map((it, i) => row(
      d.period || '', pick(it, ['item_name', 'name']) || '',
      num(pick(it, ['value', 'amount'])), i,
    )).filter((r) => r.itemName);
  }

  // 2) data_tables (periods[] + accounts[]) bila Stockbit mengisinya
  const dt = d.data_tables || {};
  if (Array.isArray(dt.periods) && dt.periods.length && Array.isArray(dt.accounts) && dt.accounts.length) {
    const periods = dt.periods.map((p) => String(pick(p, ['label', 'name', 'period']) || p));
    const out = [];
    dt.accounts.forEach((acc, i) => {
      const name = pick(acc, ['name', 'account_name', 'item_name']) || '';
      const values = acc.values || acc.data || [];
      if (!name || !Array.isArray(values)) return;
      values.forEach((v, j) => {
        if (periods[j] === undefined) return;
        out.push(row(periods[j], name, num(typeof v === 'object' ? pick(v, ['idr', 'value', 'raw']) : v), i));
      });
    });
    if (out.length) return out;
  }

  // 3) parse tabel HTML
  return parseFinancialHtml(String(d.html_report || ''), row);
}

/**
 * Parser tabel laporan keuangan Stockbit.
 *   header : <th class="periods-list" data-label="12M08">12M 2008</th>
 *   baris  : <tr ...><td ...><span class="acc-name" data-lang-0="Aset">…</span>…
 *            <td class="rowval …" data-value-idr="123" …>
 * Nilai diambil dari data-value-idr (angka mentah), bukan teks terformat.
 */
function parseFinancialHtml(html, row) {
  if (!html) return [];

  const periods = [];
  const thRe = /<th[^>]*class="[^"]*periods-list[^"]*"[^>]*data-label="([^"]*)"[^>]*>([^<]*)</gi;
  let m;
  while ((m = thRe.exec(html))) periods.push((m[2] || m[1] || '').trim());
  if (!periods.length) return [];

  const out = [];
  const rows = html.split(/<tr\b/i).slice(1);
  let idx = 0;
  for (const tr of rows) {
    // Nama akun: atribut `-full` dipakai lebih dulu. Teks di dalam <span>
    // dan atribut non-full sudah DIPOTONG Stockbit untuk tampilan tabel
    // ("Beban Umum Dan Administra..."), sedangkan yang `-full` utuh.
    const span = /<span[^>]*class="acc-name"[^>]*>/i.exec(tr);
    if (!span) continue;
    const attr = (n) => {
      const m = new RegExp(`${n}="([^"]*)"`, 'i').exec(span[0]);
      return m ? m[1].trim() : '';
    };
    const inner = /class="acc-name"[^>]*>([^<]*)</i.exec(tr);
    const name = (
      attr('data-lang-1-full') || attr('data-lang-0-full') ||
      attr('data-lang-1') || attr('data-lang-0') ||
      (inner ? inner[1] : '')
    ).trim();
    if (!name) continue;

    const values = [];
    const tdRe = /data-value-idr="([^"]*)"/gi;
    let v;
    while ((v = tdRe.exec(tr))) values.push(v[1]);
    if (!values.length) continue;

    values.forEach((raw, j) => {
      if (periods[j] === undefined) return;
      const value = num(raw);
      // sel kosong ditandai data-raw="-" dan bernilai 0; disimpan apa adanya
      out.push(row(periods[j], name, value, idx));
    });
    idx++;
  }
  return out;
}

/**
 * item_id stabil per nama akun. Respons HTML tidak membawa id numerik, padahal
 * backend memakai (symbol, report_type, statement_type, period, item_id)
 * sebagai kunci unik. Hash nama akun memberi id yang tetap sama antar crawl,
 * sehingga crawl ulang memperbarui baris yang sama alih-alih menggandakannya.
 */
function stableItemId(name, fallback) {
  const s = String(name || '');
  if (!s) return Number(fallback) || 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000;
}

/** Market mover -> payload /ingest/market-movers. */
export function toMarketMovers(payload, moverType) {
  const list = (payload && (payload.data || payload.items)) || [];
  const arr = Array.isArray(list) ? list : (Array.isArray(list.items) ? list.items : []);
  return arr.map((item) => ({
    moverType,
    symbol: String(pick(item, ['code', 'symbol', 'ticker']) || '').toUpperCase(),
    name: pick(item, ['name', 'company_name']) || '',
    price: num(pick(item, ['price', 'close', 'last'])),
    changePct: num(pick(item, ['change_percentage', 'change_pct', 'changePct'])),
    volume: num(pick(item, ['volume'])),
    value: num(pick(item, ['value'])),
    netForeign: num(pick(item, ['net_foreign', 'netForeign'])),
    frequency: num(pick(item, ['frequency', 'freq'])),
  })).filter((m) => m.symbol);
}

/**
 * Graf kepemilikan KSEI -> baris investor × emiten untuk /ingest/shareholding.
 *
 * Arah edge bisa dua-duanya (investor->company maupun sebaliknya), jadi
 * keduanya diperiksa alih-alih mengandalkan urutan yang kebetulan terlihat.
 *
 * PENTING: hanya emiten ROOT yang diambil. Emiten lain dalam graf cuma
 * tersentuh di tepi — Stockbit mengembalikan sebagian kecil pemegangnya saja,
 * dan menyimpannya membuat "jumlah pemegang" jadi 1-2 orang: angka yang SALAH,
 * bukan sekadar kurang lengkap. Nilai graf yang lebih luas tetap dipanen, tapi
 * sebagai pemetaan simbol -> company_id (lihat harvestCompanyIds).
 */
export function toShareholdingNetwork(payload, rootSymbol) {
  const d = (payload && payload.data) || {};
  const nodes = {};
  for (const n of d.nodes || []) nodes[n.id] = n;

  // simbol root: node dengan min_depth 0, jatuh ke rootSymbol bila tak ada
  const rootNode = (d.nodes || []).find(
    (n) => n.min_depth === 0 && n.metadata && n.metadata.company,
  );
  const root = rootNode
    ? String(rootNode.metadata.company.symbol || '').toUpperCase()
    : String(rootSymbol || '').toUpperCase();

  const holdings = [];
  for (const e of d.edges || []) {
    const a = nodes[e.from_id];
    const b = nodes[e.to_id];
    if (!a || !b || !a.node_type || !b.node_type) continue;

    let company = null;
    let investor = null;
    if (a.node_type.endsWith('COMPANY') && b.node_type.endsWith('INVESTOR')) {
      company = a; investor = b;
    } else if (b.node_type.endsWith('COMPANY') && a.node_type.endsWith('INVESTOR')) {
      company = b; investor = a;
    } else {
      continue;   // edge company<->company / investor<->investor tidak relevan
    }

    const cm = (company.metadata && company.metadata.company) || null;
    const iv = (investor.metadata && investor.metadata.investor) || null;
    if (!cm || !iv || !cm.symbol) continue;
    if (root && String(cm.symbol).toUpperCase() !== root) continue;

    const sh = e.shareholding || {};
    const raw = (o) => num(o && o.raw !== undefined ? o.raw : 0);
    holdings.push({
      symbol: String(cm.symbol).toUpperCase(),
      companyId: num(cm.id),
      investorId: num(iv.id),
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

  return { reportDate: d.report_date || '', holdings };
}

/** Komposisi kepemilikan -> baris investor x emiten untuk /ingest/shareholding */
export function toShareholdingComposition(payload, rootSymbol) {
  const d = (payload && payload.data) || payload || [];
  const arr = Array.isArray(d) ? d : (Array.isArray(d.composition) ? d.composition : (Array.isArray(d.items) ? d.items : []));
  const holdings = arr.map((item, idx) => ({
    symbol: String(pick(item, ['symbol', 'code']) || rootSymbol || '').toUpperCase(),
    investorId: num(pick(item, ['investor_id', 'investorId', 'id'])) || (idx + 1),
    investorName: pick(item, ['investor_name', 'investorName', 'name', 'holder_name']) || '',
    investorType: pick(item, ['investor_type', 'investorType', 'type']) || '',
    location: pick(item, ['location']) || '',
    nationality: pick(item, ['nationality']) || '',
    domicile: pick(item, ['domicile']) || '',
    classification: pick(item, ['classification']) || '',
    scrip: num(pick(item, ['scrip'])),
    scripless: num(pick(item, ['scripless'])),
    totalShares: num(pick(item, ['total_shares', 'totalShares', 'shares'])),
    percentage: num(pick(item, ['percentage', 'pct'])),
  })).filter((h) => h.symbol && h.investorName);
  return { reportDate: lastMonthEnd(), holdings };
}

/**
 * Setiap respons graf juga MENGAJARKAN pemetaan simbol -> company_id baru,
 * jadi crawl berikutnya punya lebih banyak emiten yang bisa dijadikan root.
 */
export function harvestCompanyIds(payload) {
  const d = (payload && payload.data) || {};
  const map = {};
  for (const n of d.nodes || []) {
    const cm = n.metadata && n.metadata.company;
    if (cm && cm.symbol && cm.id) map[String(cm.symbol).toUpperCase()] = num(cm.id);
  }
  return map;
}

/**
 * Running trade -> payload /ingest/trades.
 *
 * Bentuk & pemetaan field disamakan dengan relayRunningTrade() di app.js yang
 * sudah lama terbukti: data.running_trade[] dengan {time, action, price, lot,
 * buyer, seller, buy_order_number, sell_order_number}.
 *
 * `extTradeId` memakai nomor order beli+jual — id eksekusi asli dari Stockbit —
 * supaya crawl ulang di hari yang sama MEMPERBARUI baris, bukan menggandakan.
 */
export function toTrades(payload, symbol, dateIso) {
  const d = (payload && payload.data) || {};
  const arr = Array.isArray(d.running_trade) ? d.running_trade
    : (Array.isArray(d) ? d : []);
  const code = (v) => {
    const m = String(v ?? '').match(/^([A-Z]{2})/);
    return m ? m[1] : '';
  };
  return arr.map((t) => {
    const price = num(pick(t, ['price']));
    const lot = num(pick(t, ['lot', 'volume']));
    const action = String(pick(t, ['action']) || '').toLowerCase();
    const buyOrd = pick(t, ['buy_order_number', 'buyOrd']);
    const sellOrd = pick(t, ['sell_order_number', 'sellOrd']);
    const buyer = code(pick(t, ['buyer']));
    const seller = code(pick(t, ['seller']));
    return {
      ts: tradeTs(pick(t, ['time']), dateIso),
      price, lot, freq: 1,
      direction: action === 'buy' ? 'buy' : action === 'sell' ? 'sell' : 'unknown',
      buyerBroker: buyer || undefined,
      sellerBroker: seller || undefined,
      extTradeId: (buyOrd != null && sellOrd != null)
        ? `${buyOrd}-${sellOrd}`
        : `${symbol}:${dateIso || ''}:${pick(t, ['time']) || ''}:${price}:${lot}:${buyer}:${seller}`,
    };
  }).filter((t) => t.price > 0 && t.lot > 0);
}

// Stockbit mengirim waktu sebagai "HH:MM:SS" (jam bursa, WIB), kadang epoch,
// kadang ISO. Ketiganya ditangani; tanggal acuan dari job.
function tradeTs(timeStr, dateIso) {
  const s = String(timeStr || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const t = Date.parse(s); return isNaN(t) ? Date.now() : t; }
  if (/^\d{12,13}$/.test(s)) return Number(s);
  if (/^\d{9,10}$/.test(s)) return Number(s) * 1000;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const ref = dateIso || new Date().toISOString().slice(0, 10);
    const t = Date.parse(`${ref}T${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}+07:00`);
    return isNaN(t) ? Date.now() : t;
  }
  return Date.now();
}

/** Daftar broker resmi -> payload /ingest/brokers (master, bukan hardcode). */
export function toBrokers(payload) {
  const list = (payload && payload.data) || [];
  const arr = Array.isArray(list) ? list : (Array.isArray(list.items) ? list.items : []);
  return arr.map((b) => ({
    code: String(pick(b, ['code', 'broker_code']) || '').toUpperCase(),
    name: pick(b, ['name', 'broker_name']) || '',
    group: pick(b, ['group', 'group_name']) || '',
    color: pick(b, ['color']) || '',
    permission: pick(b, ['permission']) || '',
    membershipType: pick(b, ['membership_type', 'membershipType']) || '',
  })).filter((b) => b.code);
}

/** Dividen tunai -> payload /ingest/dividends. */
export function toDividends(payload, fallbackSymbol) {
  const list = (payload && payload.data) || [];
  const arr = Array.isArray(list) ? list : (Array.isArray(list.items) ? list.items : []);
  return arr.map((it) => ({
    symbol: String(pick(it, ['symbol', 'code']) || fallbackSymbol || '').toUpperCase(),
    cumDate: pick(it, ['cum_date', 'cumDate', 'date']) || '',
    exDate: pick(it, ['ex_date', 'exDate']) || '',
    paymentDate: pick(it, ['payment_date', 'paymentDate']) || '',
    amount: num(pick(it, ['amount', 'cash_dividend', 'dividend', 'value'])),
  })).filter((d) => d.symbol && d.cumDate);
}

/** Kalender aksi korporasi -> payload /ingest/calendar-events. */
export function toCalendarEvents(payload, fallbackDate) {
  const list = (payload && payload.data) || [];
  const arr = Array.isArray(list) ? list : (Array.isArray(list.items) ? list.items : []);
  return arr.map((e) => ({
    eventDate: pick(e, ['date', 'event_date', 'eventDate']) || fallbackDate || '',
    symbol: String(pick(e, ['code', 'symbol', 'ticker']) || '').toUpperCase(),
    eventType: pick(e, ['type', 'event_type', 'category']) || 'CORPORATE_ACTION',
    title: pick(e, ['title', 'name']) || '',
    description: pick(e, ['description', 'summary', 'detail']) || '',
  })).filter((e) => e.symbol && e.eventDate);
}

/** Akhir bulan lalu (YYYY-MM-DD) — acuan laporan KSEI bila tanggalnya kosong. */
function lastMonthEnd() {
  const d = new Date();
  d.setDate(0);   // mundur ke hari terakhir bulan sebelumnya
  return d.toISOString().slice(0, 10);
}

/** Major holder / insider -> payload /ingest/insider-transactions. */
export function toInsiderTransactions(payload, fallbackSymbol) {
  const list = (payload && payload.data) || [];
  const arr = Array.isArray(list) ? list : (Array.isArray(list.items) ? list.items : []);
  return arr.map((item) => ({
    symbol: String(pick(item, ['symbol', 'code', 'stock_code']) || fallbackSymbol || '').toUpperCase(),
    holderName: pick(item, ['holder_name', 'name', 'shareholder_name']) || '',
    actionType: pick(item, ['action_type', 'action', 'transaction_type']) || 'TRANSACTION',
    shares: num(pick(item, ['shares', 'volume', 'total_shares'])),
    price: num(pick(item, ['price', 'avg_price'])),
    txDate: pick(item, ['date', 'transaction_date', 'tx_date']) || '',
  })).filter((t) => t.symbol);
}

// ---------------------------------------------------------------------------
// Pengirim
// ---------------------------------------------------------------------------

async function post(settings, path, body) {
  const base = String(settings.backendUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Base URL backend belum diisi');
  const headers = { 'Content-Type': 'application/json' };
  if (settings.backendApiKey) headers['X-API-Key'] = settings.backendApiKey;
  // credentials 'omit': backend tidak memakai cookie untuk autentikasi, dan
  // cookie localhost dipakai bersama oleh SEMUA aplikasi di localhost (cookie
  // tidak mengenal nomor port). Ikut mengirimnya cuma membuat header
  // membengkak sampai server membalas HTTP 431.
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit',
  });
  if (!res.ok) throw new Error(`Backend HTTP ${res.status}`);
  return res;
}

/**
 * Kunci varian satu job: jendela tahun, varian request (mis. income-annual),
 * atau tipe mover. Dipakai backend sebagai bagian dari UNIQUE KEY sehingga
 * crawl ulang MEMPERBARUI baris yang sama, bukan menumpuknya.
 */
export function variantKey(job) {
  const m = job.meta || {};
  const parts = [];
  if (m.window && m.window.start) parts.push(`${m.window.start}..${m.window.end}`);
  if (m.variant) parts.push(m.variant);
  else if (m.reportType && m.statementType) parts.push(`${m.reportType}-${m.statementType}`);
  if (m.moverType && m.moverType !== m.variant) parts.push(m.moverType);
  return parts.join('|').slice(0, 96);
}

async function bufferPush(entry) {
  const buf = await getBuffer();
  buf.push({ ...entry, bufferedAt: Date.now() });
  if (buf.length > MAX_BUFFER) buf.splice(0, buf.length - MAX_BUFFER);
  await setBuffer(buf);
}

/** Coba kirim ulang isi buffer. Dipanggil berkala oleh queue runner. */
export async function flushBuffer() {
  const settings = await getSettings();
  if (!settings.relayEnabled) return { sent: 0, left: 0 };
  const buf = await getBuffer();
  if (!buf.length) return { sent: 0, left: 0 };
  let sent = 0;
  while (buf.length) {
    const item = buf[0];
    try {
      await post(settings, item.path, item.body);
      buf.shift();
      sent++;
    } catch (e) {
      break; // backend masih mati — sisanya biar menunggu
    }
  }
  await setBuffer(buf);
  return { sent, left: buf.length };
}

/**
 * Kirim satu hasil job ke backend.
 * job: {relay, endpointId, symbol, url, meta}
 * payload: JSON respons Stockbit
 */
export async function relayResult(job, payload) {
  const settings = await getSettings();
  if (!settings.relayEnabled) return { skipped: true };

  const sends = [];
  const symbol = job.symbol || (job.meta && job.meta.symbol) || null;

  switch (job.relay) {
    case 'symbolMetadata': {
      const root = payload && typeof payload === 'object' ? (payload.data || payload.result || payload) : {};
      const candidates = [root, root.company, root.profile, root.emitten, root.stock].filter(x => x && typeof x === 'object');
      const read = (keys) => { for (const obj of candidates) for (const key of keys) if (typeof obj[key] === 'string' && obj[key].trim()) return obj[key].trim(); return ''; };
      if (symbol) sends.push({ path: '/ingest/symbol-metadata', body: {
        symbol,
        name: read(['company_name', 'companyName', 'name', 'fullname', 'full_name']),
        sector: read(['sector_name', 'sectorName', 'sector', 'industry_name', 'industryName', 'industry']),
      }});
      break;
    }
    case 'bars': {
      const bars = toBars(payload);
      if (bars.length && symbol) {
        sends.push({ path: '/ingest/bars', body: { symbol, source: 'stockbit_collector', bars } });
      }
      break;
    }
    case 'brokerDay': {
      // broker summary satu hari bursa -> tabel broker_summary, sumber data
      // untuk Broker Analysis, fase akumulasi/distribusi, dan PVA di web.
      const { buyers, sellers } = toBrokerRange(payload, job.meta && job.meta.investorType);
      const date = (job.meta && (job.meta.date || (job.meta.window && job.meta.window.start))) || '';
      if (symbol && date && (buyers.length || sellers.length)) {
        sends.push({ path: '/ingest/broker-summary', body: { symbol, date, buyers, sellers } });
      }
      break;
    }
    case 'brokerRange': {
      const { buyers, sellers } = toBrokerRange(payload, job.meta && job.meta.investorType);
      const w = (job.meta && job.meta.window) || {};
      if (symbol && (buyers.length || sellers.length)) {
        sends.push({ path: '/ingest/broker-range', body: { symbol, from: w.start || '', to: w.end || '', buyers, sellers } });
      }
      break;
    }
    case 'keystats': {
      if (symbol) sends.push({ path: '/ingest/keystats', body: toKeyStats(symbol, payload) });
      break;
    }
    case 'financial': {
      const statements = toFinancialStatements(symbol, payload, job.meta);
      if (symbol && statements.length) {
        sends.push({ path: '/ingest/financial-statements', body: { symbol, statements } });
      }
      break;
    }
    case 'marketMovers': {
      const moverType = (job.meta && job.meta.moverType) || '';
      const movers = toMarketMovers(payload, moverType);
      if (movers.length) sends.push({ path: '/ingest/market-movers', body: { moverType, movers } });
      break;
    }
    case 'shareholdingNetwork': {
      const parsed = toShareholdingNetwork(payload, symbol);
      const holdings = parsed.holdings;
      // report_date kerap dikirim kosong. Laporan KSEI bulanan, jadi acuannya
      // akhir bulan LALU — lebih baik daripada membuang seluruh baris.
      const reportDate = parsed.reportDate || lastMonthEnd();
      // reportDate wajib: backend memakainya sebagai bagian kunci utama
      // (satu baris per bulan/emiten/investor) agar perubahan antar bulan
      // bisa dihitung dengan selisih.
      if (reportDate && holdings.length) {
        sends.push({ path: '/ingest/shareholding', body: { reportDate, holdings } });
      }
      break;
    }
    case 'shareholdingComposition': {
      const parsed = toShareholdingComposition(payload, symbol);
      const holdings = parsed.holdings;
      const reportDate = parsed.reportDate || lastMonthEnd();
      if (reportDate && holdings.length) {
        sends.push({ path: '/ingest/shareholding', body: { reportDate, holdings } });
      }
      break;
    }
    case 'trades': {
      const date = (job.meta && job.meta.date) || '';
      const trades = toTrades(payload, symbol, date);
      // dipecah 500/batch — satu hari bursa saham likuid bisa ribuan cetakan
      for (let i = 0; i < trades.length; i += 500) {
        sends.push({ path: '/ingest/trades', body: { symbol, trades: trades.slice(i, i + 500) } });
      }
      break;
    }
    case 'brokers': {
      const brokers = toBrokers(payload);
      if (brokers.length) sends.push({ path: '/ingest/brokers', body: { brokers } });
      break;
    }
    case 'dividends': {
      const dividends = toDividends(payload, symbol);
      if (dividends.length) sends.push({ path: '/ingest/dividends', body: { dividends } });
      break;
    }
    case 'calendarEvents': {
      const events = toCalendarEvents(payload, job.meta && job.meta.date);
      if (events.length) sends.push({ path: '/ingest/calendar-events', body: { events } });
      break;
    }
    case 'insider': {
      const transactions = toInsiderTransactions(payload, symbol);
      if (transactions.length) sends.push({ path: '/ingest/insider-transactions', body: { transactions } });
      break;
    }
    default:
      break;
  }

  // payload mentah: selalu untuk relay 'raw', opsional untuk yang lain
  if (job.relay === 'raw' || settings.relayRaw) {
    sends.push({
      path: settings.rawPath || '/ingest/raw',
      body: {
        source: 'stockbit_collector',
        endpoint: job.endpointId,
        symbol,
        // variant = kunci unik baris di backend bersama (endpoint, symbol).
        // Tanpa ini, tiap jendela tahun akan saling menimpa di tabel raw_ingest.
        variant: variantKey(job),
        url: job.url,
        params: job.meta || {},
        fetchedAt: new Date().toISOString(),
        payload,
      },
    });
  }

  let ok = 0, failed = 0;
  const failureReasons = [];
  for (const s of sends) {
    try {
      await post(settings, s.path, s.body);
      ok++;
    } catch (e) {
      failed++;
      failureReasons.push(String(e && e.message || e));
      await bufferPush(s);
    }
  }
  if (failed) await addLog('warn', `Relay tertunda: ${failed} payload masuk buffer (${[...new Set(failureReasons)].join(', ')})`);
  return { ok, failed, sends: sends.length };
}

/**
 * Kirim hasil klasifikasi emiten (tier + gorengan) ke tabel stock_classification
 * lewat POST /ingest/classification.
 */
export async function relayClassification(classification) {
  const settings = await getSettings();
  if (!settings.relayEnabled) return;
  const path = settings.classificationPath || '/ingest/classification';
  const body = {
    symbol: classification.symbol,
    tier: classification.tier,
    marketCap: classification.marketCap,
    categories: classification.categories,
    gorengan: classification.gorengan,
    classifiedAt: new Date(classification.classifiedAt || Date.now()).toISOString(),
  };
  try {
    await post(settings, path, body);
  } catch (e) {
    await bufferPush({ path, body });
  }
}

/**
 * Terjemahan status HTTP yang gampang disalahartikan sebagai "backend mati".
 * 431 khususnya: backend-nya sehat, header request-nya yang kebesaran.
 */
function hintFor(status) {
  if (status === 431) {
    return 'Backend hidup, tapi menolak header request yang kebesaran. ' +
      'Naikkan ReadBufferSize di fiber.New() (server/cmd/server/main.go), lalu restart backend.';
  }
  if (status === 404) return 'Server menjawab tapi tidak punya route /health — cek Base URL-nya.';
  if (status === 413) return 'Payload ditolak karena terlalu besar — naikkan BodyLimit di fiber.New().';
  return null;
}

/** Uji koneksi backend dari halaman Options / popup. */
export async function testBackend(settings) {
  const base = String(settings.backendUrl || '').replace(/\/+$/, '');
  if (!base) return { ok: false, error: 'Base URL kosong' };
  try {
    const headers = {};
    if (settings.backendApiKey) headers['X-API-Key'] = settings.backendApiKey;
    // Uji endpoint collector yang terlindungi, bukan hanya /health yang publik.
    // Dengan begitu API key kosong/salah langsung terlihat sebelum crawl berjalan.
    const res = await fetch(`${base}/ingest/coverage?symbol=`, { method: 'GET', headers, credentials: 'omit' });
    return { ok: res.ok, status: res.status, hint: res.status === 401 ? 'API Key kosong atau tidak cocok dengan server.' : hintFor(res.status) };
  } catch (e) {
    // /health mungkin tidak ada — coba root
    try {
      const res = await fetch(base, { method: 'GET', credentials: 'omit' });
      return { ok: res.ok, status: res.status, hint: hintFor(res.status) };
    } catch (e2) {
      return { ok: false, error: String(e2.message || e2) };
    }
  }
}
