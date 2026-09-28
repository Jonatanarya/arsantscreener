import type { components } from '../generated/api'

export type WatchlistItem = components['schemas']['WatchlistItem']
export type DailyBar = components['schemas']['DailyBar']
export type BrokerSummaryDay = components['schemas']['BrokerSummaryDay']
export type BrokerSummaryRange = Omit<components['schemas']['BrokerSummaryRangeResponse'], 'buyers' | 'sellers'> & {
  buyers: BrokerRow[]
  sellers: BrokerRow[]
}
// Diperluas lokal: `investorType` (domisili aliran dana per broker) baru
// ditambahkan di backend dan belum ikut tergenerate di api.ts.
export type BrokerRow = components['schemas']['BrokerRow'] & {
  investorType?: string
  // Beberapa payload lama dari Stockbit memakai nama buyValue/sellValue.
  buyValue?: number
  sellValue?: number
}
export type Phase = components['schemas']['Phase']
export type PhasesResponse = components['schemas']['PhasesResponse']
export type PVAResponse = components['schemas']['PVAResponse']
export type ScanRow = components['schemas']['ScanRow'] & {
  category?: string
  scoreAccum?: number
  scoreTech?: number
  scorePva?: number
  scoreLiq?: number
  fitScalp?: number
  fitDaytrade?: number
  fitSwing?: number
  tags?: string[]
  historyDays?: number
  averageTurnover?: number
}
export type LiquidityCandidate = components['schemas']['LiquidityCandidateResponse']
export type TapeMessage = components['schemas']['TapeMessage']
export type OrderbookLevel = components['schemas']['OrderbookLevel']
export type FakeLevel = components['schemas']['FakeLevel']
export type WallPull = components['schemas']['WallPull']
export type Position = components['schemas']['PositionResponse']
export type CreatePositionRequest = components['schemas']['CreatePositionRequest']
export type ClosePositionRequest = components['schemas']['ClosePositionRequest']
export type PortfolioSummary = components['schemas']['PortfolioSummaryResponse']
export type PositionSizeRequest = components['schemas']['PositionSizeRequest']
export type PositionSizeResult = components['schemas']['PositionSizeResponse']
export type Outlook = components['schemas']['OutlookResponse']
export type Alert = components['schemas']['AlertResponse']
export type Fundamentals = components['schemas']['FundamentalsResponse']
export type TradePrint = components['schemas']['TradePrint'] & {
  // Field ini dikirim backend untuk kebutuhan filter dan merge order.
  market?: string
  extTradeId?: string
}
export type Trades = Omit<components['schemas']['TradesResponse'], 'prints'> & {
  prints: TradePrint[]
}
export type TopBroker = components['schemas']['TopBroker']
export type BrokerAnalysis = components['schemas']['BrokerAnalysisResponse']
export type BrokerFlow = components['schemas']['BrokerFlow'] & { investorType?: string }
export type NewsItem = components['schemas']['NewsItemResponse']
export type Decision = components['schemas']['DecisionResponse'] & { quality?: { eligible: boolean; reasons: string[]; averageTurnover: number; activeSessions: number; historyDays: number; confidence: 'TINGGI' | 'SEDANG' | 'TERBATAS'; dataSources: number } }
export type Catalyst = components['schemas']['CatalystResponse']
export type CreateCatalystRequest = components['schemas']['CreateCatalystRequest']
export type UpdateCatalystRequest = components['schemas']['UpdateCatalystRequest']
export type MacroQuote = components['schemas']['MacroQuoteResponse']
export type MacroSensitivity = components['schemas']['MacroSensitivityResponse']
export type CreateMacroSensitivityRequest = components['schemas']['CreateMacroSensitivityRequest']
export type KeyStats = components['schemas']['KeyStatsResponse']
export type Dividend = components['schemas']['DividendResponse']
export type FinancialStatementItem = components['schemas']['FinancialStatementItemResponse']
export type InsiderTransaction = components['schemas']['InsiderTransactionResponse']
export type AIOutlookResponse = components['schemas']['AIOutlookResponse']

export function getApiBaseUrl(): string {
  const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '')
  if (configuredBase) return configuredBase

  const isDev =
    window.location.hostname === 'localhost' &&
    (window.location.port === '5173' || window.location.port === '5174')
  return isDev ? 'http://localhost:4000' : '/api'
}

