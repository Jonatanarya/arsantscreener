import { useDeferredValue, useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ChartPanel } from './ChartPanel'
import { Watchlist } from './Watchlist'
import { TradeBrokerSummary } from './TradeBrokerSummary'
import { NewsPanel } from './NewsPanel'
import { fetchBrokerSummary, fetchBrokerSummaryAvailability, fetchBrokers, fetchQuote, fetchServiceStatus, searchSymbols, type BrokerRow, type ServiceStatus } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'
import './TradePage.css'

type FlowDay = { date: string; bandar: number | null; asing: number | null; ritel: number | null }

function tradingDates(end: string | undefined, count = 10): string[] {
  if (!end) return []
  const dates: string[] = []
  const cursor = new Date(`${end}T12:00:00`)
  while (dates.length < count) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) dates.unshift(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() - 1)
  }
  return dates
}

function mergeDaily(buyers: BrokerRow[], sellers: BrokerRow[]) {
  const result = new Map<string, { buy: number; sell: number; investorType: string }>()
  const get = (code: string) => {
    const current = result.get(code) ?? { buy: 0, sell: 0, investorType: '' }
    result.set(code, current)
    return current
  }
  buyers.forEach((row) => {
    const value = get(row.brokerCode)
    value.buy += row.value
    value.investorType = String(row.investorType || value.investorType)
  })
  sellers.forEach((row) => {
    const value = get(row.brokerCode)
    value.sell += row.value
    value.investorType = String(row.investorType || value.investorType)
  })
  return [...result.entries()].map(([code, value]) => ({ code, net: value.buy - value.sell, investorType: value.investorType }))
}

function correlation(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null
  const ax = xs.reduce((sum, n) => sum + n, 0) / xs.length
  const ay = ys.reduce((sum, n) => sum + n, 0) / ys.length
  let numerator = 0; let dx = 0; let dy = 0
  xs.forEach((x, index) => {
    const vx = x - ax; const vy = ys[index] - ay
    numerator += vx * vy; dx += vx * vx; dy += vy * vy
  })
  const denominator = Math.sqrt(dx * dy)
  return denominator ? numerator / denominator : null
}

function MiniFlowChart({ title, values, accent, emptyLabel }: { title: string; values: ChartFlowDay[]; accent: string; emptyLabel?: string }) {
  const available = values.filter((item) => item.bandValue != null)
  const nums = available.map((item) => item.bandValue as number)
  const max = Math.max(1, ...nums.map((n) => Math.abs(n)))
  let cumulative = 0
  nums.forEach((value) => { cumulative += value })
  return (
    <div className="trade-flow-chart">
      <div className="trade-flow-title"><span>{title}</span><strong style={{ color: cumulative >= 0 ? 'var(--up)' : 'var(--down)' }}>{nums.length ? fmtRp(cumulative) : '—'}</strong></div>
      <div className="trade-flow-bars">
        <i className="trade-flow-zero" />
        {values.map((item) => {
          const value = item.bandValue
          const height = value == null ? 0 : Math.max(3, Math.abs(value) / max * 38)
          return <span key={item.date} title={`${item.date}: ${value == null ? '—' : fmtRp(value)}`} className={value == null ? 'is-null' : value >= 0 ? 'is-up' : 'is-down'} style={{ height, background: value != null ? accent : undefined, transform: value != null && value < 0 ? 'translateY(100%)' : undefined }} />
        })}
      </div>
      <div className="trade-flow-axis"><span>{values[0]?.date.slice(5) ?? '—'}</span><span>{emptyLabel ?? (cumulative >= 0 ? 'NET BUY' : 'NET SELL')}</span><span>{values.at(-1)?.date.slice(5) ?? '—'}</span></div>
    </div>
  )
}

type ChartFlowDay = FlowDay & { bandValue: number | null }

