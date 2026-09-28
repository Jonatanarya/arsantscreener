import { useState } from 'react'

const BASE_URL = 'https://ai.arsant.my.id'

type Plan = {
  id: string
  name: string
  tokens: string
  duration: string
  price: number
  oldPrice?: number
  description: string
  badge?: string
  promo?: boolean
}

const plans: readonly Plan[] = [
  { id: '5m', name: '5.00M Token', tokens: '5.000.000', duration: '7 hari', price: 3300, description: 'Cocok untuk coba-coba' },
  { id: '10m', name: '10.00M Token', tokens: '10.000.000', duration: '7 hari', price: 4400, description: 'Pas untuk bot kecil dan skrip pribadi' },
  { id: '20m', name: '20.00M Token', tokens: '20.000.000', duration: '7 hari', price: 8700, description: 'Untuk proyek yang mulai jalan' },
  { id: '50m', name: '50.00M Token', tokens: '50.000.000', duration: '14 hari', price: 16400, description: 'Kuota menengah, harga masih ringan' },
  { id: '100m', name: '100.00M Token', tokens: '100.000.000', duration: '14 hari', price: 20000, oldPrice: 22000, description: 'Paling sering diambil', badge: 'TERLARIS', promo: true },
  { id: '200m', name: '200.00M Token', tokens: '200.000.000', duration: '21 hari', price: 40000, oldPrice: 44700, description: 'Untuk tim kecil yang aktif', promo: true },
  { id: '500m', name: '500.00M Token', tokens: '500.000.000', duration: '28 hari', price: 100000, oldPrice: 113400, description: 'Pemakaian intens tanpa sering isi ulang', promo: true },
] 

type ViewMode = 'table' | 'cards'

function formatPrice(value: number) {
  return `Rp ${value.toLocaleString('id-ID')}`
}

function CopyIcon() {
  return <span className="store-copy-icon" aria-hidden="true">▣</span>
}