function getWsBaseUrl(): { scheme: string; host: string; pathPrefix: string } {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '')
  if (configuredBase) {
    const parsed = new URL(configuredBase, window.location.origin)
    return { scheme: parsed.protocol === 'https:' ? 'wss:' : 'ws:', host: parsed.host, pathPrefix: parsed.pathname }
  }

  if (window.location.hostname === 'localhost' && (window.location.port === '5173' || window.location.port === '5174')) {
    return { scheme, host: 'localhost:4000', pathPrefix: '' }
  }
  return { scheme, host: window.location.host, pathPrefix: '/api' }
}

export function tapeWebSocketUrl(symbol: string): string {
  const { scheme, host, pathPrefix } = getWsBaseUrl()
  return `${scheme}//${host}${pathPrefix}/ws/tape/${symbol}`
}

export function alertsWebSocketUrl(): string {
  const { scheme, host, pathPrefix } = getWsBaseUrl()
  return `${scheme}//${host}${pathPrefix}/ws/alerts`
}

async function getJSON<T>(path: string): Promise<T> {
  const baseUrl = getApiBaseUrl()
  const res = await fetch(`${baseUrl}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`)
  return res.json()
}

async function sendJSON<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const baseUrl = getApiBaseUrl()
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${path} failed: ${res.status} ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const fetchHealth = () => getJSON<{ status: string; env: string }>('/health')
export type OperationsStatus = { collectorLastSeen?: string; marketDataDate?: string; symbols: number; bars: number; infrastructure?: { rootDiskUsedPct: number; rootDiskFreeBytes: number; dataDiskUsedPct: number; dataDiskFreeBytes: number; backupLastUnix: number; backupBytes: number; apiActive: boolean; workerActive: boolean; nginxActive: boolean; backupTimerActive: boolean; maintenanceTimerActive: boolean } }
export const fetchOperationsStatus = () => getJSON<OperationsStatus>('/operations/status')
export type BrokerSummaryHealth = { status: 'healthy' | 'degraded' | 'critical'; targetDate: string; latestAvailableDate?: string; targetSymbols: number; freshSymbols: number; staleSymbols: number; missingSymbols: number; coveragePercent: number; rowsOnTargetDate: number; checkedAt: string }
export type ServiceStatus = { status: 'operational' | 'degraded'; checkedAt: string; marketDataDate?: string; updatedAt?: string; symbols: number; brokerSummary?: BrokerSummaryHealth; latestNewsAt?: string; fundamentalsUpdatedAt?: string; fundamentalsSymbols: number }
export const fetchServiceStatus = () => getJSON<ServiceStatus>('/service-status')
export type DataStatus = { symbol: string; completeness: number; latest?: string; areas: Record<string, { available: boolean; count: number; latest?: string }> }
export const fetchDataStatus = (symbol: string) => getJSON<DataStatus>(`/data-status/${encodeURIComponent(symbol)}`)

export type AccountSession = { authenticated: boolean; isAdmin?: boolean; user?: { name: string; email: string } }
export const fetchAccountSession = () => getJSON<AccountSession>('/account/session')
export type DataSessionStatus = { status: 'ready' | 'authentication_required'; authenticated: boolean; browserConnected: boolean; expiresAt?: string | null; capturedAt?: string | null; lastFetchAt?: string | null; error?: string | null }
export const fetchDataSessionStatus = () => getJSON<DataSessionStatus>('/account/data-session')

