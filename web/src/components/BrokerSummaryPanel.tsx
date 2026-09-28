import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchBrokerSummary, fetchBrokerSummaryAvailability, type BrokerRow, type BrokerMaster } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'
import { useBrokerMaster, flowMark, avgPerTrx } from '../lib/brokers'

const fmtLot = (v: number) => v.toLocaleString('id-ID')
const fmtNum = (v: number) => Math.round(v).toLocaleString('id-ID')
const fmtSigned = (v: number, fmt: (v: number) => string) => (v > 0 ? '+' : '') + fmt(v)

type Mode = 'net' | 'gross'

// Baris per broker: buyers[] dan sellers[] dari server dikunci per sisi (satu
// broker cuma muncul di satu sisi per query) — digabung di sini per brokerCode
// supaya beli & jual broker yang sama tampil dalam satu baris.
type MergedBroker = {
  brokerCode: string
  buyVal: number; buyLot: number
  sellVal: number; sellLot: number
  netVal: number; netLot: number
  grossVal: number
  freq: number
  avgTrx: number       // nilai rata-rata per transaksi
  investorType: string // domisili aliran dana ("Asing"/"Lokal"/"Campuran")
}

function mergeBrokers(buyers: BrokerRow[], sellers: BrokerRow[]): MergedBroker[] {
  const byCode = new Map<string, MergedBroker>()
  const get = (code: string) => {
    let m = byCode.get(code)
    if (!m) {
      m = {
        brokerCode: code, buyVal: 0, buyLot: 0, sellVal: 0, sellLot: 0,
        netVal: 0, netLot: 0, grossVal: 0, freq: 0, avgTrx: 0, investorType: '',
      }
      byCode.set(code, m)
    }
    return m
  }
  const noteDom = (m: MergedBroker, t?: string) => {
    const v = String(t ?? '').trim()
    if (!v) return
    m.investorType = m.investorType && m.investorType !== v ? 'Campuran' : v
  }
  for (const r of buyers) {
    const m = get(r.brokerCode)
    m.buyVal += r.value; m.buyLot += r.lot; m.freq += r.freq
    noteDom(m, r.investorType)
  }
  for (const r of sellers) {
    const m = get(r.brokerCode)
    m.sellVal += r.value; m.sellLot += r.lot; m.freq += r.freq
    noteDom(m, r.investorType)
  }
  for (const m of byCode.values()) {
    m.netVal = m.buyVal - m.sellVal
    m.netLot = m.buyLot - m.sellLot
    m.grossVal = m.buyVal + m.sellVal
    m.avgTrx = avgPerTrx(m.grossVal, m.freq)
  }
  return [...byCode.values()]
}

const th = (extra?: React.CSSProperties): React.CSSProperties => ({
  textAlign: 'right', padding: '4px 8px', fontWeight: 400, ...extra,
})

function BrokerCell({ row, master }: { row: MergedBroker; master: Map<string, BrokerMaster> }) {
  const m = master.get(row.brokerCode)
  const mark = flowMark(row.brokerCode, row.investorType, master)
  return (
    <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }} title={m?.name ? `${m.name} — ${mark.title}` : mark.title}>
      <span style={{ fontWeight: 600 }}>{row.brokerCode}</span>
      {mark.label && (
        <span
          style={{
            marginLeft: 5, fontSize: 9, padding: '0 4px', borderRadius: 3, verticalAlign: 'middle',
            border: `1px solid ${mark.mismatch ? 'var(--warn, #d29922)' : 'var(--border)'}`,
            color: mark.mismatch ? 'var(--warn, #d29922)' : 'var(--text-dim)',
          }}
        >
          {mark.label}
        </span>
      )}
      {/* Kasus YU: broker asing tapi yang transaksi investor lokal. */}
      {mark.mismatch && (
        <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--warn, #d29922)' }}>⚠</span>
      )}
      {m?.name && (
        <div style={{ fontSize: 9.5, color: 'var(--text-dim)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.name}
        </div>
      )}
    </td>
  )
}

