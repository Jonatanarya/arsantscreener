import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchQuote, fetchSymbols, searchSymbols } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { DataFreshness } from './DataFreshness'
import { DecisionPanel } from './DecisionPanel'
import { ChartPanel } from './ChartPanel'
import { TeknikalPanel } from './TeknikalPanel'
import { FundamentalsPanel } from './FundamentalsPanel'
import { BrokerAnalysisPanel } from './BrokerAnalysisPanel'
import { RunningTradePanel } from './RunningTradePanel'
import { SIDPanel } from './SIDPanel'
import { NewsPanel } from './NewsPanel'
import { usePageMetadata } from '../hooks/usePageMetadata'

type DetailTab = 'summary' | 'chart' | 'fundamental' | 'flow' | 'ownership' | 'news'

const tabs: { id: DetailTab; label: string }[] = [
  { id: 'summary', label: 'Ringkasan' },
  { id: 'chart', label: 'Chart & Teknikal' },
  { id: 'fundamental', label: 'Fundamental' },
  { id: 'flow', label: 'Broker & Transaksi' },
  { id: 'ownership', label: 'Kepemilikan' },
  { id: 'news', label: 'Berita' },
]

const formatPrice = (value?: number | null) => value == null ? '—' : `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
const formatPct = (value?: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`

