import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Session = {
  authenticated: boolean
  user?: { name?: string; email?: string; avatarUrl?: string }
}

type ApiKey = {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt?: string | null
}

type AccountSummary = {
  creditsRemaining: number
  creditsTotal: number
  creditsUsed: number
  activeKeys: number
  planName: string
  expiresAt?: string | null
}

type UsagePoint = { label: string; value: number }

const emptySummary: AccountSummary = {
  creditsRemaining: 0,
  creditsTotal: 0,
  creditsUsed: 0,
  activeKeys: 0,
  planName: 'Belum ada paket aktif',
  expiresAt: null,
}

function formatCredits(value: number) {
  return value.toLocaleString('id-ID')
}

function GoogleIcon() {
  return <span className="user-google-icon" aria-hidden="true">G</span>
}

function KeyIcon() {
  return <span className="user-key-icon" aria-hidden="true">⌁</span>
}

export function UserDashboardPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [summary, setSummary] = useState<AccountSummary>(emptySummary)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [usage, setUsage] = useState<UsagePoint[]>([])
  const [showCreateKey, setShowCreateKey] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadAccount() {
      try {
        const response = await fetch('/api/auth/session', { credentials: 'include' })
        const nextSession = response.ok ? await response.json() as Session : { authenticated: false }
        if (cancelled) return
        setSession(nextSession)

        if (!nextSession.authenticated) return

        const [summaryResponse, keysResponse, usageResponse] = await Promise.all([
          fetch('/api/account/summary', { credentials: 'include' }),
          fetch('/api/account/keys', { credentials: 'include' }),
          fetch('/api/account/usage?period=30d', { credentials: 'include' }),
        ])
        if (cancelled) return
        if (summaryResponse.ok) setSummary(await summaryResponse.json() as AccountSummary)
        if (keysResponse.ok) setKeys(await keysResponse.json() as ApiKey[])
        if (usageResponse.ok) setUsage(await usageResponse.json() as UsagePoint[])
      } catch {
        if (!cancelled) setSession({ authenticated: false })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAccount()
    return () => { cancelled = true }
  }, [])

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice('')
    try {
      const response = await fetch('/api/account/keys', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName.trim() || 'API key utama' }),
      })
      if (!response.ok) throw new Error('create key failed')
      const created = await response.json() as ApiKey
      setKeys((current) => [created, ...current])
      setSummary((current) => ({ ...current, activeKeys: current.activeKeys + 1 }))
      setKeyName('')
      setShowCreateKey(false)
      setNotice('API key berhasil dibuat. Simpan secret key saat pertama kali ditampilkan.')
    } catch {
      setNotice('API key belum dapat dibuat. Backend provisioning belum terhubung.')
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined)
    setSession({ authenticated: false })
    setKeys([])
    setUsage([])
    setSummary(emptySummary)
  }

  if (loading) {
    return <div className="user-dashboard user-dashboard-loading"><div className="user-loading-mark">A</div><p>Memuat dashboard…</p></div>
  }

  if (!session?.authenticated) {
    return <div className="user-dashboard">
      <header className="user-nav">
        <a className="store-brand" href="/" aria-label="Arsant API home"><span className="store-brand-mark">A</span><span>ARSANT <b>API</b></span></a>
        <a className="user-nav-back" href="/">← Kembali ke paket</a>
      </header>
      <main className="user-auth-main">
        <section className="user-auth-card">
          <p className="store-eyebrow"><i /> DASHBOARD PELANGGAN</p>
          <h1>Semua API Anda,<br /><em>satu tempat.</em></h1>
          <p className="user-auth-copy">Masuk untuk membuat API key, melihat pemakaian token, dan memantau sisa credit dari paket Anda.</p>
          <a className="user-google-button" href="/api/auth/google?returnTo=%2Fdashboard"><GoogleIcon /> Masuk dengan Google <span>→</span></a>
          <p className="user-auth-note">Login menggunakan akun Google. Kami tidak meminta atau menyimpan password Google Anda.</p>
        </section>
        <aside className="user-auth-side">
          <div className="user-endpoint-mini"><span className="store-pulse" /> ENDPOINT API<div>{'https://ai.arsant.my.id'}</div></div>
          <ol>
            <li><b>01</b><span><strong>Create API key</strong><small>Buat key berbeda untuk setiap aplikasi.</small></span></li>
            <li><b>02</b><span><strong>Cek pemakaian</strong><small>Lihat pemakaian token secara berkala.</small></span></li>
            <li><b>03</b><span><strong>Kelola credit</strong><small>Pantau saldo dan masa aktif paket.</small></span></li>
          </ol>
        </aside>
      </main>
      <footer className="user-footer"><span>© 2026 Arsant API</span><a href="/">Lihat paket token ↗</a></footer>
    </div>
  }

  const usagePercent = summary.creditsTotal > 0 ? Math.min(100, Math.round(summary.creditsUsed / summary.creditsTotal * 100)) : 0
  const maxUsage = Math.max(...usage.map((point) => point.value), 1)

  return <div className="user-dashboard">
    <header className="user-nav">
      <a className="store-brand" href="/" aria-label="Arsant API home"><span className="store-brand-mark">A</span><span>ARSANT <b>API</b></span></a>
      <nav className="user-nav-links"><a href="/">Paket</a><a href="#usage">Usage</a><a className="user-nav-active" href="/dashboard">Dashboard</a></nav>
      <div className="user-account"><span>{session.user?.name || session.user?.email || 'Akun Google'}</span><button type="button" onClick={logout}>Keluar</button></div>
    </header>
    <main className="user-main">
      <section className="user-titlebar"><div><p className="store-eyebrow"><i /> DASHBOARD PELANGGAN</p><h1>Halo, {session.user?.name?.split(' ')[0] || 'developer'}.</h1><p>Kelola API key dan pantau pemakaian gateway Anda.</p></div><div className="user-endpoint-badge"><span className="store-pulse" /> GATEWAY AKTIF<strong>ai.arsant.my.id</strong></div></section>

      <section className="user-stats">
        <article className="user-stat-highlight"><small>CREDIT TERSISA</small><strong>{formatCredits(summary.creditsRemaining)}</strong><span>dari {formatCredits(summary.creditsTotal)} total</span><div className="user-progress"><i style={{ width: `${100 - usagePercent}%` }} /></div></article>
        <article><small>PEMAKAIAN 30 HARI</small><strong>{formatCredits(summary.creditsUsed)}</strong><span>token terpakai</span></article>
        <article><small>API KEY AKTIF</small><strong>{summary.activeKeys}</strong><span>key terdaftar</span></article>
        <article><small>PAKET AKTIF</small><strong className="user-plan-value">{summary.planName}</strong><span>{summary.expiresAt ? `aktif sampai ${summary.expiresAt}` : 'belum ada paket'}</span></article>
      </section>

      <section className="user-grid">
        <div className="user-panel user-keys-panel">
          <div className="user-panel-head"><div><span className="user-panel-kicker">ACCESS CONTROL</span><h2>API key Anda</h2></div><button className="user-dark-button" type="button" onClick={() => { setShowCreateKey(true); setNotice('') }}>+ Buat API key</button></div>
          {showCreateKey && <form className="user-create-form" onSubmit={createKey}><label htmlFor="key-name">Nama key</label><div><input id="key-name" autoFocus value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Contoh: aplikasi produksi" /><button type="submit">Buat key</button></div></form>}
          {notice && <p className="user-notice">{notice}</p>}
          {keys.length === 0 ? <div className="user-empty"><KeyIcon /><h3>Belum ada API key</h3><p>Buat key untuk mulai mengakses <code>ai.arsant.my.id</code>.</p><button type="button" onClick={() => setShowCreateKey(true)}>Buat API key pertama →</button></div> : <div className="user-key-list">{keys.map((key) => <div className="user-key-row" key={key.id}><span className="user-key-symbol"><KeyIcon /></span><div><strong>{key.name}</strong><small>{key.prefix}•••••••• · dibuat {key.createdAt}</small></div><span className="user-key-status">AKTIF</span></div>)}</div>}
        </div>

        <div className="user-panel user-usage-panel" id="usage">
          <div className="user-panel-head"><div><span className="user-panel-kicker">TOKEN ACTIVITY</span><h2>Usage 30 hari</h2></div><span className="user-period">30 HARI⌄</span></div>
          {usage.length === 0 ? <div className="user-empty user-empty-usage"><div className="user-usage-placeholder"><i /><i /><i /><i /><i /><i /><i /></div><p>Data usage akan muncul setelah API key digunakan.</p></div> : <div className="user-usage-chart">{usage.map((point) => <div className="user-chart-column" key={point.label}><span style={{ height: `${Math.max(5, point.value / maxUsage * 100)}%` }} /><small>{point.label}</small></div>)}</div>}
        </div>
      </section>

      <section className="user-bottom-grid">
        <div className="user-panel user-quickstart"><span className="user-panel-kicker">QUICK START</span><h2>Hubungkan aplikasi Anda.</h2><p>Gunakan base URL berikut dan simpan API key sebagai environment variable.</p><div className="user-code-line"><span>BASE URL</span><code>https://ai.arsant.my.id</code></div><div className="user-code-line"><span>AUTH</span><code>Authorization: Bearer YOUR_API_KEY</code></div></div>
        <div className="user-panel user-plan-panel"><span className="user-panel-kicker">PAKET SAAT INI</span><h2>{summary.planName}</h2><div className="user-plan-progress"><div><span>Credit terpakai</span><b>{usagePercent}%</b></div><div className="user-progress"><i style={{ width: `${usagePercent}%` }} /></div></div><a href="/#paket">Tambah credit / upgrade →</a></div>
      </section>
    </main>
    <footer className="user-footer"><span>© 2026 Arsant API</span><span>Base URL <b>ai.arsant.my.id</b></span><a href="/">Beli paket token ↗</a></footer>
  </div>
}