function MergedBrokerTable({ rows, mode, master }: {
  rows: MergedBroker[]
  mode: Mode
  master: Map<string, BrokerMaster>
}) {
  if (!rows.length) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: '4px 8px' }}>Tidak ada data.</div>
  }
  // Ambang "order besar": 2,5x median avg/trx pasar — dipakai untuk menyorot
  // broker yang nilainya besar tapi frekuensinya sedikit (ciri smart money).
  const avgs = rows.map((r) => r.avgTrx).filter((a) => a > 0).sort((a, b) => a - b)
  const median = avgs.length ? avgs[Math.floor(avgs.length / 2)] : 0
  const bigThreshold = Math.max(median * 2.5, 12e6)

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-dim)' }}>
          <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Broker</th>
          <th style={th({ color: 'var(--up)' })}>Buy Val</th>
          <th style={th({ color: 'var(--up)' })}>Buy Lot</th>
          <th style={th({ color: 'var(--down)' })}>Sell Val</th>
          <th style={th({ color: 'var(--down)' })}>Sell Lot</th>
          {mode === 'net' ? (
            <>
              <th style={th()}>Net Val</th>
              <th style={th()}>Net Lot</th>
            </>
          ) : (
            <>
              <th style={th()}>Gross Val</th>
              <th style={th()}>Gross Lot</th>
            </>
          )}
          <th style={th()} title="Jumlah transaksi (frekuensi)">Freq</th>
          <th style={th()} title="Nilai rata-rata per transaksi = Gross Val ÷ Freq. Nilai besar dengan freq kecil = ciri order institusi.">
            Avg/Trx
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const big = r.avgTrx >= bigThreshold
          return (
            <tr key={r.brokerCode}>
              <BrokerCell row={r} master={master} />
              <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--up)' }}>{fmtRp(r.buyVal)}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtLot(r.buyLot)}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--down)' }}>{fmtRp(r.sellVal)}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtLot(r.sellLot)}</td>
              {mode === 'net' ? (
                <>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, color: r.netVal >= 0 ? 'var(--up)' : 'var(--down)' }}>
                    {fmtSigned(r.netVal, fmtRp)}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: r.netLot >= 0 ? 'var(--up)' : 'var(--down)' }}>
                    {fmtSigned(r.netLot, fmtLot)}
                  </td>
                </>
              ) : (
                <>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{fmtRp(r.grossVal)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{fmtLot(r.buyLot + r.sellLot)}</td>
                </>
              )}
              <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-dim)' }}>
                {r.freq ? fmtNum(r.freq) : '—'}
              </td>
              <td
                style={{ padding: '4px 8px', textAlign: 'right', fontWeight: big ? 600 : 400, color: big ? 'var(--up)' : 'var(--text-dim)' }}
                title={big ? 'Order besar — nilai per transaksi jauh di atas rata-rata pasar (ciri institusi)' : undefined}
              >
                {r.avgTrx ? fmtRp(r.avgTrx) : '—'}{big ? ' 🐋' : ''}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function BrokerSummaryPanel() {
  const symbol = useTerminalStore((s) => s.selectedSymbol)
  const globalTo = useTerminalStore((s) => s.periodTo)
  const [date, setDate] = useState(globalTo)

  const [mode, setMode] = useState<Mode>('net')
  const master = useBrokerMaster()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['broker-summary-daily', symbol, date],
    queryFn: () => fetchBrokerSummary(symbol!, date),
    enabled: !!symbol,
  })
  const availability = useQuery({
    queryKey: ['broker-summary-availability', symbol],
    queryFn: () => fetchBrokerSummaryAvailability(symbol!),
    enabled: !!symbol,
    staleTime: 60_000,
  })

  if (!symbol) {
    return (
      <div style={{ color: 'var(--text-dim)', padding: 16 }}>
        Pilih simbol dari watchlist untuk melihat broker summary.
      </div>
    )
  }
  if (isLoading) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Memuat broker summary…</div>
  if (isError) return <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat broker summary.</div>

  const merged = mergeBrokers(data?.buyers ?? [], data?.sellers ?? [])
  merged.sort((a, b) => (mode === 'net' ? b.netVal - a.netVal : b.grossVal - a.grossVal))

  const totalBuy = merged.reduce((s, r) => s + r.buyVal, 0)
  const totalSell = merged.reduce((s, r) => s + r.sellVal, 0)
  const totalFreq = merged.reduce((s, r) => s + r.freq, 0)
  const totalNet = totalBuy - totalSell
  const totalGross = totalBuy + totalSell

  return (
    <div style={{ padding: 8, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ color: 'var(--text-h)', fontWeight: 600 }}>
          {symbol} · DAILY · {date}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ModeToggle mode={mode} onChange={setMode} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)' }}>
            <span style={{ color: 'var(--cyan)', fontSize: 9.5, fontWeight: 800 }}>📅 Tanggal</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ background: 'transparent', border: 0, color: 'var(--text-h)', fontSize: 10, fontWeight: 700, outline: 'none' }} />
          </label>
        </div>
      </div>

      {!merged.length ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.6, padding: '10px 4px' }}>
          <b style={{color:'var(--text-h)'}}>Broker summary harian {symbol} belum tersedia untuk {date}.</b>
          {availability.data?.dailyTo ? <div><p style={{margin:'7px 0'}}>Data harian tersedia pada {availability.data.dailyFrom} s/d {availability.data.dailyTo}.</p><button onClick={() => setDate(availability.data!.dailyTo!)} style={{padding:'7px 10px',border:'1px solid var(--accent)',background:'var(--accent)',color:'#071426',fontWeight:800,fontSize:10,cursor:'pointer'}}>Buka tanggal terbaru</button></div> : <p style={{margin:'7px 0'}}>Data broker harian untuk emiten ini belum tersedia.</p>}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--up)' }}>Buy {fmtRp(totalBuy)}</span>
            <span style={{ color: 'var(--down)' }}>Sell {fmtRp(totalSell)}</span>
            <span style={{ color: totalNet >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>
              Net {fmtSigned(totalNet, fmtRp)}
            </span>
            <span style={{ color: 'var(--text-dim)' }}>Gross {fmtRp(totalGross)}</span>
            <span style={{ color: 'var(--text-dim)' }}>Freq {totalFreq ? fmtNum(totalFreq) : '—'}</span>
            {totalFreq > 0 && (
              <span style={{ color: 'var(--text-dim)' }}>Avg/Trx {fmtRp(totalGross / totalFreq)}</span>
            )}
          </div>
          <MergedBrokerTable rows={merged} mode={mode} master={master} />
          <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            <b>F</b>/<b>D</b>/<b>M</b> = domisili investor yang bertransaksi (asing/lokal/campuran), bukan kebangsaan brokernya.
            <span style={{ color: 'var(--warn, #d29922)' }}> ⚠</span> = keduanya berbeda (mis. broker asing dipakai investor lokal).
            {' '}🐋 = nilai per transaksi jauh di atas rata-rata pasar.
          </div>
        </>
      )}
    </div>
  )
}

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const btn = (m: Mode, label: string, title: string) => (
    <button
      onClick={() => onChange(m)}
      title={title}
      style={{
        padding: '2px 9px', fontSize: 11, cursor: 'pointer',
        background: mode === m ? 'var(--accent, #238636)' : 'transparent',
        color: mode === m ? '#fff' : 'var(--text-dim)',
        border: '1px solid var(--border)',
        borderRadius: m === 'net' ? '3px 0 0 3px' : '0 3px 3px 0',
        borderRight: m === 'net' ? 'none' : '1px solid var(--border)',
      }}
    >
      {label}
    </button>
  )
  return (
    <span style={{ display: 'inline-flex' }}>
      {btn('net', 'Net', 'Net = Beli − Jual. Menunjukkan arah posisi broker.')}
      {btn('gross', 'Gross', 'Gross = Beli + Jual. Menunjukkan besar aktivitas broker.')}
    </span>
  )
}