export function StockDetailPage() {
  const pathSymbol = decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1] || 'BBCA').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'BBCA'
  const selectSymbol = useTerminalStore((state) => state.selectSymbol)
  const requestedTab = new URLSearchParams(window.location.search).get('tab') as DetailTab | null
  const [tab, setTab] = useState<DetailTab>(tabs.some((item) => item.id === requestedTab) ? requestedTab! : 'summary')
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState(pathSymbol)
  const [searchError, setSearchError] = useState('')
  const symbols = useQuery({ queryKey: ['symbols'], queryFn: fetchSymbols, staleTime: 5 * 60_000 })
  const symbolInfo = useMemo(() => symbols.data?.find((row) => row.symbol === pathSymbol), [symbols.data, pathSymbol])
  const quote = useQuery({
    queryKey: ['quote', pathSymbol],
    queryFn: () => fetchQuote(pathSymbol),
    staleTime: 60_000,
  })
  const notFound = quote.isError && !symbols.isLoading && !symbols.isError && !!symbols.data && !symbolInfo

  useEffect(() => { if (quote.data || symbolInfo) selectSymbol(pathSymbol) }, [pathSymbol, quote.data, selectSymbol, symbolInfo])
  const latestPrice = quote.data?.close ?? symbolInfo?.close
  const latestChange = quote.data?.changePct ?? symbolInfo?.changePct
  const latestDate = quote.data?.date ?? symbolInfo?.date
  const tone = (latestChange ?? 0) > 0 ? 'up' : (latestChange ?? 0) < 0 ? 'down' : 'neutral'
  const companyName = quote.data?.name || symbolInfo?.name || quote.data?.sector || symbolInfo?.sector
  const suggestions = useMemo(() => {
    const available = symbols.data ?? []
    const similar = available.filter((item) => item.symbol.startsWith(pathSymbol.slice(0, 1))).slice(0, 8)
    return similar.length ? similar : available.filter((item) => item.close != null).slice(0, 8)
  }, [pathSymbol, symbols.data])

  usePageMetadata({
    title: notFound ? `${pathSymbol} Tidak Ditemukan — Arsant Screener` : `${pathSymbol} — Analisis Saham | Arsant Screener`,
    description: notFound ? `Kode emiten ${pathSymbol} tidak ditemukan di Arsant Screener.` : `Lihat chart, fundamental, broker flow, transaksi, kepemilikan, dan sinyal analisis saham ${pathSymbol}${companyName ? ` (${companyName})` : ''}.`,
    path: `/stock/${pathSymbol}`,
    noIndex: notFound,
  })

  async function openSymbol(event: FormEvent) {
    event.preventDefault()
    const query = search.toUpperCase().trim()
    const available = await searchSymbols(query)
    const match = available.find((item) => item.symbol === query)
      ?? available.find((item) => item.name?.toUpperCase() === query)
      ?? available.find((item) => item.symbol.startsWith(query) || item.name?.toUpperCase().startsWith(query))
    if (match) {
      window.location.href = `/stock/${match.symbol}`
      return
    }
    setSearchError(query ? 'Emiten tidak ditemukan' : 'Masukkan kode atau nama emiten')
  }

  function selectTab(next: DetailTab) {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === 'summary') url.searchParams.delete('tab')
    else url.searchParams.set('tab', next)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (notFound) return <div className="stock-detail-page"><header className="dashboard-nav stock-detail-nav"><a className="landing-brand" href="/"><img src="/arsant-logo.png" alt="Arsant" /><span>ARSANT <b>SCREENER</b></span></a><nav className="dashboard-nav-links"><a href="/dashboard">Dashboard</a><a className="dashboard-open" href="/trade">Trade →</a></nav></header><main className="stock-missing"><span>KODE TIDAK DITEMUKAN</span><h1>{pathSymbol}</h1><p>Periksa kembali kode saham atau pilih salah satu emiten yang tersedia.</p><form className="stock-detail-search" onSubmit={openSymbol}><input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label="Cari kode emiten" placeholder="Kode emiten"/><button type="submit">Cari</button></form>{suggestions.length>0&&<div><small>SARAN EMITEN</small><nav>{suggestions.map((item)=><a key={item.symbol} href={`/stock/${item.symbol}`}>{item.symbol}</a>)}</nav></div>}</main></div>

  return <div className="stock-detail-page">
    <header className="dashboard-nav stock-detail-nav">
      <a className="landing-brand" href="/" aria-label="Arsant Screener home"><img src="/arsant-logo.png" alt="Arsant" /><span>ARSANT <b>SCREENER</b></span></a>
      <div className="stock-detail-search-wrap"><form className="stock-detail-search" onSubmit={openSymbol}>
        <input value={search} onChange={(event) => { setSearch(event.target.value); setSearchError('') }} aria-label="Cari kode atau nama emiten" placeholder="Kode atau nama emiten" list="stock-detail-symbol-options" autoComplete="off" />
        <datalist id="stock-detail-symbol-options">{(symbols.data ?? []).map((item) => <option key={item.symbol} value={item.symbol}>{item.name && item.name !== item.symbol ? item.name : 'Emiten IDX'}</option>)}</datalist>
        <button type="submit">Buka analisis</button>
      </form>{searchError && <span className="stock-detail-search-error" role="alert">{searchError}</span>}</div>
      <nav className="dashboard-nav-links"><a href="/dashboard">Dashboard</a><a className="dashboard-open" href="/trade">Trade →</a></nav>
    </header>

    <main className="stock-detail-main">
      <section className="stock-detail-hero">
        <div><p className="eyebrow"><i /> PROFIL EMITEN</p><h1>{pathSymbol}</h1><p>{companyName || 'Informasi emiten dan analisis pasar'}</p></div>
        <div className={`stock-detail-quote${quote.isLoading ? ' is-loading' : ''}`} aria-live="polite"><small>HARGA TERAKHIR</small><strong>{quote.isLoading ? 'Memuat…' : formatPrice(latestPrice)}</strong><span className={tone}>{quote.isLoading ? '' : formatPct(latestChange)}</span><em>{quote.isLoading ? 'Mengambil data terbaru' : (latestDate || 'Tanggal belum tersedia')}</em></div>
      </section>

      <section className="stock-detail-status"><DataFreshness symbol={pathSymbol} /></section>

      <div className="stock-detail-tabs" role="tablist" aria-label="Bagian analisis emiten">
        {tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} aria-controls={`stock-panel-${item.id}`} className={tab === item.id ? 'active' : ''} onClick={() => selectTab(item.id)}>{item.label}</button>)}
        <button className="stock-detail-copy" type="button" onClick={copyLink}>{copied ? 'Tautan tersalin' : 'Salin tautan'}</button>
      </div>

      <div className="stock-detail-mobile-tabs">
        <label htmlFor="stock-detail-section">Bagian analisis</label>
        <select id="stock-detail-section" value={tab} onChange={(event) => selectTab(event.target.value as DetailTab)}>
          {tabs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <button type="button" onClick={copyLink}>{copied ? 'Tersalin' : 'Salin tautan'}</button>
      </div>

      <section id={`stock-panel-${tab}`} role="tabpanel" className={`stock-detail-panel stock-detail-panel-${tab}`}>
        {tab === 'summary' && <DecisionPanel showDataStatus={false} />}
        {tab === 'chart' && <div className="stock-detail-split"><div><ChartPanel /></div><div><TeknikalPanel /></div></div>}
        {tab === 'fundamental' && <FundamentalsPanel params={{ symbolOverride: pathSymbol }} />}
        {tab === 'flow' && <div className="stock-detail-split"><div><BrokerAnalysisPanel /></div><div><RunningTradePanel /></div></div>}
        {tab === 'ownership' && <SIDPanel />}
        {tab === 'news' && <div style={{ minHeight: 620, height: '72vh' }}><NewsPanel symbolOverride={pathSymbol} /></div>}
      </section>

      <p className="stock-detail-note">Informasi ini merupakan alat bantu analisis. Periksa kembali risiko, likuiditas, dan kesesuaian strategi sebelum mengambil keputusan.</p>
    </main>
  </div>
}
