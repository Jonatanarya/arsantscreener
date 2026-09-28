import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAccountSession,
  fetchDataSessionStatus,
  fetchOperationsStatus,
  fetchPipelineFreshness,
  fetchPipelineJobs,
  fetchPipelineStatus,
  fetchServiceStatus,
  retryPipelineJob,
  setPipelinePaused,
  setPipelineSourceEnabled,
  type PipelineFreshness,
} from '../api/client'
import { usePageMetadata } from '../hooks/usePageMetadata'
import './DataControlPage.css'

const dateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
  : 'Belum tersedia'

const compactNumber = (value: number) => new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const bytes = (value?: number) => {
  if (!value) return '0 GB'
  return `${(value / 1024 / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} GB`
}
const pct = (part: number, total: number) => total > 0 ? Math.round((part / total) * 100) : 0
const isRecent = (value?: string, threshold = 90_000) => Boolean(value && Date.now() - new Date(value).getTime() < threshold)
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

type FreshnessGroup = {
  dataset: string
  total: number
  fresh: number
  stale: number
  error: number
  partial: number
  rows: number
  latestMarketDate?: string
  checkedAt?: string
}

function summarizeFreshness(rows: PipelineFreshness[]) {
  const groups = new Map<string, FreshnessGroup>()
  for (const row of rows) {
    const group = groups.get(row.dataset) ?? { dataset: row.dataset, total: 0, fresh: 0, stale: 0, error: 0, partial: 0, rows: 0 }
    group.total += 1
    group.rows += row.rowCount
    const status = row.status.toLowerCase()
    if (status === 'fresh' || status === 'ready' || status === 'healthy' || status === 'success') group.fresh += 1
    else if (status === 'stale') group.stale += 1
    else if (status === 'error' || status === 'failed') group.error += 1
    else group.partial += 1
    if (row.latestMarketDate && (!group.latestMarketDate || row.latestMarketDate > group.latestMarketDate)) group.latestMarketDate = row.latestMarketDate
    if (row.lastCheckedAt && (!group.checkedAt || row.lastCheckedAt > group.checkedAt)) group.checkedAt = row.lastCheckedAt
    groups.set(row.dataset, group)
  }
  return [...groups.values()].sort((a, b) => a.dataset.localeCompare(b.dataset))
}

