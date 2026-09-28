import { useEffect, useState } from 'react'
import { deleteAccount, fetchAccountSession, logoutAccount, type AccountSession } from '../api/client'
import { usePageMetadata } from '../hooks/usePageMetadata'

export function AccountPage() {
  usePageMetadata({ title: 'Akun — Arsant Screener', description: 'Kelola akun Arsant Screener Anda.', path: '/account', noIndex: true })
  const [session,setSession]=useState<AccountSession|null>(null)
  const [deleteOpen,setDeleteOpen]=useState(false)
  const [confirmation,setConfirmation]=useState('')
  const [deleting,setDeleting]=useState(false)
  const [deleteError,setDeleteError]=useState('')
  const [deleted,setDeleted]=useState(false)
  useEffect(()=>{fetchAccountSession().then(setSession).catch(()=>setSession({authenticated:false}))},[])
  if(deleted)return <main className="account-page"><section className="account-card"><a href="/">ARSANT SCREENER</a><h1>Akun telah dihapus</h1><p>Profil dan data pribadi Anda di Arsant Screener telah dihapus.</p><div className="account-actions"><a href="/">Kembali ke beranda</a></div></section></main>
  if(session?.authenticated)return <main className="account-page"><section className="account-card"><a href="/">ARSANT SCREENER</a><h1>Akun Anda</h1><p>{session.user?.name}</p><p>{session.user?.email}</p><div className="account-actions"><a href="/trade">Buka Trade</a><button onClick={async()=>{await logoutAccount();setSession({authenticated:false})}}>Keluar</button></div><button className="account-guide-button" onClick={()=>{localStorage.removeItem('arsant_onboarding_complete_v1');window.location.assign('/help')}}>Buka panduan penggunaan</button><div className="account-danger"><h2>Hapus akun</h2><p>Tindakan ini menghapus profil, seluruh watchlist, posisi portofolio, dan pengaturan peringatan Anda secara permanen.</p>{!deleteOpen?<button onClick={()=>setDeleteOpen(true)}>Mulai penghapusan</button>:<div className="account-delete-confirm"><label>Ketik <b>HAPUS AKUN</b> untuk melanjutkan<input value={confirmation} onChange={(event)=>setConfirmation(event.target.value)} autoComplete="off" /></label>{deleteError&&<p className="account-error">{deleteError}</p>}<div><button onClick={()=>{setDeleteOpen(false);setConfirmation('');setDeleteError('')}}>Batal</button><button disabled={confirmation!=='HAPUS AKUN'||deleting} onClick={async()=>{setDeleting(true);setDeleteError('');try{await deleteAccount(confirmation);setDeleted(true);setSession({authenticated:false})}catch{setDeleteError('Akun belum dapat dihapus. Silakan coba kembali.')}finally{setDeleting(false)}}}>{deleting?'Menghapus…':'Hapus permanen'}</button></div></div>}</div></section></main>
  return <main className="account-page"><section className="account-card"><a href="/">ARSANT SCREENER</a><h1>Masuk ke Arsant</h1><p>Gunakan akun Google. Portfolio dan data pribadi akan disimpan terpisah untuk akun Anda.</p><div className="account-actions"><a href="/api/account/google?returnTo=/trade">Lanjutkan dengan Google</a></div><p className="account-legal">Dengan melanjutkan, Anda menyetujui <a href="/terms">Ketentuan</a> dan telah membaca <a href="/privacy">Kebijakan Privasi</a>.</p></section></main>
}
