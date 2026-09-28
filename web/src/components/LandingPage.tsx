import { useQuery } from '@tanstack/react-query'
import { fetchBrokers, fetchSymbols } from '../api/client'
import { usePageMetadata } from '../hooks/usePageMetadata'

const features = [
  ['Screener terarah', 'Temukan saham dengan kombinasi teknikal, likuiditas, valuasi, dan akumulasi broker.'],
  ['Broker flow', 'Baca pergerakan akumulasi dan distribusi untuk melihat siapa yang menggerakkan harga.'],
  ['Data terpusat', 'Data pasar, laporan keuangan, aksi korporasi, dan kepemilikan tersaji dalam satu ruang analisis.'],
]

export function LandingPage() {
  usePageMetadata({ title: 'Arsant Screener — Analisis Saham Indonesia', description: 'Screener saham Indonesia dengan chart, broker flow, fundamental, kepemilikan, dan sinyal kuantitatif dalam satu workspace.', path: '/' })
  const symbols = useQuery({ queryKey: ['symbols'], queryFn: fetchSymbols, staleTime: 5 * 60_000 })
  const brokers = useQuery({ queryKey: ['brokers'], queryFn: fetchBrokers, staleTime: 24 * 60 * 60_000 })

  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Arsant Screener home">
          <img src="/arsant-logo.png" alt="Arsant" />
          <span>ARSANT <b>SCREENER</b></span>
        </a>
        <nav>
          <a href="/dashboard">Dashboard</a>
          <a href="#fitur">Fitur</a>
          <a href="#cara-kerja">Cara kerja</a>
          <a href="/account">Masuk</a>
          <a className="nav-cta" href="/trade">Buka Trade <span>↗</span></a>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <p className="eyebrow"><i /> INTELLIGENCE UNTUK PASAR INDONESIA</p>
            <h1>Temukan peluang.<br /><em>Ambil keputusan</em> lebih jernih.</h1>
            <p className="hero-description">Arsant Screener menyatukan screener, chart, broker flow, dan data fundamental dalam satu workspace yang dibangun untuk investor Indonesia.</p>
            <div className="hero-actions">
              <a className="button-primary" href="/dashboard">Lihat dashboard <span>→</span></a>
              <a className="button-quiet" href="#fitur">Lihat fitur <span>↓</span></a>
            </div>
            <div className="hero-trust">
              <span><b>{symbols.data?.length ?? '—'}</b> emiten terindeks</span>
              <span><b>{brokers.data?.length ?? '—'}</b> broker dipantau</span>
              <span><i className="live-dot" /> data terus diperbarui</span>
            </div>
          </div>
          <div className="hero-terminal" aria-label="Preview Arsant Screener">
            <div className="preview-top"><span className="preview-mark">A</span><span>ARSANT / PREVIEW WORKSPACE</span><small>ILUSTRASI</small></div>
            <div className="preview-title"><div><small>IDX COMPOSITE</small><strong>7,248.31</strong><span className="positive">+0.84%</span></div><div className="mini-bars"><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
            <div className="preview-grid">
              <article><small>TOP ACCUMULATION</small><b>BBCA</b><span className="positive">+2.14%</span><div className="meter"><i style={{ width: '82%' }} /></div></article>
              <article><small>TOP MOMENTUM</small><b>TLKM</b><span className="positive">+1.63%</span><div className="meter"><i style={{ width: '67%' }} /></div></article>
              <article><small>BROKER FLOW</small><b>NET BUY</b><span className="positive">Rp 48.2B</span><div className="meter"><i style={{ width: '74%' }} /></div></article>
              <article><small>MARKET BREADTH</small><b>318 : 241</b><span className="muted">naik : turun</span><div className="meter"><i style={{ width: '58%' }} /></div></article>
            </div>
            <div className="preview-bottom"><span>CONTOH TAMPILAN PRODUK</span><span>ARSANT SCREENER</span></div>
          </div>
        </section>

        <section className="logo-strip"><span>BUILT FOR</span><b>SCREENER</b><b>CHART</b><b>BROKER FLOW</b><b>MARKET INTEL</b><b>PORTFOLIO</b></section>

        <section className="feature-section" id="fitur">
          <div className="section-heading"><p className="eyebrow"><i /> SATU WORKSPACE</p><h2>Data yang relevan,<br />pada saat Anda membutuhkannya.</h2></div>
          <div className="feature-grid">
            {features.map(([title, description], index) => <article className="feature-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p><a href="/trade">Jelajahi <b>→</b></a></article>)}
          </div>
        </section>

        <section className="process-section" id="cara-kerja">
          <div><p className="eyebrow"><i /> CARA KERJA</p><h2>Lebih sedikit noise.<br /><em>Lebih banyak conviction.</em></h2></div>
          <ol><li><b>01</b><div><h3>Saring pasar</h3><p>Mulai dari saham yang memenuhi parameter strategi Anda.</p></div></li><li><b>02</b><div><h3>Validasi momentum</h3><p>Bandingkan struktur harga, volume, dan aliran broker.</p></div></li><li><b>03</b><div><h3>Kelola keputusan</h3><p>Simpan pantauan, pantau risiko, dan evaluasi posisi.</p></div></li></ol>
        </section>

        <section className="landing-cta"><p className="eyebrow"><i /> ARSANT SCREENER</p><h2>Pasar bergerak cepat.<br /><em>Workspace Anda juga.</em></h2><a className="button-primary" href="/trade">Buka Arsant Trade <span>→</span></a></section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-main">
          <div className="landing-footer-brand">
            <a className="landing-brand" href="/"><img src="/arsant-logo.png" alt="" /><span>ARSANT <b>SCREENER</b></span></a>
            <p>Workspace analisis saham Indonesia untuk menyaring pasar, memeriksa momentum, dan mengelola keputusan dengan lebih terstruktur.</p>
            <a className="landing-footer-status" href="/status"><i /> Status layanan</a>
          </div>
          <nav aria-label="Produk"><strong>PRODUK</strong><a href="/dashboard">Dashboard Pasar</a><a href="/trade">Arsant Trade</a><a href="/stock/BBCA">Detail Saham</a></nav>
          <nav aria-label="Informasi"><strong>INFORMASI</strong><a href="/methodology">Metodologi</a><a href="/help">Bantuan & FAQ</a><a href="/status">Status Layanan</a><a href="/account">Akun</a></nav>
          <nav aria-label="Legal"><strong>LEGAL</strong><a href="/privacy">Kebijakan Privasi</a><a href="/terms">Ketentuan</a><a href="/disclaimer">Penafian Risiko</a></nav>
        </div>
        <div className="landing-footer-bottom"><span>© 2026 Arsant. Seluruh hak dilindungi.</span><p>Arsant Screener adalah alat bantu riset dan analisis, bukan rekomendasi atau jaminan hasil investasi.</p></div>
      </footer>
    </div>
  )
}
