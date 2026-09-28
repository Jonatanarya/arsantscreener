import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchStockProfile,
  fetchBars,
  fetchBrokerSummaryRange,
  fetchBrokerDistribution,
  type CategoryFlow,
  type InventorySeries,
  type StockProfile,
  type DailyBar,
  type BrokerSummaryRange,
} from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'
import { useBrokerMaster, brokerColor } from '../lib/brokers'
import { DateRangeFilter } from './PeriodPicker'

type Tab = 'overview' | 'inventory' | 'brokerFlow' | 'brokerDist'

const CAT_COLOR: Record<string, string> = {
  asing: '#ef4444',
  bumn: '#10b981',
  institusi: '#8b5cf6',
  'smart-retail': '#f5a623',
  ritel: '#f5a623',
}

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
const fmtPrice = (v: number) => (!v ? '—' : Math.round(v).toLocaleString('id-ID'))
const fmtLot = (v: number) => {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`
  return `${sign}${a.toLocaleString('id-ID')}`
}

/**
 * Deret inventory satu broker dari summaryRange / profile backend
 */
function getBrokerSeries(
  code: string,
  profileInventory: InventorySeries[],
  dates: string[] = [],
  summaryRange?: BrokerSummaryRange,
): InventorySeries {
  const cleanCode = String(code ?? '').toUpperCase().trim()
  const existing = profileInventory.find((s) => s.code.toUpperCase() === cleanCode)
  if (existing) return existing

  let netVal = 0
  let side: 'buy' | 'sell' = 'buy'

  if (summaryRange) {
    const buyer = (summaryRange.buyers || []).find(
      (b) => String(b.brokerCode || '').toUpperCase() === cleanCode,
    )
    const seller = (summaryRange.sellers || []).find(
      (s) => String(s.brokerCode || '').toUpperCase() === cleanCode,
    )
    const buyVal = buyer?.value || 0
    const sellVal = seller?.value || 0
    netVal = buyVal - sellVal
    side = netVal >= 0 ? 'buy' : 'sell'
  }

  return {
    code: cleanCode,
    name: cleanCode,
    type: 'lokal',
    side,
    netVal,
    points: dates.map((date) => ({ date, cumNet: netVal })),
  }
}

/** Visualisasi mikro-bar harian per kategori investor */
function DayBars({ days, color }: { days: CategoryFlow['days']; color: string }) {
  const max = Math.max(1, ...days.map((d) => Math.abs(d.netVal)))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 32, padding: '2px 0' }}>
      {days.map((d) => {
        const pct = (Math.abs(d.netVal) / max) * 100
        const up = d.netVal >= 0
        return (
          <div key={d.date} title={`${d.date} · Net: ${fmtRp(d.netVal)}`} style={{ flex: 1, height: '100%', position: 'relative', minWidth: 2 }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: `${Math.max(pct * 0.85, d.netVal === 0 ? 5 : 15)}%`,
                background: d.netVal === 0 ? 'var(--border)' : up ? color : 'var(--down)',
                top: up ? undefined : '50%',
                bottom: up ? '50%' : undefined,
                borderRadius: 1,
                opacity: d.netVal === 0 ? 0.3 : 0.9,
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Modal untuk menambah broker ke chart inventory / flow */
function AddBrokerModal({
  isOpen,
  onClose,
  activeBrokers,
  onAdd,
}: {
  isOpen: boolean
  onClose: () => void
  activeBrokers: string[]
  onAdd: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const master = useBrokerMaster()
  if (!isOpen) return null

  const q = query.toLowerCase()
  const filtered = [...master.values()]
    .filter((b) => b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q))
    .sort((a, b) => a.code.localeCompare(b.code))

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 460,
          background: 'var(--panel)',
          border: '1px solid var(--border-bright)',
          borderRadius: 8,
          padding: 16,
          boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 12, letterSpacing: 0.5 }}>+ TAMBAH BROKER TO CHART</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}>
            ✕
          </button>
        </div>

        <input
          type="text"
          placeholder="Cari kode atau nama broker (YP, MG, BK, AK)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'var(--bg)',
            color: 'var(--text-h)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 11.5,
            marginBottom: 12,
            outline: 'none',
          }}
        />

        <div style={{ maxHeight: 280, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {filtered.map((b) => {
            const isAdded = activeBrokers.includes(b.code)
            const color = brokerColor(b.code, master)
            return (
              <button
                key={b.code}
                disabled={isAdded}
                onClick={() => {
                  onAdd(b.code)
                  onClose()
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: isAdded ? 'var(--bg)' : 'var(--panel)',
                  border: `1px solid ${isAdded ? 'var(--border)' : color}`,
                  borderRadius: 6,
                  cursor: isAdded ? 'default' : 'pointer',
                  opacity: isAdded ? 0.4 : 1,
                  textAlign: 'left',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ color: 'var(--text-h)', fontWeight: 900, fontSize: 11 }}>{b.code}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: 9.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                </div>
                {isAdded ? <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>✓ Added</span> : <span style={{ fontSize: 10, color: 'var(--cyan)', fontWeight: 800 }}>+</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Component Tab 2: Inventory Analysis */
function InventoryTab({
  profile,
  bars,
  selectedBrokers,
  onRemoveBroker,
  onAddBrokerClick,
  onAddBrokerCode,
  periodFrom,
  periodTo,
  onSetPeriod,
}: {
  profile: StockProfile
  bars: DailyBar[]
  selectedBrokers: string[]
  onRemoveBroker: (code: string) => void
  onAddBrokerClick: () => void
  onAddBrokerCode: (code: string) => void
  periodFrom: string
  periodTo: string
  onSetPeriod: (from: string, to: string) => void
}) {
  const master = useBrokerMaster()
  const [showPrice, setShowPrice] = useState(true)
  const [priceStyle, setPriceStyle] = useState<'candle' | 'line'>('candle')
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const { data: summaryRange } = useQuery({
    queryKey: ['brokerSummaryRange', profile.symbol, periodFrom, periodTo],
    queryFn: () => fetchBrokerSummaryRange(profile.symbol, periodFrom, periodTo),
    enabled: !!profile.symbol && !!periodFrom && !!periodTo,
  })

  // Compute exact Net Value (buyVal - sellVal), Clean Buy/Sell status, and sort by largest Net Value
  const { accumBrokersList, distBrokersList, defaultCodes, cleanStatusMap } = useMemo(() => {
    const map = new Map<string, { code: string; buyVal: number; sellVal: number }>()

    const get = (c: string) => {
      const code = String(c ?? '').toUpperCase().trim()
      let item = map.get(code)
      if (!item) {
        item = { code, buyVal: 0, sellVal: 0 }
        map.set(code, item)
      }
      return item
    }

    if (summaryRange?.buyers) {
      for (const b of summaryRange.buyers) {
        if (!b.brokerCode) continue
        const item = get(b.brokerCode)
        item.buyVal += b.value ?? b.buyValue ?? 0
      }
    }

    if (summaryRange?.sellers) {
      for (const s of summaryRange.sellers) {
        if (!s.brokerCode) continue
        const item = get(s.brokerCode)
        item.sellVal += s.value ?? s.sellValue ?? 0
      }
    }

    // Complement from profile backend structures if summaryRange is partial
    if (profile?.floorTop) {
      for (const f of profile.floorTop) {
        if (!f.code) continue
        const item = get(f.code)
        if (item.buyVal === 0 && item.sellVal === 0) {
          if (f.netVal >= 0) item.buyVal = f.netVal
          else item.sellVal = Math.abs(f.netVal)
        }
      }
    }

    if (profile?.inventory) {
      for (const inv of profile.inventory) {
        if (!inv.code) continue
        const item = get(inv.code)
        if (item.buyVal === 0 && item.sellVal === 0) {
          if (inv.netVal >= 0) item.buyVal = inv.netVal
          else item.sellVal = Math.abs(inv.netVal)
        }
      }
    }

    if (profile?.netVsGross) {
      for (const n of profile.netVsGross) {
        if (!n.code) continue
        const item = get(n.code)
        if (item.buyVal === 0 && item.sellVal === 0) {
          if (n.side === 'buy' || n.netVal >= 0) item.buyVal = Math.abs(n.netVal || n.grossVal || 0)
          else item.sellVal = Math.abs(n.netVal || n.grossVal || 0)
        }
      }
    }

    const cleanMap = new Map<string, 'clean_buy' | 'clean_sell' | null>()

    const allMerged = Array.from(map.values()).map((b) => {
      const netVal = b.buyVal - b.sellVal
      const isCleanBuy = b.buyVal > 0 && b.sellVal === 0
      const isCleanSell = b.sellVal > 0 && b.buyVal === 0

      if (isCleanBuy) cleanMap.set(b.code, 'clean_buy')
      else if (isCleanSell) cleanMap.set(b.code, 'clean_sell')
      else cleanMap.set(b.code, null)

      return {
        code: b.code,
        buyVal: b.buyVal,
        sellVal: b.sellVal,
        netVal,
        isCleanBuy,
        isCleanSell,
      }
    })

    // Accumulators: Net Value > 0, STRICTLY SORTED DESCENDING BY NET VALUE (Highest netVal first!)
    const accum = allMerged
      .filter((b) => b.netVal > 0)
      .sort((a, b) => b.netVal - a.netVal)

    // Distributors: Net Value < 0, STRICTLY SORTED DESCENDING BY ABSOLUTE NET VALUE (Highest netVal distribution first!)
    const dist = allMerged
      .filter((b) => b.netVal < 0)
      .sort((a, b) => Math.abs(b.netVal) - Math.abs(a.netVal))

    const top2Accum = accum.slice(0, 2).map((b) => b.code)
    const top2Dist = dist.slice(0, 2).map((b) => b.code)
    const combined = Array.from(new Set([...top2Accum, ...top2Dist]))

    return {
      accumBrokersList: accum.slice(0, 10),
      distBrokersList: dist.slice(0, 10),
      defaultCodes: combined.length > 0 ? combined : profile.inventory.slice(0, 4).map((s) => s.code),
      cleanStatusMap: cleanMap,
    }
  }, [summaryRange, profile])

  const activeSeries = useMemo(() => {
    const targetCodes = selectedBrokers.length > 0 ? selectedBrokers : defaultCodes
    return targetCodes.map((code) => getBrokerSeries(code, profile.inventory, profile.dates, summaryRange))
  }, [selectedBrokers, defaultCodes, profile, summaryRange])

  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart')

  const dates = profile.dates
  if (dates.length < 2) {
    return <div style={{ color: 'var(--text-dim)', padding: 16, textAlign: 'center' }}>Data broker harian belum cukup untuk menggambar inventory.</div>
  }

  const W = 860
  const H = 360
  const padL = 65
  const padR = 65
  const padT = 16
  const padB = 55

  const allCum = activeSeries.flatMap((s) => s.points.map((p) => p.cumNet))
  const maxCum = allCum.length ? Math.max(...allCum, 0) : 100
  const minCum = allCum.length ? Math.min(...allCum, 0) : -100
  const spanCum = maxCum - minCum || 1

  const x = (i: number) => padL + (i / Math.max(1, dates.length - 1)) * (W - padL - padR)
  const yCum = (v: number) => padT + (1 - (v - minCum) / spanCum) * (H - padT - padB)

  const priceByDate = new Map(profile.priceLine.map((p) => [p.date, p.cumNet]))
  const prices = dates.map((d) => priceByDate.get(d)).filter((v): v is number => v != null)
  const barsByDate = new Map(bars.map((b) => [b.date, b]))

  let pMax = prices.length ? Math.max(...prices) : profile.lastClose || 100
  let pMin = prices.length ? Math.min(...prices) : profile.lastClose || 10
  if (priceStyle === 'candle') {
    const highs = dates.map((d) => barsByDate.get(d)?.high).filter((v): v is number => v != null)
    const lows = dates.map((d) => barsByDate.get(d)?.low).filter((v): v is number => v != null)
    if (highs.length) pMax = Math.max(...highs)
    if (lows.length) pMin = Math.min(...lows)
  }
  const pSpan = pMax - pMin || 1
  const yPrice = (v: number) => padT + (1 - (v - pMin) / pSpan) * (H - padT - padB)

  const volumes = dates.map((d) => barsByDate.get(d)?.volume || 0)
  const maxVol = Math.max(1, ...volumes)
  const volH = 45
  const yVol = (v: number) => H - padB - (v / maxVol) * volH

  let priceLinePath = ''
  dates.forEach((d, i) => {
    const v = priceByDate.get(d)
    if (v == null) return
    priceLinePath += `${priceLinePath ? 'L' : 'M'}${x(i)},${yPrice(v)}`
  })

  const candleW = Math.max(3, Math.min(10, ((W - padL - padR) / dates.length) * 0.65))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Control Header Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-header)', padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11, letterSpacing: 0.4 }}>
            📦 INVENTORY ANALYSIS · AKUMULASI KUMULATIF BROKER
          </span>

          {/* View Mode Switcher */}
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: 'var(--bg)' }}>
            <button
              onClick={() => setViewMode('chart')}
              style={{
                background: viewMode === 'chart' ? 'rgba(34,211,238,0.25)' : 'transparent',
                color: viewMode === 'chart' ? 'var(--cyan)' : 'var(--text-dim)',
                border: 'none',
                padding: '3px 10px',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              📈 Area Chart
            </button>
            <button
              onClick={() => setViewMode('table')}
              style={{
                background: viewMode === 'table' ? 'rgba(34,211,238,0.25)' : 'transparent',
                color: viewMode === 'table' ? 'var(--cyan)' : 'var(--text-dim)',
                border: 'none',
                padding: '3px 10px',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              📊 Table Breakdown
            </button>
          </div>

          <button
            onClick={onAddBrokerClick}
            style={{
              background: 'rgba(34,211,238,0.12)',
              color: 'var(--cyan)',
              border: '1px solid var(--cyan)',
              borderRadius: 4,
              padding: '3px 10px',
              fontSize: 10.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            + Add Broker
          </button>
          <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={onSetPeriod} />
        </div>

        {/* Toggle Price & Price Style */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setShowPrice(!showPrice)}
            style={{
              background: showPrice ? 'var(--accent)' : 'var(--bg)',
              color: showPrice ? '#000' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '3px 10px',
              fontSize: 10.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            📈 Price Overlay {showPrice ? 'ON' : 'OFF'}
          </button>

          {showPrice && (
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: 'var(--bg)' }}>
              <button
                onClick={() => setPriceStyle('candle')}
                style={{
                  background: priceStyle === 'candle' ? 'rgba(34,211,238,0.25)' : 'transparent',
                  color: priceStyle === 'candle' ? 'var(--cyan)' : 'var(--text-dim)',
                  border: 'none',
                  padding: '3px 10px',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Candle
              </button>
              <button
                onClick={() => setPriceStyle('line')}
                style={{
                  background: priceStyle === 'line' ? 'rgba(34,211,238,0.25)' : 'transparent',
                  color: priceStyle === 'line' ? 'var(--cyan)' : 'var(--text-dim)',
                  border: 'none',
                  padding: '3px 10px',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Line
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid: Visual Left + Side Panel Right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 10 }}>
        {/* LEFT VIEW (Chart OR Table Breakdown) */}
        {viewMode === 'chart' ? (
          <div
            style={{ position: 'relative', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 6 }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const mouseX = e.clientX - rect.left
              const relX = Math.max(padL, Math.min(W - padR, mouseX))
              const idx = Math.round(((relX - padL) / (W - padL - padR)) * (dates.length - 1))
              setHoverIdx(Math.max(0, Math.min(dates.length - 1, idx)))
            }}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 360, display: 'block' }}>
              <defs>
                {activeSeries.map((s) => {
                  const color = brokerColor(s.code, master)
                  return (
                    <linearGradient key={`grad-${s.code}`} id={`grad-${s.code}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity="0.32" />
                      <stop offset="100%" stopColor={color} stopOpacity="0.0" />
                    </linearGradient>
                  )
                })}
              </defs>

              {/* Zero Line */}
              <line x1={padL} y1={yCum(0)} x2={W - padR} y2={yCum(0)} stroke="var(--border-bright)" strokeDasharray="3 3" strokeWidth={1.2} />
              <text x={4} y={yCum(0) + 3} fill="var(--text-dim)" fontSize={8.5} fontFamily="monospace">0</text>
              <text x={4} y={yCum(maxCum) + 8} fill="var(--text-dim)" fontSize={8.5} fontFamily="monospace">{fmtRp(maxCum)}</text>
              <text x={4} y={yCum(minCum) - 2} fill="var(--text-dim)" fontSize={8.5} fontFamily="monospace">{fmtRp(minCum)}</text>

              {/* Price Scale Right Axis */}
              {showPrice && (
                <>
                  <text x={W - padR + 6} y={yPrice(pMax) + 8} fill="#3b82f6" fontSize={8.5} fontWeight={900} fontFamily="monospace">{fmtPrice(pMax)}</text>
                  <text x={W - padR + 6} y={yPrice(pMin) - 2} fill="#3b82f6" fontSize={8.5} fontWeight={900} fontFamily="monospace">{fmtPrice(pMin)}</text>
                </>
              )}

              {/* Volume Histogram */}
              {dates.map((d, i) => {
                const b = barsByDate.get(d)
                if (!b || !b.volume) return null
                const isUp = b.close >= b.open
                const cx = x(i)
                const yTop = yVol(b.volume)
                const height = H - padB - yTop
                return (
                  <rect
                    key={`vol-${d}`}
                    x={cx - candleW / 2}
                    y={yTop}
                    width={candleW}
                    height={Math.max(1, height)}
                    fill={isUp ? 'var(--up-bg)' : 'var(--down-bg)'}
                  />
                )
              })}

              {/* Price Candlesticks / Line */}
              {showPrice && priceStyle === 'candle' && dates.map((d, i) => {
                const b = barsByDate.get(d)
                if (!b) return null
                const cx = x(i)
                const isUp = b.close >= b.open
                const color = isUp ? 'var(--up)' : 'var(--down)'
                const yOpen = yPrice(b.open)
                const yClose = yPrice(b.close)
                const yHigh = yPrice(b.high)
                const yLow = yPrice(b.low)
                const bodyY = Math.min(yOpen, yClose)
                const bodyH = Math.max(2, Math.abs(yOpen - yClose))

                return (
                  <g key={`candle-${d}`}>
                    <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth={1} />
                    <rect x={cx - candleW / 2} y={bodyY} width={candleW} height={bodyH} fill={color} stroke={color} strokeWidth={1} rx={1} />
                  </g>
                )
              })}

              {showPrice && priceStyle === 'line' && (
                <path d={priceLinePath} fill="none" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 2" />
              )}

              {/* Broker Inventory Lines + Gradient Area Fills */}
              {activeSeries.map((s) => {
                const pathD = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${yCum(p.cumNet)}`).join(' ')
                const areaPath = `${pathD} L${x(dates.length - 1)},${yCum(0)} L${x(0)},${yCum(0)} Z`
                const color = brokerColor(s.code, master)

                return (
                  <g key={s.code}>
                    <path d={areaPath} fill={`url(#grad-${s.code})`} opacity={0.35} />
                    <path d={pathD} fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
                  </g>
                )
              })}

              {/* Hover Crosshair */}
              {hoverIdx != null && (
                <g>
                  <line x1={x(hoverIdx)} y1={padT} x2={x(hoverIdx)} y2={H - padB} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 3" />
                  {activeSeries.map((s) => {
                    const pt = s.points[hoverIdx]
                    if (!pt) return null
                    const color = brokerColor(s.code, master)
                    return <circle key={s.code} cx={x(hoverIdx)} cy={yCum(pt.cumNet)} r={4.5} fill={color} stroke="#000" strokeWidth={1.8} />
                  })}
                </g>
              )}

              {/* Date Axis */}
              {dates.map((d, i) =>
                i % Math.ceil(dates.length / 8) === 0 ? (
                  <text key={d} x={x(i)} y={H - 8} fill="var(--text-dim)" fontSize={8.5} textAnchor="middle" fontFamily="monospace">
                    {d.slice(5)}
                  </text>
                ) : null,
              )}
            </svg>

            {/* Floating Glass Tooltip Overlay */}
            {hoverIdx != null && (
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 12,
                  background: 'rgba(15, 23, 42, 0.92)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
                  zIndex: 10,
                  fontSize: 10.5,
                  minWidth: 180,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, marginBottom: 6 }}>
                  <span style={{ color: 'var(--cyan)', fontWeight: 900 }}>📅 {dates[hoverIdx]}</span>
                  {barsByDate.get(dates[hoverIdx]) && (
                    <span style={{ color: 'var(--text-h)', fontWeight: 800 }}>
                      Close: <b style={{ color: '#3b82f6' }}>{fmtPrice(barsByDate.get(dates[hoverIdx])!.close)}</b>
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {activeSeries.map((s) => {
                    const val = s.points[hoverIdx]?.cumNet || 0
                    const color = brokerColor(s.code, master)
                    return (
                      <div key={s.code} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
                          <b style={{ color: 'var(--text-h)', fontWeight: 900 }}>{s.code}</b>
                        </div>
                        <span style={{ color: val >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 900, fontFamily: 'monospace' }}>
                          {val >= 0 ? '+' : ''}{fmtRp(val)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* TABLE BREAKDOWN VIEW MODE */
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
              <thead>
                <tr style={{ background: 'var(--panel-header)', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', fontSize: 9.5, color: 'var(--text-dim)' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Broker & Tipe</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Conviction Status</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total Net Flow</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: 120 }}>Porsi Magnitudo</th>
                  <th style={{ padding: '8px 10px', textAlign: 'center' }}>Daily Net Trend (Per Hari)</th>
                </tr>
              </thead>
              <tbody>
                {activeSeries.map((s) => {
                  const color = brokerColor(s.code, master)
                  const cleanStatus = cleanStatusMap.get(s.code)
                  const isPositive = s.netVal >= 0
                  const absNet = Math.abs(s.netVal)
                  const maxNetVal = Math.max(1, ...activeSeries.map((ser) => Math.abs(ser.netVal)))
                  const barPct = (absNet / maxNetVal) * 100

                  return (
                    <tr key={s.code} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 5, background: color }} />
                          <div>
                            <b style={{ color: 'var(--text-h)', fontSize: 11.5 }}>{s.code}</b>
                            <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{s.type.toUpperCase()}</div>
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '8px 10px' }}>
                        {cleanStatus === 'clean_buy' && (
                          <span style={{ background: 'var(--up-bg)', color: 'var(--up)', border: '1px solid var(--up)', borderRadius: 3, padding: '2px 6px', fontSize: 9, fontWeight: 900 }}>
                            ✓ Clean Buy
                          </span>
                        )}
                        {cleanStatus === 'clean_sell' && (
                          <span style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--down)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 3, padding: '2px 6px', fontSize: 9, fontWeight: 900 }}>
                            ✓ Clean Sell
                          </span>
                        )}
                        {!cleanStatus && (
                          <span style={{ color: isPositive ? 'var(--up)' : 'var(--down)', fontWeight: 800, fontSize: 9.5 }}>
                            {isPositive ? '▲ Net Accumulation' : '▼ Net Distribution'}
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                        <div style={{ color: isPositive ? 'var(--up)' : 'var(--down)', fontWeight: 900, fontSize: 12.5, fontFamily: 'monospace' }}>
                          {isPositive ? '+' : '-'}{fmtRp(absNet)}
                        </div>
                      </td>

                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', background: color, borderRadius: 3 }} />
                        </div>
                      </td>

                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, height: 22 }}>
                          {s.points.map((p, idx) => {
                            const prevCum = idx > 0 ? s.points[idx - 1].cumNet : 0
                            const dayDiff = p.cumNet - prevCum
                            const isDayUp = dayDiff >= 0
                            return (
                              <div
                                key={p.date}
                                title={`${p.date}: ${dayDiff >= 0 ? '+' : ''}${fmtRp(dayDiff)}`}
                                style={{
                                  width: 4,
                                  height: Math.max(3, Math.min(18, (Math.abs(dayDiff) / (maxNetVal || 1)) * 30)),
                                  background: isDayUp ? 'var(--up)' : 'var(--down)',
                                  borderRadius: 1,
                                  opacity: 0.85,
                                }}
                              />
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Right Side Panel: Net Akumulasi & Distribusi Brokers */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, overflowY: 'auto', maxHeight: 420 }}>
          {/* Section 1: TOP AKUMULASI */}
          <div>
            <div style={{ color: 'var(--up)', fontWeight: 900, fontSize: 10.5, letterSpacing: 0.4, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>🟢 TOP AKUMULASI (NET BUY)</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>Toggle Chart</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {accumBrokersList.map((b) => {
                const isSelected = activeSeries.some((s) => s.code.toUpperCase() === b.code)
                const color = brokerColor(b.code, master)
                const cleanStatus = cleanStatusMap.get(b.code)

                return (
                  <div
                    key={b.code}
                    onClick={() => {
                      if (isSelected) onRemoveBroker(b.code)
                      else onAddBrokerCode(b.code)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 8px',
                      background: isSelected ? 'var(--up-bg)' : 'var(--bg)',
                      border: `1px solid ${isSelected ? color : 'var(--border)'}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 10.5,
                      transition: 'all 0.12s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
                      <b style={{ color: 'var(--text-h)', fontWeight: 900 }}>{b.code}</b>
                      {cleanStatus === 'clean_buy' && (
                        <span style={{ background: 'var(--up-bg)', color: 'var(--up)', border: '1px solid var(--up)', borderRadius: 3, padding: '0 4px', fontSize: 8.5, fontWeight: 900 }}>
                          ✓ Clean Buy
                        </span>
                      )}
                    </div>
                    <span style={{ color: 'var(--up)', fontWeight: 900, fontSize: 10.5 }}>
                      +{fmtRp(Math.abs(b.netVal))}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Section 2: TOP DISTRIBUSI */}
          <div>
            <div style={{ color: 'var(--down)', fontWeight: 900, fontSize: 10.5, letterSpacing: 0.4, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>🔴 TOP DISTRIBUSI (NET SELL)</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>Toggle Chart</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {distBrokersList.map((b) => {
                const isSelected = activeSeries.some((s) => s.code.toUpperCase() === b.code)
                const color = brokerColor(b.code, master)
                const cleanStatus = cleanStatusMap.get(b.code)

                return (
                  <div
                    key={b.code}
                    onClick={() => {
                      if (isSelected) onRemoveBroker(b.code)
                      else onAddBrokerCode(b.code)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 8px',
                      background: isSelected ? 'rgba(239,68,68,0.1)' : 'var(--bg)',
                      border: `1px solid ${isSelected ? color : 'var(--border)'}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 10.5,
                      transition: 'all 0.12s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
                      <b style={{ color: 'var(--text-h)', fontWeight: 900 }}>{b.code}</b>
                      {cleanStatus === 'clean_sell' && (
                        <span style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--down)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 3, padding: '0 4px', fontSize: 8.5, fontWeight: 900 }}>
                          ✓ Clean Sell
                        </span>
                      )}
                    </div>
                    <span style={{ color: 'var(--down)', fontWeight: 900, fontSize: 10.5 }}>
                      -{fmtRp(Math.abs(b.netVal))}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Active Broker Chips Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, background: 'var(--panel)', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 700 }}>Broker Aktif:</span>
        {activeSeries.map((s) => {
          const color = brokerColor(s.code, master)
          return (
            <div
              key={s.code}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--bg)',
                border: `1px solid ${color}`,
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: 10.5,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
              <span style={{ color: 'var(--text-h)', fontWeight: 900 }}>{s.code}</span>
              <span style={{ color: s.netVal >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 800, fontSize: 10 }}>
                {s.netVal >= 0 ? '+' : ''}{fmtRp(s.netVal)}
              </span>
              <button
                onClick={() => onRemoveBroker(s.code)}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, marginLeft: 2 }}
              >
                ✕
              </button>
            </div>
          )
        })}
        <button
          onClick={onAddBrokerClick}
          style={{
            background: 'var(--bg)',
            border: '1px dashed var(--cyan)',
            color: 'var(--cyan)',
            borderRadius: 4,
            padding: '3px 10px',
            fontSize: 11,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          + Add Broker
        </button>
      </div>
    </div>
  )
}

/** Component Tab 3: Broker Flow */
function BrokerFlowTab({
  profile,
  selectedBrokers,
  onRemoveBroker,
  onAddBrokerClick,
  periodFrom,
  periodTo,
  onSetPeriod,
}: {
  profile: StockProfile
  selectedBrokers: string[]
  onRemoveBroker: (code: string) => void
  onAddBrokerClick: () => void
  periodFrom: string
  periodTo: string
  onSetPeriod: (from: string, to: string) => void
}) {
  const master = useBrokerMaster()
  const [unit, setUnit] = useState<'value' | 'volume'>('value')
  const [showPrice, setShowPrice] = useState(true)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const { data: summaryRange } = useQuery({
    queryKey: ['brokerSummaryRange', profile.symbol, periodFrom, periodTo],
    queryFn: () => fetchBrokerSummaryRange(profile.symbol, periodFrom, periodTo),
    enabled: !!profile.symbol && !!periodFrom && !!periodTo,
  })

  const activeSeries = useMemo(() => {
    const defaultCodes = profile.floorTop.length > 0
      ? profile.floorTop.slice(0, 4).map((f) => f.code)
      : profile.inventory.slice(0, 4).map((s) => s.code)

    const targetCodes = selectedBrokers.length > 0 ? selectedBrokers : defaultCodes

    return targetCodes.map((code) => getBrokerSeries(code, profile.inventory, profile.dates, summaryRange))
  }, [selectedBrokers, profile, summaryRange])

  const dates = profile.dates
  if (dates.length < 2) {
    return <div style={{ color: 'var(--text-dim)', padding: 16, textAlign: 'center' }}>Data tidak cukup untuk Broker Flow.</div>
  }

  const W = 960
  const H = 340
  const padL = 75
  const padR = 65
  const padT = 15
  const padB = 40

  const allCum = activeSeries.flatMap((s) =>
    s.points.map((p) => (unit === 'volume' ? Math.round(p.cumNet / profile.lastClose) : p.cumNet))
  )
  const maxCum = allCum.length ? Math.max(...allCum, 0) : 100
  const minCum = allCum.length ? Math.min(...allCum, 0) : -100
  const spanCum = maxCum - minCum || 1

  const x = (i: number) => padL + (i / Math.max(1, dates.length - 1)) * (W - padL - padR)
  const yCum = (v: number) => padT + (1 - (v - minCum) / spanCum) * (H - padT - padB)

  const priceByDate = new Map(profile.priceLine.map((p) => [p.date, p.cumNet]))
  const prices = dates.map((d) => priceByDate.get(d)).filter((v): v is number => v != null)
  const pMax = prices.length ? Math.max(...prices) : profile.lastClose || 100
  const pMin = prices.length ? Math.min(...prices) : profile.lastClose || 10
  const pSpan = pMax - pMin || 1
  const yPrice = (v: number) => padT + (1 - (v - pMin) / pSpan) * (H - padT - padB)

  let priceLinePath = ''
  dates.forEach((d, i) => {
    const v = priceByDate.get(d)
    if (v == null) return
    priceLinePath += `${priceLinePath ? 'L' : 'M'}${x(i)},${yPrice(v)}`
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Control Header Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-header)', padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11, letterSpacing: 0.4 }}>
            🌊 BROKER FLOW · ALIRAN KUMULATIF DANA BROKER
          </span>
          <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={onSetPeriod} />
        </div>

        {/* Unit Switcher */}
        <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
          <button
            onClick={() => setUnit('value')}
            style={{
              background: unit === 'value' ? 'var(--accent)' : 'transparent',
              color: unit === 'value' ? '#000' : 'var(--text-dim)',
              border: 'none',
              padding: '3px 10px',
              fontSize: 10.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            💰 Value (Rp)
          </button>
          <button
            onClick={() => setUnit('volume')}
            style={{
              background: unit === 'volume' ? 'var(--accent)' : 'transparent',
              color: unit === 'volume' ? '#000' : 'var(--text-dim)',
              border: 'none',
              padding: '3px 10px',
              fontSize: 10.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            📊 Volume (Lot)
          </button>
        </div>
      </div>

      {/* Main Multi-Line Flow Chart */}
      <div
        style={{ position: 'relative', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 6 }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const mouseX = e.clientX - rect.left
          const relX = Math.max(padL, Math.min(W - padR, mouseX))
          const idx = Math.round(((relX - padL) / (W - padL - padR)) * (dates.length - 1))
          setHoverIdx(Math.max(0, Math.min(dates.length - 1, idx)))
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 340, display: 'block' }}>
          <line x1={padL} y1={yCum(0)} x2={W - padR} y2={yCum(0)} stroke="var(--border-bright)" strokeDasharray="3 3" strokeWidth={1.2} />
          <text x={4} y={yCum(0) + 3} fill="var(--text-dim)" fontSize={8.5} fontFamily="monospace">0</text>
          <text x={4} y={yCum(maxCum) + 8} fill="var(--text-dim)" fontSize={8.5} fontFamily="monospace">
            {unit === 'value' ? fmtRp(maxCum) : fmtLot(maxCum)}
          </text>
          <text x={4} y={yCum(minCum) - 2} fill="var(--text-dim)" fontSize={8.5} fontFamily="monospace">
            {unit === 'value' ? fmtRp(minCum) : fmtLot(minCum)}
          </text>

          {showPrice && (
            <>
              <text x={W - padR + 6} y={yPrice(pMax) + 8} fill="#3b82f6" fontSize={8.5} fontWeight={900} fontFamily="monospace">{fmtPrice(pMax)}</text>
              <text x={W - padR + 6} y={yPrice(pMin) - 2} fill="#3b82f6" fontSize={8.5} fontWeight={900} fontFamily="monospace">{fmtPrice(pMin)}</text>
              <path d={priceLinePath} fill="none" stroke="#3b82f6" strokeWidth={1.8} strokeDasharray="4 2" />
            </>
          )}

          {/* Broker Flow Lines */}
          {activeSeries.map((s) => {
            const pathD = s.points
              .map((p, i) => {
                const val = unit === 'volume' ? Math.round(p.cumNet / profile.lastClose) : p.cumNet
                return `${i === 0 ? 'M' : 'L'}${x(i)},${yCum(val)}`
              })
              .join(' ')
            const color = brokerColor(s.code, master)
            return <path key={s.code} d={pathD} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
          })}

          {/* Hover Crosshair */}
          {hoverIdx != null && (
            <g>
              <line x1={x(hoverIdx)} y1={padT} x2={x(hoverIdx)} y2={H - padB} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 3" />
              {activeSeries.map((s) => {
                const pt = s.points[hoverIdx]
                if (!pt) return null
                const val = unit === 'volume' ? Math.round(pt.cumNet / profile.lastClose) : pt.cumNet
                const color = brokerColor(s.code, master)
                return <circle key={s.code} cx={x(hoverIdx)} cy={yCum(val)} r={4} fill={color} stroke="#000" strokeWidth={1.5} />
              })}
            </g>
          )}

          {/* Date Axis */}
          {dates.map((d, i) =>
            i % Math.ceil(dates.length / 8) === 0 ? (
              <text key={d} x={x(i)} y={H - 8} fill="var(--text-dim)" fontSize={8.5} textAnchor="middle" fontFamily="monospace">
                {d.slice(5)}
              </text>
            ) : null,
          )}
        </svg>

        {/* Hover Tooltip Bar */}
        {hoverIdx != null && (
          <div style={{ background: 'var(--panel-header)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 10px', marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, fontSize: 10 }}>
            <span style={{ color: 'var(--cyan)', fontWeight: 800 }}>📅 {dates[hoverIdx]}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {activeSeries.map((s) => {
                const rawVal = s.points[hoverIdx]?.cumNet || 0
                const val = unit === 'volume' ? Math.round(rawVal / profile.lastClose) : rawVal
                const color = brokerColor(s.code, master)
                return (
                  <span key={s.code} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 3, background: color }} />
                    <b style={{ color: 'var(--text-h)' }}>{s.code}:</b>
                    <span style={{ color: val >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 800 }}>
                      {val >= 0 ? '+' : ''}{unit === 'value' ? fmtRp(val) : `${fmtLot(val)} lot`}
                    </span>
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Timeframe Presets & Active Broker Chips Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--panel)', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
        <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={onSetPeriod} />

        {/* Broker Chips & Price Toggle */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setShowPrice(!showPrice)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: showPrice ? '#3b82f6' : 'var(--bg)',
              color: showPrice ? '#fff' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '3px 8px',
              fontSize: 10.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 4, background: '#3b82f6' }} />
            Price Overlay
          </button>

          {activeSeries.map((s) => {
            const color = brokerColor(s.code, master)
            return (
              <div
                key={s.code}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'var(--bg)',
                  border: `1px solid ${color}`,
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 10.5,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
                <span style={{ color: 'var(--text-h)', fontWeight: 900 }}>{s.code}</span>
                <button
                  onClick={() => onRemoveBroker(s.code)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, marginLeft: 2 }}
                >
                  ✕
                </button>
              </div>
            )
          })}

          <button
            onClick={onAddBrokerClick}
            style={{
              background: 'var(--bg)',
              border: '1px dashed var(--cyan)',
              color: 'var(--cyan)',
              borderRadius: 4,
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            + Add Broker
          </button>
        </div>
      </div>
    </div>
  )
}

/** Component Tab 4: Broker Distribution Matrix (Sankey Flow Diagram) */
function BrokerDistTab({
  profile,
  periodFrom,
  periodTo,
  onSetPeriod,
}: {
  profile: StockProfile
  periodFrom: string
  periodTo: string
  onSetPeriod: (from: string, to: string) => void
}) {
  const [unit, setUnit] = useState<'value' | 'volume'>('value')
  const [investorType, setInvestorType] = useState<'all' | 'foreign' | 'local'>('all')
  const [expanded, setExpanded] = useState(false)
  const [hoverNode, setHoverNode] = useState<string | null>(null)
  const [hoverFlow, setHoverFlow] = useState<{ from: string; to: string; val: number } | null>(null)

  const masterMap = useBrokerMaster()

  // 1. Fetch exact raw_ingest distribution matrix from backend endpoint using active period date range
  const { data: distPayload, isLoading: isDistLoading } = useQuery({
    queryKey: ['brokerDistribution', profile.symbol, periodFrom, periodTo, unit],
    queryFn: () => fetchBrokerDistribution(profile.symbol, { from: periodFrom, to: periodTo, unit }),
    enabled: !!profile.symbol,
  })

  // 2. Fallback fetch to broker summary range if raw_ingest payload is loading
  const { data: summaryRange } = useQuery({
    queryKey: ['brokerSummaryRange', profile.symbol, periodFrom, periodTo],
    queryFn: () => fetchBrokerSummaryRange(profile.symbol, periodFrom, periodTo),
    enabled: !!profile.symbol && !!periodFrom && !!periodTo,
  })

  const getCategoryType = (typeStr?: string, groupStr?: string): 'domestic' | 'bumn' | 'foreign' => {
    const s = String(typeStr || groupStr || '').toLowerCase()
    if (s.includes('asing') || s.includes('foreign')) return 'foreign'
    if (s.includes('pemerintah') || s.includes('bumn')) return 'bumn'
    return 'domestic'
  }

  const getCatColor = (cat: 'domestic' | 'bumn' | 'foreign') => {
    if (cat === 'foreign') return '#ef4444' // Red (Foreign)
    if (cat === 'bumn') return '#10b981'   // Green (BUMN)
    return '#8b5cf6'                       // Purple (Domestic)
  }

  const fmtAmount = (val: number) => {
    if (!val) return '0'
    const abs = Math.abs(val)
    if (unit === 'value') {
      if (abs >= 1e12) return `${(abs / 1e12).toFixed(2)} T`
      if (abs >= 1e9) return `${(abs / 1e9).toFixed(2)} B`
      if (abs >= 1e6) return `${(abs / 1e6).toFixed(2)} M`
      if (abs >= 1e3) return `${(abs / 1e3).toFixed(2)} K`
      return abs.toLocaleString('id-ID')
    } else {
      if (abs >= 1e9) return `${(abs / 1e9).toFixed(2)} B`
      if (abs >= 1e6) return `${(abs / 1e6).toFixed(2)} M`
      if (abs >= 1e3) return `${(abs / 1e3).toFixed(2)} K`
      return abs.toLocaleString('id-ID')
    }
  }

  // Parse & SORT distribution matrix (HIGHEST VALUE/VOLUME FIRST)
  const { buyersList, sellersList, flows, totalBuyVal, totalSellVal } = useMemo(() => {
    const rawData = unit === 'value'
      ? (distPayload?.data?.by_value || distPayload?.by_value)
      : (distPayload?.data?.by_volume || distPayload?.by_volume)

    const buyItems = rawData?.top_broker_buy || []
    const sellItems = rawData?.top_broker_sell || []

    if (buyItems.length > 0 || sellItems.length > 0) {
      const buyerMap = new Map<string, { code: string; val: number; category: 'domestic' | 'bumn' | 'foreign' }>()
      const sellerMap = new Map<string, { code: string; val: number; category: 'domestic' | 'bumn' | 'foreign' }>()
      const rawFlows: { from: string; to: string; val: number; category: 'domestic' | 'bumn' | 'foreign' }[] = []

      // 1. Process top_broker_buy
      for (const item of buyItems) {
        const d = item.detail
        if (!d || !d.code) continue
        const bCode = String(d.code).toUpperCase()
        const master = masterMap.get(bCode)
        const bCat = getCategoryType(d.type, master?.group)

        if (investorType === 'foreign' && bCat !== 'foreign') continue
        if (investorType === 'local' && bCat === 'foreign') continue

        buyerMap.set(bCode, { code: bCode, val: d.amount || 0, category: bCat })

        const distArr = item.distribute_to || []
        for (const dist of distArr) {
          if (!dist || !dist.code) continue
          const sCode = String(dist.code).toUpperCase()
          const sMaster = masterMap.get(sCode)
          const sCat = getCategoryType(dist.type, sMaster?.group)

          if (investorType === 'foreign' && sCat !== 'foreign') continue
          if (investorType === 'local' && sCat === 'foreign') continue

          rawFlows.push({ from: bCode, to: sCode, val: dist.amount || 0, category: bCat })
        }
      }

      // 2. Process top_broker_sell
      for (const item of sellItems) {
        const d = item.detail
        if (!d || !d.code) continue
        const sCode = String(d.code).toUpperCase()
        const master = masterMap.get(sCode)
        const sCat = getCategoryType(d.type, master?.group)

        if (investorType === 'foreign' && sCat !== 'foreign') continue
        if (investorType === 'local' && sCat === 'foreign') continue

        sellerMap.set(sCode, { code: sCode, val: d.amount || 0, category: sCat })
      }

      if (sellerMap.size === 0) {
        for (const fl of rawFlows) {
          const sCode = fl.to
          sellerMap.set(sCode, {
            code: sCode,
            val: (sellerMap.get(sCode)?.val || 0) + fl.val,
            category: fl.category,
          })
        }
      }

      const limit = expanded ? 25 : 8
      const bList = Array.from(buyerMap.values()).sort((a, b) => b.val - a.val).slice(0, limit)
      const sList = Array.from(sellerMap.values()).sort((a, b) => b.val - a.val).slice(0, limit)

      const bCodeSet = new Set(bList.map((b) => b.code))
      const sCodeSet = new Set(sList.map((s) => s.code))

      const activeFlows = rawFlows.filter((f) => bCodeSet.has(f.from) && sCodeSet.has(f.to))
      const tBuy = bList.reduce((acc, b) => acc + b.val, 0)
      const tSell = sList.reduce((acc, s) => acc + s.val, 0)

      return { buyersList: bList, sellersList: sList, flows: activeFlows, totalBuyVal: tBuy, totalSellVal: tSell }
    }

    // Fallback compute
    const getCode = (b: any): string => String(b?.brokerCode ?? b?.code ?? b?.Code ?? b?.broker ?? '').toUpperCase()

    let bList = (summaryRange?.buyers ?? []).map((b: any) => {
      const code = getCode(b)
      const master = masterMap.get(code)
      const val = unit === 'value'
        ? (b.value ?? b.buyValue ?? Math.abs(b.netVal ?? 0))
        : (((b.lot ?? b.buyLot ?? 0) * 100) || Math.abs((b.netLot ?? 0) * 100))
      return { code, val: Math.abs(val), category: getCategoryType(b.investorType, master?.group) }
    })

    let sList = (summaryRange?.sellers ?? []).map((s: any) => {
      const code = getCode(s)
      const master = masterMap.get(code)
      const val = unit === 'value'
        ? (s.value ?? s.sellValue ?? Math.abs(s.netVal ?? 0))
        : (((s.lot ?? s.sellLot ?? 0) * 100) || Math.abs((s.netLot ?? 0) * 100))
      return { code, val: Math.abs(val), category: getCategoryType(s.investorType, master?.group) }
    })

    if (!bList.length && profile.floorTop) {
      bList = profile.floorTop.filter((f) => f.netVal > 0).map((f) => ({
        code: String(f.code).toUpperCase(),
        val: unit === 'value' ? Math.abs(f.netVal) : Math.abs(f.netLot * 100),
        category: getCategoryType(f.type),
      }))
    }

    if (!sList.length && profile.netVsGross) {
      sList = profile.netVsGross.filter((s) => s.side === 'sell').map((s) => ({
        code: String(s.code).toUpperCase(),
        val: unit === 'value' ? Math.abs(s.netVal || s.grossVal) : 0,
        category: getCategoryType(undefined, masterMap.get(String(s.code).toUpperCase())?.group),
      }))
    }

    if (investorType === 'foreign') {
      bList = bList.filter((b) => b.category === 'foreign')
      sList = sList.filter((s) => s.category === 'foreign')
    } else if (investorType === 'local') {
      bList = bList.filter((b) => b.category !== 'foreign')
      sList = sList.filter((s) => s.category !== 'foreign')
    }

    const limit = expanded ? 25 : 8
    bList = bList.filter((b) => b.code && b.val > 0).sort((a, b) => b.val - a.val).slice(0, limit)
    sList = sList.filter((s) => s.code && s.val > 0).sort((a, b) => b.val - a.val).slice(0, limit)

    const tBuy = bList.reduce((acc, b) => acc + b.val, 0)
    const tSell = sList.reduce((acc, s) => acc + s.val, 0)

    return { buyersList: bList, sellersList: sList, flows: [], totalBuyVal: tBuy, totalSellVal: tSell }
  }, [distPayload, summaryRange, profile, unit, investorType, expanded, masterMap])

  const totalBuy = totalBuyVal || 1
  const totalSell = totalSellVal || 1

  const W = 920
  const maxNodes = Math.max(buyersList.length, sellersList.length, 1)
  const H = Math.max(440, maxNodes * 56)
  const padT = 30
  const padB = 30
  const colL = 155
  const colR = 765
  const pillW = 140

  let curYBuy = padT
  const buyerNodes = buyersList.map((b) => {
    const height = Math.max(32, (b.val / totalBuy) * (H - padT - padB - buyersList.length * 8))
    const node = { ...b, y: curYBuy, height }
    curYBuy += height + 8
    return node
  })

  let curYSell = padT
  const sellerNodes = sellersList.map((s) => {
    const height = Math.max(32, (s.val / totalSell) * (H - padT - padB - sellersList.length * 8))
    const node = { ...s, y: curYSell, height }
    curYSell += height + 8
    return node
  })

  const buyerNodeMap = new Map(buyerNodes.map((n) => [n.code, n]))
  const sellerNodeMap = new Map(sellerNodes.map((n) => [n.code, n]))

  const buyerFlowOffsets = new Map<string, number>()
  const sellerFlowOffsets = new Map<string, number>()

  const flowPaths = flows.map((fl) => {
    const bNode = buyerNodeMap.get(fl.from)
    const sNode = sellerNodeMap.get(fl.to)
    if (!bNode || !sNode) return null

    const curBOffset = buyerFlowOffsets.get(fl.from) || 0
    const bFlowH = Math.max(2, (fl.val / bNode.val) * bNode.height)
    const y1Top = bNode.y + curBOffset
    const y1Bot = y1Top + bFlowH
    buyerFlowOffsets.set(fl.from, curBOffset + bFlowH)

    const curSOffset = sellerFlowOffsets.get(fl.to) || 0
    const sFlowH = Math.max(2, (fl.val / sNode.val) * sNode.height)
    const y2Top = sNode.y + curSOffset
    const y2Bot = y2Top + sFlowH
    sellerFlowOffsets.set(fl.to, curSOffset + sFlowH)

    const xL = colL + pillW
    const xR = colR - pillW
    const ctrlX1 = xL + (xR - xL) * 0.45
    const ctrlX2 = xL + (xR - xL) * 0.55

    const pathD = `M ${xL},${y1Top} C ${ctrlX1},${y1Top} ${ctrlX2},${y2Top} ${xR},${y2Top} L ${xR},${y2Bot} C ${ctrlX2},${y2Bot} ${ctrlX1},${y1Bot} ${xL},${y1Bot} Z`

    return {
      key: `${fl.from}-${fl.to}`,
      from: fl.from,
      to: fl.to,
      val: fl.val,
      category: fl.category,
      pathD,
      bNode,
      sNode,
    }
  }).filter((f): f is NonNullable<typeof f> => f !== null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, width: '100%' }}>
      {/* Header Title & Controls Row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: 'var(--text-h)', letterSpacing: 0.3 }}>
              BROKER DISTRIBUTION MATRIX
            </h3>
            <span className="bbg-badge bbg-badge-cyan" style={{ fontSize: 10 }}>
              {profile.symbol} IJ
            </span>
            {isDistLoading && (
              <span style={{ fontSize: 10, color: 'var(--cyan)' }}>Memuat matrix distribusi…</span>
            )}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 2 }}>
            Urutan Broker berdasar nilai transaksi tertinggi (highest value/volume) · {periodFrom} → {periodTo}
          </div>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={onSetPeriod} />
          {/* Investor Type Select */}
          <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: 2 }}>
            {(['all', 'foreign', 'local'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setInvestorType(t)}
                style={{
                  background: investorType === t ? 'var(--accent)' : 'transparent',
                  color: investorType === t ? '#000' : 'var(--text-dim)',
                  border: 'none',
                  borderRadius: 18,
                  padding: '3px 10px',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {t === 'all' ? 'All Investor' : t === 'foreign' ? 'Foreign Only' : 'Local Only'}
              </button>
            ))}
          </div>

          {/* Unit Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <button
              onClick={() => setUnit('value')}
              style={{
                background: unit === 'value' ? 'var(--cyan)' : 'transparent',
                color: unit === 'value' ? '#000' : 'var(--text-dim)',
                border: 'none',
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Value (Rp)
            </button>
            <button
              onClick={() => setUnit('volume')}
              style={{
                background: unit === 'volume' ? 'var(--cyan)' : 'transparent',
                color: unit === 'volume' ? '#000' : 'var(--text-dim)',
                border: 'none',
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Volume (Lot)
            </button>
          </div>
        </div>
      </div>

      {/* Sankey Flow Chart Container */}
      <div style={{ overflowX: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 6 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 840, height: H, display: 'block' }}>
          {/* Column Header Titles */}
          <text x={colL} y={18} fill="var(--up)" fontSize={12} fontWeight={900} textAnchor="start">
            TOP BUYERS (PEMBELI)
          </text>
          <text x={colR} y={18} fill="var(--down)" fontSize={12} fontWeight={900} textAnchor="end">
            TOP SELLERS (PENJUAL)
          </text>

          {/* Ribbon Flow Paths */}
          {flowPaths.map((fl) => {
            const isRelated = hoverNode === fl.from || hoverNode === fl.to
            const isHovered = hoverFlow?.from === fl.from && hoverFlow?.to === fl.to
            const catColor = getCatColor(fl.category)
            const opacity = hoverNode ? (isRelated ? 0.75 : 0.06) : hoverFlow ? (isHovered ? 0.85 : 0.08) : 0.4

            return (
              <path
                key={fl.key}
                d={fl.pathD}
                fill={catColor}
                opacity={opacity}
                style={{ transition: 'all 0.15s ease', cursor: 'pointer' }}
                onMouseEnter={() => setHoverFlow({ from: fl.from, to: fl.to, val: fl.val })}
                onMouseLeave={() => setHoverFlow(null)}
              >
                <title>{`${fl.from} ➔ ${fl.to}: ${fmtAmount(fl.val)}`}</title>
              </path>
            )
          })}

          {/* Buyer Node Cards (Left Side) */}
          {buyerNodes.map((b, idx) => {
            const isHovered = hoverNode === b.code
            const color = getCatColor(b.category)
            const pct = ((b.val / totalBuy) * 100).toFixed(1)

            return (
              <g
                key={`buyer-${b.code}`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoverNode(b.code)}
                onMouseLeave={() => setHoverNode(null)}
              >
                {/* Node Pill */}
                <rect
                  x={colL}
                  y={b.y}
                  width={pillW}
                  height={b.height}
                  fill={isHovered ? 'rgba(30,41,59,0.98)' : 'rgba(15,23,42,0.94)'}
                  stroke={isHovered ? 'var(--cyan)' : color}
                  strokeWidth={isHovered ? 2 : 1.2}
                  rx={6}
                />

                <rect x={colL - 28} y={b.y + b.height / 2 - 11} width={22} height={22} fill="var(--bg)" stroke={color} strokeWidth={1} rx={4} />
                <text x={colL - 17} y={b.y + b.height / 2 + 4} fill="var(--text-h)" fontSize={9.5} fontWeight={900} textAnchor="middle">
                  #{idx + 1}
                </text>

                <text x={colL + 10} y={b.y + b.height / 2 + 4} fill="#ffffff" fontSize={11} fontWeight={900} textAnchor="start">
                  <tspan fill={color}>{b.code}</tspan>
                </text>

                <text x={colL + pillW - 8} y={b.y + b.height / 2 + 4} fill="var(--text-h)" fontSize={10} fontWeight={800} textAnchor="end">
                  {fmtAmount(b.val)} <tspan fontSize={8.5} fill="var(--text-dim)">({pct}%)</tspan>
                </text>
              </g>
            )
          })}

          {/* Seller Node Cards (Right Side) */}
          {sellerNodes.map((s, idx) => {
            const isHovered = hoverNode === s.code
            const color = getCatColor(s.category)
            const pct = ((s.val / totalSell) * 100).toFixed(1)

            return (
              <g
                key={`seller-${s.code}`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoverNode(s.code)}
                onMouseLeave={() => setHoverNode(null)}
              >
                <rect
                  x={colR - pillW}
                  y={s.y}
                  width={pillW}
                  height={s.height}
                  fill={isHovered ? 'rgba(30,41,59,0.98)' : 'rgba(15,23,42,0.94)'}
                  stroke={isHovered ? 'var(--cyan)' : color}
                  strokeWidth={isHovered ? 2 : 1.2}
                  rx={6}
                />

                <text x={colR - pillW + 8} y={s.y + s.height / 2 + 4} fill="var(--text-h)" fontSize={10} fontWeight={800} textAnchor="start">
                  {fmtAmount(s.val)} <tspan fontSize={8.5} fill="var(--text-dim)">({pct}%)</tspan>
                </text>

                <text x={colR - 10} y={s.y + s.height / 2 + 4} fill="#ffffff" fontSize={11} fontWeight={900} textAnchor="end">
                  <tspan fill={color}>{s.code}</tspan>
                </text>

                <rect x={colR + 10} y={s.y + s.height / 2 - 11} width={22} height={22} fill="var(--bg)" stroke={color} strokeWidth={1} rx={4} />
                <text x={colR + 21} y={s.y + s.height / 2 + 4} fill="var(--text-h)" fontSize={9.5} fontWeight={900} textAnchor="middle">
                  #{idx + 1}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Footer Legend & Expand Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-h)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#8b5cf6' }} />
            Domestic / Lokal
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-h)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#10b981' }} />
            BUMN / Pemerintah
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-h)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#ef4444' }} />
            Foreign / Asing
          </span>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            color: 'var(--cyan)',
            fontSize: 11,
            fontWeight: 800,
            cursor: 'pointer',
            padding: '4px 14px',
          }}
        >
          {expanded ? 'Lihat Top 8 Broker' : 'Lihat Semua Broker (See More)'}
        </button>
      </div>
    </div>
  )
}

export function StockProfilerPanel({ params }: { params?: { symbolOverride?: string } }) {
  const globalSymbol = useTerminalStore((s) => s.selectedSymbol)
  const globalFrom = useTerminalStore((s) => s.periodFrom)
  const globalTo = useTerminalStore((s) => s.periodTo)

  const [periodFrom, setPeriodFrom] = useState(globalFrom)
  const [periodTo, setPeriodTo] = useState(globalTo)

  const setPeriod = (from: string, to: string) => {
    setPeriodFrom(from)
    setPeriodTo(to)
  }

  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(params?.symbolOverride || null)
  const [inputVal, setInputVal] = useState('')

  const symbol = pinnedSymbol || globalSymbol || 'BBCA'
  const isPinned = !!pinnedSymbol

  const [tab, setTab] = useState<Tab>('overview')
  const [selectedBrokers, setSelectedBrokers] = useState<string[]>([])
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)

  // Query Data Stock Profile & Daily Bars
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stock-profile', symbol, periodFrom, periodTo],
    queryFn: () => fetchStockProfile(symbol!, periodFrom, periodTo),
    enabled: !!symbol,
  })

  const { data: barsData = [] } = useQuery({
    queryKey: ['bars', symbol, periodFrom, periodTo],
    queryFn: () => fetchBars(symbol!, periodFrom, periodTo),
    enabled: !!symbol,
  })

  useEffect(() => {
    if (data && selectedBrokers.length === 0) {
      const initialCodes = data.floorTop.slice(0, 4).map((f) => f.code)
      if (initialCodes.length > 0) {
        setSelectedBrokers(initialCodes)
      }
    }
  }, [data])

  const handleRemoveBroker = (code: string) => {
    setSelectedBrokers((prev) => prev.filter((b) => b.toUpperCase() !== code.toUpperCase()))
  }

  const handleAddBroker = (code: string) => {
    if (!selectedBrokers.includes(code)) {
      setSelectedBrokers((prev) => [...prev, code])
    }
  }

  const handleSymbolSubmit = () => {
    if (inputVal.trim()) {
      setPinnedSymbol(inputVal.trim().toUpperCase())
      setInputVal('')
    }
  }

  if (!symbol) {
    return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat profil saham.</div>
  }
  if (isLoading) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Memuat profil saham…</div>
  if (isError || !data) return <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat profil saham.</div>

  const maxCatNet = Math.max(1, ...data.categories.map((c) => Math.abs(c.netVal)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {/* Header Bar */}
      <div
        style={{
          padding: '6px 10px',
          background: 'var(--panel-header)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11, letterSpacing: 0.3 }}>[ STOCK PROFILER - ALIRAN DANA & INVENTORY ]</span>

          {/* Local Symbol Picker */}
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg)', border: `1px solid ${isPinned ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 4, padding: '2px 6px' }}>
            <button
              onClick={() => {
                if (isPinned) setPinnedSymbol(null)
                else setPinnedSymbol(symbol)
              }}
              style={{
                background: isPinned ? 'var(--accent)' : 'transparent',
                color: isPinned ? '#000' : 'var(--cyan)',
                border: 'none',
                borderRadius: 2,
                padding: '1px 6px',
                fontSize: 9.5,
                fontWeight: 900,
                cursor: 'pointer',
                marginRight: 4,
              }}
              title={isPinned ? 'Di-Pin ke emiten ini. Klik untuk Sync Global.' : 'Terhubung ke Global Watchlist. Klik untuk Lock/Pin.'}
            >
              {isPinned ? '📌 PIN' : '🔗 SYNC'}
            </button>

            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSymbolSubmit()
              }}
              onBlur={handleSymbolSubmit}
              placeholder={symbol}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-hover)',
                fontWeight: 900,
                fontSize: 11,
                width: 65,
                outline: 'none',
              }}
            />
          </div>

          <span className={`bbg-badge ${isPinned ? 'bbg-badge-amber' : 'bbg-badge-cyan'}`} style={{ fontSize: 11, fontWeight: 900 }}>
            {symbol} IJ
          </span>

          <div style={{ display: 'flex', gap: 3 }}>
            {['SSIA', 'IHSG', 'BBCA', 'TLKM', 'ASII', 'BREN'].map((s) => (
              <button
                key={s}
                onClick={() => setPinnedSymbol(s)}
                style={{
                  background: symbol === s ? 'var(--accent)' : 'var(--bg)',
                  color: symbol === s ? '#000' : 'var(--text-dim)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  padding: '2px 6px',
                  fontSize: 9.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 10, fontFamily: 'monospace' }}>
            {data.from} → {data.to}
          </span>
        </span>
      </div>

      {/* Tabs Bar */}
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
        {[
          { id: 'overview', label: '📊 Overview' },
          { id: 'inventory', label: '📦 Inventory Analysis' },
          { id: 'brokerFlow', label: '🌊 Broker Flow' },
          { id: 'brokerDist', label: '🔀 Broker Distribution' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            style={{
              background: tab === t.id ? 'var(--accent)' : 'transparent',
              color: tab === t.id ? '#000' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 12px',
              fontSize: 10.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Body Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 10, fontSize: 11 }}>
        {data.dates.length === 0 && (
          <div style={{ color: 'var(--text-dim)', marginBottom: 8, padding: 8, textAlign: 'center' }}>
            Belum ada broker summary harian untuk {symbol} pada periode ini.
          </div>
        )}

        {/* Tab 1: Overview */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Header Control Bar */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', background: 'var(--panel-header)', padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6, gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11, letterSpacing: 0.4 }}>
                  📊 OVERVIEW SUMMARY · ALIRAN DANA MARKET ({data.from} → {data.to})
                </span>
                <span className="bbg-badge bbg-badge-cyan" style={{ fontSize: 9.5 }}>
                  {data.dates.length} Hari Bursa
                </span>
              </div>
              <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={setPeriod} />
            </div>

            {/* Top KPI Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {/* Foreign Flow Metric Card */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: '3px solid #ef4444', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 10.5, letterSpacing: 0.4 }}>FOREIGN FLOW · NET ASING</span>
                  <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>Per Rentang</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 4 }}>
                  {data.foreignFlow.map((f) => {
                    const isUp = f.netVal >= 0
                    const color = !f.ok ? 'var(--text-dim)' : isUp ? 'var(--up)' : 'var(--down)'
                    return (
                      <div key={f.label} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 4px', textAlign: 'center' }}>
                        <div style={{ color: 'var(--text-dim)', fontSize: 9, fontWeight: 700 }}>{f.label}</div>
                        <div style={{ color, fontWeight: 900, fontSize: 11, marginTop: 2 }}>
                          {f.ok ? `${isUp ? '+' : ''}${fmtRp(f.netVal)}` : '—'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Relative Strength vs IHSG Card */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: '3px solid #3b82f6', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 10.5, letterSpacing: 0.4 }}>KEKUATAN RELATIF VS IHSG</span>
                  <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>Performa Rentang</span>
                </div>
                {data.vsIndex.available ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                      <span style={{ color: data.vsIndex.relPct >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 900, fontSize: 22 }}>
                        {fmtPct(data.vsIndex.relPct)}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: data.vsIndex.relPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                        {data.vsIndex.relPct >= 0 ? '▲ Outperform' : '▼ Underperform'}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 9.5, marginTop: 2 }}>
                      Saham: <b style={{ color: 'var(--text-h)' }}>{fmtPct(data.vsIndex.stockPct)}</b> vs IHSG: <b style={{ color: 'var(--text-h)' }}>{fmtPct(data.vsIndex.indexPct)}</b>
                    </div>
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>Bar harian IHSG belum tersedia untuk menghitung kekuatan relatif.</div>
                )}
              </div>

              {/* Price & Market Stats Card */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 10.5, letterSpacing: 0.4 }}>STATISTIK PASAR</span>
                  <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>Terakhir</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>Harga Penutupan</div>
                    <div style={{ color: 'var(--accent-hover)', fontWeight: 900, fontSize: 20 }}>{fmtPrice(data.lastClose)}</div>
                  </div>
                  <div style={{ textAlign: 'end' }}>
                    <div style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>Total Transaksi Broker</div>
                    <div style={{ color: 'var(--text-h)', fontWeight: 900, fontSize: 14 }}>{fmtRp(data.totalValue)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Category Market Flow Section */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11, letterSpacing: 0.4 }}>
                  MARKET FLOW PER KATEGORI BROKER
                </span>
                <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>Beli vs Jual harian</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {data.categories.map((c) => {
                  const isNetUp = c.netVal >= 0
                  const color = CAT_COLOR[c.key] ?? 'var(--text-h)'
                  return (
                    <div key={c.key} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ color, fontWeight: 900, fontSize: 11 }}>{c.label}</span>
                        <span style={{ color: isNetUp ? 'var(--up)' : 'var(--down)', fontWeight: 900, fontSize: 11 }}>
                          {isNetUp ? '+' : ''}{fmtRp(c.netVal)}
                        </span>
                      </div>
                      <DayBars days={c.days} color={color} />
                      <div style={{ height: 4, background: 'var(--panel)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${(Math.abs(c.netVal) / maxCatNet) * 100}%`,
                            height: '100%',
                            background: isNetUp ? 'var(--up)' : 'var(--down)',
                          }}
                        />
                      </div>
                      <div style={{ color: 'var(--text-dim)', fontSize: 9.5, marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Gross Volume</span>
                        <span style={{ color: 'var(--text-h)', fontWeight: 800 }}>{fmtRp(c.grossVal)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Bottom Section: Floor Top Accumulators & Conviction Side-by-Side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {/* Floor Top Accumulators Card */}
              <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11, letterSpacing: 0.4 }}>
                    FLOOR TOP AKUMULATOR (HARGA MODAL BROKER)
                  </span>
                  <span style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>Harga Saat Ini: <b>{fmtPrice(data.lastClose)}</b></span>
                </div>
                {data.floorTop.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: 10.5, padding: 8 }}>Belum ada broker net beli pada periode ini.</div>
                ) : (
                  data.floorTop.map((f, idx) => {
                    const bColor = brokerColor(f.code)
                    const maxVal = Math.max(1, data.floorTop[0].netVal)
                    const pctBar = Math.min(100, (f.netVal / maxVal) * 100)

                    return (
                      <div key={f.code} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 9.5, fontWeight: 900, color: 'var(--text-dim)' }}>#{idx + 1}</span>
                            <span style={{ width: 8, height: 8, borderRadius: 4, background: bColor }} />
                            <b style={{ color: 'var(--text-h)', fontWeight: 900, fontSize: 11 }} title={f.name}>{f.code}</b>
                            <span style={{ background: 'var(--panel)', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', fontSize: 9 }}>
                              {f.accumDays}/{f.totalDays} Hari Akum
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                              Modal Floor: <b style={{ color: '#fff', fontWeight: 900 }}>{f.hasFloor ? fmtPrice(f.floorPrice) : '—'}</b>
                            </span>
                            <span style={{ color: f.vsFloorPct >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 900, fontSize: 10.5 }}>
                              {f.hasFloor ? fmtPct(f.vsFloorPct) : ''}
                            </span>
                          </div>
                        </div>

                        <div style={{ height: 4, background: 'var(--panel)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                          <div style={{ width: `${pctBar}%`, height: '100%', background: 'var(--up)' }} />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Net vs Gross Conviction Card */}
              <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--cyan)', fontWeight: 900, fontSize: 11, letterSpacing: 0.4 }}>
                    NET VS GROSS FLOW (KONVIKSI ARAH)
                  </span>
                  <span style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>%Net = Rasa Percaya Diri</span>
                </div>
                {data.netVsGross.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: 10.5, padding: 8 }}>Belum ada data transaksi broker.</div>
                ) : (
                  data.netVsGross.map((n, idx) => {
                    const bColor = brokerColor(n.code)
                    const isBuy = n.side === 'buy'

                    return (
                      <div key={n.code} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 9.5, fontWeight: 900, color: 'var(--text-dim)' }}>#{idx + 1}</span>
                            <span style={{ width: 8, height: 8, borderRadius: 4, background: bColor }} />
                            <b style={{ color: 'var(--text-h)', fontWeight: 900, fontSize: 11 }} title={n.name}>{n.code}</b>
                            <span
                              style={{
                                background: isBuy ? 'var(--up-bg)' : 'var(--down-bg)',
                                color: isBuy ? 'var(--up)' : 'var(--down)',
                                border: `1px solid ${isBuy ? 'var(--up)' : 'var(--down)'}`,
                                borderRadius: 4,
                                padding: '1px 6px',
                                fontSize: 9,
                                fontWeight: 900,
                                textTransform: 'uppercase',
                              }}
                            >
                              {n.side}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>
                              Net {fmtRp(n.netVal)} / Gross {fmtRp(n.grossVal)}
                            </span>
                            <span style={{ color: isBuy ? 'var(--up)' : 'var(--down)', fontWeight: 900, fontSize: 11 }}>
                              {n.netPct.toFixed(0)}%
                            </span>
                          </div>
                        </div>

                        <div style={{ height: 4, background: 'var(--panel)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, n.netPct)}%`, height: '100%', background: isBuy ? 'var(--up)' : 'var(--down)' }} />
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Inventory Analysis */}
        {tab === 'inventory' && (
          <InventoryTab
            profile={data}
            bars={barsData}
            selectedBrokers={selectedBrokers}
            onRemoveBroker={handleRemoveBroker}
            onAddBrokerClick={() => setIsAddModalOpen(true)}
            onAddBrokerCode={handleAddBroker}
            periodFrom={periodFrom}
            periodTo={periodTo}
            onSetPeriod={setPeriod}
          />
        )}

        {/* Tab 3: Broker Flow */}
        {tab === 'brokerFlow' && (
          <BrokerFlowTab
            profile={data}
            selectedBrokers={selectedBrokers}
            onRemoveBroker={handleRemoveBroker}
            onAddBrokerClick={() => setIsAddModalOpen(true)}
            periodFrom={periodFrom}
            periodTo={periodTo}
            onSetPeriod={setPeriod}
          />
        )}

        {/* Tab 4: Broker Distribution */}
        {tab === 'brokerDist' && (
          <BrokerDistTab
            profile={data}
            periodFrom={periodFrom}
            periodTo={periodTo}
            onSetPeriod={setPeriod}
          />
        )}
      </div>

      {/* Add Broker Modal */}
      <AddBrokerModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        activeBrokers={selectedBrokers}
        onAdd={handleAddBroker}
      />
    </div>
  )
}
