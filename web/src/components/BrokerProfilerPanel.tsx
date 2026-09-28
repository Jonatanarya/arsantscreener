import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchBrokerIntel,
  fetchBrokerProfiler,
  type BrokerStockRow,
  type PortfolioSeries,
} from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { useBrokerMaster, brokerColor } from '../lib/brokers'
import { fmtRp } from '../lib/format'
import { DateRangeFilter } from './PeriodPicker'

type Tab = 'intel' | 'profiler'
type Mode = 'accum' | 'dist'

const SERIES_COLORS = ['#22c55e', '#f05252', '#4da3ff', '#f59e0b', '#c084fc', '#67b5ff', '#fb923c', '#a3e635', '#f472b6', '#818cf8']

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
const fmtPrice = (v: number) => (!v ? '—' : Math.round(v).toLocaleString('id-ID'))
const fmtLot = (v: number) => {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`
  return `${sign}${a.toLocaleString('id-ID')}`
}

/** Heatmap harian: visualisasi batang intensitas aliran dana per hari bursa */
function Heatmap({ row }: { row: BrokerStockRow }) {
  const max = Math.max(1, ...row.heat.map((h) => Math.abs(h.netVal)))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 8, fontFamily: 'monospace' }}>
        D-{Math.max(0, row.heat.length - 1)}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 26, background: 'var(--bg)', padding: '2px 4px', borderRadius: 3, border: '1px solid var(--border)' }}>
        {row.heat.map((h) => {
          const pct = Math.min(100, (Math.abs(h.netVal) / max) * 100)
          const up = h.netVal >= 0
          const color = h.netVal === 0 ? 'var(--border)' : up ? 'var(--up)' : 'var(--down)'
          return (
            <div
              key={h.date}
              title={`${h.date} · Net: ${fmtRp(h.netVal)}`}
              style={{
                width: 10,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  height: `${Math.max(pct * 0.85, h.netVal === 0 ? 10 : 20)}%`,
                  minHeight: 3,
                  background: color,
                  opacity: h.netVal === 0 ? 0.3 : Math.max(0.45, pct / 100),
                  borderRadius: 1.5,
                  alignSelf: 'stretch',
                  marginTop: up ? 'auto' : 0,
                  marginBottom: up ? 0 : 'auto',
                  transition: 'all 0.15s ease',
                }}
              />
            </div>
          )
        })}
      </div>
      <span style={{ color: 'var(--text-dim)', fontSize: 8, fontFamily: 'monospace' }}>D0</span>
    </div>
  )
}

function BrokerStockTable({ rows, onPick }: { rows: BrokerStockRow[]; onPick: (s: string) => void }) {
  const master = useBrokerMaster()
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-dim)', padding: 16, textAlign: 'center', fontSize: 11 }}>Tidak ada data broker intel pada periode ini.</div>
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--panel)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
        <thead>
          <tr style={{ background: 'var(--panel-header)', color: 'var(--text-dim)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '6px 8px', fontWeight: 800, width: 28, textAlign: 'center' }}>#</th>
            <th style={{ padding: '6px 8px', fontWeight: 800 }}>BROKER</th>
            <th style={{ padding: '6px 8px', fontWeight: 800 }}>SAHAM</th>
            <th style={{ padding: '6px 8px', fontWeight: 800 }}>AKTIVITAS HARIAN (HEATMAP)</th>
            <th style={{ padding: '6px 8px', fontWeight: 800, textAlign: 'right' }}>NET VALUE (RP)</th>
            <th style={{ padding: '6px 8px', fontWeight: 800, textAlign: 'center' }}>KONSISTENSI</th>
            <th style={{ padding: '6px 8px', fontWeight: 800, textAlign: 'right' }}>AVG PRICE</th>
            <th style={{ padding: '6px 8px', fontWeight: 800, textAlign: 'right' }}>FLOAT P/L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const bColor = brokerColor(r.brokerCode, master)
            const isFullCons = r.daysTotal && r.daysNet === r.daysTotal
            return (
              <tr
                key={`${r.brokerCode}-${r.symbol}`}
                style={{
                  borderTop: '1px solid var(--border)',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                  transition: 'background 0.12s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(34,211,238,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)')}
              >
                <td style={{ padding: '6px 8px', color: 'var(--text-dim)', textAlign: 'center', fontWeight: 700 }}>{i + 1}</td>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--bg)', border: `1px solid ${bColor}`, borderRadius: 4, padding: '1px 6px' }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: bColor }} />
                    <span style={{ color: 'var(--text-h)', fontWeight: 900, fontSize: 11 }} title={r.brokerName}>
                      {r.brokerCode}
                    </span>
                  </div>
                </td>
                <td style={{ padding: '6px 8px', cursor: 'pointer' }} onClick={() => onPick(r.symbol)}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11 }}>{r.symbol}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>➔</span>
                  </div>
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <Heatmap row={r} />
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <div style={{ color: r.netVal >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 900, fontSize: 11 }}>
                    {r.netVal >= 0 ? '+' : ''}
                    {fmtRp(r.netVal)}
                  </div>
                  <div style={{ color: 'var(--text-dim)', fontSize: 9, fontWeight: 600 }}>{fmtLot(r.netLot)} lot</div>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      background: isFullCons ? 'var(--up-bg)' : 'var(--bg)',
                      color: isFullCons ? 'var(--up)' : 'var(--text-h)',
                      border: `1px solid ${isFullCons ? 'var(--up)' : 'var(--border)'}`,
                      borderRadius: 12,
                      padding: '1px 8px',
                      fontSize: 9.5,
                      fontWeight: 800,
                    }}
                  >
                    {r.daysNet}/{r.daysTotal} Hari
                  </span>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-h)', fontWeight: 800, fontSize: 10.5 }}>
                  {fmtPrice(r.avgPrice)}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  {r.hasPl ? (
                    <span
                      style={{
                        display: 'inline-block',
                        background: r.floatPlPct >= 0 ? 'var(--up-bg)' : 'var(--down-bg)',
                        color: r.floatPlPct >= 0 ? 'var(--up)' : 'var(--down)',
                        border: `1px solid ${r.floatPlPct >= 0 ? 'var(--up)' : 'var(--down)'}`,
                        borderRadius: 4,
                        padding: '1px 6px',
                        fontWeight: 900,
                        fontSize: 10,
                      }}
                    >
                      {fmtPct(r.floatPlPct)}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Grafik net kumulatif per saham dalam portofolio broker dengan hover crosshair interaktif */
function FlowChart({ series, dates }: { series: PortfolioSeries[]; dates: string[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  if (series.length === 0 || dates.length < 2) {
    return <div style={{ color: 'var(--text-dim)', padding: 16, textAlign: 'center', fontSize: 11 }}>Data belum cukup untuk menggambar grafik portofolio flow.</div>
  }
  const W = 920
  const H = 260
  const padL = 75
  const padB = 28
  const padT = 15
  const padR = 20

  const all = series.flatMap((s) => s.points.map((p) => p.cumNet))
  const max = Math.max(...all, 0)
  const min = Math.min(...all, 0)
  const span = max - min || 1

  const x = (i: number) => padL + (i / (dates.length - 1)) * (W - padL - padR)
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB)

  return (
    <div
      style={{ position: 'relative', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const relX = Math.max(padL, Math.min(W - padR, mouseX))
        const idx = Math.round(((relX - padL) / (W - padL - padR)) * (dates.length - 1))
        setHoverIdx(Math.max(0, Math.min(dates.length - 1, idx)))
      }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 260, display: 'block' }}>
        {/* Horizontal Gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const val = max - ratio * span
          const yPos = y(val)
          return (
            <g key={ratio}>
              <line x1={padL} y1={yPos} x2={W - padR} y2={yPos} stroke="var(--border)" strokeDasharray="2 2" strokeWidth={0.8} />
              <text x={padL - 6} y={yPos + 3} fill="var(--text-dim)" fontSize={8.5} textAnchor="end" fontFamily="monospace">
                {fmtRp(val)}
              </text>
            </g>
          )
        })}

        {/* Zero Axis Line */}
        <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="var(--border-bright)" strokeDasharray="4 2" strokeWidth={1.5} />

        {/* Portfolio Line Paths */}
        {series.map((s, si) => {
          const dPath = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.cumNet)}`).join(' ')
          const color = SERIES_COLORS[si % SERIES_COLORS.length]
          return <path key={s.symbol} d={dPath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
        })}

        {/* Hover Crosshair & Tooltip Overlay */}
        {hoverIdx != null && (
          <g>
            <line x1={x(hoverIdx)} y1={padT} x2={x(hoverIdx)} y2={H - padB} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 3" />
            {series.map((s, si) => {
              const pt = s.points[hoverIdx]
              if (!pt) return null
              const color = SERIES_COLORS[si % SERIES_COLORS.length]
              return (
                <circle key={s.symbol} cx={x(hoverIdx)} cy={y(pt.cumNet)} r={4} fill={color} stroke="#000" strokeWidth={1.5} />
              )
            })}
          </g>
        )}

        {/* Date Labels */}
        {dates.map((d, i) =>
          i % Math.ceil(dates.length / 8) === 0 ? (
            <text key={d} x={x(i)} y={H - 8} fill="var(--text-dim)" fontSize={8.5} textAnchor="middle" fontFamily="monospace">
              {d.slice(5)}
            </text>
          ) : null,
        )}
      </svg>

      {/* Interactive Hover Tooltip Bar */}
      {hoverIdx != null && (
        <div style={{ background: 'var(--panel-header)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 10px', marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, fontSize: 10 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 800 }}>📅 {dates[hoverIdx]}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {series.map((s, si) => {
              const val = s.points[hoverIdx]?.cumNet || 0
              const color = SERIES_COLORS[si % SERIES_COLORS.length]
              return (
                <span key={s.symbol} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: color }} />
                  <b style={{ color: 'var(--text-h)' }}>{s.symbol}:</b>
                  <span style={{ color: val >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 800 }}>
                    {val >= 0 ? '+' : ''}{fmtRp(val)}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Series Legend Chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, padding: '4px 6px', borderTop: '1px solid var(--border)' }}>
        {series.map((s, si) => {
          const color = SERIES_COLORS[si % SERIES_COLORS.length]
          return (
            <div
              key={s.symbol}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--bg)',
                border: `1px solid ${color}`,
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 10,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
              <span style={{ color: 'var(--text-h)', fontWeight: 900 }}>{s.symbol}</span>
              <span style={{ color: s.netVal >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 800 }}>
                {s.netVal >= 0 ? '+' : ''}{fmtRp(s.netVal)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TopList({ title, rows, color, onPick }: { title: string; rows: BrokerStockRow[]; color: string; onPick: (s: string) => void }) {
  const maxVal = Math.max(1, ...rows.map((r) => Math.abs(r.netVal)))

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, background: 'var(--panel)', overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', background: 'var(--panel-header)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color, fontWeight: 900, fontSize: 11, letterSpacing: 0.3 }}>{title}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>Top 8 Saham</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: 12, fontSize: 10.5, textAlign: 'center' }}>Kosong pada periode ini.</div>
      ) : (
        rows.map((r, idx) => {
          const pctBar = Math.min(100, (Math.abs(r.netVal) / maxVal) * 100)
          return (
            <div
              key={`${r.brokerCode}-${r.symbol}`}
              onClick={() => onPick(r.symbol)}
              style={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 10px',
                borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                cursor: 'pointer',
                fontSize: 10.5,
              }}
              className="bbg-suggestion-item"
            >
              {/* Background Volume Conviction Bar */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pctBar}%`,
                  background: color === 'var(--up)' ? 'var(--up-bg)' : 'var(--down-bg)',
                  pointerEvents: 'none',
                }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, zIndex: 1 }}>
                <span style={{ fontSize: 9, fontWeight: 900, color: 'var(--text-dim)', width: 14 }}>#{idx + 1}</span>
                <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11 }}>{r.symbol}</span>
                <span style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>{fmtLot(r.netLot)} lot</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, zIndex: 1 }}>
                <span style={{ color, fontWeight: 900, fontSize: 11 }}>{fmtRp(Math.abs(r.netVal))}</span>
                <span style={{ color: 'var(--text-h)', fontWeight: 700, fontSize: 10 }}>@ {fmtPrice(r.avgPrice)}</span>
                <span
                  style={{
                    color: !r.hasPl ? 'var(--text-dim)' : r.floatPlPct >= 0 ? 'var(--up)' : 'var(--down)',
                    fontWeight: 900,
                    fontSize: 10,
                    minWidth: 45,
                    textAlign: 'right',
                  }}
                >
                  {r.hasPl ? fmtPct(r.floatPlPct) : '—'}
                </span>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

export function BrokerProfilerPanel() {
  const selectSymbol = useTerminalStore((s) => s.selectSymbol)
  const selectedSymbol = useTerminalStore((s) => s.selectedSymbol)
  const globalFrom = useTerminalStore((s) => s.periodFrom)
  const globalTo = useTerminalStore((s) => s.periodTo)

  const [periodFrom, setPeriodFrom] = useState(globalFrom)
  const [periodTo, setPeriodTo] = useState(globalTo)

  const setPeriod = (from: string, to: string) => {
    setPeriodFrom(from)
    setPeriodTo(to)
  }

  const [tab, setTab] = useState<Tab>('intel')
  const [mode, setMode] = useState<Mode>('accum')
  const [filterBySymbol, setFilterBySymbol] = useState(false)
  const [brokerInput, setBrokerInput] = useState('')
  const [brokers, setBrokers] = useState<string[]>(['MG'])

  const intel = useQuery({
    queryKey: ['broker-intel', mode, filterBySymbol ? selectedSymbol : null, periodFrom, periodTo],
    queryFn: () => fetchBrokerIntel({ mode, limit: 40, symbol: filterBySymbol && selectedSymbol ? selectedSymbol : undefined, from: periodFrom, to: periodTo }),
    enabled: tab === 'intel',
  })

  const profiler = useQuery({
    queryKey: ['broker-profiler', brokers.join(','), periodFrom, periodTo],
    queryFn: () => fetchBrokerProfiler(brokers.join(','), periodFrom, periodTo),
    enabled: tab === 'profiler' && brokers.length > 0,
  })

  const addBroker = () => {
    const code = brokerInput.trim().toUpperCase()
    if (!code || brokers.includes(code) || brokers.length >= 5) return
    setBrokers([...brokers, code])
    setBrokerInput('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {/* Header Controls Bar */}
      <div
        style={{
          padding: '6px 10px',
          background: 'var(--panel-header)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11, letterSpacing: 0.3 }}>
            [ BROKER PROFILER - INTEL & PORTOFOLIO BROKER ]
          </span>
        </div>
        <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={setPeriod} />
      </div>

      {/* Sub-Header Toolbar */}
      <div style={{ display: 'flex', gap: 10, padding: '6px 10px', borderBottom: '1px solid var(--border)', alignItems: 'center', flexWrap: 'wrap', background: 'var(--panel)' }}>
        {/* Main Tab Buttons */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: 2 }}>
          {([
            { id: 'intel', label: '🕵️ Broker Intel' },
            { id: 'profiler', label: '💼 Broker Portfolio' },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: tab === t.id ? 'var(--accent)' : 'transparent',
                color: tab === t.id ? '#000' : 'var(--text-dim)',
                border: 'none',
                borderRadius: 3,
                padding: '3px 10px',
                fontSize: 10.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'intel' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Mode Switcher */}
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: 2 }}>
              {([
                { id: 'accum', label: '🟢 Accumulation' },
                { id: 'dist', label: '🔴 Distribution' },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  style={{
                    background: mode === m.id ? (m.id === 'accum' ? 'var(--up)' : 'var(--down)') : 'transparent',
                    color: mode === m.id ? '#000' : 'var(--text-dim)',
                    border: 'none',
                    borderRadius: 3,
                    padding: '3px 10px',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-h)', fontWeight: 700, cursor: 'pointer' }}>
              <input type="checkbox" checked={filterBySymbol} onChange={(e) => setFilterBySymbol(e.target.checked)} />
              Hanya {selectedSymbol ? <b style={{ color: 'var(--cyan)' }}>{selectedSymbol}</b> : 'Simbol Aktif'}
            </label>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {brokers.map((b) => (
              <span
                key={b}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(245,166,35,0.15)',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 10.5,
                  fontWeight: 900,
                }}
              >
                {b}
                <span onClick={() => setBrokers(brokers.filter((x) => x !== b))} style={{ cursor: 'pointer', color: 'var(--text-dim)', fontWeight: 800 }}>
                  ✕
                </span>
              </span>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                value={brokerInput}
                onChange={(e) => setBrokerInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addBroker()}
                placeholder="KODE (YP, MG, AK)…"
                style={{
                  fontSize: 10.5,
                  width: 130,
                  background: 'var(--bg)',
                  color: 'var(--accent-hover)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontWeight: 800,
                  outline: 'none',
                }}
              />
              <button
                onClick={addBroker}
                disabled={brokers.length >= 5}
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  background: 'var(--cyan)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 4,
                  padding: '3px 10px',
                }}
              >
                + Add Broker
              </button>
            </div>
            <span style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>Maksimal 5 broker</span>
          </div>
        )}
      </div>

      {/* Main Tab Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {tab === 'intel' && (
          <>
            {intel.isLoading && <div style={{ color: 'var(--text-dim)', padding: 16 }}>Memuat data broker intel…</div>}
            {intel.isError && <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat data broker intel.</div>}
            {intel.data && <BrokerStockTable rows={intel.data.rows} onPick={selectSymbol} />}
          </>
        )}

        {tab === 'profiler' && (
          <>
            {brokers.length === 0 && <div style={{ color: 'var(--text-dim)', padding: 16 }}>Tambahkan minimal satu kode broker di toolbar atas.</div>}
            {profiler.isLoading && <div style={{ color: 'var(--text-dim)', padding: 16 }}>Memuat portofolio broker…</div>}
            {profiler.isError && <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat portofolio broker.</div>}
            {profiler.data && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* KPI Cards Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: '3px solid #3b82f6', borderRadius: 6, padding: 12 }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3 }}>NET TOTAL PORTOFOLIO</div>
                    <div style={{ color: profiler.data.totalNet >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 900, fontSize: 18, marginTop: 4 }}>
                      {profiler.data.totalNet >= 0 ? '+' : ''}
                      {fmtRp(profiler.data.totalNet)}
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: '3px solid var(--up)', borderRadius: 6, padding: 12 }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3 }}>TOTAL BELI (AKUMULASI)</div>
                    <div style={{ color: 'var(--up)', fontWeight: 900, fontSize: 18, marginTop: 4 }}>{fmtRp(profiler.data.totalBuy)}</div>
                  </div>
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: '3px solid var(--down)', borderRadius: 6, padding: 12 }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3 }}>TOTAL JUAL (DISTRIBUSI)</div>
                    <div style={{ color: 'var(--down)', fontWeight: 900, fontSize: 18, marginTop: 4 }}>{fmtRp(profiler.data.totalSell)}</div>
                  </div>
                </div>

                {/* Portfolio Flow Chart Card */}
                <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                  <div style={{ paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11, letterSpacing: 0.3 }}>
                      BROKER PORTFOLIO FLOW (NET KUMULATIF)
                    </span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>
                      Broker: {profiler.data.brokers.map((b) => `${b.code}`).join(', ')}
                    </span>
                  </div>
                  <FlowChart series={profiler.data.flow} dates={profiler.data.dates ?? []} />
                </div>

                {/* Top Buys & Top Sells Side-by-Side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <TopList title="🟢 TOP BUYS (AKUMULASI TERBESAR)" rows={profiler.data.topBuys} color="var(--up)" onPick={selectSymbol} />
                  <TopList title="🔴 TOP SELLS (DISTRIBUSI TERBESAR)" rows={profiler.data.topSells} color="var(--down)" onPick={selectSymbol} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