export type PipelineSource = { id: number; code: string; name: string; kind: string; status: string; enabled: boolean; priority: number; lastSuccessAt?: string; lastErrorAt?: string; lastError?: string; updatedAt: string }
export type PipelineWorker = { workerId: string; version: string; hostname: string; status: string; currentJobId?: number; startedAt: string; heartbeatAt: string; metadata?: Record<string, unknown> }
export type PipelineRun = { id: number; jobId: number; sourceId: number; sourceCode: string; workerId: string; status: string; itemsRead: number; itemsWritten: number; itemsSkipped: number; startedAt: string; finishedAt?: string; errorMessage?: string }
export type PipelineStatus = { paused: boolean; pending: number; running: number; succeeded: number; failed: number; sources: PipelineSource[]; workers: PipelineWorker[]; lastRuns: PipelineRun[] }
export type PipelineJob = { id: number; sourceId: number; sourceCode: string; jobType: string; symbol?: string; status: string; priority: number; attempts: number; maxAttempts: number; scheduledFor: string; runAfter: string; finishedAt?: string; lastError?: string; createdAt: string; updatedAt: string }
export type PipelineFreshness = { sourceId: number; sourceCode: string; dataset: string; symbol?: string; status: string; latestMarketDate?: string; latestDataAt?: string; lastCheckedAt?: string; rowCount: number; lastError?: string; updatedAt: string }

export const fetchPipelineStatus = () => getJSON<PipelineStatus>('/admin/pipeline/status')
export const fetchPipelineJobs = (status = '', limit = 100) => getJSON<PipelineJob[]>(`/admin/pipeline/jobs?status=${encodeURIComponent(status)}&limit=${limit}`)
export const fetchPipelineFreshness = (limit = 1000) => getJSON<PipelineFreshness[]>(`/admin/pipeline/freshness?limit=${limit}`)
export const setPipelinePaused = (paused: boolean) => sendJSON<{ paused: boolean }>('POST', '/admin/pipeline/control', { paused })
export const retryPipelineJob = (id: number) => sendJSON<{ id: number; status: string }>('POST', `/admin/pipeline/jobs/${id}/retry`)
export const setPipelineSourceEnabled = (code: string, enabled: boolean) => sendJSON<{ code: string; enabled: boolean }>('PATCH', `/admin/pipeline/sources/${encodeURIComponent(code)}`, { enabled })
export const logoutAccount = () => sendJSON<void>('POST', '/account/logout')
export const deleteAccount = (confirmation: string) => sendJSON<void>('DELETE', '/account', { confirmation })
export type UserWatchlists = { lists: { name: string; symbols: string[] }[] }
export const fetchUserWatchlists = () => getJSON<UserWatchlists>('/account/watchlists')
export const createUserWatchlist = (name: string) => sendJSON<{ name: string }>('POST', '/account/watchlists', { name })
export const renameUserWatchlist = (name: string, newName: string) => sendJSON<{ name: string }>('PATCH', `/account/watchlists/${encodeURIComponent(name)}`, { name: newName })
export const deleteUserWatchlist = (name: string) => sendJSON<void>('DELETE', `/account/watchlists/${encodeURIComponent(name)}`)
export const addUserWatchlistItem = (symbol: string, listName = 'Pantauan Utama') => sendJSON<void>('POST','/account/watchlists/items',{symbol,listName})
export const deleteUserWatchlistItem = (symbol: string, listName = 'Pantauan Utama') => sendJSON<void>('DELETE',`/account/watchlists/items/${encodeURIComponent(symbol)}?listName=${encodeURIComponent(listName)}`)

export const fetchSymbols = () => getJSON<WatchlistItem[]>('/symbols')
export const fetchSymbolCatalog = () => getJSON<WatchlistItem[]>('/symbols/catalog')
export const searchSymbols = (query: string) => getJSON<WatchlistItem[]>(`/symbols/search?q=${encodeURIComponent(query)}`)
export type Quote = { symbol: string; name: string; sector?: string; date?: string; close?: number; changePct?: number }
export const fetchQuote = (symbol: string) => getJSON<Quote>(`/quote/${encodeURIComponent(symbol)}`)

export const fetchBars = (symbol: string, from?: string, to?: string) => {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  return getJSON<DailyBar[]>(`/bars/${symbol}${qs ? `?${qs}` : ''}`)
}

export const fetchBrokerSummary = (symbol: string, date: string) =>
  getJSON<BrokerSummaryDay>(`/broker-summary/${symbol}?date=${date}`)

// Master broker dari database (diisi Data Collector dari daftar resmi
// Stockbit) — frontend tidak lagi menyimpan daftar broker sendiri.
export type BrokerMaster = {
  code: string
  name: string
  group: string   // "Asing" | "Lokal" (dari Stockbit)
  type: string    // asing | bumn | lokal-inst | ritel | ritel-online | campuran | lain
  smart: boolean
  color?: string
  source: string
}

