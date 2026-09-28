/**
 * apiClient.js — pembungkus terstruktur SELURUH endpoint Stockbit yang dipakai
 * collector, plus katalog endpoint yang dibaca Queue Runner.
 *
 * Dua wajah dari modul yang sama:
 *
 *  1. `StockbitApi` — kelas dengan method per endpoint (`api.emittenInfo('BBCA')`).
 *     Enak dipakai manual / dari halaman Options untuk uji satu endpoint.
 *
 *  2. `ENDPOINTS` — katalog deklaratif yang dipakai lib/planner.js untuk
 *     membangun antrean crawling otomatis. Satu sumber kebenaran: method kelas
 *     dan katalog memakai builder URL yang sama, jadi tidak mungkin melenceng.
 *
 * Modul ini TIDAK melakukan fetch sendiri. Semua request dikirim lewat
 * `transport` (lihat lib/queue.js) yang mengeksekusinya di dalam tab Stockbit
 * pada MAIN world, sehingga header, cookie, TLS fingerprint, dan Referer
 * identik dengan request asli halaman.
 */

import { resolveDepth } from './lib/depth.js';

export const EXODUS = 'https://exodus.stockbit.com';
export const WEB = 'https://stockbit.com';

/**
 * Nilai enum/param yang dipakai Stockbit. Beberapa di antaranya berubah
 * sewaktu-waktu; semuanya dikumpulkan di sini supaya kalau Stockbit mengganti
 * nama enum, cukup satu blok ini yang disunting (bisa juga di-override lewat
 * halaman Options).
 */
/**
 * Fundachart hanya menerima periode berbentuk `Ny` (tahun), tidak bisa rentang
 * tanggal. Angkanya diambil dari tabel `depth` kelompok `default` supaya tidak
 * ada lagi setelan kedalaman yang berdiri sendiri di luar lib/depth.js.
 */
function fundachartYears(settings = {}) {
  const { from, to } = resolveDepth('default', settings);
  const years = (new Date(to) - new Date(from)) / (365.25 * 24 * 3600 * 1000);
  return Math.max(1, Math.round(years));
}

export const PARAMS = {
  // TERVERIFIKASI dari app.js yang sudah lama jalan di produksi: Exodus memakai
  // enum ber-prefix, BUKAN nilai pendek seperti "all_investor"/"all_market".
  // Nilai pendek dibalas 400 INVALID_PARAMETER.
  investorType: {
    all: 'INVESTOR_TYPE_ALL',
    foreign: 'INVESTOR_TYPE_FOREIGN',
    domestic: 'INVESTOR_TYPE_DOMESTIC',
  },
  marketBoard: {
    // hanya REGULER yang terbukti diterima; sisanya menyusul kalau template
    // dari halaman membuktikan namanya (lihat lib/templates.js)
    reguler: 'MARKET_BOARD_REGULER',
    all: 'MARKET_BOARD_ALL',
    nego: 'MARKET_BOARD_NEGO',
    tunai: 'MARKET_BOARD_TUNAI',
  },
  transactionType: 'TRANSACTION_TYPE_GROSS',
  // keystats hanya menerima 0, 3, atau 10 — angka lain ditolak
  keystatsYearLimit: 10,
  // chartbit: JUMLAH baris maksimum per respons ±250, jadi histori panjang
  // harus dipecah per jendela ~220 hari kalender (±150 hari bursa)
  chartWindowDays: 220,
  moverTypes: [
    'MOVER_TYPE_TOP_GAINER',
    'MOVER_TYPE_TOP_LOSER',
    'MOVER_TYPE_TOP_VALUE',
    'MOVER_TYPE_TOP_VOLUME',
    'MOVER_TYPE_NET_FOREIGN_BUY',
    'MOVER_TYPE_NET_FOREIGN_SELL',
  ],
  filterStocks: [
    'FILTER_STOCKS_TYPE_MAIN_BOARD',
    'FILTER_STOCKS_TYPE_DEVELOPMENT_BOARD',
    'FILTER_STOCKS_TYPE_ACCELERATION_BOARD',
    'FILTER_STOCKS_TYPE_NEW_ECONOMY_BOARD',
  ],
  // Laporan keuangan findata-view: report_type x statement_type
  financialReportTypes: [
    { code: 1, key: 'income' },
    { code: 2, key: 'balance' },
    { code: 3, key: 'cashflow' },
  ],
  financialStatementTypes: [
    { code: 1, key: 'quarterly' },
    { code: 2, key: 'annual' },
  ],
  historicalPeriod: 'HS_PERIOD_DAILY',
  // limit historical/summary: 250 ditolak Exodus, 12 terbukti diterima.
  historicalSummaryLimit: 12,
  chartTimeframeByYears: { 1: '1y', 2: '2y', 3: '3y', 5: '5y' },
};

