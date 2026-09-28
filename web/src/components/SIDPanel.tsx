import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchSID,
  fetchShareholdingComposition,
  fetchShareholdingDivergence,
  type ClassificationSlice,
  type SIDPoint,
  type SIDRow,
} from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { DateRangeFilter } from './PeriodPicker'

type Tab = 'sid' | 'scripless' | 'composition' | 'divergence'

const fmtInt = (v: number) => v.toLocaleString('id-ID')
const fmtPct = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
const fmtSigned = (v: number) => `${v > 0 ? '+' : ''}${fmtInt(v)}`

function fmtShares(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(2)} T`
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)} B`
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)} M`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)} K`
  return `${sign}${a.toFixed(0)}`
}

const SIGNAL_COLOR: Record<string, string> = {
  'DISTRIBUSI KE RITEL': 'var(--down)',
  AKUMULASI: 'var(--up)',
  'PARTISIPASI LUAS': 'var(--cyan)',
  KAPITULASI: 'var(--accent)',
  NETRAL: 'var(--text-dim)',
  'TIDAK DIKETAHUI': 'var(--text-dim)',
}

/** Tren jumlah pemegang antar bulan laporan. Batang hijau = bertambah dari
 *  bulan sebelumnya, merah = berkurang; batang pertama selalu netral karena
 *  tidak punya pembanding. */