export const fetchBrokers = () => getJSON<BrokerMaster[]>('/brokers')

export const fetchBrokerSummaryRange = (symbol: string, from: string, to: string) =>
  getJSON<BrokerSummaryRange>(`/broker-summary-range/${symbol}?from=${from}&to=${to}`)

export type BrokerSummaryAvailability = { dailyFrom?: string; dailyTo?: string; dailyRows: number; rangeFrom?: string; rangeTo?: string; rangeRows: number }
export const fetchBrokerSummaryAvailability = (symbol: string) =>
  getJSON<BrokerSummaryAvailability>(`/broker-summary-availability/${encodeURIComponent(symbol)}`)

export const fetchBrokerDistribution = (symbol: string, opts?: { from?: string; to?: string; date?: string; unit?: string }) => {
  const params = new URLSearchParams()
  if (opts?.from) params.set('from', opts.from)
  if (opts?.to) params.set('to', opts.to)
  if (opts?.date) params.set('date', opts.date)
  if (opts?.unit) params.set('unit', opts.unit)
  const qs = params.toString()
  return getJSON<any>(`/broker-distribution/${symbol}${qs ? `?${qs}` : ''}`)
}

export const fetchPhases = (
  symbol: string,
  opts?: { from?: string; to?: string; window?: number; sensitivity?: 'rendah' | 'sedang' | 'tinggi' },
) => {
  const params = new URLSearchParams()
  if (opts?.from) params.set('from', opts.from)
  if (opts?.to) params.set('to', opts.to)
  if (opts?.window) params.set('window', String(opts.window))
  if (opts?.sensitivity) params.set('sensitivity', opts.sensitivity)
  const qs = params.toString()
  return getJSON<PhasesResponse>(`/phases/${symbol}${qs ? `?${qs}` : ''}`)
}

export const fetchPVA = (symbol: string, from?: string, to?: string) => {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  return getJSON<PVAResponse>(`/pva/${symbol}${qs ? `?${qs}` : ''}`)
}

export const fetchScan = () => getJSON<ScanRow[]>('/scan')

export const fetchLiquidityCandidates = (limit = 100) =>
  getJSON<LiquidityCandidate[]>(`/screener/liquidity-candidates?limit=${limit}`)

export const fetchPositions = (status: 'open' | 'closed' | 'all' = 'open') =>
  getJSON<Position[]>(`/positions?status=${status}`)

export const createPosition = (req: CreatePositionRequest) =>
  sendJSON<{ id: number }>('POST', '/positions', req)

export const closePosition = (id: number, req: ClosePositionRequest) =>
  sendJSON<void>('PATCH', `/positions/${id}/close`, req)

export const deletePosition = (id: number) => sendJSON<void>('DELETE', `/positions/${id}`)

export const fetchPortfolioSummary = () => getJSON<PortfolioSummary>('/portfolio/summary')

export const calculatePositionSize = (req: PositionSizeRequest) =>
  sendJSON<PositionSizeResult>('POST', '/risk/position-size', req)

export const fetchOutlook = (symbol: string) => getJSON<Outlook>(`/outlook/${symbol}`)

export const fetchAlerts = (limit = 50) => getJSON<Alert[]>(`/alerts?limit=${limit}`)
export const fetchUserAlerts = (limit = 50) => getJSON<Alert[]>(`/account/alerts?limit=${limit}`)
export type UserAlertSettings = { minScore: number; bullish: boolean; bearish: boolean; netral: boolean }
export const fetchUserAlertSettings = () => getJSON<UserAlertSettings>('/account/alert-settings')
export const updateUserAlertSettings = (settings: UserAlertSettings) => sendJSON<UserAlertSettings>('PATCH', '/account/alert-settings', settings)

export const fetchFundamentals = (symbol: string, refresh = false) =>
  getJSON<Fundamentals>(`/fundamentals/${symbol}${refresh ? '?refresh=true' : ''}`)

export const fetchMacro = () => getJSON<MacroQuote[]>('/macro')

export const fetchMacroSensitivity = (symbol: string) => getJSON<MacroSensitivity[]>(`/macro/sensitivity/${symbol}`)

