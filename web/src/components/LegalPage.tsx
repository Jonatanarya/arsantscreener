import { usePageMetadata } from '../hooks/usePageMetadata'

type LegalKind = 'privacy' | 'terms' | 'disclaimer'

const content: Record<LegalKind, { title: string; intro: string; sections: { title: string; paragraphs: string[] }[] }> = {
  privacy: {
    title: 'Kebijakan Privasi',
    intro: 'Kebijakan ini menjelaskan informasi yang diproses ketika Anda menggunakan Arsant Screener dan masuk dengan akun Google.',
    sections: [
      { title: 'Informasi yang diproses', paragraphs: ['Saat Anda masuk dengan Google, Arsant Screener menerima pengenal akun, nama, alamat email, dan foto profil yang disediakan Google. Kami juga menyimpan data yang Anda buat di layanan, seperti watchlist, posisi portofolio, serta pengaturan peringatan.', 'Catatan teknis yang diperlukan untuk keamanan, diagnosis gangguan, dan kestabilan layanan dapat diproses secara terbatas.'] },
      { title: 'Tujuan penggunaan', paragraphs: ['Informasi digunakan untuk mengautentikasi akun, memisahkan data antar pengguna, menyimpan preferensi, menjalankan fitur yang Anda pilih, menjaga keamanan, dan meningkatkan kestabilan layanan.'] },
      { title: 'Penyimpanan dan pembagian', paragraphs: ['Informasi akun disimpan selama diperlukan untuk menyediakan layanan dan memenuhi kewajiban yang berlaku. Akses dibatasi pada sistem serta penyedia infrastruktur yang diperlukan untuk mengoperasikan Arsant Screener.', 'Kami tidak menjual informasi pribadi. Informasi dapat diungkapkan bila diwajibkan oleh hukum atau diperlukan untuk melindungi keamanan layanan dan pengguna.'] },
      { title: 'Kontrol pengguna', paragraphs: ['Anda dapat keluar dari akun kapan saja dan mencabut akses Arsant Screener melalui pengaturan keamanan akun Google. Anda juga berhak meminta akses, koreksi, atau penghapusan informasi akun sesuai ketentuan yang berlaku.'] },
      { title: 'Perubahan kebijakan', paragraphs: ['Kebijakan dapat diperbarui mengikuti perubahan fitur atau kewajiban hukum. Tanggal pembaruan terbaru ditampilkan pada halaman ini.'] },
    ],
  },
  terms: {
    title: 'Ketentuan Penggunaan',
    intro: 'Dengan menggunakan Arsant Screener, Anda menyetujui ketentuan berikut.',
    sections: [
      { title: 'Penggunaan layanan', paragraphs: ['Layanan disediakan untuk membantu riset dan analisis pasar. Anda bertanggung jawab menjaga keamanan akun dan memastikan aktivitas melalui akun Anda sesuai hukum serta tidak mengganggu layanan atau pengguna lain.'] },
      { title: 'Akurasi dan ketersediaan', paragraphs: ['Kami berupaya menjaga data dan fitur tetap tersedia, tetapi tidak menjamin bahwa seluruh informasi selalu lengkap, tepat waktu, bebas kesalahan, atau tersedia tanpa gangguan. Informasi penting perlu diperiksa kembali sebelum digunakan.'] },
      { title: 'Hak atas layanan', paragraphs: ['Nama, tampilan, perangkat lunak, dan materi Arsant Screener dilindungi oleh hak yang berlaku. Penggunaan layanan tidak memberikan hak untuk menyalin, menjual kembali, mengganggu, atau mencoba memperoleh akses tanpa izin ke sistem.'] },
      { title: 'Perubahan dan penghentian', paragraphs: ['Fitur dan ketentuan dapat diperbarui untuk meningkatkan layanan, menjaga keamanan, atau memenuhi kewajiban hukum. Penggunaan setelah pembaruan berarti Anda menerima ketentuan terbaru.'] },
    ],
  },
  disclaimer: {
    title: 'Penafian Risiko',
    intro: 'Arsant Screener adalah alat bantu riset. Seluruh keputusan investasi tetap menjadi tanggung jawab pengguna.',
    sections: [
      { title: 'Bukan nasihat keuangan', paragraphs: ['Sinyal, skor, penyaringan saham, proyeksi, dan rencana transaksi yang ditampilkan bukan rekomendasi personal, ajakan membeli atau menjual efek, maupun jaminan hasil.'] },
      { title: 'Risiko pasar', paragraphs: ['Perdagangan dan investasi mengandung risiko kehilangan sebagian atau seluruh modal. Kinerja masa lalu, pola harga, aktivitas broker, dan hasil perhitungan tidak menjamin hasil pada masa depan.'] },
      { title: 'Tanggung jawab pengguna', paragraphs: ['Pertimbangkan kondisi keuangan, tujuan, jangka waktu, toleransi risiko, biaya transaksi, likuiditas, serta informasi resmi emiten. Bila diperlukan, konsultasikan keputusan dengan penasihat yang memiliki izin sesuai yurisdiksi Anda.'] },
      { title: 'Keterbatasan informasi', paragraphs: ['Data dapat terlambat, tidak lengkap, atau berubah setelah ditampilkan. Arsant Screener tidak bertanggung jawab atas kerugian yang timbul dari keputusan yang dibuat hanya berdasarkan informasi dalam layanan.'] },
    ],
  },
}

export function LegalPage({ kind }: { kind: LegalKind }) {
  const page = content[kind]
  usePageMetadata({ title: `${page.title} — Arsant Screener`, description: page.intro, path: `/${kind}` })
  return <div className="legal-page">
    <header className="dashboard-nav legal-nav"><a className="landing-brand" href="/"><img src="/arsant-logo.png" alt="Arsant" /><span>ARSANT <b>SCREENER</b></span></a><a className="legal-back" href="/">← Kembali</a></header>
    <main className="legal-main">
      <p className="eyebrow"><i /> INFORMASI LAYANAN</p><h1>{page.title}</h1><p className="legal-updated">Terakhir diperbarui: 4 September 2026</p><p className="legal-intro">{page.intro}</p>
      {page.sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
      <nav className="legal-links"><a href="/privacy">Privasi</a><a href="/terms">Ketentuan</a><a href="/disclaimer">Penafian risiko</a></nav>
    </main>
  </div>
}
