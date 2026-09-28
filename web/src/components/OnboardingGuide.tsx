import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAccountSession } from '../api/client'

const storageKey = 'arsant_onboarding_complete_v1'
const steps = [
  { number: '01', title: 'Mulai dari Scanner Pasar', text: 'Gunakan filter Siap Analisis untuk melihat emiten yang sudah mempunyai harga, histori, dan likuiditas minimum.' },
  { number: '02', title: 'Pilih emiten', text: 'Klik emiten pada scanner atau ketik kode saham di kotak perintah. Panel yang terhubung akan mengikuti simbol aktif.' },
  { number: '03', title: 'Baca keputusan', text: 'Mulai dari Quant Decision. Perhatikan verdict, confidence, alasan skor, serta data yang masih belum tersedia.' },
  { number: '04', title: 'Validasi bukti', text: 'Periksa chart, PVA, broker flow, fundamental, kepemilikan, dan berita. Jangan mengambil keputusan hanya dari satu indikator.' },
  { number: '05', title: 'Simpan dan kelola risiko', text: 'Tambahkan kandidat ke watchlist. Tentukan batas risiko, stop loss, target, dan ukuran posisi sebelum melakukan transaksi.' },
]

export function OnboardingGuide() {
  const session = useQuery({ queryKey: ['account-session'], queryFn: fetchAccountSession, staleTime: 60_000 })
  const [step, setStep] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!session.data?.authenticated) return
    const requested = new URLSearchParams(window.location.search).get('guide') === '1'
    if (requested || localStorage.getItem(storageKey) !== '1') setOpen(true)
  }, [session.data?.authenticated])
  function finish() {
    localStorage.setItem(storageKey, '1')
    setOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('guide')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }
  if (!open) return null
  const item = steps[step]
  return <div className="onboarding-backdrop"><section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><div className="onboarding-progress" style={{gridTemplateColumns:`repeat(${steps.length},1fr)`}}>{steps.map((_, index) => <i key={index} className={index <= step ? 'active' : ''} />)}</div><span className="onboarding-number">{item.number} / {String(steps.length).padStart(2,'0')}</span><h2 id="onboarding-title">{item.title}</h2><p>{item.text}</p>{step===2&&<a className="onboarding-learn" href="/methodology">Pelajari arti skor dan confidence →</a>}<div className="onboarding-actions"><button className="onboarding-skip" onClick={finish}>Lewati panduan</button>{step > 0 && <button className="onboarding-back" onClick={() => setStep(step - 1)}>Kembali</button>}<button className="onboarding-next" onClick={() => step === steps.length - 1 ? finish() : setStep(step + 1)}>{step === steps.length - 1 ? 'Mulai menggunakan' : 'Lanjut'}</button></div></section></div>
}