export const createMacroSensitivity = (req: CreateMacroSensitivityRequest) =>
  sendJSON<{ id: number }>('POST', '/macro/sensitivity', req)

export const deleteMacroSensitivity = (id: number) => sendJSON<void>('DELETE', `/macro/sensitivity/${id}`)

export const fetchTrades = (symbol: string, date?: string, limit = 0) =>
  getJSON<Trades>(`/trades/${symbol}?limit=${limit}${date ? `&date=${date}` : ''}`)

export const fetchBrokerAnalysis = (symbol: string, from: string, to: string) =>
  getJSON<BrokerAnalysis>(`/broker-analysis/${symbol}?from=${from}&to=${to}`)

export const fetchNews = (symbol?: string, limit = 50) =>
  getJSON<NewsItem[]>(`/news?limit=${limit}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`)

export const fetchDecision = (symbol: string, from: string, to: string) =>
  getJSON<Decision>(`/decision/${symbol}?from=${from}&to=${to}`)

export type ResetDataSummary = {
  status: string
  tables: { table: string; rows: number }[]
  tableCount: number
  totalRows: number
}

export const resetAllData = () =>
  sendJSON<ResetDataSummary>('POST', '/admin/reset-data', { confirm: true })

export const fetchCatalysts = (symbol: string) => getJSON<Catalyst[]>(`/catalysts/${symbol}`)

export const createCatalyst = (req: CreateCatalystRequest) => sendJSON<{ id: number }>('POST', '/catalysts', req)

export const updateCatalyst = (id: number, req: UpdateCatalystRequest) =>
  sendJSON<void>('PATCH', `/catalysts/${id}`, req)

export const fetchKeyStats = (symbol: string) => getJSON<KeyStats>(`/keystats/${symbol}`)

export const fetchDividends = (symbol: string) => getJSON<Dividend[]>(`/dividends/${symbol}`)

/**
 * Rasio KeyStats LENGKAP dari Stockbit (95+ rasio bergrup: Current Valuation,
 * Solvency, Profitability, Growth, Dividend, …). Tabel `keystats` hanya
 * menampung 7 di antaranya.
 */
export type KeyStatsRatio = {
  symbol: string
  group: string
  name: string
  value: number
  rawValue: string
  unit?: string
}

export const fetchKeyStatsRatios = (symbol: string) =>
  getJSON<KeyStatsRatio[]>(`/keystats-ratios/${symbol}`)

export const fetchFinancialStatements = (
  symbol: string,
  opts?: { reportType?: 'income' | 'balance' | 'cashflow'; statementType?: 'annual' | 'quarterly' },
) => {
  const params = new URLSearchParams()
  if (opts?.reportType) params.set('reportType', opts.reportType)
  if (opts?.statementType) params.set('statementType', opts.statementType)
  const qs = params.toString()
  return getJSON<FinancialStatementItem[]>(`/financial-statements/${symbol}${qs ? `?${qs}` : ''}`)
}

export const fetchInsiderTransactions = (symbol: string) =>
  getJSON<InsiderTransaction[]>(`/insider-transactions?symbol=${symbol}`)

export const generateAIOutlook = (symbol: string, apiKey: string) =>
  sendJSON<AIOutlookResponse>('POST', `/ai/outlook/${symbol}`, { apiKey })

export const deleteCatalyst = (id: number) => sendJSON<void>('DELETE', `/catalysts/${id}`)

// ---- Teknikal, Foreign Radar, Broker Profiler & Stock Profiler ----