function TrendBars({ trend }: { trend: SIDPoint[] }) {
  if (trend.length === 0) return <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>—</span>
  const deltas = trend.map((p, i) => (i === 0 ? 0 : p.investors - trend[i - 1].investors))
  const max = Math.max(1, ...deltas.map((d) => Math.abs(d)))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 22 }}>
      {trend.map((p, i) => {
        const d = deltas[i]
        const h = (Math.abs(d) / max) * 100
        const up = d > 0
        return (
          <div
            key={p.reportDate}
            title={`${p.reportDate} · ${fmtInt(p.investors)} pemegang${i > 0 ? ` (${fmtSigned(d)})` : ''}`}
            style={{ width: 11, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
          >
            <div
              style={{
                height: `${Math.max(h * 0.5, 6)}%`,
                background: d === 0 ? 'var(--border-bright)' : up ? 'var(--up)' : 'var(--down)',
                borderRadius: 1,
                alignSelf: 'stretch',
                marginTop: up ? 'auto' : 0,
                marginBottom: up ? 0 : 'auto',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

function SliceBars({ slices, title }: { slices: ClassificationSlice[]; title: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 3 }}>
      <div style={{ padding: '3px 6px', background: 'var(--panel-header)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: 10 }}>{title}</span>
      </div>
      <div style={{ padding: 6 }}>
        {slices.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>Belum ada data.</div>}
        {slices.map((s) => (
          <div key={s.label} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
              <span style={{ color: 'var(--text-h)', fontWeight: 600 }}>
                {s.label} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({s.holders})</span>
              </span>
              <span>
                <b style={{ color: 'var(--text-h)' }}>{s.sharePct.toFixed(1)}%</b>{' '}
                <span style={{ color: s.chgShares >= 0 ? 'var(--up)' : 'var(--down)', fontSize: 9 }}>
                  {s.chgShares >= 0 ? '+' : ''}
                  {fmtShares(s.chgShares)}
                </span>
              </span>
            </div>
            <div style={{ height: 5, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, s.sharePct)}%`, height: '100%', background: 'var(--cyan)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyState({ coverage }: { coverage?: { symbols: number; months: number } }) {
  return (
    <div style={{ color: 'var(--text-dim)', padding: 16, lineHeight: 1.6, fontSize: 11 }}>
      <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 6 }}>Data kepemilikan KSEI belum ada.</div>
      Data kepemilikan sedang disiapkan. Periksa kembali setelah pembaruan berikutnya.
      <div style={{ marginTop: 8 }}>
        Laporan KSEI terbit <b style={{ color: 'var(--text-h)' }}>bulanan</b>, jadi cukup ditarik sekali per bulan.
        Perubahan 1M/3M baru muncul setelah minimal dua bulan laporan terkumpul.
      </div>
      {coverage && coverage.symbols > 0 && (
        <div style={{ marginTop: 8 }}>
          Saat ini tersimpan: {coverage.symbols} emiten, {coverage.months} bulan laporan.
        </div>
      )}
    </div>
  )
}

function SIDTable({ rows, mode, onPick }: { rows: SIDRow[]; mode: 'sid' | 'scripless'; onPick: (s: string) => void }) {
  if (rows.length === 0) return <div style={{ color: 'var(--text-dim)', padding: 12 }}>Tidak ada baris pada filter ini.</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
      <thead>
        <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
          <th style={{ padding: '4px 6px', fontWeight: 600 }}>#</th>
          <th style={{ padding: '4px 6px', fontWeight: 600 }}>SAHAM</th>
          <th style={{ padding: '4px 6px', fontWeight: 600 }}>TREND</th>
          <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>BULAN</th>
          {mode === 'sid' ? (
            <>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>PEMEGANG</th>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>CHG 1M</th>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>CHG 3M</th>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>% 1M</th>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>% 3M</th>
            </>
          ) : (
            <>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>TOTAL SAHAM</th>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>SCRIPLESS</th>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Δ SCRIPLESS</th>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>ASING</th>
              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Δ ASING</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.symbol}
            onClick={() => onPick(r.symbol)}
            style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
            className="bbg-suggestion-item"
          >
            <td style={{ padding: '4px 6px', color: 'var(--text-dim)' }}>{i + 1}</td>
            <td style={{ padding: '4px 6px', color: 'var(--text-h)', fontWeight: 700 }}>{r.symbol}</td>
            <td style={{ padding: '4px 6px' }}>
              <TrendBars trend={r.trend} />
            </td>
            <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-dim)' }}>{r.reportDate}</td>
            {mode === 'sid' ? (
              <>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-h)', fontWeight: 700 }}>
                  {fmtInt(r.investors)}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: !r.has1m ? 'var(--text-dim)' : r.chg1m >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                  {r.has1m ? fmtSigned(r.chg1m) : '—'}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: !r.has3m ? 'var(--text-dim)' : r.chg3m >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                  {r.has3m ? fmtSigned(r.chg3m) : '—'}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: !r.has1m ? 'var(--text-dim)' : r.pct1m >= 0 ? 'var(--up)' : 'var(--down)' }}>
                  {r.has1m ? fmtPct(r.pct1m, 1) : '—'}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: !r.has3m ? 'var(--text-dim)' : r.pct3m >= 0 ? 'var(--up)' : 'var(--down)' }}>
                  {r.has3m ? fmtPct(r.pct3m, 1) : '—'}
                </td>
              </>
            ) : (
              <>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-h)' }}>{fmtShares(r.totalShares)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-h)', fontWeight: 700 }}>
                  {r.scriplessPct.toFixed(2)}%
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: !r.has1m ? 'var(--text-dim)' : r.scriplessChg1m >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                  {r.has1m ? `${r.scriplessChg1m > 0 ? '+' : ''}${r.scriplessChg1m.toFixed(2)} pp` : '—'}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-h)' }}>{r.foreignPct.toFixed(2)}%</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: !r.has1m ? 'var(--text-dim)' : r.foreignChg1m >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                  {r.has1m ? `${r.foreignChg1m > 0 ? '+' : ''}${r.foreignChg1m.toFixed(2)} pp` : '—'}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SIDPanel() {
  const symbol = useTerminalStore((s) => s.selectedSymbol)
  const selectSymbol = useTerminalStore((s) => s.selectSymbol)
  const globalFrom = useTerminalStore((s) => s.periodFrom)
  const globalTo = useTerminalStore((s) => s.periodTo)

  const [periodFrom, setPeriodFrom] = useState(globalFrom)
  const [periodTo, setPeriodTo] = useState(globalTo)

  const setPeriod = (from: string, to: string) => {
    setPeriodFrom(from)
    setPeriodTo(to)
  }

  const [tab, setTab] = useState<Tab>('sid')
  const [month, setMonth] = useState('')
  const [search, setSearch] = useState('')

  const sid = useQuery({
    queryKey: ['sid', month, search, periodFrom, periodTo],
    queryFn: () => fetchSID({ month: month || undefined, symbol: search || undefined, limit: 200 }),
  })

  const comp = useQuery({
    queryKey: ['shareholding', symbol],
    queryFn: () => fetchShareholdingComposition(symbol!),
    enabled: tab === 'composition' && !!symbol,
  })

  const div = useQuery({
    queryKey: ['shareholding-divergence'],
    queryFn: () => fetchShareholdingDivergence(100),
    enabled: tab === 'divergence',
  })

  const coverage = sid.data?.coverage
  const hasData = (coverage?.rows ?? 0) > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      <div
        style={{
          padding: '4px 8px',
          background: 'var(--panel-header)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10 }}>
          [ SID &amp; SCRIPLESS - KEPEMILIKAN KSEI ]
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={setPeriod} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '5px 8px', borderBottom: '1px solid var(--border)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 3 }}>
          {([
            { id: 'sid', label: 'SID Changes' },
            { id: 'scripless', label: 'Scripless Changes' },
            { id: 'composition', label: 'Investor Composition' },
            { id: 'divergence', label: 'Divergence Analysis' },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: tab === t.id ? 'var(--accent)' : 'transparent',
                color: tab === t.id ? '#000' : 'var(--text-dim)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {(tab === 'sid' || tab === 'scripless') && (
          <>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ fontSize: 10, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}
            >
              <option value="">Semua bulan</option>
              {(sid.data?.months ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value.toUpperCase())}
              placeholder="Cari saham…"
              style={{ fontSize: 10, width: 110, background: 'var(--bg)', color: 'var(--accent-hover)', border: '1px solid var(--border)', padding: '2px 5px' }}
            />
          </>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {sid.isLoading && <div style={{ color: 'var(--text-dim)' }}>Memuat kepemilikan KSEI…</div>}
        {sid.isError && <div style={{ color: 'var(--down)' }}>Gagal memuat data kepemilikan.</div>}

        {sid.data && !hasData && <EmptyState coverage={coverage} />}

        {sid.data && hasData && (tab === 'sid' || tab === 'scripless') && (
          <>
            {tab === 'scripless' && (
              <div style={{ color: 'var(--text-dim)', fontSize: 10, marginBottom: 8, lineHeight: 1.5 }}>
                Porsi <b style={{ color: 'var(--text-h)' }}>scripless</b> = saham tanpa warkat terhadap total. Naiknya
                porsi scripless tanpa tambahan total saham berarti konversi warkat, bukan pembelian baru — makanya
                total saham ditampilkan berdampingan. Δ dalam <b style={{ color: 'var(--text-h)' }}>poin persentase</b>.
              </div>
            )}
            <SIDTable rows={sid.data.rows} mode={tab} onPick={selectSymbol} />
          </>
        )}

        {tab === 'composition' && (
          <>
            {!symbol && <div style={{ color: 'var(--text-dim)' }}>Pilih simbol dari watchlist untuk melihat komposisi pemegang saham.</div>}
            {symbol && comp.isLoading && <div style={{ color: 'var(--text-dim)' }}>Memuat komposisi {symbol}…</div>}
            {symbol && comp.isError && <div style={{ color: 'var(--down)' }}>Gagal memuat komposisi.</div>}
            {symbol && comp.data && comp.data.investors === 0 && (
              <div style={{ color: 'var(--text-dim)' }}>
                Belum ada data kepemilikan untuk {symbol}. Data akan ditampilkan otomatis setelah pembaruan tersedia.
              </div>
            )}
            {symbol && comp.data && comp.data.investors > 0 && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
                  {[
                    { l: 'PEMEGANG', v: fmtInt(comp.data.investors), c: 'var(--text-h)' },
                    { l: 'TOTAL SAHAM', v: fmtShares(comp.data.totalShares), c: 'var(--text-h)' },
                    { l: 'SCRIPLESS', v: `${comp.data.scriplessPct.toFixed(2)}%`, c: 'var(--cyan)' },
                    { l: 'LAPORAN', v: comp.data.reportDate, c: 'var(--accent)' },
                  ].map((s) => (
                    <div key={s.l} style={{ border: '1px solid var(--border)', borderRadius: 3, padding: '6px 8px' }}>
                      <div style={{ color: 'var(--text-dim)', fontSize: 9 }}>{s.l}</div>
                      <div style={{ color: s.c, fontWeight: 800, fontSize: 14 }}>{s.v}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <SliceBars slices={comp.data.byClassification} title="KOMPOSISI PER KLASIFIKASI" />
                  <SliceBars slices={comp.data.byLocation} title="KOMPOSISI LOKAL VS ASING" />
                </div>

                <div style={{ border: '1px solid var(--border)', borderRadius: 3, marginBottom: 8 }}>
                  <div style={{ padding: '3px 6px', background: 'var(--panel-header)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: 10 }}>PEMEGANG SAHAM</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>
                      {comp.data.prevReportDate ? `Δ vs ${comp.data.prevReportDate}` : 'belum ada bulan pembanding'}
                    </span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                    <thead>
                      <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                        <th style={{ padding: '4px 6px', fontWeight: 600 }}>INVESTOR</th>
                        <th style={{ padding: '4px 6px', fontWeight: 600 }}>KLASIFIKASI</th>
                        <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>SAHAM</th>
                        <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>%</th>
                        <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Δ SAHAM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comp.data.holders.map((h) => (
                        <tr key={h.investorId} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 6px', color: 'var(--text-h)', fontWeight: 600 }}>
                            {h.name}
                            {h.isNew && (
                              <span className="bbg-badge bbg-badge-green" style={{ marginLeft: 5, fontSize: 8 }}>
                                BARU
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '4px 6px', color: 'var(--text-dim)' }}>
                            {h.classification || '—'} · {h.location || '—'}
                          </td>
                          <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-h)' }}>{fmtShares(h.totalShares)}</td>
                          <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-h)', fontWeight: 700 }}>
                            {h.percentage.toFixed(2)}%
                          </td>
                          <td style={{ padding: '4px 6px', textAlign: 'right', color: !h.hasPrev && !h.isNew ? 'var(--text-dim)' : h.chgShares >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                            {h.hasPrev || h.isNew ? `${h.chgShares >= 0 ? '+' : ''}${fmtShares(h.chgShares)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {comp.data.goneHolders.length > 0 && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 3 }}>
                    <div style={{ padding: '3px 6px', background: 'var(--panel-header)', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--down)', fontWeight: 700, fontSize: 10 }}>
                        KELUAR TOTAL ({comp.data.goneHolders.length}) — ada bulan lalu, hilang bulan ini
                      </span>
                    </div>
                    {comp.data.goneHolders.map((h) => (
                      <div key={h.investorId} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 6px', borderTop: '1px solid var(--border)', fontSize: 10 }}>
                        <span style={{ color: 'var(--text-h)' }}>{h.name}</span>
                        <span style={{ color: 'var(--down)', fontWeight: 700 }}>{fmtShares(h.chgShares)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === 'divergence' && (
          <>
            {div.isLoading && <div style={{ color: 'var(--text-dim)' }}>Memuat analisa divergensi…</div>}
            {div.isError && <div style={{ color: 'var(--down)' }}>Gagal memuat divergensi.</div>}
            {div.data && div.data.rows.length === 0 && (
              <div style={{ color: 'var(--text-dim)' }}>
                Butuh minimal dua bulan laporan KSEI untuk menghitung divergensi. Tarik lagi bulan depan.
              </div>
            )}
            {div.data && div.data.rows.length > 0 && (
              <>
                <div style={{ color: 'var(--text-dim)', fontSize: 10, marginBottom: 8, lineHeight: 1.5 }}>
                  Membandingkan arah <b style={{ color: 'var(--text-h)' }}>jumlah pemegang</b> dengan arah{' '}
                  <b style={{ color: 'var(--text-h)' }}>harga</b> pada rentang bulan laporan yang sama. Pemegang naik
                  saat harga turun = barang berpindah ke banyak tangan kecil (distribusi ritel); pemegang turun saat
                  harga naik = barang mengumpul (akumulasi). Diurut dari selisih paling ekstrem.
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                      <th style={{ padding: '4px 6px', fontWeight: 600 }}>#</th>
                      <th style={{ padding: '4px 6px', fontWeight: 600 }}>SAHAM</th>
                      <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Δ PEMEGANG</th>
                      <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>Δ HARGA</th>
                      <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>GAP</th>
                      <th style={{ padding: '4px 6px', fontWeight: 600 }}>SINYAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {div.data.rows.map((r, i) => (
                      <tr
                        key={r.symbol}
                        onClick={() => selectSymbol(r.symbol)}
                        style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                        className="bbg-suggestion-item"
                      >
                        <td style={{ padding: '4px 6px', color: 'var(--text-dim)' }}>{i + 1}</td>
                        <td style={{ padding: '4px 6px', color: 'var(--text-h)', fontWeight: 700 }}>{r.symbol}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', color: r.holderChgPct >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                          {fmtPct(r.holderChgPct, 1)}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', color: !r.hasPrice ? 'var(--text-dim)' : r.priceChgPct >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                          {r.hasPrice ? fmtPct(r.priceChgPct, 1) : '—'}
                        </td>
                        <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-h)' }}>
                          {r.hasPrice ? r.gap.toFixed(1) : '—'}
                        </td>
                        <td style={{ padding: '4px 6px' }}>
                          <span style={{ color: SIGNAL_COLOR[r.signal] ?? 'var(--text)', fontWeight: 700 }} title={r.note}>
                            {r.signal}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
