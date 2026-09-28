/**
 * stockCategorizer.js — logika segmentasi emiten.
 *
 * Empat segmen:
 *   bluechip : market cap > Rp 10 T
 *   second   : Rp 500 M – Rp 10 T
 *   third    : < Rp 500 M
 *   gorengan : DETEKSI PERILAKU, bukan ukuran — sebuah emiten bisa sekaligus
 *              third liner DAN gorengan. Karena itu hasil klasifikasi
 *              mengembalikan `tier` (satu dari tiga) plus flag `gorengan`
 *              terpisah, bukan satu label tunggal.
 *
 * Respons Stockbit bentuknya tidak seragam antar-endpoint (kadang {data:[...]},
 * kadang {data:{items:[...]}}, nama field berubah-ubah). Semua ekstraksi di
 * modul ini karena itu ditulis toleran: cari nilai numerik/simbol dengan
 * beberapa kandidat nama field, dan jangan pernah melempar kalau tidak ketemu.
 */
import { TIER_THRESHOLDS } from './lib/config.js';

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const SYMBOL_RE = /^[A-Z]{3,5}$/;

/** Ambil nilai pertama yang ada dari beberapa kandidat nama field. */
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

/** Telusuri objek apa pun, kumpulkan semua kode emiten yang terlihat. */
export function harvestSymbols(node, out = new Set(), depth = 0) {
  if (!node || depth > 6) return out;
  if (Array.isArray(node)) {
    for (const x of node) harvestSymbols(x, out, depth + 1);
    return out;
  }
  if (typeof node !== 'object') return out;
  const sym = pick(node, ['symbol', 'code', 'ticker', 'stock_code', 'emiten', 'company_symbol']);
  if (typeof sym === 'string' && SYMBOL_RE.test(sym.toUpperCase())) out.add(sym.toUpperCase());
  for (const k of Object.keys(node)) harvestSymbols(node[k], out, depth + 1);
  return out;
}

/** Market cap dari keystats / info emiten. */
export function extractMarketCap(payload) {
  if (!payload) return 0;
  const d = payload.data || payload;
  const direct = pick(d, ['market_cap', 'marketCap', 'marketcap', 'market_capitalization']);
  if (direct !== undefined) {
    const v = typeof direct === 'object' ? pick(direct, ['raw', 'value', 'amount']) : direct;
    const n = num(v);
    if (n > 0) return n;
  }
  // beberapa respons menaruhnya di dalam array rasio {name, value}
  const list = Array.isArray(d) ? d : (Array.isArray(d && d.items) ? d.items : null);
  if (list) {
    for (const it of list) {
      const name = String(pick(it, ['name', 'item_name', 'key']) || '').toLowerCase();
      if (name.includes('market cap') || name === 'market_cap') {
        const n = num(pick(it, ['value', 'raw', 'amount']));
        if (n > 0) return n;
      }
    }
  }
  // fallback: harga x saham beredar
  const price = num(pick(d, ['last_price', 'lastprice', 'close', 'price']));
  const shares = num(pick(d, ['shares_outstanding', 'listed_shares', 'outstanding_shares', 'total_shares']));
  return price > 0 && shares > 0 ? price * shares : 0;
}

/** Tier berdasarkan kapitalisasi pasar. */
export function tierFromMarketCap(mcap, thresholds) {
  const t = { ...TIER_THRESHOLDS, ...(thresholds || {}) };
  if (!mcap || mcap <= 0) return 'unknown';
  if (mcap > t.bluechip) return 'bluechip';
  if (mcap >= t.second) return 'second';
  return 'third';
}

/**
 * Bangun indeks papan pemantauan khusus dari respons /emitten/indexes/special-board.
 * Bentuk respons berubah-ubah, jadi cukup panen semua kode emiten yang muncul
 * di dalamnya — apa pun yang tercantum di sana memang berstatus khusus.
 */