export function ApiStorePage() {
  const [view, setView] = useState<ViewMode>('table')
  const [copied, setCopied] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)

  async function copyBaseUrl() {
    try {
      await navigator.clipboard.writeText(BASE_URL)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  function choosePlan(plan: Plan) {
    setSelectedPlan(plan)
    window.requestAnimationFrame(() => document.getElementById('store-order')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  return (
    <div className="api-store">
      <header className="store-nav">
        <a className="store-brand" href="/" aria-label="Arsant API home">
          <span className="store-brand-mark">A</span>
          <span>ARSANT <b>API</b></span>
        </a>
        <nav className="store-nav-links" aria-label="Navigasi utama">
          <a href="#paket">Paket</a>
          <a href="#cara-pakai">Cara pakai</a>
          <a href="/dashboard">Dashboard <span aria-hidden="true">→</span></a>
          <a href="/screener">Arsant Screener <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <main>
        <section className="store-hero">
          <div>
            <p className="store-eyebrow"><i /> AI API UNTUK PRODUK ANDA</p>
            <h1>Bangun lebih cepat.<br /><em>Bayar sesuai pakai.</em></h1>
            <p className="store-hero-copy">Token AI siap pakai untuk eksperimen, bot, dan aplikasi Anda. Satu base URL, paket fleksibel, dan masa aktif yang jelas.</p>
            <div className="store-hero-actions">
              <a className="store-primary-button" href="#paket">Lihat paket <span>↓</span></a>
              <a className="store-text-button" href="#cara-pakai">Cara integrasi <span>→</span></a>
            </div>
          </div>

          <aside className="store-endpoint-card" aria-label="Base URL API">
            <div className="store-card-label"><span className="store-pulse" /> ENDPOINT AKTIF</div>
            <p>Base URL</p>
            <strong>{BASE_URL}</strong>
            <button className="store-copy-button" type="button" onClick={copyBaseUrl}>
              <CopyIcon /> {copied ? 'Tersalin' : 'Salin base URL'}
            </button>
            <div className="store-card-foot"><span>9Router gateway</span><span>HTTPS</span></div>
          </aside>
        </section>

        <section className="store-trust-strip" aria-label="Keunggulan">
          <span><b>01</b> Satu endpoint</span>
          <span><b>02</b> Paket transparan</span>
          <span><b>03</b> Cocok untuk API client</span>
          <span><b>04</b> Base URL terpusat</span>
        </section>

        <section className="store-packages" id="paket">
          <div className="store-section-head">
            <div>
              <p className="store-eyebrow"><i /> PILIH SESUAI KEBUTUHAN</p>
              <h2>Paket token AI</h2>
              <p>Kuota dihitung dari total pemakaian, bukan per model.</p>
            </div>
            <div className="store-view-controls" aria-label="Tampilan paket">
              <button type="button" className={view === 'table' ? 'is-active' : ''} onClick={() => setView('table')}>Tabel</button>
              <button type="button" className={view === 'cards' ? 'is-active' : ''} onClick={() => setView('cards')}>Kartu</button>
            </div>
          </div>

          {view === 'table' ? (
            <div className="store-table-wrap">
              <table className="store-table">
                <thead>
                  <tr><th>Paket</th><th>Kuota token</th><th>Masa aktif</th><th>Harga</th><th aria-label="Pilih paket" /></tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr className={selectedPlan?.id === plan.id ? 'is-selected' : ''} key={plan.id}>
                      <td><div className="store-plan-title"><b>{plan.name}</b>{plan.badge && <span>{plan.badge}</span>}{plan.promo && <span>PROMO</span>}</div><small>{plan.description}</small></td>
                      <td>{plan.tokens} token</td>
                      <td>{plan.duration}</td>
                      <td><div className="store-price">{plan.oldPrice && <del>{formatPrice(plan.oldPrice)}</del>}<strong>{formatPrice(plan.price)}</strong></div></td>
                      <td><button className={`store-select-button ${plan.promo ? 'is-promo' : ''}`} type="button" onClick={() => choosePlan(plan)}>Pilih</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="store-card-grid">
              {plans.map((plan) => (
                <article className={`store-plan-card ${plan.promo ? 'is-promo' : ''} ${selectedPlan?.id === plan.id ? 'is-selected' : ''}`} key={plan.id}>
                  <div className="store-plan-card-top"><span>{plan.badge || (plan.promo ? 'PROMO' : 'PAKET API')}</span>{plan.duration}</div>
                  <h3>{plan.name}</h3>
                  <p>{plan.description}</p>
                  <div className="store-plan-card-price">{plan.oldPrice && <del>{formatPrice(plan.oldPrice)}</del>}<strong>{formatPrice(plan.price)}</strong></div>
                  <div className="store-plan-card-meta"><span>{plan.tokens} token</span><span>·</span><span>{plan.duration}</span></div>
                  <button className="store-select-button is-wide" type="button" onClick={() => choosePlan(plan)}>Pilih paket <span>→</span></button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="store-order" id="store-order" aria-live="polite">
          <div>
            <p className="store-eyebrow"><i /> PESANAN ANDA</p>
            <h2>{selectedPlan ? `Paket ${selectedPlan.name}` : 'Siap mulai?'}</h2>
            <p>{selectedPlan ? `${selectedPlan.tokens} token untuk ${selectedPlan.duration}. Pilihan paket sudah tersimpan di perangkat ini.` : 'Pilih salah satu paket di atas untuk menyiapkan pesanan.'}</p>
          </div>
          <button className="store-order-button" type="button" disabled={!selectedPlan} onClick={() => window.alert('Checkout dan penerbitan API key akan diaktifkan setelah payment gateway terhubung.')}>Lanjutkan pesanan <span>→</span></button>
        </section>

        <section className="store-how" id="cara-pakai">
          <div>
            <p className="store-eyebrow"><i /> CARA PAKAI</p>
            <h2>Mulai dari satu<br /><em>base URL.</em></h2>
          </div>
          <ol>
            <li><b>01</b><div><h3>Pilih paket</h3><p>Tentukan kuota token dan masa aktif sesuai pemakaian aplikasi Anda.</p></div></li>
            <li><b>02</b><div><h3>Terima API key</h3><p>Setelah pembayaran terhubung, key akan diterbitkan untuk akun Anda.</p></div></li>
            <li><b>03</b><div><h3>Gunakan endpoint</h3><p>Arahkan client ke base URL Arsant dan simpan key di environment variable.</p></div></li>
          </ol>
        </section>

        <section className="store-code-card" aria-label="Contoh konfigurasi">
          <div><span>CONTOH KONFIGURASI</span><h2>Pasang di aplikasi Anda.</h2><p>Jangan menaruh API key langsung di frontend atau repository publik.</p></div>
          <pre><code><span className="code-muted">ARSANT_BASE_URL</span>=<span className="code-string">{BASE_URL}</span>{'\n'}<span className="code-muted">ARSANT_API_KEY</span>=<span className="code-string">your_api_key</span></code></pre>
        </section>
      </main>

      <footer className="store-footer"><a className="store-brand" href="/"><span className="store-brand-mark">A</span><span>ARSANT <b>API</b></span></a><span>© 2026 Arsant. API gateway untuk produk Anda.</span><a href="https://ai.arsant.my.id">Buka gateway ↗</a></footer>
    </div>
  )
}