function FlowMonitor() {
  const symbol = useTerminalStore((state) => state.selectedSymbol) || 'BBCA'
  const availability = useQuery({ queryKey: ['broker-summary-availability', symbol], queryFn: () => fetchBrokerSummaryAvailability(symbol), staleTime: 10 * 60_000 })
  const dates = useMemo(() => tradingDates(availability.data?.dailyTo), [availability.data?.dailyTo])
  const masters = useQuery({ queryKey: ['brokers'], queryFn: fetchBrokers, staleTime: 30 * 60_000 })
  const daily = useQueries({ queries: dates.map((date) => ({ queryKey: ['broker-summary-daily', symbol, date], queryFn: () => fetchBrokerSummary(symbol, date), staleTime: 10 * 60_000, retry: 1 })) })
  const flows = useMemo<FlowDay[]>(() => dates.map((date, index) => {
    const response = daily[index]?.data
    if (!response) return { date, bandar: null, asing: null, ritel: null }
    const rows = mergeDaily(response.buyers ?? [], response.sellers ?? [])
    if (!rows.length) return { date, bandar: null, asing: null, ritel: null }
    const sorted = [...rows].sort((a, b) => b.net - a.net)
    const topBuy = sorted.filter((row) => row.net > 0).slice(0, 5).reduce((sum, row) => sum + row.net, 0)
    const topSell = sorted.filter((row) => row.net < 0).slice(-5).reduce((sum, row) => sum + Math.abs(row.net), 0)
    const master = new Map((masters.data ?? []).map((broker) => [broker.code, broker]))
    const asingRows = rows.filter((row) => row.investorType.toLowerCase().includes('asing') || master.get(row.code)?.group.toLowerCase() === 'asing')
    const retailRows = rows.filter((row) => master.get(row.code)?.type.toLowerCase().includes('ritel'))
    return {
      date,
      bandar: topBuy - topSell,
      asing: asingRows.length ? asingRows.reduce((sum, row) => sum + row.net, 0) : null,
      ritel: retailRows.length ? retailRows.reduce((sum, row) => sum + row.net, 0) : null,
    }
  }), [daily, dates, masters.data])
  const valid = flows.filter((day) => day.bandar != null && day.asing != null)
  const r = correlation(valid.map((day) => day.bandar as number), valid.map((day) => day.asing as number))
  const same = valid.length ? valid.filter((day) => Math.sign(day.bandar as number) === Math.sign(day.asing as number)).length / valid.length : null
  const total = (key: 'bandar' | 'asing' | 'ritel') => flows.reduce((sum, day) => sum + (day[key] ?? 0), 0)
  const phase = total('bandar') > 0 && total('ritel') < 0 ? 'AKUMULASI' : total('bandar') < 0 && total('ritel') > 0 ? 'DISTRIBUSI' : 'SEARAH PASAR'
  const chartValues = (key: 'bandar' | 'asing' | 'ritel'): ChartFlowDay[] => flows.map((day) => ({ ...day, bandValue: day[key] }))
  return (
    <section className="trade-card trade-flow-monitor">
      <header className="trade-card-head"><div><small>T9 · FLOW MONITOR</small><h2>Bandarmology, Asing, Ritel</h2></div><span className="trade-pill">10 HARI BURSA</span></header>
      <div className="trade-flow-stats"><span>FASE <b>{flows.length ? phase : '—'}</b></span><span>KORELASI <b>{r == null ? '—' : r.toFixed(2)}</b></span><span>SEARAH <b>{same == null ? '—' : `${Math.round(same * 100)}%`}</b></span></div>
      <MiniFlowChart title="FLOW BANDARMOLOGY" values={chartValues('bandar')} accent="var(--accent)" />
      <MiniFlowChart title="FLOW ASING" values={chartValues('asing')} accent="var(--cyan)" />
      <MiniFlowChart title="FLOW RITEL" values={chartValues('ritel')} accent="#a78bfa" emptyLabel="PENDEKATAN BROKER RITEL" />
      <p className="trade-method-note">Aliran dana menggambarkan aktivitas anggota bursa dan bukan rekomendasi arah harga. Klasifikasi ritel memakai referensi tipe broker.</p>
    </section>
  )
}

function SymbolSearch() {
  const selectSymbol = useTerminalStore((state) => state.selectSymbol)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const deferredQuery = useDeferredValue(query.trim())
  const results = useQuery({
    queryKey: ['symbol-search', deferredQuery],
    queryFn: () => searchSymbols(deferredQuery),
    enabled: deferredQuery.length > 0,
    staleTime: 5 * 60_000,
  })

  const choose = (symbol: string) => {
    selectSymbol(symbol)
    setQuery('')
    setOpen(false)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = query.trim().toUpperCase()
    if (!normalized) return
    const match = results.data?.find((item) => item.symbol === normalized) ?? results.data?.[0]
    if (match) choose(match.symbol)
  }

  return (
    <form className="trade-symbol-search" onSubmit={submit} role="search">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        value={query}
        onChange={(event) => { setQuery(event.target.value.toUpperCase()); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="Cari kode atau nama emiten…"
        aria-label="Cari emiten"
        autoComplete="off"
      />
      <button type="submit" disabled={!query.trim()}>BUKA</button>
      {open && query.trim() && (
        <div className="trade-symbol-results">
          {results.isLoading && <div className="trade-search-state">Mencari…</div>}
          {!results.isLoading && !(results.data?.length) && <div className="trade-search-state">Emiten tidak ditemukan.</div>}
          {results.data?.slice(0, 8).map((item) => (
            <button type="button" key={item.symbol} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item.symbol)}>
              <b>{item.symbol}</b><span>{item.name || item.sector || 'Emiten BEI'}</span><em>{item.close == null ? '—' : item.close.toLocaleString('id-ID')}</em>
            </button>
          ))}
        </div>
      )}
    </form>
  )
}