export function buildSpecialBoardIndex(payload) {
  const set = harvestSymbols(payload);
  const detail = {};
  const scan = (node, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) { node.forEach((x) => scan(x, depth + 1)); return; }
    if (typeof node !== 'object') return;
    const sym = pick(node, ['symbol', 'code', 'ticker']);
    if (typeof sym === 'string' && SYMBOL_RE.test(sym.toUpperCase())) {
      detail[sym.toUpperCase()] = {
        notation: pick(node, ['notation', 'notasi', 'special_notation', 'flag']) || null,
        board: pick(node, ['board', 'board_name', 'papan']) || null,
        reason: pick(node, ['reason', 'description', 'note']) || null,
      };
    }
    for (const k of Object.keys(node)) scan(node[k], depth + 1);
  };
  scan(payload);
  return { symbols: [...set], detail };
}

/** Indeks pergerakan ekstrem dari kumpulan respons market-mover. */
export function buildMoverIndex(moverResponses) {
  // moverResponses: [{moverType, payload}]
  const idx = {};
  for (const entry of moverResponses || []) {
    const list = (entry.payload && (entry.payload.data || entry.payload.items)) || [];
    const arr = Array.isArray(list) ? list : (Array.isArray(list.items) ? list.items : []);
    for (const item of arr) {
      const sym = String(pick(item, ['code', 'symbol', 'ticker']) || '').toUpperCase();
      if (!SYMBOL_RE.test(sym)) continue;
      const rec = idx[sym] || (idx[sym] = { symbol: sym, moverTypes: [], changePct: 0, volume: 0, value: 0, netForeign: 0 });
      if (!rec.moverTypes.includes(entry.moverType)) rec.moverTypes.push(entry.moverType);
      rec.changePct = num(pick(item, ['change_percentage', 'change_pct', 'changePct', 'percentage_change'])) || rec.changePct;
      rec.volume = Math.max(rec.volume, num(pick(item, ['volume'])));
      rec.value = Math.max(rec.value, num(pick(item, ['value'])));
      rec.netForeign = num(pick(item, ['net_foreign', 'netForeign'])) || rec.netForeign;
    }
  }
  return idx;
}

/**
 * Ringkas respons /marketdetectors/{symbol} jadi metrik konsentrasi broker.
 * Akumulasi/distribusi ekstrem = beberapa broker menguasai porsi net yang
 * tidak wajar besar terhadap total nilai transaksi.
 */
export function summarizeBrokerFlow(payload) {
  const d = (payload && (payload.data || payload)) || {};
  const rows = [];
  const scan = (node, depth = 0) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) { node.forEach((x) => scan(x, depth + 1)); return; }
    if (typeof node !== 'object') return;
    const code = pick(node, ['broker_code', 'brokercode', 'code', 'broker']);
    const bval = num(pick(node, ['buy_value', 'bval', 'blot_value', 'netbuy_value']));
    const sval = num(pick(node, ['sell_value', 'sval', 'slot_value', 'netsell_value']));
    const net = num(pick(node, ['net_value', 'netvalue', 'net']));
    if (typeof code === 'string' && code.length <= 4 && (bval || sval || net)) {
      rows.push({ code: code.toUpperCase(), bval, sval, net: net || (bval - sval) });
    }
    for (const k of Object.keys(node)) scan(node[k], depth + 1);
  };
  scan(d);
  if (!rows.length) return null;

  const totVal = rows.reduce((a, r) => a + Math.abs(r.bval) + Math.abs(r.sval), 0) || 1;
  const sorted = [...rows].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const top3Net = sorted.slice(0, 3).reduce((a, r) => a + Math.abs(r.net), 0);
  return {
    brokers: rows.length,
    totalValue: totVal,
    top3Concentration: top3Net / totVal,     // 0..1
    topNet: sorted[0] ? sorted[0].net : 0,
    topCode: sorted[0] ? sorted[0].code : null,
  };
}

/**
 * Deteksi "saham gorengan" — skor 0..100 dengan alasan yang bisa dibaca manusia.
 * Sinyal (sesuai spesifikasi):
 *   1. tercantum di papan pemantauan khusus / UMA / suspend  -> sinyal terkuat
 *   2. lonjakan volume / masuk market mover ekstrem
 *   3. akumulasi/distribusi broker yang sangat terkonsentrasi
 *   4. volatilitas harga harian ekstrem (dari candle, bila tersedia)
 */
