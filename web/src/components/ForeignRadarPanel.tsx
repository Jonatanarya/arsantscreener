import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchForeignRadar, type RadarCell, type RadarRow } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'
import { DateRangeFilter } from './PeriodPicker'

type Tab = 'radar' | 'top' | 'sector'
type Mode = 'akumulasi' | 'distribusi'

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 3, padding: '6px 8px' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: color ?? 'var(--text-h)', fontWeight: 800, fontSize: 15 }}>{value}</div>
    </div>
  )
}

/** Satu sel heat = satu hari bursa. Angka di dalamnya adalah peringkat net
 *  asing hari itu (bukan nilai), jadi "#1" berarti pembeli asing terbesar
 *  se-bursa pada tanggal tersebut. */
function HeatCellBox({ cell, mode }: { cell: RadarCell; mode: Mode }) {
  const on = cell.hit
  const color = mode === 'akumulasi' ? 'var(--up)' : 'var(--down)'
  const bg = mode === 'akumulasi' ? 'var(--up-bg)' : 'var(--down-bg)'
  return (
    <div
      title={`${cell.date} · ${fmtRp(cell.netVal)}${on ? ` · peringkat #${cell.rank}` : ''}`}
      style={{
        minWidth: 20,
        height: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 3,
        background: on ? bg : 'var(--bg)',
        border: `1px solid ${on ? color : 'var(--border)'}`,
        color: on ? color : 'var(--text-dim)',
        fontSize: 9,
        fontWeight: 700,
      }}
    >
      {on ? cell.rank : '-'}
    </div>
  )
}

function RadarTable({ rows, mode, onPick }: { rows: RadarRow[]; mode: Mode; onPick: (s: string) => void }) {
  if (rows.length === 0) {
    return (
      <div style={{ color: 'var(--text-dim)', padding: 12 }}>
        Belum ada saham yang terdeteksi pada periode ini. Coba periode lain atau periksa kembali setelah pembaruan data berikutnya.
      </div>
    )
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
      <thead>
        <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
          <th style={{ padding: '4px 6px', fontWeight: 600 }}>#</th>
          <th style={{ padding: '4px 6px', fontWeight: 600 }}>SAHAM</th>
          <th style={{ padding: '4px 6px', fontWeight: 600 }}>HEAT (peringkat harian)</th>
          <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'center' }}>HARI</th>
          <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'center' }}>STREAK</th>
          <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>NET ASING</th>
          <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>AVG RANK</th>
          <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>RETURN</th>
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
            <td style={{ padding: '4px 6px' }}>
              <div style={{ color: 'var(--text-h)', fontWeight: 700 }}>{r.symbol}</div>
              {r.sector && <div style={{ color: 'var(--text-dim)', fontSize: 9 }}>{r.sector}</div>}
            </td>
            <td style={{ padding: '4px 6px' }}>
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: 8 }}>D-{r.cells.length - 1}</span>
                {r.cells.map((c) => (
                  <HeatCellBox key={c.date} cell={c} mode={mode} />
                ))}
                <span style={{ color: 'var(--text-dim)', fontSize: 8 }}>D0</span>
              </div>
            </td>
            <td style={{ padding: '4px 6px', textAlign: 'center' }}>
              <span className="bbg-badge" style={{ background: 'var(--bg)', color: 'var(--text-h)', border: '1px solid var(--border)' }}>
                {r.days}/{r.totalDays}
              </span>
            </td>
            <td style={{ padding: '4px 6px', textAlign: 'center', color: 'var(--accent)', fontWeight: 700 }}>{r.streak}</td>
            <td style={{ padding: '4px 6px', textAlign: 'right', color: r.netVal >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
              {r.netVal >= 0 ? '+' : ''}
              {fmtRp(r.netVal)}
            </td>
            <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text)' }}>#{r.avgRank.toFixed(1)}</td>
            <td
              style={{
                padding: '4px 6px',
                textAlign: 'right',
                color: !r.hasReturn ? 'var(--text-dim)' : r.returnPct >= 0 ? 'var(--up)' : 'var(--down)',
                fontWeight: 700,
              }}
            >
              {r.hasReturn ? fmtPct(r.returnPct) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function ForeignRadarPanel() {
  const selectSymbol = useTerminalStore((s) => s.selectSymbol)
  const globalFrom = useTerminalStore((s) => s.periodFrom)
  const globalTo = useTerminalStore((s) => s.periodTo)

  const [periodFrom, setPeriodFrom] = useState(globalFrom)
  const [periodTo, setPeriodTo] = useState(globalTo)

  const setPeriod = (from: string, to: string) => {
    setPeriodFrom(from)
    setPeriodTo(to)
  }

  const [tab, setTab] = useState<Tab>('radar')
  const [mode, setMode] = useState<Mode>('akumulasi')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['foreign-radar', mode, periodFrom, periodTo],
    queryFn: () => fetchForeignRadar({ mode, limit: 60, from: periodFrom, to: periodTo }),
    refetchInterval: 5 * 60 * 1000,
  })

  const rows = data?.rows ?? []
  const topRows = [...rows].sort((a, b) => (mode === 'akumulasi' ? b.netVal - a.netVal : a.netVal - b.netVal))
  const maxSectorShare = Math.max(1, ...(data?.sectors ?? []).map((s) => s.sharePct))

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
        <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10 }}>[ FOREIGN RADAR - KONSISTENSI ALIRAN ASING ]</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={setPeriod} />
        </div>
      </div>

      {/* Tab & filter */}
      <div style={{ display: 'flex', gap: 8, padding: '5px 8px', borderBottom: '1px solid var(--border)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 3 }}>
          {([
            { id: 'radar', label: 'Foreign Radar' },
            { id: 'top', label: 'Foreign Top' },
            { id: 'sector', label: 'Sector Rotation' },
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
        <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>TIPE:</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {(['akumulasi', 'distribusi'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                background: mode === m ? (m === 'akumulasi' ? 'var(--up)' : 'var(--down)') : 'transparent',
                color: mode === m ? '#000' : 'var(--text-dim)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {isLoading && <div style={{ color: 'var(--text-dim)' }}>Memuat radar asing…</div>}
        {isError && <div style={{ color: 'var(--down)' }}>Gagal memuat Foreign Radar.</div>}

        {data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
              <Stat label="Hari Trading" value={String(data.tradingDays)} />
              <Stat label="Saham Terdeteksi" value={String(data.detected)} />
              <Stat label="Paling Konsisten" value={data.mostConsistent ?? '—'} color="var(--cyan)" />
              <Stat
                label="Streak Tertinggi"
                value={rows.length ? `${Math.max(...rows.map((r) => r.streak))}/${data.tradingDays}` : '—'}
                color={mode === 'akumulasi' ? 'var(--up)' : 'var(--down)'}
              />
            </div>

            {tab === 'radar' && <RadarTable rows={rows} mode={mode} onPick={selectSymbol} />}
            {tab === 'top' && <RadarTable rows={topRows} mode={mode} onPick={selectSymbol} />}
            {tab === 'sector' && (
              <div>
                <div style={{ color: 'var(--text-dim)', fontSize: 10, marginBottom: 8 }}>
                  Net asing per sektor sepanjang {data.from} → {data.to}. Sektor tanpa label pada tabel symbols tidak ikut dihitung.
                </div>
                {(data.sectors ?? []).length === 0 && (
                  <div style={{ color: 'var(--text-dim)' }}>Data sektor belum tersedia pada tabel symbols.</div>
                )}
                {(data.sectors ?? []).map((s) => (
                  <div key={s.sector} style={{ marginBottom: 7 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                      <span style={{ color: 'var(--text-h)', fontWeight: 600 }}>
                        {s.sector} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({s.symbols} saham)</span>
                      </span>
                      <span style={{ color: s.netVal >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                        {s.netVal >= 0 ? '+' : ''}
                        {fmtRp(s.netVal)}
                      </span>
                    </div>
                    <div style={{ height: 5, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${(s.sharePct / maxSectorShare) * 100}%`,
                          height: '100%',
                          background: s.netVal >= 0 ? 'var(--up)' : 'var(--down)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