function shortDate(value?: string) {
  if (!value) return 'BELUM TERSEDIA'
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(`${value.slice(0, 10)}T12:00:00+07:00`)).toUpperCase()
}

function shortDateTime(value?: string) {
  if (!value) return 'BELUM TERSEDIA'
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value)).replace('.', ':').toUpperCase()
}

function TradeDataFreshness({ status }: { status?: ServiceStatus }) {
  const broker = status?.brokerSummary
  const brokerTone = broker?.status === 'healthy' ? 'is-fresh' : broker?.status === 'degraded' ? 'is-warning' : ''
  return (
    <div className="trade-data-freshness" aria-label="Status pembaruan data">
      <div><small>HARGA HARIAN</small><strong>{shortDate(status?.marketDataDate)}</strong><span className="is-fresh">EOD</span></div>
      <div><small>BROKER HARIAN</small><strong>{broker ? `${broker.freshSymbols}/${broker.targetSymbols} EMITEN` : 'MEMERIKSA'}</strong><span className={brokerTone}>{shortDate(broker?.targetDate)}</span></div>
      <div><small>BERITA PASAR</small><strong>{shortDateTime(status?.latestNewsAt)}</strong><span className="is-fresh">BERKALA</span></div>
      <div><small>FUNDAMENTAL</small><strong>{status ? `${status.fundamentalsSymbols.toLocaleString('id-ID')} EMITEN` : 'MEMERIKSA'}</strong><span>{shortDateTime(status?.fundamentalsUpdatedAt)}</span></div>
      <p>Harga dan broker menggunakan data harian setelah sesi bursa selesai.</p>
    </div>
  )
}

export function TradePage() {
  const symbol = useTerminalStore((state) => state.selectedSymbol) || 'BBCA'
  const quote = useQuery({ queryKey: ['quote', symbol], queryFn: () => fetchQuote(symbol) })
  const service = useQuery({ queryKey: ['service-status'], queryFn: fetchServiceStatus, refetchInterval: 60_000 })
  const change = quote.data?.changePct

  return (
    <div className="trade-page">
      <header className="trade-topbar">
        <a className="trade-brand" href="/"><img src="/arsant-logo.png" alt="" /><span>ARSANT</span><b>TRADE</b></a>
        <nav><a href="/dashboard">Dashboard</a><a className="active" href="/trade">Trade</a><a href={`/stock/${symbol}`}>Detail Saham</a><a href="/help">Bantuan</a></nav>
        <div className="trade-active-symbol"><small>EMITEN AKTIF</small><strong>{symbol} <span>IJ</span></strong><em className={change == null ? '' : change >= 0 ? 'up' : 'down'}>{change == null ? '—' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%`}</em></div>
      </header>
      <div className="trade-context"><span>ARSANT MARKET WORKSPACE</span><SymbolSearch /><strong>{symbol} · {quote.data?.name || '—'}</strong><small>WIB · Data terakhir {quote.data?.date || '—'}</small></div>
      <TradeDataFreshness status={service.data} />
      <main className="trade-grid">
        <div className="trade-column trade-left"><FlowMonitor /><section className="trade-card trade-watchlist"><header className="trade-section-label">T0 · WATCHLIST</header><Watchlist /></section></div>
        <div className="trade-column trade-center">
          <section className="trade-card trade-chart"><header className="trade-section-label"><span>T3 · CHART TRADINGVIEW</span><small>Harga IDX</small></header><ChartPanel /></section>
          <section className="trade-card trade-bandarmology"><header className="trade-section-label"><span>T8 · BROKER SUMMARY HARIAN</span><b>{symbol}</b></header><TradeBrokerSummary /></section>
        </div>
        <div className="trade-column trade-right"><section className="trade-card trade-news"><header className="trade-section-label"><span>T7 · NEWS & DAMPAK EMITEN</span><b>BERITA PASAR</b></header><NewsPanel /></section></div>
      </main>
    </div>
  )
}
