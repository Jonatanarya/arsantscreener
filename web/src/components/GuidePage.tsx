import { usePageMetadata } from '../hooks/usePageMetadata'

const methods = [
  ['Quant Decision', 'Ringkasan keputusan menggabungkan bukti yang tersedia dari struktur harga, volume, fase pasar, aliran broker, transaksi, katalis, dan valuasi. Data yang belum tersedia tidak diberi nilai pengganti.'],
  ['Confidence', 'Tingkat keyakinan menunjukkan kelengkapan dan keselarasan sumber data. Confidence tinggi berarti lebih banyak sumber tersedia dan saling mendukung; bukan jaminan prediksi akan benar.'],
  ['Fase akumulasi dan distribusi', 'Fase memperkirakan kecenderungan pembelian atau penjualan berdasarkan hubungan harga, volume, serta aliran broker dalam jendela waktu tertentu. Kondisi dapat berubah ketika data baru masuk.'],
  ['PVA / analisis harga-volume', 'PVA membaca hubungan perubahan harga, rentang candle, dan volume untuk mengenali penguatan, pelemahan, klimaks, atau divergensi. Periksa bersama tren dan likuiditas.'],
  ['Kesiapan dan likuiditas', 'Filter Siap Analisis mensyaratkan harga tersedia, sedikitnya 20 hari histori, dan rata-rata nilai transaksi minimal Rp1 miliar per hari.'],
  ['Sentimen berita', 'Label positif, negatif, atau netral dihitung dari konteks bahasa pada judul dan ringkasan. Label ini adalah penyaring awal dan tetap perlu diperiksa bersama isi berita.'],
]
const faqs = [
  ['Mengapa sebagian emiten menampilkan tanda kosong?', 'Jenis data untuk setiap emiten tidak selalu tersedia pada waktu yang sama. Arsant menampilkan status apa adanya dan tidak membuat angka pengganti ketika data belum cukup.'],
  ['Seberapa sering data diperbarui?', 'Pembaruan dilakukan secara berkala sesuai jenis data. Tanggal atau waktu terbaru ditampilkan pada panel dan halaman emiten agar Anda dapat menilai kesegarannya.'],
  ['Apakah sinyal BELI merupakan rekomendasi investasi?', 'Tidak. Sinyal adalah hasil perhitungan berdasarkan data yang tersedia dan berfungsi sebagai titik awal riset. Keputusan dan risiko tetap menjadi tanggung jawab pengguna.'],
  ['Mengapa hasil scanner dapat berubah?', 'Harga, volume, aliran transaksi, dan kelengkapan data berubah. Emiten dapat masuk atau keluar ketika kondisi pasar atau kesiapan datanya berubah.'],
  ['Apa arti Confidence Terbatas?', 'Bukti yang tersedia belum cukup banyak atau belum selaras. Gunakan hasil dengan kehati-hatian lebih tinggi dan periksa panel data yang masih kosong.'],
  ['Bagaimana memulai analisis?', 'Buka Arsant Trade, pilih emiten Siap Analisis, baca Quant Decision, lalu validasi chart, PVA, broker flow, fundamental, berita, dan risiko.'],
  ['Apakah saya harus login?', 'Halaman publik dapat dibuka tanpa login. Login Google diperlukan untuk fitur pribadi seperti watchlist, posisi, dan pengaturan akun.'],
  ['Bagaimana menghapus akun?', 'Buka halaman Akun, pilih penghapusan akun, lalu ikuti konfirmasi. Profil, watchlist, posisi, dan pengaturan akun akan dihapus.'],
]

export function GuidePage({ kind }: { kind: 'methodology' | 'help' }) {
  const methodology = kind === 'methodology'
  const title = methodology ? 'Metodologi Arsant' : 'Bantuan & FAQ'
  const intro = methodology ? 'Cara membaca skor, fase, volume, likuiditas, dan tingkat keyakinan di Arsant Screener.' : 'Jawaban singkat untuk penggunaan Arsant Screener, kesegaran data, akun, dan hasil analisis.'
  usePageMetadata({ title: `${title} — Arsant Screener`, description: intro, path: methodology ? '/methodology' : '/help' })
  const items = methodology ? methods : faqs
  return <div className="guide-page"><header className="dashboard-nav guide-nav"><a className="landing-brand" href="/"><img src="/arsant-logo.png" alt="Arsant"/><span>ARSANT <b>SCREENER</b></span></a><nav><a href={methodology?'/help':'/methodology'}>{methodology?'Bantuan & FAQ':'Metodologi'}</a><a className="guide-open" href="/trade">Arsant Trade →</a></nav></header><main className="guide-main"><p className="eyebrow"><i/> PUSAT PENGETAHUAN</p><h1>{title}</h1><p className="guide-intro">{intro}</p><div className={methodology?'method-grid':'faq-list'}>{items.map(([heading,text], index) => methodology ? <article key={heading}><span>{String(index+1).padStart(2,'0')}</span><h2>{heading}</h2><p>{text}</p></article> : <details key={heading} open={index===0}><summary>{heading}<i>+</i></summary><p>{text}</p></details>)}</div>{methodology && <section className="method-note"><h2>Cara memakai hasil dengan benar</h2><ol><li>Periksa tanggal dan kelengkapan data.</li><li>Gunakan scanner untuk mempersempit kandidat.</li><li>Validasi beberapa jenis bukti, bukan satu skor saja.</li><li>Tentukan risiko dan kondisi pembatalan sebelum mengambil posisi.</li></ol></section>}<nav className="guide-actions"><a href="/trade">Buka Arsant Trade</a><a href={methodology?'/help':'/methodology'}>{methodology?'Baca FAQ':'Pelajari metodologi'}</a></nav></main></div>
}