export type Pivot = components['schemas']['Pivot']
export type CandlePattern = components['schemas']['CandlePattern']
export type VolumeSurge = components['schemas']['VolumeSurge']
export type HorizonReturn = components['schemas']['HorizonReturn']
export type TechnicalAnalysis = components['schemas']['TechnicalAnalysis']
export type Confluence = components['schemas']['Confluence']
export type TechnicalResponse = components['schemas']['TechnicalResponse']
export type RadarCell = components['schemas']['RadarCell']
export type RadarRow = components['schemas']['RadarRow']
export type SectorFlow = components['schemas']['SectorFlow']
export type ForeignRadar = components['schemas']['ForeignRadarResponse']
export type HeatCell = components['schemas']['HeatCell']
export type BrokerStockRow = components['schemas']['BrokerStockRow']
export type BrokerIntelResponse = components['schemas']['BrokerIntelResponse']
export type PortfolioPoint = components['schemas']['PortfolioPoint']
export type PortfolioSeries = components['schemas']['PortfolioSeries']
export type BrokerIdentity = components['schemas']['BrokerIdentity']
export type BrokerProfilerResponse = components['schemas']['BrokerProfilerResponse']
export type CategoryDay = components['schemas']['CategoryDay']
export type CategoryFlow = components['schemas']['CategoryFlow']
export type FloorAccumulator = components['schemas']['FloorAccumulator']
export type NetVsGross = components['schemas']['NetVsGross']
export type InventorySeries = components['schemas']['InventorySeries']
export type ForeignFlowWindow = components['schemas']['ForeignFlowWindow']
export type RelativeStrength = components['schemas']['RelativeStrength']
export type StockProfile = components['schemas']['StockProfileResponse']

export const fetchTechnical = (symbol: string, from?: string, to?: string) => {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  return getJSON<TechnicalResponse>(`/technical/${symbol}${qs ? `?${qs}` : ''}`)
}

export const fetchForeignRadar = (opts?: {
  from?: string
  to?: string
  mode?: 'akumulasi' | 'distribusi'
  limit?: number
}) => {
  const params = new URLSearchParams()
  if (opts?.from) params.set('from', opts.from)
  if (opts?.to) params.set('to', opts.to)
  if (opts?.mode) params.set('mode', opts.mode)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  return getJSON<ForeignRadar>(`/foreign-radar${qs ? `?${qs}` : ''}`)
}

export const fetchBrokerIntel = (opts?: {
  from?: string
  to?: string
  mode?: 'accum' | 'dist'
  symbol?: string
  brokers?: string
  limit?: number
}) => {
  const params = new URLSearchParams()
  if (opts?.from) params.set('from', opts.from)
  if (opts?.to) params.set('to', opts.to)
  if (opts?.mode) params.set('mode', opts.mode)
  if (opts?.symbol) params.set('symbol', opts.symbol)
  if (opts?.brokers) params.set('brokers', opts.brokers)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  return getJSON<BrokerIntelResponse>(`/broker-intel${qs ? `?${qs}` : ''}`)
}

export const fetchBrokerProfiler = (brokers: string, from?: string, to?: string) => {
  const params = new URLSearchParams({ brokers })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return getJSON<BrokerProfilerResponse>(`/broker-profiler?${params.toString()}`)
}

// ---- SID & Scripless (kepemilikan KSEI) ----

export type SIDPoint = components['schemas']['SIDPoint']
export type SIDRow = components['schemas']['SIDRow']
export type ShareholdingCoverage = components['schemas']['ShareholdingCoverage']
export type SIDResponse = components['schemas']['SIDResponse']
export type InvestorHolding = components['schemas']['InvestorHolding']
export type ClassificationSlice = components['schemas']['ClassificationSlice']
export type Composition = components['schemas']['CompositionResponse']
export type DivergenceRow = components['schemas']['DivergenceRow']
export type DivergenceResponse = components['schemas']['DivergenceResponse']

export const fetchSID = (opts?: {
  month?: string
  symbol?: string
  sort?: 'chg1m' | 'chg1m_asc' | 'scripless' | 'holders'
  limit?: number
}) => {
  const params = new URLSearchParams()
  if (opts?.month) params.set('month', opts.month)
  if (opts?.symbol) params.set('symbol', opts.symbol)
  if (opts?.sort) params.set('sort', opts.sort)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const qs = params.toString()
  return getJSON<SIDResponse>(`/sid${qs ? `?${qs}` : ''}`)
}

export const fetchShareholdingComposition = (symbol: string) =>
  getJSON<Composition>(`/shareholding/${symbol}`)

export const fetchShareholdingDivergence = (limit = 100) =>
  getJSON<DivergenceResponse>(`/shareholding-divergence?limit=${limit}`)

export const fetchStockProfile = (symbol: string, from?: string, to?: string) => {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  return getJSON<StockProfile>(`/stock-profile/${symbol}${qs ? `?${qs}` : ''}`)
}