export function DataControlPage() {
  usePageMetadata({ title: 'Data Control Center — Arsant Screener', description: 'Panel operasional data Arsant Screener.', path: '/admin/data', noIndex: true })
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const account = useQuery({ queryKey: ['account-session'], queryFn: fetchAccountSession, staleTime: 60_000 })
  const adminEnabled = account.data?.isAdmin === true
  const pipeline = useQuery({ queryKey: ['admin-pipeline-status'], queryFn: fetchPipelineStatus, enabled: adminEnabled, refetchInterval: 15_000 })
  const failedJobs = useQuery({ queryKey: ['admin-pipeline-jobs', 'failed'], queryFn: () => fetchPipelineJobs('failed', 50), enabled: adminEnabled, refetchInterval: 30_000 })
  const freshness = useQuery({ queryKey: ['admin-pipeline-freshness'], queryFn: () => fetchPipelineFreshness(1000), enabled: adminEnabled, refetchInterval: 30_000 })
  const operations = useQuery({ queryKey: ['admin-operations-status'], queryFn: fetchOperationsStatus, enabled: adminEnabled, refetchInterval: 30_000 })
  const service = useQuery({ queryKey: ['service-status'], queryFn: fetchServiceStatus, enabled: adminEnabled, refetchInterval: 30_000 })
  const dataSession = useQuery({ queryKey: ['admin-data-session'], queryFn: fetchDataSessionStatus, enabled: adminEnabled, refetchInterval: 30_000, retry: 1 })

  const pauseMutation = useMutation({
    mutationFn: setPipelinePaused,
    onSuccess: async (result) => {
      setActionError('')
      setMessage(result.paused ? 'Pipeline dijeda.' : 'Pipeline dilanjutkan.')
      await queryClient.invalidateQueries({ queryKey: ['admin-pipeline-status'] })
    },
    onError: () => setActionError('Status pipeline belum dapat diubah.'),
  })
  const retryMutation = useMutation({
    mutationFn: retryPipelineJob,
    onSuccess: async () => {
      setActionError('')
      setMessage('Pekerjaan dimasukkan kembali ke antrean.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-pipeline-status'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-pipeline-jobs', 'failed'] }),
      ])
    },
    onError: () => setActionError('Pekerjaan belum dapat diulang.'),
  })
  const sourceMutation = useMutation({
    mutationFn: ({ code, enabled }: { code: string; enabled: boolean }) => setPipelineSourceEnabled(code, enabled),
    onSuccess: async (result) => {
      setActionError('')
      setMessage(`${label(result.code)} ${result.enabled ? 'diaktifkan' : 'dinonaktifkan'}.`)
      await queryClient.invalidateQueries({ queryKey: ['admin-pipeline-status'] })
    },
    onError: () => setActionError('Sumber data belum dapat diubah.'),
  })

  const freshnessGroups = useMemo(() => summarizeFreshness(freshness.data ?? []), [freshness.data])
  const activeWorkers = (pipeline.data?.workers ?? []).filter((worker) => isRecent(worker.heartbeatAt))
  const broker = service.data?.brokerSummary
  const fundamentalCoverage = pct(service.data?.fundamentalsSymbols ?? 0, service.data?.symbols ?? 0)
  const infrastructure = operations.data?.infrastructure
  const sessionNeedsLogin = dataSession.isError || dataSession.data?.authenticated === false
  const warningCount = [
    sessionNeedsLogin,
    broker?.status !== 'healthy',
    activeWorkers.length === 0,
    Boolean(infrastructure && (infrastructure.rootDiskUsedPct >= 85 || infrastructure.dataDiskUsedPct >= 85)),
  ].filter(Boolean).length

  async function refreshAll() {
    setRefreshing(true)
    setActionError('')
    const results = await Promise.allSettled([pipeline.refetch(), failedJobs.refetch(), freshness.refetch(), operations.refetch(), service.refetch(), dataSession.refetch()])
    setRefreshing(false)
    if (results.some((result) => result.status === 'rejected')) setActionError('Sebagian status belum dapat diperbarui.')
    else setMessage('Status terbaru berhasil dimuat.')
  }

  if (account.isLoading) return <main className="data-control-gate"><img src="/arsant-logo.png" alt="" /><p>Memeriksa akses admin…</p></main>
  if (!account.data?.authenticated) return <main className="data-control-gate"><img src="/arsant-logo.png" alt="Arsant" /><span>DATA CONTROL CENTER</span><h1>Login admin diperlukan</h1><p>Masuk dengan akun Google admin untuk membuka kontrol operasional data.</p><a href="/api/account/google?returnTo=/admin/data">Lanjutkan dengan Google</a><a className="gate-secondary" href="/trade">Kembali ke Trade</a></main>
  if (!adminEnabled) return <main className="data-control-gate"><img src="/arsant-logo.png" alt="Arsant" /><span>AKSES TERBATAS</span><h1>Halaman khusus admin</h1><p>Akun {account.data.user?.email} tidak memiliki akses ke kontrol data.</p><a href="/dashboard">Kembali ke dashboard</a></main>

  const loading = pipeline.isLoading || service.isLoading || operations.isLoading
  return <div className="data-control-page">
    <header className="data-control-nav">
      <a className="data-control-brand" href="/dashboard"><img src="/arsant-logo.png" alt="" /><span>ARSANT <b>CONTROL</b></span></a>
      <nav><a href="/dashboard">Dashboard</a><a href="/status">Status publik</a><a href="/trade">Buka Trade →</a></nav>
    </header>

    <main className="data-control-main">
      <section className="data-control-title">
        <div><p className="control-eyebrow">ADMIN · DATA OPERATIONS</p><h1>Data Control Center</h1><p>Pantau pembaruan data, sesi, antrean, dan kapasitas server dari satu halaman.</p></div>
        <div className="control-actions"><button type="button" onClick={refreshAll} disabled={refreshing}>{refreshing ? 'Memperbarui…' : '↻ Perbarui status'}</button><button type="button" className={pipeline.data?.paused ? 'resume' : 'pause'} disabled={pauseMutation.isPending || !pipeline.data} onClick={() => pauseMutation.mutate(!pipeline.data?.paused)}>{pipeline.data?.paused ? '▶ Lanjutkan pipeline' : 'Ⅱ Jeda pipeline'}</button></div>
      </section>

      {(message || actionError) && <div className={`control-toast ${actionError ? 'error' : 'success'}`} role="status"><span>{actionError || message}</span><button type="button" aria-label="Tutup pesan" onClick={() => { setMessage(''); setActionError('') }}>×</button></div>}

      <section className="control-healthline">
        <div><i className={pipeline.data?.paused ? 'warning' : 'ok'} /> <b>{pipeline.data?.paused ? 'PIPELINE DIJEDA' : 'PIPELINE AKTIF'}</b><span>{activeWorkers.length} worker online</span></div>
        <div className={warningCount ? 'has-warning' : ''}>{warningCount ? `${warningCount} kondisi perlu diperiksa` : 'Seluruh indikator utama normal'}</div>
      </section>

      <section className="control-kpis" aria-busy={loading}>
        <article><span>ANTREAN</span><strong>{pipeline.data ? compactNumber(pipeline.data.pending) : '—'}</strong><small>Menunggu diproses</small></article>
        <article><span>SEDANG BERJALAN</span><strong className="cyan">{pipeline.data ? compactNumber(pipeline.data.running) : '—'}</strong><small>{activeWorkers.length} worker aktif</small></article>
        <article><span>GAGAL TERSIMPAN</span><strong className={(failedJobs.data?.length ?? 0) > 0 ? 'red' : 'green'}>{failedJobs.data?.length ?? '—'}</strong><small>50 pekerjaan terbaru</small></article>
        <article><span>CAKUPAN BROKER</span><strong className={broker?.status === 'healthy' ? 'green' : 'amber'}>{broker ? `${broker.coveragePercent}%` : '—'}</strong><small>{broker ? `${broker.freshSymbols}/${broker.targetSymbols} emiten · ${broker.targetDate}` : 'Memeriksa data'}</small></article>
        <article><span>CAKUPAN FUNDAMENTAL</span><strong>{service.data ? `${fundamentalCoverage}%` : '—'}</strong><small>{service.data ? `${service.data.fundamentalsSymbols}/${service.data.symbols} emiten` : 'Memeriksa data'}</small></article>
        <article><span>DATA PASAR</span><strong className="date-value">{service.data?.marketDataDate ?? '—'}</strong><small>Pembaruan terakhir tersedia</small></article>
      </section>

      <section className="control-grid">
        <article className={`control-panel control-session ${sessionNeedsLogin ? 'danger' : ''}`}>
          <div className="control-panel-head"><div><span>SESI DATA</span><h2>Akses pembaruan broker</h2></div><b className={sessionNeedsLogin ? 'badge bad' : 'badge good'}>{sessionNeedsLogin ? 'LOGIN DIPERLUKAN' : 'AKTIF'}</b></div>
          <dl><div><dt>Autentikasi</dt><dd>{dataSession.data?.authenticated ? 'Terhubung' : 'Tidak terhubung'}</dd></div><div><dt>Browser worker</dt><dd>{dataSession.data?.browserConnected ? 'Online' : 'Offline'}</dd></div><div><dt>Berlaku sampai</dt><dd>{dateTime(dataSession.data?.expiresAt)}</dd></div><div><dt>Fetch terakhir</dt><dd>{dateTime(dataSession.data?.lastFetchAt)}</dd></div></dl>
          {dataSession.data?.error && <p className="control-error-copy">{dataSession.data.error}</p>}
          <a className="control-primary-link" href="/api/account/data-session/viewer" target="_blank" rel="noreferrer">{sessionNeedsLogin ? 'Buka halaman login →' : 'Kelola sesi →'}</a>
        </article>

        <article className="control-panel">
          <div className="control-panel-head"><div><span>INFRASTRUKTUR</span><h2>Server &amp; penyimpanan</h2></div><b className={infrastructure?.apiActive && infrastructure?.workerActive && infrastructure?.nginxActive ? 'badge good' : 'badge bad'}>{infrastructure?.apiActive && infrastructure?.workerActive && infrastructure?.nginxActive ? 'NORMAL' : 'PERIKSA'}</b></div>
          <div className="disk-list"><Disk label="Root disk" used={infrastructure?.rootDiskUsedPct} free={infrastructure?.rootDiskFreeBytes} /><Disk label="Data disk" used={infrastructure?.dataDiskUsedPct} free={infrastructure?.dataDiskFreeBytes} /></div>
          <ul className="service-dots"><ServiceDot label="API" active={infrastructure?.apiActive} /><ServiceDot label="Worker" active={infrastructure?.workerActive} /><ServiceDot label="Nginx" active={infrastructure?.nginxActive} /><ServiceDot label="Backup otomatis" active={infrastructure?.backupTimerActive} /><ServiceDot label="Maintenance" active={infrastructure?.maintenanceTimerActive} /></ul>
          <p className="backup-note">Backup terakhir: {infrastructure?.backupLastUnix ? dateTime(new Date(infrastructure.backupLastUnix * 1000).toISOString()) : 'Belum tercatat'} · {bytes(infrastructure?.backupBytes)}</p>
        </article>
      </section>

      <section className="control-panel control-wide">
        <div className="control-panel-head"><div><span>SUMBER DATA</span><h2>Status sumber &amp; jadwal</h2></div><small>Perubahan berlaku pada pekerjaan berikutnya</small></div>
        <div className="control-table-scroll"><table className="control-table"><thead><tr><th>SUMBER</th><th>JENIS</th><th>STATUS</th><th>SUKSES TERAKHIR</th><th>KONTROL</th></tr></thead><tbody>{pipeline.data?.sources.map((source) => {
          const protectedSource = source.code === 'system'
          return <tr key={source.code}><td><b>{source.name}</b><small>{source.code}</small></td><td>{label(source.kind)}</td><td><span className={`status-pill ${source.enabled && source.status !== 'error' ? 'good' : source.status === 'error' ? 'bad' : 'muted'}`}>{source.enabled ? label(source.status) : 'Nonaktif'}</span>{source.lastError && <small className="row-error" title={source.lastError}>{source.lastError}</small>}</td><td>{dateTime(source.lastSuccessAt)}</td><td><button className="source-toggle" type="button" disabled={protectedSource || sourceMutation.isPending} onClick={() => sourceMutation.mutate({ code: source.code, enabled: !source.enabled })}>{protectedSource ? 'Dikelola sistem' : source.enabled ? 'Nonaktifkan' : 'Aktifkan'}</button></td></tr>
        })}</tbody></table></div>
      </section>

      <section className="control-split">
        <article className="control-panel">
          <div className="control-panel-head"><div><span>KESEGARAN DATA</span><h2>Cakupan per dataset</h2></div><small>{freshness.data?.length ?? 0} rekaman diperiksa</small></div>
          <div className="freshness-list">{freshnessGroups.length ? freshnessGroups.map((group) => <div className="freshness-row" key={group.dataset}><div><b>{label(group.dataset)}</b><small>Data pasar {group.latestMarketDate ?? '—'} · dicek {dateTime(group.checkedAt)}</small></div><div className="freshness-bar"><i style={{ width: `${pct(group.fresh, group.total)}%` }} /></div><span>{group.fresh}/{group.total}</span><em>{group.error ? `${group.error} gagal` : group.stale ? `${group.stale} usang` : `${compactNumber(group.rows)} baris`}</em></div>) : <p className="control-empty">Belum ada rekaman kesegaran data.</p>}</div>
        </article>

        <article className="control-panel">
          <div className="control-panel-head"><div><span>WORKER</span><h2>Proses yang terhubung</h2></div><b className={activeWorkers.length ? 'badge good' : 'badge bad'}>{activeWorkers.length ? `${activeWorkers.length} ONLINE` : 'OFFLINE'}</b></div>
          <div className="worker-list">{(pipeline.data?.workers ?? []).slice(0, 5).map((worker) => <div key={worker.workerId} className={isRecent(worker.heartbeatAt) ? 'online' : 'offline'}><i /><p><b>{worker.hostname || worker.workerId}</b><small>{worker.currentJobId ? `Job #${worker.currentJobId}` : label(worker.status)}</small></p><time>{dateTime(worker.heartbeatAt)}</time></div>)}</div>
        </article>
      </section>

      <section className="control-panel control-wide">
        <div className="control-panel-head"><div><span>PEKERJAAN GAGAL</span><h2>Perlu pemeriksaan atau retry</h2></div><small>{failedJobs.data?.length ?? 0} dari maksimal 50 ditampilkan</small></div>
        {failedJobs.data?.length ? <div className="control-table-scroll"><table className="control-table failed-table"><thead><tr><th>EMITEN</th><th>PEKERJAAN</th><th>SUMBER</th><th>PERCOBAAN</th><th>ERROR</th><th /></tr></thead><tbody>{failedJobs.data.map((job) => <tr key={job.id}><td><b>{job.symbol || '—'}</b><small>#{job.id}</small></td><td>{label(job.jobType)}</td><td>{label(job.sourceCode)}</td><td>{job.attempts}/{job.maxAttempts}</td><td><span className="error-text" title={job.lastError}>{job.lastError || 'Penyebab belum tercatat'}</span></td><td><button type="button" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate(job.id)}>Retry</button></td></tr>)}</tbody></table></div> : <p className="control-empty success">Tidak ada pekerjaan gagal yang perlu ditangani.</p>}
      </section>

      <section className="control-panel control-wide">
        <div className="control-panel-head"><div><span>AKTIVITAS TERBARU</span><h2>Riwayat eksekusi pipeline</h2></div><small>Total historis sukses {compactNumber(pipeline.data?.succeeded ?? 0)} · gagal {compactNumber(pipeline.data?.failed ?? 0)}</small></div>
        <div className="runs-grid">{pipeline.data?.lastRuns.slice(0, 12).map((run) => <div key={run.id}><span className={`run-status ${run.status}`}>{label(run.status)}</span><p><b>{label(run.sourceCode)}</b><small>Job #{run.jobId} · {run.itemsWritten.toLocaleString('id-ID')} ditulis</small></p><time>{dateTime(run.startedAt)}</time></div>)}</div>
      </section>
    </main>
  </div>
}

function Disk({ label: diskLabel, used, free }: { label: string; used?: number; free?: number }) {
  const safeUsed = Math.max(0, Math.min(100, used ?? 0))
  return <div className="disk-row"><div><b>{diskLabel}</b><span>{used == null ? 'Memeriksa…' : `${used}% terpakai · ${bytes(free)} tersisa`}</span></div><div><i className={safeUsed >= 85 ? 'danger' : safeUsed >= 70 ? 'warning' : ''} style={{ width: `${safeUsed}%` }} /></div></div>
}

function ServiceDot({ label: serviceLabel, active }: { label: string; active?: boolean }) {
  return <li><i className={active ? 'online' : 'offline'} /><span>{serviceLabel}</span><b>{active ? 'Aktif' : 'Berhenti'}</b></li>
}
