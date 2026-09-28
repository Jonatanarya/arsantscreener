import { type FormEvent, useState } from 'react'
import { usePageMetadata } from '../hooks/usePageMetadata'

export function NotFoundPage() {
  const [symbol, setSymbol] = useState('')
  usePageMetadata({ title: 'Halaman Tidak Ditemukan — Arsant Screener', description: 'Halaman yang Anda cari tidak tersedia.', path: window.location.pathname, noIndex: true })
  function submit(event: FormEvent) {
    event.preventDefault()
    const clean = symbol.toUpperCase().trim().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    if (clean) window.location.assign(`/stock/${clean}`)
  }
  return <main className="not-found-page"><section><a className="landing-brand" href="/"><img src="/arsant-logo.png" alt="Arsant" /><span>ARSANT <b>SCREENER</b></span></a><strong>404</strong><h1>Halaman tidak ditemukan</h1><p>Alamat mungkin tidak tepat atau halaman sudah dipindahkan.</p><form onSubmit={submit}><input value={symbol} onChange={(event)=>setSymbol(event.target.value)} placeholder="Cari kode emiten, mis. BBCA" aria-label="Cari kode emiten"/><button type="submit">Cari saham</button></form><nav><a href="/">Beranda</a><a href="/dashboard">Dashboard</a><a href="/trade">Trade</a></nav></section></main>
}