/** Susun query string, buang nilai null/undefined/''. */
export function qs(params) {
  if (!params) return '';
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

const u = (path, params) => `${EXODUS}${path}${qs(params)}`;

/** Semua URL Stockbit dibangun di sini — dipakai kelas maupun katalog. */
export const URLS = {
  // 1. Stream / feed & data pasar umum
  trending: () => u('/emitten/trending'),
  discoveryTrending: () => u('/user/v2/discovery/trending'),
  ihsgMarket: () => u('/company-price-feed/prices/IHSG/market'),
  ihsgDaily: () => u('/charts/IHSG/daily'),
  specialBoard: () => u('/emitten/indexes/special-board'),

  // 2. Search & referensi
  search: (keyword, page = 1, type = 'all') => u('/search', { keyword, page, type }),
  brokers: (page = 1, limit = 150, group = 'GROUP_UNSPECIFIED') =>
    u('/findata-view/marketdetectors/brokers', { page, limit, group }),

  // 3. Detail saham, harga & fundamental
  emittenInfo: (s) => u(`/emitten/${s}/info`),
  emittenProfile: (s) => u(`/emitten/${s}/profile`),
  emittenContact: (s) => u(`/emitten/${s}/contact`),
  chartsDaily: (s, timeframe) => u(`/charts/${s}/daily`, { timeframe }),
  // Endpoint candle harian yang TERBUKTI jalan (dipakai app.js sejak lama).
  // PERHATIAN semantik terbalik: `from` = tanggal TERBARU, `to` = tanggal
  // TERLAMA. limit=0 berarti tanpa batas baris.
  chartbitDaily: (s, newestIso, oldestIso) => u(`/chartbit/${s}/price/daily`, {
    from: newestIso, to: oldestIso, limit: 0,
  }),
  marketSession: () => u('/company-price-feed/market-time/session'),
  // PERHATIAN limit: 250 dibalas 400 INVALID_PARAMETER. Payload yang terbukti
  // jalan memakai limit=12, jadi itu yang dipakai dan halamannya di-paginasi
  // lewat `page` (lihat paginate:'historicalSummary' di lib/queue.js).
  historicalSummary: (s, o = {}) => u(`/company-price-feed/historical/summary/${s}`, {
    period: o.period || PARAMS.historicalPeriod,
    start_date: o.startDate,
    end_date: o.endDate,
    limit: o.limit || PARAMS.historicalSummaryLimit,
    page: o.page || 1,
  }),
  pricePerformance: (s) => u(`/company-price-feed/price-performance/${s}`),
  keystats: (s, yearLimit) => u(`/keystats/ratio/v1/${s}`, {
    year_limit: [0, 3, 10].includes(Number(yearLimit)) ? Number(yearLimit) : PARAMS.keystatsYearLimit,
  }),
  research: (s) => u(`/research/company/${s}`),
  analystRatings: (s) => u(`/analyst-ratings/${s}`),
  analystConsensus: (s) => u(`/analyst-ratings/${s}/consensus`),
  financial: (s, dataType, reportType, statementType) => u('/findata-view/company/financial', {
    symbol: s, data_type: dataType, report_type: reportType, statement_type: statementType,
  }),
  fundachartTemplates: () => u('/fundachart/templates'),
  fundachart: (item, companies, timeframe) => u('/fundachart', { item, companies, timeframe }),
  nextData: (buildId, symbol, tab, param) =>
    `${WEB}/_next/data/${buildId}/symbol/${symbol}/${tab}.json${qs({ symbol, param })}`,

  // 4. Insider, kepemilikan & aksi korporasi
  majorHolder: (o = {}) => u('/insider/company/majorholder', {
    date_start: o.dateStart, date_end: o.dateEnd, page: o.page || 1, limit: o.limit || 100, symbol: o.symbol,
  }),
  shareholdingComposition: (s, periodStart, periodEnd) =>
    u(`/insider/shareholding/composition/companies/${s}`, { period_start: periodStart, period_end: periodEnd }),
  // Graf kepemilikan KSEI: nodes (emiten & investor) + edges (kepemilikan,
  // lengkap pecahan scrip/scripless). Di-key BUKAN oleh simbol melainkan
  // company_id/investor_id, jadi butuh pemetaan simbol -> company_id lebih dulu
  // (lihat absorb() di lib/queue.js).
  shareholdingNetwork: (rootId, rootType = 'COMPANY', maxDepth = 2, maxEdgePerNode = 20) =>
    u('/insider/shareholding/network', {
      root_id: rootId,
      root_type: `SHAREHOLDING_NETWORK_NODE_TYPE_${rootType}`,
      max_depth: maxDepth,
      max_edge_per_node: maxEdgePerNode,
    }),
  shareholdersToken: () => u('/emitten-metadata/shareholders/token'),
  shareholdersChart: (s) => u(`/emitten-metadata/shareholders/${s}/chart`),
  corpaction: (s, limit = 100) => u(`/corpaction/${s}`, { limit }),
  // Dividen tunai — endpoint TERPISAH dari /corpaction/{symbol} di atas
  // (yang berisi aksi korporasi umum). Riwayatnya dikembalikan sekaligus,
  // jadi tidak perlu dijendelakan per tahun.
  dividends: (s) => u('/corpaction/dividend', { symbol: s }),

  corpactionConversion: (s, page = 1, limit = 100) =>
    u(`/corpaction/${s}/stock_conversion`, { page, limit }),

  // 5. Bandarmologi, broker flow & order trade
  // Pola TERVERIFIKASI (app.js brokerRangeUrl): limit=0 = seluruh broker,
  // enum ber-prefix, rentang lewat from/to.
  marketDetectors: (s, o = {}) => u(`/marketdetectors/${s}`, {
    transaction_type: o.transactionType || PARAMS.transactionType,
    market_board: o.marketBoard || PARAMS.marketBoard.reguler,
    investor_type: o.investorType || PARAMS.investorType.all,
    limit: o.limit === undefined ? 0 : o.limit,
    period: o.period,
    from: o.from,
    to: o.to,
  }),
  runningTradeChart: (s, o = {}) => u(`/order-trade/running-trade/chart/${s}`, {
    period: o.period, investor_type: o.investorType, market_board: o.marketBoard,
  }),
  // Running trade satu emiten. Pola TERVERIFIKASI dari app.js: `symbols[]`,
  // urut waktu naik, dan paginasi lewat CURSOR `trade_number` — parameter
  // `page` TIDAK berfungsi (mengembalikan batch yang sama berulang).
  runningTradeSymbol: (s, o = {}) => u('/order-trade/running-trade', {
    'symbols[]': s,
    sort: o.sort || 'ASC',
    order_by: o.orderBy || 'RUNNING_TRADE_ORDER_BY_TIME',
    limit: o.limit || 1000,
    date: o.date,
    trade_number: o.cursor,
  }),
  runningTradeGroup: (s, o = {}) => u('/order-trade/running-trade/group', {
    'symbols[]': s,
    sort: o.sort || 'ASC',
    order_by: o.orderBy || 'RUNNING_TRADE_ORDER_BY_TIME',
    limit: o.limit || 1000,
    date: o.date,
    trade_number: o.cursor,
  }),
  // TERVERIFIKASI (app.js): simbol dikirim sebagai array `symbols[]`, bukan `symbol`.
  runningTrade: (o = {}) => u('/order-trade/running-trade', {
    'symbols[]': o.symbol,
    sort: o.sort || 'DESC', limit: o.limit || 80,
    order_by: o.orderBy || 'RUNNING_TRADE_ORDER_BY_TIME',
    date: o.date,
  }),
  brokerDistribution: (o = {}) => u('/order-trade/broker/distribution', {
    date: o.date, symbol: o.symbol, investor_type: o.investorType,
    market_board: o.marketBoard, data_type: o.dataType, period: o.period,
  }),
  tradeBookChart: (o = {}) => u('/order-trade/trade-book/chart', {
    symbol: o.symbol, time_interval: o.timeInterval || '1m', date: o.date,
  }),
  marketMover: (moverType, filterStocks) =>
    u('/order-trade/market-mover', { mover_type: moverType, filter_stocks: filterStocks || PARAMS.filterStocks }),
  brokerTop: (o = {}) => u('/order-trade/broker/top', {
    sort: o.sort || 'DESC', order: o.order, period: o.period,
    market_type: o.marketType, eod_only: o.eodOnly,
  }),
  brokerActivity: (o = {}) => u('/order-trade/broker/activity', {
    broker_code: o.brokerCode, transaction_type: o.transactionType,
    investor_type: o.investorType, limit: o.limit || 100,
    market_board: o.marketBoard, page: o.page || 1,
    period: o.period, net_val_period: o.netValPeriod,
  }),
  brokerActivityChart: (o = {}) => u('/order-trade/broker/activity-chart', {
    period: o.period, brokers_code: o.brokersCode, investor_type: o.investorType,
    market_board: o.marketBoard, symbols: o.symbols,
  }),
  brokerActivityHistorical: (o = {}) => u('/order-trade/broker/activity/historical', {
    interval: o.interval || 'daily',
    date_from: o.dateFrom, date_to: o.dateTo,
    broker_codes: o.brokerCodes, symbols: o.symbols,
    market_board: o.marketBoard, investor_type: o.investorType,
    net_interval: o.netInterval, period: o.period,
    'pagination.page': o.page || 1,
    'pagination.limit': o.limit || 100,
  }),

  // 6. Realtime / orderbook handshake
  orderbook: (s) => u(`/orderbook/companies/${s}`),
  websocketKey: () => u('/auth/websocket/key'),

  // 7. Screener & paywall
  screenerTemplate: (id, type) => u(`/screener/templates/${id}`, { type }),
  paywallCheck: (features, company) => u('/paywall/eligibility/check', { features, company }),
  paywallIncrement: () => u('/paywall/counter/increment'),
};

/**
 * Wrapper API. `transport` menerima {method, url, body} dan mengembalikan
 * {ok, status, json, text, error}.
 */
export class StockbitApi {
  constructor(transport) {
    this.transport = transport;
  }

  request(method, url, body) {
    return this.transport({ method, url, body });
  }

  get(url) { return this.request('GET', url); }
  post(url, body) { return this.request('POST', url, body); }

  // ---- 1. stream / market umum ----
  trending() { return this.get(URLS.trending()); }
  discoveryTrending() { return this.get(URLS.discoveryTrending()); }
  ihsgMarket() { return this.get(URLS.ihsgMarket()); }
  ihsgDaily() { return this.get(URLS.ihsgDaily()); }
  specialBoard() { return this.get(URLS.specialBoard()); }

  // ---- 2. search & referensi ----
  search(keyword, page, type) { return this.get(URLS.search(keyword, page, type)); }
  brokers(page, limit, group) { return this.get(URLS.brokers(page, limit, group)); }

  // ---- 3. detail saham ----
  emittenInfo(s) { return this.get(URLS.emittenInfo(s)); }
  emittenProfile(s) { return this.get(URLS.emittenProfile(s)); }
  emittenContact(s) { return this.get(URLS.emittenContact(s)); }
  chartsDaily(s, timeframe) { return this.get(URLS.chartsDaily(s, timeframe)); }
  marketSession() { return this.get(URLS.marketSession()); }
  historicalSummary(s, o) { return this.get(URLS.historicalSummary(s, o)); }
  pricePerformance(s) { return this.get(URLS.pricePerformance(s)); }
  keystats(s, yearLimit) { return this.get(URLS.keystats(s, yearLimit)); }
  research(s) { return this.get(URLS.research(s)); }
  analystRatings(s) { return this.get(URLS.analystRatings(s)); }
  analystConsensus(s) { return this.get(URLS.analystConsensus(s)); }
  financial(s, dataType, reportType, statementType) {
    return this.get(URLS.financial(s, dataType, reportType, statementType));
  }
  fundachartTemplates() { return this.get(URLS.fundachartTemplates()); }
  fundachart(item, companies, timeframe) { return this.get(URLS.fundachart(item, companies, timeframe)); }
  nextData(buildId, symbol, tab, param) { return this.get(URLS.nextData(buildId, symbol, tab, param)); }

  // ---- 4. insider & aksi korporasi ----
  majorHolder(o) { return this.get(URLS.majorHolder(o)); }
  shareholdingComposition(s, start, end) { return this.get(URLS.shareholdingComposition(s, start, end)); }
  shareholdingNetwork(rootId, rootType, maxDepth, maxEdge) {
    return this.get(URLS.shareholdingNetwork(rootId, rootType, maxDepth, maxEdge));
  }
  shareholdersToken() { return this.post(URLS.shareholdersToken(), {}); }
  shareholdersChart(s) { return this.get(URLS.shareholdersChart(s)); }
  corpaction(s, limit) { return this.get(URLS.corpaction(s, limit)); }
  dividends(s) { return this.get(URLS.dividends(s)); }
  corpactionConversion(s, page, limit) { return this.get(URLS.corpactionConversion(s, page, limit)); }

  // ---- 5. bandarmologi ----
  marketDetectors(s, o) { return this.get(URLS.marketDetectors(s, o)); }
  runningTradeChart(s, o) { return this.get(URLS.runningTradeChart(s, o)); }
  runningTrade(o) { return this.get(URLS.runningTrade(o)); }
  brokerDistribution(o) { return this.get(URLS.brokerDistribution(o)); }
  tradeBookChart(o) { return this.get(URLS.tradeBookChart(o)); }
  marketMover(moverType, filterStocks) { return this.get(URLS.marketMover(moverType, filterStocks)); }
  brokerTop(o) { return this.get(URLS.brokerTop(o)); }
  brokerActivity(o) { return this.get(URLS.brokerActivity(o)); }
  brokerActivityChart(o) { return this.get(URLS.brokerActivityChart(o)); }
  brokerActivityHistorical(o) { return this.get(URLS.brokerActivityHistorical(o)); }

  // ---- 6. realtime ----
  orderbook(s) { return this.get(URLS.orderbook(s)); }
  websocketKey() { return this.get(URLS.websocketKey()); }

  // ---- 7. screener & paywall ----
  screenerTemplate(id, type) { return this.get(URLS.screenerTemplate(id, type)); }
  paywallCheck(features, company) { return this.get(URLS.paywallCheck(features, company)); }
  paywallIncrement(body) { return this.post(URLS.paywallIncrement(), body || {}); }
}

/**
 * ---------------------------------------------------------------------------
 * KATALOG ENDPOINT untuk Queue Runner
 * ---------------------------------------------------------------------------
 * pass     : TAHAP eksekusi. Seluruh emiten diselesaikan pada tahap 1 dulu,
 *            baru pindah ke tahap 2, lalu 3. Tanpa ini, endpoint berat milik
 *            emiten PERTAMA (running trade: ribuan request) jalan sebelum data
 *            ringan emiten ke-900 tersentuh — untuk universe 900 emiten itu
 *            berarti berhari-hari sebelum datanya berguna.
 *              1 = ringan & menengah (bawaan)
 *              2 = broker summary harian
 *              3 = running trade (paling berat, berpaginasi)
 * scope    : 'global' (sekali per run) | 'symbol' (per emiten)
 * phase    : 'discovery' (dipakai untuk klasifikasi, dijalankan paling awal)
 *            | 'profile' (identitas + market cap, penentu tier)
 *            | 'deep' (histori panjang)
 * perYear  : true -> job dipecah per jendela 1 tahun sebanyak setting `years`
 * variants : fungsi -> array varian (mis. 6 mover type, 6 kombinasi laporan)
 * relay    : kunci transform di lib/relay.js ('raw' = kirim mentah)
 * heavy    : true -> hanya dijalankan untuk emiten yang lolos filter kategori
 */
export const ENDPOINTS = [
  // ============ GLOBAL / DISCOVERY ============
  {
    id: 'special_board', label: 'Papan Pemantauan Khusus', group: 'Discovery',
    scope: 'global', phase: 'discovery', defaultOn: true, relay: 'raw',
    build: () => ({ method: 'GET', url: URLS.specialBoard() }),
  },
  {
    id: 'market_mover', label: 'Market Mover (7 tipe)', group: 'Discovery',
    scope: 'global', phase: 'discovery', defaultOn: true, relay: 'marketMovers',
    variants: () => PARAMS.moverTypes.map((mt) => ({ key: mt, moverType: mt })),
    build: (ctx, v) => ({
      method: 'GET',
      url: URLS.marketMover(v.moverType),
      meta: { moverType: v.moverType },
    }),
  },
  {
    id: 'trending', label: 'Emiten Trending', group: 'Discovery',
    scope: 'global', phase: 'discovery', defaultOn: true, relay: 'raw',
    build: () => ({ method: 'GET', url: URLS.trending() }),
  },
  {
    id: 'discovery_trending', label: 'Discovery Trending (v2)', group: 'Discovery',
    scope: 'global', phase: 'discovery', defaultOn: true, relay: 'raw',
    build: () => ({ method: 'GET', url: URLS.discoveryTrending() }),
  },
  {
    id: 'running_trade_global', label: 'Running Trade (pasar)', group: 'Discovery',
    scope: 'global', phase: 'discovery', defaultOn: true, relay: 'raw',
    build: () => ({ method: 'GET', url: URLS.runningTrade({ limit: 80 }) }),
  },
  // ============ GLOBAL / DISCOVERY ============
  {
    id: 'market_session', label: 'Sesi Perdagangan', group: 'Referensi',
    scope: 'global', phase: 'discovery', defaultOn: true, relay: 'raw',
    build: () => ({ method: 'GET', url: URLS.marketSession() }),
  },
  {
    // Ditolak tanpa parameter `Boards` (minimal 1 item) dan nama enumnya belum
    // terverifikasi — dimatikan sampai template asli halaman terpelajari.
    id: 'ihsg_market', label: 'IHSG — Market Feed', group: 'Referensi',
    scope: 'global', phase: 'discovery', defaultOn: false, relay: 'raw',
    needsTemplate: true, match: /^https:\/\/exodus\.stockbit\.com\/company-price-feed\/prices\/[A-Z0-9]+\/market(?:[?#]|$)/,
    build: () => ({ method: 'GET', url: URLS.ihsgMarket() }),
  },
  {
    // Memakai endpoint chartbit yang terbukti, bukan /charts/{s}/daily
    // (yang dibalas "Invalid parameter").
    depthKey: 'chart', id: 'ihsg_daily', label: 'IHSG — Candle Harian', group: 'Referensi',
    scope: 'global', phase: 'discovery', defaultOn: true, relay: 'bars',
    windowDays: PARAMS.chartWindowDays,
    match: /^https:\/\/exodus\.stockbit\.com\/chartbit\/[A-Z0-9-]+\/price\/daily(?:[?#]|$)/,
    build: (ctx) => ({
      method: 'GET',
      url: URLS.chartbitDaily('IHSG', ctx.window.end, ctx.window.start),
      meta: { symbol: 'IHSG', window: ctx.window },
    }),
  },
  {
    // Master broker resmi -> tabel `brokers`, menggantikan daftar hardcoded
    // sebagai sumber nama & golongan Asing/Lokal di backend dan frontend.
    id: 'brokers', label: 'Daftar Broker (master)', group: 'Referensi',
    scope: 'global', phase: 'discovery', defaultOn: true, relay: 'brokers',
    build: () => ({ method: 'GET', url: URLS.brokers(1, 150, 'GROUP_UNSPECIFIED') }),
  },
  {
    // Kombinasi parameternya belum terverifikasi (dibalas "Your request is
    // invalid") — menunggu template dari halaman Broker Analysis.
    id: 'broker_top', label: 'Top Broker', group: 'Referensi',
    scope: 'global', phase: 'discovery', defaultOn: false, relay: 'raw',
    needsTemplate: true, match: /^https:\/\/exodus\.stockbit\.com\/order-trade\/broker\/top(?:[?#]|$)/,
    build: (ctx) => ({ method: 'GET', url: URLS.brokerTop({ period: ctx.settings.brokerTopPeriod || '1d', marketType: ctx.settings.marketBoard }) }),
  },
  {
    id: 'fundachart_templates', label: 'Fundachart — Templates', group: 'Referensi',
    scope: 'global', phase: 'discovery', defaultOn: false, relay: 'raw',
    build: () => ({ method: 'GET', url: URLS.fundachartTemplates() }),
  },
  {
    id: 'screener_template', label: 'Screener Template', group: 'Referensi',
    scope: 'global', phase: 'discovery', defaultOn: false, relay: 'raw',
    enabledIf: (ctx) => !!ctx.settings.screenerTemplateId,
    build: (ctx) => ({ method: 'GET', url: URLS.screenerTemplate(ctx.settings.screenerTemplateId, ctx.settings.screenerType || '') }),
  },
  {
    id: 'websocket_key', label: 'Handshake WebSocket Key', group: 'Referensi',
    scope: 'global', phase: 'discovery', defaultOn: false, relay: 'raw',
    build: () => ({ method: 'GET', url: URLS.websocketKey() }),
  },

  // ============ PER EMITEN / PROFIL (penentu kategori) ============
  // Sengaja hanya SATU endpoint di fase ini. Fase profil dijalankan untuk
  // SETIAP emiten di universe (termasuk yang nanti dilewati), jadi tiap job
  // tambahan di sini berarti ~900 request ekstra sebelum penyaringan kategori
  // sempat bekerja. keystats sudah cukup: dari sana market cap-nya terbaca.
  {
    id: 'keystats', label: 'KeyStats & Rasio (market cap)', group: 'Profil',
    scope: 'symbol', phase: 'profile', defaultOn: true, relay: 'keystats',
    match: /^https:\/\/exodus\.stockbit\.com\/keystats\/ratio\/v1\/[A-Z0-9]+(?:[?#]|$)/,
    build: (ctx) => ({ method: 'GET', url: URLS.keystats(ctx.symbol, PARAMS.keystatsYearLimit) }),
  },

  // ============ PER EMITEN / DEEP ============
  {
    id: 'info', order: 10, label: 'Info Emiten', group: 'Profil',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'symbolMetadata',
    build: (ctx) => ({ method: 'GET', url: URLS.emittenInfo(ctx.symbol) }),
  },
  {
    id: 'price_performance', order: 11, label: 'Price Performance', group: 'Profil',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'symbolMetadata',
    build: (ctx) => ({ method: 'GET', url: URLS.pricePerformance(ctx.symbol) }),
  },
  {
    id: 'profile', order: 12, label: 'Profil Perusahaan', group: 'Fundamental',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'raw',
    build: (ctx) => ({ method: 'GET', url: URLS.emittenProfile(ctx.symbol) }),
  },
  {
    id: 'contact', order: 13, label: 'Kontak Perusahaan', group: 'Fundamental',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    build: (ctx) => ({ method: 'GET', url: URLS.emittenContact(ctx.symbol) }),
  },
  {
    // Endpoint /charts/{s}/daily dibalas "Invalid parameter"; yang terbukti
    // jalan adalah /chartbit/{s}/price/daily dengan jendela ~220 hari
    // (responsnya dibatasi ±250 baris, jadi 5 tahun harus dipecah).
    depthKey: 'chart', id: 'charts_daily', order: 15, label: 'Candle Harian (jendela 220 hari)', group: 'Harga',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'bars',
    windowDays: PARAMS.chartWindowDays,
    match: /^https:\/\/exodus\.stockbit\.com\/chartbit\/[A-Z0-9-]+\/price\/daily(?:[?#]|$)/,
    build: (ctx) => ({
      method: 'GET',
      url: URLS.chartbitDaily(ctx.symbol, ctx.window.end, ctx.window.start),
      meta: { symbol: ctx.symbol, window: ctx.window },
    }),
  },
  {
    // Enum period TERVERIFIKASI: HS_PERIOD_DAILY / _WEEKLY / _MONTHLY.
    // TANPA `match`: ketiga varian memakai path yang sama, jadi satu template
    // akan menimpa ketiganya menjadi periode yang sama.
    paginate: 'historicalSummary', depthKey: 'historical', id: 'historical_summary_daily', order: 70, label: 'Ringkasan Historis Harian', group: 'Harga',
    scope: 'symbol', phase: 'deep', defaultOn: true, perYear: true, relay: 'raw',
    build: (ctx) => ({
      method: 'GET',
      url: URLS.historicalSummary(ctx.symbol, {
        period: 'HS_PERIOD_DAILY',
        startDate: ctx.window.start, endDate: ctx.window.end, page: 1,
      }),
      meta: { symbol: ctx.symbol, period: 'HS_PERIOD_DAILY', window: ctx.window },
    }),
  },
  {
    paginate: 'historicalSummary', depthKey: 'historical', id: 'historical_summary_weekly', order: 71, label: 'Ringkasan Historis Mingguan', group: 'Harga',
    scope: 'symbol', phase: 'deep', defaultOn: true, perYear: true, relay: 'raw',
    build: (ctx) => ({
      method: 'GET',
      url: URLS.historicalSummary(ctx.symbol, {
        period: 'HS_PERIOD_WEEKLY',
        startDate: ctx.window.start, endDate: ctx.window.end, page: 1,
      }),
      meta: { symbol: ctx.symbol, period: 'HS_PERIOD_WEEKLY', window: ctx.window },
    }),
  },
  {
    paginate: 'historicalSummary', depthKey: 'historical', id: 'historical_summary_monthly', order: 72, label: 'Ringkasan Historis Bulanan', group: 'Harga',
    scope: 'symbol', phase: 'deep', defaultOn: true, perYear: true, relay: 'raw',
    build: (ctx) => ({
      method: 'GET',
      url: URLS.historicalSummary(ctx.symbol, {
        period: 'HS_PERIOD_MONTHLY',
        startDate: ctx.window.start, endDate: ctx.window.end, page: 1,
      }),
      meta: { symbol: ctx.symbol, period: 'HS_PERIOD_MONTHLY', window: ctx.window },
    }),
  },
  {
    // Ditarik SEKALI PER investor_type. Inilah cara membuktikan kasus SSIA/YU:
    // YU broker asing, tapi kalau barisnya muncul di respons
    // INVESTOR_TYPE_DOMESTIC berarti yang bertransaksi lewat dia investor
    // LOKAL. Jauh lebih tegas daripada mengandalkan field `type` per baris.
    depthKey: 'broker', id: 'marketdetectors', order: 80, label: 'Bandarmologi / Broker Summary (per tahun x investor type)',
    group: 'Bandarmologi',
    scope: 'symbol', phase: 'deep', defaultOn: true, perYear: true, relay: 'brokerRange',
    variants: (ctx) => (ctx.settings.brokerInvestorTypes || [
      'INVESTOR_TYPE_ALL', 'INVESTOR_TYPE_FOREIGN', 'INVESTOR_TYPE_DOMESTIC',
    ]).map((it) => ({ key: it, investorType: it })),
    build: (ctx, v) => ({
      method: 'GET',
      url: URLS.marketDetectors(ctx.symbol, {
        transactionType: ctx.settings.transactionType || PARAMS.transactionType,
        marketBoard: ctx.settings.marketBoard,
        investorType: v.investorType,
        limit: 0,
        from: ctx.window.start, to: ctx.window.end,
      }),
      // investorType di meta = yang DIMINTA, bukan hasil tebakan dari respons
      meta: { symbol: ctx.symbol, window: ctx.window, investorType: v.investorType },
    }),
  },
  {
    // Broker summary PER HARI BURSA — inilah yang dibaca fitur Broker Analysis,
    // Fase Akumulasi/Distribusi, dan PVA di web terminal (tabel broker_summary).
    // Endpoint `marketdetectors` yang per-rentang hanya mengisi broker_range_agg,
    // yang tidak punya granularitas harian sehingga fase tidak bisa dihitung.
    //
    // MAHAL: ±245 request per tahun per emiten (akhir pekan sudah dilewati).
    // Karena itu default MATI — nyalakan untuk daftar emiten pilihan, bukan
    // untuk seluruh universe.
    depthKey: 'runningTrade', pass: 3, id: 'running_trade_symbol', order: 98, label: 'Running Trade per Emiten (hari ini)',
    group: 'Bandarmologi',
    // TANPA `match`: path-nya sama persis dengan running trade GLOBAL yang
    // dipanggil halaman (sort=DESC&limit=80). Kalau template itu dipelajari,
    // ia menimpa URL katalog dan yang tertarik cuma 80 cetakan TERAKHIR —
    // bukan satu hari penuh dari 08:58.
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'trades',
    paginate: 'runningTrade',
    build: (ctx) => ({
      method: 'GET',
      url: URLS.runningTradeSymbol(ctx.symbol, { limit: 1000, date: ctx.today }),
      meta: { symbol: ctx.symbol, date: ctx.today },
    }),
  },
  {
    // Versi historis: satu request per hari bursa. MAHAL seperti broker harian,
    // jadi default mati.
    depthKey: 'runningTrade', pass: 3, id: 'running_trade_daily', order: 99, label: 'Running Trade harian (backfill, batas runningTradeDays)',
    group: 'Bandarmologi',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'trades',
    windowDays: 1, tradingDaysOnly: true, paginate: 'runningTrade',
    build: (ctx) => ({
      method: 'GET',
      url: URLS.runningTradeSymbol(ctx.symbol, { limit: 1000, date: ctx.window.start }),
      meta: { symbol: ctx.symbol, date: ctx.window.start, window: ctx.window },
    }),
  },
  {
    // Broker summary PER HARI BURSA -> tabel broker_summary.
    depthKey: 'broker', pass: 2, id: 'broker_summary_daily', order: 90, label: 'Broker Summary harian (batas brokerSummaryDays)',
    group: 'Bandarmologi',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'brokerDay',
    windowDays: 1, tradingDaysOnly: true,
    build: (ctx) => ({
      method: 'GET',
      url: URLS.marketDetectors(ctx.symbol, {
        transactionType: ctx.settings.transactionType || PARAMS.transactionType,
        marketBoard: ctx.settings.marketBoard,
        investorType: ctx.settings.investorType,
        limit: 0,
        from: ctx.window.start, to: ctx.window.end,
      }),
      meta: { symbol: ctx.symbol, date: ctx.window.start, window: ctx.window },
    }),
  },
  {
    depthKey: 'broker', id: 'broker_activity_historical', order: 81, label: 'Broker Activity Historis (per tahun)', group: 'Bandarmologi',
    scope: 'symbol', phase: 'deep', defaultOn: false, perYear: true, relay: 'raw',
    needsTemplate: true, match: /^https:\/\/exodus\.stockbit\.com\/order-trade\/broker\/activity\/historical(?:[?#]|$)/,
    build: (ctx) => ({
      method: 'GET',
      url: URLS.brokerActivityHistorical({
        interval: 'daily', dateFrom: ctx.window.start, dateTo: ctx.window.end,
        symbols: ctx.symbol, marketBoard: ctx.settings.marketBoard,
        investorType: ctx.settings.investorType, page: 1, limit: 200,
      }),
      meta: { symbol: ctx.symbol, window: ctx.window },
    }),
  },
  {
    id: 'running_trade_chart', order: 82, label: 'Running Trade Chart', group: 'Bandarmologi',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    needsTemplate: true, match: /^https:\/\/exodus\.stockbit\.com\/order-trade\/running-trade\/chart\/[A-Z0-9]+(?:[?#]|$)/,
    build: (ctx) => ({
      method: 'GET',
      url: URLS.runningTradeChart(ctx.symbol, {
        period: ctx.settings.runningTradePeriod || '1d',
        investorType: ctx.settings.investorType, marketBoard: ctx.settings.marketBoard,
      }),
      meta: { symbol: ctx.symbol },
    }),
  },
  {
    id: 'broker_distribution', order: 83, label: 'Distribusi Broker', group: 'Bandarmologi',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    needsTemplate: true, match: /^https:\/\/exodus\.stockbit\.com\/order-trade\/broker\/distribution(?:[?#]|$)/,
    build: (ctx) => ({
      method: 'GET',
      url: URLS.brokerDistribution({
        symbol: ctx.symbol, date: ctx.today,
        investorType: ctx.settings.investorType, marketBoard: ctx.settings.marketBoard,
        period: ctx.settings.brokerDistPeriod || '1d',
      }),
      meta: { symbol: ctx.symbol },
    }),
  },
  {
    id: 'trade_book_chart', order: 41, label: 'Trade Book Chart (intraday)', group: 'Bandarmologi',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    build: (ctx) => ({
      method: 'GET',
      url: URLS.tradeBookChart({ symbol: ctx.symbol, timeInterval: '1m', date: ctx.today }),
      meta: { symbol: ctx.symbol },
    }),
  },
  {
    id: 'orderbook', order: 40, label: 'Orderbook Snapshot', group: 'Bandarmologi',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    build: (ctx) => ({ method: 'GET', url: URLS.orderbook(ctx.symbol), meta: { symbol: ctx.symbol } }),
  },
  {
    id: 'financial', order: 60, label: 'Laporan Keuangan (6 kombinasi)', group: 'Fundamental',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'financial',
    variants: () => {
      const out = [];
      for (const rt of PARAMS.financialReportTypes) {
        for (const st of PARAMS.financialStatementTypes) {
          out.push({ key: `${rt.key}-${st.key}`, reportType: rt, statementType: st });
        }
      }
      return out;
    },
    build: (ctx, v) => ({
      method: 'GET',
      url: URLS.financial(ctx.symbol, 1, v.reportType.code, v.statementType.code),
      meta: { symbol: ctx.symbol, reportType: v.reportType.key, statementType: v.statementType.key },
    }),
  },
  {
    id: 'research', order: 22, label: 'Research Perusahaan', group: 'Fundamental',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    build: (ctx) => ({ method: 'GET', url: URLS.research(ctx.symbol) }),
  },
  {
    id: 'analyst_ratings', order: 20, label: 'Analyst Ratings', group: 'Fundamental',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'raw',
    build: (ctx) => ({ method: 'GET', url: URLS.analystRatings(ctx.symbol) }),
  },
  {
    id: 'analyst_consensus', order: 21, label: 'Analyst Consensus', group: 'Fundamental',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'raw',
    build: (ctx) => ({ method: 'GET', url: URLS.analystConsensus(ctx.symbol) }),
  },
  {
    id: 'fundachart', order: 42, label: 'Fundachart per Emiten', group: 'Fundamental',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    build: (ctx) => ({
      method: 'GET',
      url: URLS.fundachart(ctx.settings.fundachartItem || 'revenue', ctx.symbol, `${fundachartYears(ctx.settings)}y`),
      meta: { symbol: ctx.symbol },
    }),
  },
  {
    depthKey: 'ownership', id: 'majorholder', order: 52, label: 'Major Holder / Insider (per tahun)', group: 'Kepemilikan',
    scope: 'symbol', phase: 'deep', defaultOn: true, perYear: true, relay: 'insider',
    build: (ctx) => ({
      method: 'GET',
      url: URLS.majorHolder({
        symbol: ctx.symbol, dateStart: ctx.window.start, dateEnd: ctx.window.end, page: 1, limit: 100,
      }),
      meta: { symbol: ctx.symbol, window: ctx.window },
    }),
  },
  {
    depthKey: 'ownership', id: 'shareholding_composition', order: 51, label: 'Komposisi Kepemilikan (per tahun)', group: 'Kepemilikan',
    scope: 'symbol', phase: 'deep', defaultOn: true, perYear: true, relay: 'shareholdingComposition',
    build: (ctx) => ({
      method: 'GET',
      url: URLS.shareholdingComposition(ctx.symbol, ctx.window.start, ctx.window.end),
      meta: { symbol: ctx.symbol, window: ctx.window },
    }),
  },
  {
    // Graf kepemilikan KSEI — sumber panel SID / komposisi pemegang saham di
    // web terminal (tabel `shareholding`). Datanya laporan BULANAN KSEI, jadi
    // tidak perlu dijendelakan per tahun: satu request memberi snapshot bulan
    // terakhir.
    //
    // Endpoint ini di-key oleh company_id, BUKAN simbol. Pemetaannya dipanen
    // sendiri oleh collector: dari /emitten/trending (satu-satunya endpoint
    // yang membawa company_id bersama simbolnya) dan dari setiap respons graf
    // yang datang. Emiten yang company_id-nya belum dikenal otomatis dilewati
    // dan akan ikut pada crawl berikutnya setelah pemetaannya bertambah.
    id: 'shareholding_network', order: 50, label: 'Graf Kepemilikan KSEI (SID & scripless)',
    group: 'Kepemilikan',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'shareholdingNetwork',
    match: /^https:\/\/exodus\.stockbit\.com\/insider\/shareholding\/network(?:[?#]|$)/,
    enabledIf: (ctx) => !!(ctx.market && ctx.market.companyIds && ctx.market.companyIds[ctx.symbol]),
    build: (ctx) => ({
      method: 'GET',
      url: URLS.shareholdingNetwork(
        ctx.market.companyIds[ctx.symbol], 'COMPANY',
        ctx.settings.shareholdingDepth || 2,
        ctx.settings.shareholdingMaxEdge || 20,
      ),
      meta: { symbol: ctx.symbol, companyId: ctx.market.companyIds[ctx.symbol] },
    }),
  },
  {
    // Endpoint ini memakai "WebViewToken" tersendiri, di luar Bearer biasa —
    // dibalas 401 "WebViewToken.FromContext: User Not Found" walau sesi
    // Stockbit sehat. Cara halaman menyisipkan token itu belum diketahui, jadi
    // endpoint ini hanya dijalankan kalau bentuk request aslinya sudah
    // terpelajari dari halaman (lihat lib/templates.js).
    id: 'shareholders_chart', order: 43, label: 'Shareholders Chart (butuh WebViewToken)', group: 'Kepemilikan',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    needsTemplate: true,
    match: /^https:\/\/exodus\.stockbit\.com\/emitten-metadata\/shareholders\/[A-Z0-9]+\/chart(?:[?#]|$)/,
    needsShareholderToken: true,
    build: (ctx) => ({ method: 'GET', url: URLS.shareholdersChart(ctx.symbol), meta: { symbol: ctx.symbol } }),
  },
  {
    // Riwayat dividen tunai lengkap dalam satu request -> tabel `dividends`.
    id: 'dividends', order: 30, label: 'Dividen Tunai (riwayat penuh)', group: 'Aksi Korporasi',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'dividends',
    match: /^https:\/\/exodus\.stockbit\.com\/corpaction\/dividend(?:[?#]|$)/,
    build: (ctx) => ({ method: 'GET', url: URLS.dividends(ctx.symbol), meta: { symbol: ctx.symbol } }),
  },
  {
    id: 'corpaction', order: 31, label: 'Aksi Korporasi', group: 'Aksi Korporasi',
    scope: 'symbol', phase: 'deep', defaultOn: true, relay: 'raw',
    build: (ctx) => ({ method: 'GET', url: URLS.corpaction(ctx.symbol, 100), meta: { symbol: ctx.symbol } }),
  },
  {
    id: 'corpaction_conversion', order: 32, label: 'Stock Conversion', group: 'Aksi Korporasi',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    build: (ctx) => ({ method: 'GET', url: URLS.corpactionConversion(ctx.symbol, 1, 100), meta: { symbol: ctx.symbol } }),
  },
  {
    id: 'next_data', order: 44, label: 'Halaman Next.js (_next/data)', group: 'Web',
    scope: 'symbol', phase: 'deep', defaultOn: false, relay: 'raw',
    enabledIf: (ctx) => !!ctx.market.buildId,
    build: (ctx) => ({
      method: 'GET',
      url: URLS.nextData(ctx.market.buildId, ctx.symbol, ctx.settings.nextTab || 'chartbit'),
      meta: { symbol: ctx.symbol },
    }),
  },
];

export const ENDPOINT_BY_ID = Object.fromEntries(ENDPOINTS.map((e) => [e.id, e]));

/** Endpoint aktif menurut setelan (kosong = pakai defaultOn). */
export function isEndpointEnabled(ep, settings) {
  const flag = settings.endpoints ? settings.endpoints[ep.id] : undefined;
  return flag === undefined ? !!ep.defaultOn : !!flag;
}