export function detectGorengan(symbol, ctx = {}) {
  const reasons = [];
  let score = 0;

  const special = ctx.specialBoard || {};
  if (special.detail && special.detail[symbol]) {
    score += 45;
    const d = special.detail[symbol];
    reasons.push(`Papan Pemantauan Khusus${d.notation ? ` (${d.notation})` : ''}`);
  } else if (Array.isArray(special.symbols) && special.symbols.includes(symbol)) {
    score += 45;
    reasons.push('Papan Pemantauan Khusus');
  }

  const mover = (ctx.movers || {})[symbol];
  if (mover) {
    const extremeTypes = mover.moverTypes.filter((t) => /GAINER|LOSER|VOLUME/.test(t));
    if (extremeTypes.length) {
      score += 12 * Math.min(extremeTypes.length, 2);
      reasons.push(`Market mover: ${extremeTypes.map((t) => t.replace('MOVER_TYPE_', '')).join(', ')}`);
    }
    if (Math.abs(mover.changePct) >= 15) {
      score += 15;
      reasons.push(`Perubahan harga ekstrem ${mover.changePct.toFixed(1)}%`);
    }
  }

  const flow = ctx.brokerFlow;
  if (flow && flow.top3Concentration >= 0.55) {
    score += 20;
    reasons.push(`Konsentrasi broker ekstrem (${Math.round(flow.top3Concentration * 100)}% oleh 3 broker)`);
  }

  const stats = ctx.priceStats;
  if (stats) {
    if (stats.avgRangePct >= 8) {
      score += 15;
      reasons.push(`Rata-rata rentang harian ${stats.avgRangePct.toFixed(1)}%`);
    }
    if (stats.volumeSpike >= 4) {
      score += 12;
      reasons.push(`Lonjakan volume ${stats.volumeSpike.toFixed(1)}x rata-rata`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { is: score >= 40, score, reasons };
}

/** Statistik volatilitas ringkas dari candle harian (dipakai detectGorengan). */
export function priceStatsFromBars(bars, lookback = 60) {
  if (!Array.isArray(bars) || bars.length < 5) return null;
  const slice = bars.slice(-lookback);
  let rangeSum = 0, volSum = 0;
  for (const b of slice) {
    const c = num(b.close ?? b.c);
    const h = num(b.high ?? b.h);
    const l = num(b.low ?? b.l);
    if (c > 0) rangeSum += ((h - l) / c) * 100;
    volSum += num(b.volume ?? b.v);
  }
  const avgVol = volSum / slice.length || 1;
  const lastVol = num(slice[slice.length - 1].volume ?? slice[slice.length - 1].v);
  return {
    avgRangePct: rangeSum / slice.length,
    volumeSpike: lastVol / avgVol,
    bars: slice.length,
  };
}

/**
 * Klasifikasi lengkap satu emiten.
 * ctx: { marketCap, specialBoard, movers, brokerFlow, priceStats, thresholds }
 */
export function classify(symbol, ctx = {}) {
  const sym = String(symbol || '').toUpperCase();
  const marketCap = num(ctx.marketCap);
  const tier = tierFromMarketCap(marketCap, ctx.thresholds);
  const goreng = detectGorengan(sym, ctx);
  const categories = [];
  if (tier !== 'unknown') categories.push(tier);
  if (goreng.is) categories.push('gorengan');
  return {
    symbol: sym,
    tier,
    marketCap,
    gorengan: goreng,
    categories,
    classifiedAt: Date.now(),
  };
}

/**
 * Apakah emiten ini masuk kategori yang dipilih user?
 * Emiten yang market cap-nya belum ketahuan (tier 'unknown') tetap diloloskan
 * supaya data profilnya sempat ditarik — kalau langsung dibuang, emiten yang
 * endpoint keystats-nya gagal sekali akan hilang selamanya dari crawl.
 */
export function matchesSelection(classification, selected) {
  if (!selected || !selected.length) return true;
  if (!classification) return true;
  if (classification.tier === 'unknown' && !classification.gorengan.is) return true;
  return classification.categories.some((c) => selected.includes(c));
}
