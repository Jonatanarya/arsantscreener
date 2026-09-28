import { type FormEvent, useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { fetchAccountSession, fetchDataSessionStatus, fetchDecision, fetchHealth, fetchLiquidityCandidates, fetchOperationsStatus, fetchScan, fetchServiceStatus, fetchSymbols, searchSymbols } from '../api/client'
import { usePageMetadata } from '../hooks/usePageMetadata'

const money = (value?: number | null) => value == null ? '—' : `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
const pct = (value?: number | null) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
const tone = (value?: number | null) => value && value > 0 ? 'up' : value && value < 0 ? 'down' : 'neutral'
const dataAge = (date?: string | null) => {
  if (!date) return 'Tanggal belum tersedia'
  const then = new Date(`${date}T00:00:00+07:00`).getTime()
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
  return days === 0 ? 'Data hari ini' : days === 1 ? 'Data 1 hari lalu' : `Data ${days} hari lalu`
}
const confidenceRank = (value?: string) => value === 'TINGGI' ? 3 : value === 'SEDANG' ? 2 : 1
type CandidateFilter = 'all' | 'buy' | 'accumulation' | 'bullish' | 'liquid'

const candidateFilters: { id: CandidateFilter; label: string }[] = [
  { id: 'all', label: 'Semua kandidat' },
  { id: 'buy', label: 'BELI' },
  { id: 'accumulation', label: 'Akumulasi' },
  { id: 'bullish', label: 'PVA Bullish' },
  { id: 'liquid', label: 'Likuiditas meningkat' },
]

export function DashboardPage() {
  const [symbolSearch, setSymbolSearch] = useState('')
  const [searchError, setSearchError] = useState('')
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>('all')
  const [selectedSector, setSelectedSector] = useState('ALL')
  const [visibleLimit, setVisibleLimit] = useState(12)
  usePageMetadata({ title: 'Dashboard Pasar — Arsant Screener', description: 'Pantau kandidat saham, fase akumulasi, momentum volume, likuiditas, dan hasil analisis pasar Indonesia.', path: '/dashboard' })
  const dashboardPath = ['arsant.my.id', 'www.arsant.my.id'].includes(window.location.hostname) ? '/market-dashboard' : '/dashboard'
  const scan = useQuery({ queryKey: ['scan'], queryFn: fetchScan, refetchInterval: 60_000 })
  const symbols = useQuery({ queryKey: ['symbols'], queryFn: fetchSymbols, refetchInterval: 5 * 60_000 })
  const liquid = useQuery({ queryKey: ['liquidity-candidates'], queryFn: () => fetchLiquidityCandidates(100), refetchInterval: 60_000 })
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 30_000 })
  const service = useQuery({ queryKey: ['service-status'], queryFn: fetchServiceStatus, refetchInterval: 60_000 })
  const account = useQuery({ queryKey: ['account-session'], queryFn: fetchAccountSession, staleTime: 60_000 })
  const dataSession = useQuery({
    queryKey: ['admin-data-session'],
    queryFn: fetchDataSessionStatus,
    enabled: account.data?.isAdmin === true,
    refetchInterval: 60_000,
    retry: 1,
  })
  const operations = useQuery({
    queryKey: ['admin-operations-status'],
    queryFn: fetchOperationsStatus,
    enabled: account.data?.isAdmin === true,
    refetchInterval: 60_000,
  })
  const dataSessionNeedsLogin = account.data?.isAdmin === true && (dataSession.isError || dataSession.data?.authenticated === false)
  const sessionExpiresSoon = Boolean(dataSession.data?.authenticated && dataSession.data?.expiresAt && new Date(dataSession.data.expiresAt).getTime() - Date.now() < 6 * 60 * 60_000)
  const adminWarnings = account.data?.isAdmin ? [
    dataSessionNeedsLogin ? { level: 'danger', title: 'SESI DATA PERLU LOGIN ULANG', text: 'Pembaruan broker ditahan dan akan berlanjut otomatis setelah sesi aktif.', href: '/api/account/data-session/viewer', action: 'Buka halaman login →' } : null,
    !dataSessionNeedsLogin && sessionExpiresSoon ? { level: 'warning', title: 'SESI DATA AKAN BERAKHIR', text: `Periksa sesi sebelum ${new Date(dataSession.data!.expiresAt!).toLocaleString('id-ID')}.`, href: '/api/account/data-session/viewer', action: 'Periksa sesi →' } : null,
    service.data?.brokerSummary && service.data.brokerSummary.status !== 'healthy' ? { level: 'warning', title: 'CAKUPAN BROKER BELUM PENUH', text: `${service.data.brokerSummary.freshSymbols}/${service.data.brokerSummary.targetSymbols} emiten tersedia untuk ${service.data.brokerSummary.targetDate}.`, href: '/trade', action: 'Lihat Trade →' } : null,
    operations.data?.infrastructure && !operations.data.infrastructure.workerActive ? { level: 'danger', title: 'WORKER DATA TIDAK AKTIF', text: 'Pembaruan harga, broker, berita, dan fundamental sedang berhenti.', href: '/status', action: 'Lihat status →' } : null,
    operations.data?.infrastructure && (operations.data.infrastructure.rootDiskUsedPct >= 85 || operations.data.infrastructure.dataDiskUsedPct >= 85) ? { level: 'danger', title: 'KAPASITAS PENYIMPANAN MENIPIS', text: `Root ${operations.data.infrastructure.rootDiskUsedPct}% · Data ${operations.data.infrastructure.dataDiskUsedPct}% terpakai.`, href: '/status', action: 'Lihat kapasitas →' } : null,
  ].filter((item): item is { level: string; title: string; text: string; href: string; action: string } => item != null) : []

  const rankedUniverse = useMemo(() => [...(scan.data ?? [])]
    .filter((row) => row.close != null && (row.phase?.type === 'AKUMULASI' || row.pvaBias === 'BULLISH'))
    .sort((a, b) => Number(b.phase?.type === 'AKUMULASI') - Number(a.phase?.type === 'AKUMULASI') || (b.pvaScore ?? 0) - (a.pvaScore ?? 0) || (b.changePct ?? -999) - (a.changePct ?? -999)), [scan.data])
  const sectorOptions = useMemo(() => [...new Set(rankedUniverse.map((row) => row.sector).filter((sector): sector is string => !!sector))].sort(), [rankedUniverse])
  const sectorCandidates = selectedSector === 'ALL' ? rankedUniverse : rankedUniverse.filter((row) => row.sector === selectedSector)
  const ranked = sectorCandidates.slice(0, visibleLimit)
  const today = new Date().toISOString().slice(0, 10)
  const sixMonthsAgo = new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString().slice(0, 10)
  const decisions = useQueries({ queries: ranked.map((row) => ({
    queryKey: ['decision', row.symbol, sixMonthsAgo, today],
    queryFn: () => fetchDecision(row.symbol, sixMonthsAgo, today),
    staleTime: 5 * 60_000,
  })) })
  const accumulation = (scan.data ?? []).filter((row) => row.phase?.type === 'AKUMULASI').length
  const bullish = (scan.data ?? []).filter((row) => row.pvaBias === 'BULLISH').length
  const visibleRanked = ranked.map((row, index) => ({ row, decision: decisions[index] }))
    .filter(({ decision }) => decision.isLoading || decision.data?.quality?.eligible !== false)
    .sort((a, b) => Number(b.decision.data?.verdict === 'BELI') - Number(a.decision.data?.verdict === 'BELI')
      || confidenceRank(b.decision.data?.quality?.confidence) - confidenceRank(a.decision.data?.quality?.confidence)
      || (b.decision.data?.quality?.averageTurnover ?? 0) - (a.decision.data?.quality?.averageTurnover ?? 0)
      || (b.row.pvaScore ?? 0) - (a.row.pvaScore ?? 0)
      || (b.row.changePct ?? -999) - (a.row.changePct ?? -999))
  const liquidSymbols = useMemo(() => new Set((liquid.data ?? []).map((item) => item.symbol)), [liquid.data])
  const filteredRanked = visibleRanked.filter(({ row, decision }) => {
    if (candidateFilter === 'buy') return decision.data?.verdict === 'BELI'
    if (candidateFilter === 'accumulation') return row.phase?.type === 'AKUMULASI'
    if (candidateFilter === 'bullish') return row.pvaBias === 'BULLISH'
    if (candidateFilter === 'liquid') return liquidSymbols.has(row.symbol)
    return true
  })
  const buyCount = visibleRanked.filter(({ decision }) => decision.data?.verdict === 'BELI').length
  const latestDate = (scan.data ?? []).reduce((latest, row) => row.date && row.date > latest ? row.date : latest, '')

  async function openStock(event: FormEvent) {
    event.preventDefault()
    const query = symbolSearch.toUpperCase().trim()
    const available = await searchSymbols(query)
    const match = available.find((item) => item.symbol === query)
      ?? available.find((item) => item.name?.toUpperCase() === query)
      ?? available.find((item) => item.symbol.startsWith(query) || item.name?.toUpperCase().startsWith(query))
    if (match) {
      window.location.href = `/stock/${match.symbol}`
      return
    }
    setSearchError(query ? 'Emiten tidak ditemukan. Pilih kode dari daftar saran.' : 'Masukkan kode atau nama emiten.')
  }

  return <div className="dashboard-page">
    <header className="dashboard-nav">
      <a className="landing-brand" href="/" aria-label="Arsant Screener home"><img src="/arsant-logo.png" alt="Arsant" /><span>ARSANT <b>SCREENER</b></span></a>
      <div className="dashboard-nav-links"><a className="dashboard-nav-active" href={dashboardPath}>Dashboard Pasar</a><a href="/stock/BBCA">Detail Saham</a><a className="dashboard-open" href="/trade">Buka Trade →</a></div>
    </header>

    <main className="dashboard-main">
      {adminWarnings.map((warning) => <section key={warning.title} className={`dashboard-admin-alert ${warning.level}`} role="alert"><div><strong>{warning.title}</strong><span>{warning.text}</span></div><a href={warning.href} target={warning.href.startsWith('/api/') ? '_blank' : undefined} rel={warning.href.startsWith('/api/') ? 'noreferrer' : undefined}>{warning.action}</a></section>)}
      <section className="dashboard-titlebar">
        <div><p className="eyebrow"><i /> MARKET INTELLIGENCE</p><h1>Dashboard pasar</h1><p>Ringkasan kandidat dari data yang sudah masuk ke Arsant Screener.</p><form className="dashboard-symbol-search" onSubmit={openStock}><input value={symbolSearch} onChange={(event) => { setSymbolSearch(event.target.value); setSearchError('') }} placeholder="Kode atau nama emiten" aria-label="Cari kode atau nama emiten" list="dashboard-symbol-options" autoComplete="off"/><datalist id="dashboard-symbol-options">{(symbols.data ?? []).map((item) => <option key={item.symbol} value={item.symbol}>{item.name && item.name !== item.symbol ? item.name : 'Emiten IDX'}</option>)}</datalist><button type="submit">Buka analisis →</button></form>{searchError && <p className="dashboard-search-error" role="alert">{searchError}</p>}</div>
        <div className="dashboard-live"><i /> {health.data ? 'SISTEM TERHUBUNG' : health.isError ? 'SISTEM TIDAK TERJANGKAU' : 'MEMERIKSA SISTEM'}<br /><small>{latestDate ? `Data pasar terbaru ${latestDate}` : 'Menunggu data pasar'}</small><br/><small>{service.data?.updatedAt ? `Pembaruan terakhir ${new Date(service.data.updatedAt).toLocaleString('id-ID')}` : 'Pembaruan belum tersedia'}</small></div>
      </section>

      <section className="dashboard-stats">
        <article><small>EMITEN TERINDEKS</small><strong>{symbols.data?.length ?? service.data?.symbols ?? '—'}</strong><span>siap dianalisis</span></article>
        <article><small>KANDIDAT AKUMULASI</small><strong>{accumulation}</strong><span>fase terbaru terdeteksi</span></article>
        <article><small>PVA BULLISH</small><strong>{bullish}</strong><span>konfirmasi volume-harga</span></article>
        <article><small>LIKUIDITAS MENINGKAT</small><strong>{liquid.data?.length ?? '—'}</strong><span>surge atau awakening</span></article>
      </section>

      <section className="dashboard-content">
        <div className="dashboard-table-wrap">
          <div className="dashboard-section-head"><div><span>ARSANT INTELLIGENCE</span><h2>Kandidat fase &amp; PVA</h2></div><div className="dashboard-section-note">{buyCount} berstatus BELI dari mesin Quant Decision</div></div>
          <div className="dashboard-filters" role="group" aria-label="Filter kandidat saham">
            {candidateFilters.map((item) => <button key={item.id} type="button" className={candidateFilter === item.id ? 'active' : ''} aria-pressed={candidateFilter === item.id} onClick={() => setCandidateFilter(item.id)}>{item.label}</button>)}
            {sectorOptions.length > 0 && <label className="dashboard-sector-filter">SEKTOR<select value={selectedSector} onChange={(event) => { setSelectedSector(event.target.value); setVisibleLimit(12) }}><option value="ALL">Semua sektor</option>{sectorOptions.map((sector) => <option key={sector} value={sector}>{sector}</option>)}</select></label>}
          </div>
          {scan.isLoading ? <div className="dashboard-empty">Memuat data scanner…</div> : scan.isError ? <div className="dashboard-empty">Data scanner belum dapat diambil. Coba buka ulang beberapa saat lagi.</div> : ranked.length === 0 ? <div className="dashboard-empty">Data harga sedang disiapkan. Silakan periksa kembali beberapa saat lagi.</div> :
            filteredRanked.length === 0 ? <div className="dashboard-empty">Belum ada kandidat yang sesuai dengan filter ini.</div> : <div className="dashboard-table-scroll"><table className="dashboard-table"><thead><tr><th>EMITEN</th><th>HARGA</th><th>CHG %</th><th>QUANT DECISION</th><th>FASE & PVA</th><th>RENCANA ATR</th><th /></tr></thead><tbody>{filteredRanked.map(({ row, decision: decisionQuery }) => {
              const phase = row.phase?.type ?? 'MENUNGGU'; const decision = decisionQuery.data
              return <tr key={row.symbol}><td><b>{row.symbol}</b><small>{row.name || row.sector || 'IDX'}</small><small className="data-age">{dataAge(row.date)}</small></td><td className="price">{money(row.close)}</td><td><span className={`change ${tone(row.changePct)}`}>{pct(row.changePct)}</span></td><td><span className={`phase ${decision?.verdict === 'BELI' ? 'phase-up' : decision?.verdict === 'HINDARI' ? 'phase-down' : ''}`}>{decision?.verdict ?? (decisionQuery.isLoading ? 'MENGHITUNG…' : 'PANTAU')}</span><small className={`confidence confidence-${(decision?.quality?.confidence ?? 'terbatas').toLowerCase()}`}>KEYAKINAN {decision?.quality?.confidence ?? '—'}</small><small className="pva">Skor {decision?.score ?? '—'} · {decision?.quality?.dataSources ?? 0}/5 sumber</small></td><td><span className={`phase ${phase === 'AKUMULASI' ? 'phase-up' : phase === 'DISTRIBUSI' ? 'phase-down' : ''}`}>{phase}</span><small className="pva">{row.pvaBias || 'PVA menunggu'} ({row.pvaScore ?? '—'})</small></td><td><span className="profile">Entry {money(decision?.plan?.entry)}</span><small className="pva">SL {money(decision?.plan?.stopLoss)} · TP {money(decision?.plan?.takeProfit)}</small></td><td><a className="row-open" href={`/stock/${row.symbol}`}>Analisis →</a></td></tr>
            })}</tbody></table></div>}
          {sectorCandidates.length > visibleLimit && <div className="dashboard-load-more"><button type="button" onClick={() => setVisibleLimit((value) => value + 12)}>Muat 12 kandidat berikutnya</button><span>{Math.min(visibleLimit, sectorCandidates.length)} dari {sectorCandidates.length} kandidat diproses</span></div>}
          <footer className="dashboard-disclaimer">Kandidat adalah hasil penyaringan data, bukan ajakan beli atau jaminan hasil. Buka workspace untuk memeriksa chart dan broker flow.</footer>
        </div>
        <aside className="dashboard-side">
          {account.data?.isAdmin && <div className={`side-card admin-session-card ${dataSessionNeedsLogin ? 'needs-login' : ''}`}><span className="side-label">STATUS ADMIN</span><h3>Sesi pembaruan data</h3><p>{dataSession.isLoading ? 'Memeriksa sesi…' : dataSessionNeedsLogin ? 'Login ulang diperlukan. Antrean broker sedang ditahan.' : 'Sesi aktif. Pembaruan broker berjalan otomatis.'}</p>{dataSession.data?.expiresAt && !dataSessionNeedsLogin && <p className="admin-session-time">Token aktif sampai {new Date(dataSession.data.expiresAt).toLocaleString('id-ID')}</p>}<a href="/api/account/data-session/viewer" target="_blank" rel="noreferrer">{dataSessionNeedsLogin ? 'Login ulang →' : 'Kelola sesi →'}</a></div>}
          {account.data?.isAdmin && operations.data?.infrastructure && <div className="side-card admin-operations-card"><span className="side-label">MONITOR OPERASIONAL</span><h3>Kesehatan pipeline data</h3><ul><li><b>Worker</b><span>{operations.data.infrastructure.workerActive ? 'Aktif' : 'Berhenti'}</span><em>●</em></li><li><b>Broker</b><span>{service.data?.brokerSummary ? `${service.data.brokerSummary.freshSymbols}/${service.data.brokerSummary.targetSymbols}` : 'Memeriksa'}</span><em>●</em></li><li><b>Root disk</b><span>{operations.data.infrastructure.rootDiskUsedPct}% terpakai</span><em>●</em></li><li><b>Data disk</b><span>{operations.data.infrastructure.dataDiskUsedPct}% terpakai</span><em>●</em></li></ul><a href="/admin/data">Buka Data Control Center →</a></div>}
          {service.data && <div className="side-card"><span className="side-label">STATUS LAYANAN</span><h3>Operasional Arsant</h3><ul><li><b>Aplikasi</b><span>{health.data?'Normal':'Memeriksa'}</span><em>●</em></li><li><b>Layanan data</b><span>{service.data.status==='operational'?'Normal':'Diperiksa'}</span><em>●</em></li><li><b>Cakupan</b><span>{service.data.symbols.toLocaleString('id-ID')} emiten</span><em>●</em></li><li><b>Data terbaru</b><span>{service.data.marketDataDate||'Belum ada'}</span><em>●</em></li></ul><a href="/status">Lihat status →</a></div>}
          <div className="side-card"><span className="side-label">PULSE LIKUIDITAS</span><h3>Saham dengan aktivitas meningkat</h3>{liquid.data?.length ? <ul>{liquid.data.slice(0, 7).map((item) => <li key={item.symbol}><b>{item.symbol}</b><span>{item.level.replace('+', ' + ')}</span><em>{item.score}</em></li>)}</ul> : <p>Belum ada perubahan likuiditas yang tercatat.</p>}<a href="/trade">Buka Arsant Trade →</a></div>
          <div className="side-card side-guide"><span className="side-label">CARA MEMBACA</span><p><b>Quant Decision</b> berasal langsung dari mesin keputusan backend: fase, PVA, broker flow, running trade, katalis, dan valuasi yang tersedia.</p><p>Data yang belum terkumpul tidak diberi skor pengganti. Gunakan hasil sebagai titik awal riset.</p></div>
        </aside>
      </section>
    </main>
  </div>
}
