import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTrades, type TopBroker } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'

const fmtLot = (v: number) => v.toLocaleString('id-ID')
const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' })

const dirColor = (d: string) => (d === 'buy' ? 'var(--up)' : d === 'sell' ? 'var(--down)' : 'var(--text-dim)')

function fmtValShort(val: number): string {
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)} B`
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)} M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)} K`
  return val.toLocaleString('id-ID')
}

function fmtBrokerTag(code?: string): string {
  if (!code || code === '—') return '—'
  return `${code.toUpperCase()} [D]`
}

interface FilterState {
  actionType: 'all' | 'buy' | 'sell'
  marketType: 'all' | 'regular' | 'nego' | 'cash'
  priceFrom: string
  priceTo: string
  valFrom: string
  valTo: string
  minLot: string
  timeFrom: string
  timeTo: string
  buyerBroker: string
  sellerBroker: string
}

const initialFilter: FilterState = {
  actionType: 'all',
  marketType: 'all',
  priceFrom: '',
  priceTo: '',
  valFrom: '',
  valTo: '',
  minLot: '',
  timeFrom: '',
  timeTo: '',
  buyerBroker: '',
  sellerBroker: '',
}

interface MergedPrint {
  id: string
  ts: number
  symbol: string
  price: number
  lot: number
  freq: number
  direction: string
  buyerBrokers: string[]
  sellerBrokers: string[]
  market: string
  val: number
  count: number
  isWhale: boolean
}

function TopBrokerList({ items, color }: { items: TopBroker[]; color: string }) {
  if (!items.length) return <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>—</div>
  return (
    <div>
      {items.map((b) => (
        <div key={b.code} style={{ display: 'flex', gap: 6, fontSize: 10, marginBottom: 1 }}>
          <span style={{ color, fontWeight: 700, minWidth: 26 }}>{b.code}</span>
          <span style={{ flex: 1, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {b.name}
          </span>
          <span style={{ color: 'var(--text-h)' }}>{fmtRp(b.val)}</span>
        </div>
      ))}
    </div>
  )
}

/** Lightweight Virtual Scroll Component for 60fps performance with 50,000+ items */
function VirtualTradeList({
  rows,
  symbol,
  onHoverRow,
  rowHeight = 24,
}: {
  rows: MergedPrint[]
  symbol: string
  onHoverRow: (r: MergedPrint | null) => void
  rowHeight?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(400)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setContainerHeight(entry.contentRect.height)
        }
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }

  const totalHeight = rows.length * rowHeight
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 5)
  const endIndex = Math.min(rows.length, Math.ceil((scrollTop + containerHeight) / rowHeight) + 5)
  const visibleRows = useMemo(() => {
    return rows.slice(startIndex, endIndex).map((row, idx) => ({
      row,
      index: startIndex + idx,
    }))
  }, [rows, startIndex, endIndex])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ flex: 1, overflowY: 'auto', position: 'relative' }}
    >
      <div style={{ height: totalHeight, width: '100%', position: 'relative' }}>
        {visibleRows.map(({ row, index }) => {
          const isBuy = row.direction === 'buy'
          const isSell = row.direction === 'sell'
          const hasMultipleBuyers = row.buyerBrokers.length > 1
          const hasMultipleSellers = row.sellerBrokers.length > 1

          return (
            <div
              key={row.id}
              onMouseEnter={() => onHoverRow(row)}
              style={{
                position: 'absolute',
                top: index * rowHeight,
                left: 0,
                right: 0,
                height: rowHeight,
                display: 'grid',
                gridTemplateColumns: '55px 44px 75px 42px 65px 55px 55px 65px 32px',
                gap: 4,
                padding: '0 6px',
                fontSize: 10,
                alignItems: 'center',
                background: row.isWhale ? 'rgba(245,166,35,0.12)' : undefined,
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                boxSizing: 'border-box',
                cursor: 'pointer',
              }}
            >
              {/* Time */}
              <span style={{ color: 'var(--text-dim)', fontFamily: 'monospace' }}>{fmtTime(row.ts)}</span>

              {/* Symbol Code */}
              <span style={{ color: '#00d69a', fontWeight: 700 }}>{symbol}</span>

              {/* Price */}
              <span style={{ textAlign: 'right', color: dirColor(row.direction), fontWeight: 700 }}>
                {row.price.toLocaleString('id-ID')}
              </span>

              {/* Action */}
              <span style={{ textAlign: 'center', color: dirColor(row.direction), fontWeight: 700 }}>
                {isBuy ? 'Buy' : isSell ? 'Sell' : '—'}
              </span>

              {/* Action Lot */}
              <span style={{ textAlign: 'right', color: 'var(--text-h)', fontWeight: row.isWhale ? 700 : 500 }}>
                {row.isWhale && <span title="Whale Print / Order Besar" style={{ marginRight: 2 }}>🐋</span>}
                {fmtLot(row.lot)}
              </span>

              {/* Buyer Column */}
              <span style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hasMultipleBuyers ? (
                  <span
                    title={`Multiple Buyers: ${row.buyerBrokers.join(', ')}`}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      padding: '1px 5px',
                      borderRadius: 4,
                      fontSize: 10,
                      cursor: 'help',
                    }}
                  >
                    🥞
                  </span>
                ) : (
                  <span style={{ color: '#8b5cf6', fontWeight: 600 }}>{fmtBrokerTag(row.buyerBrokers[0])}</span>
                )}
              </span>

              {/* Seller Column */}
              <span style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hasMultipleSellers ? (
                  <span
                    title={`Multiple Sellers: ${row.sellerBrokers.join(', ')}`}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      padding: '1px 5px',
                      borderRadius: 4,
                      fontSize: 10,
                      cursor: 'help',
                    }}
                  >
                    🥞
                  </span>
                ) : (
                  <span style={{ color: '#8b5cf6', fontWeight: 600 }}>{fmtBrokerTag(row.sellerBrokers[0])}</span>
                )}
              </span>

              {/* Value (Val) */}
              <span style={{ textAlign: 'right', color: isBuy ? 'var(--up)' : isSell ? 'var(--down)' : 'var(--text-h)', fontWeight: 600 }}>
                {fmtValShort(row.val)}
              </span>

              {/* Market */}
              <span style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 9 }}>{row.market}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function RunningTradePanel() {
  const symbol = useTerminalStore((s) => s.selectedSymbol)
  const [limit, setLimit] = useState<number>(0)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [isMergeOrder, setIsMergeOrder] = useState<boolean>(true)
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false)
  const [filter, setFilter] = useState<FilterState>(initialFilter)
  const [hoveredRow, setHoveredRow] = useState<MergedPrint | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['trades', symbol, limit, selectedDate],
    queryFn: () => fetchTrades(symbol!, selectedDate || undefined, limit),
    enabled: !!symbol,
    refetchInterval: selectedDate ? false : 15_000,
  })

  const availableDates: string[] = (data as any)?.availableDates || []

  // Active filter counter
  const activeFilterCount = useMemo(() => {
    let cnt = 0
    if (filter.actionType !== 'all') cnt++
    if (filter.marketType !== 'all') cnt++
    if (filter.priceFrom || filter.priceTo) cnt++
    if (filter.valFrom || filter.valTo) cnt++
    if (filter.minLot) cnt++
    if (filter.timeFrom || filter.timeTo) cnt++
    if (filter.buyerBroker) cnt++
    if (filter.sellerBroker) cnt++
    return cnt
  }, [filter])

  // Filter raw prints
  const filteredPrints = useMemo(() => {
    if (!data?.prints) return []
    return data.prints.filter((t) => {
      if (filter.actionType === 'buy' && t.direction !== 'buy') return false
      if (filter.actionType === 'sell' && t.direction !== 'sell') return false

      const mkt = (t.market || 'RG').toLowerCase()
      if (filter.marketType === 'regular' && mkt !== 'rg') return false
      if (filter.marketType === 'nego' && mkt !== 'ng') return false
      if (filter.marketType === 'cash' && mkt !== 'tn') return false

      if (filter.priceFrom && t.price < Number(filter.priceFrom)) return false
      if (filter.priceTo && t.price > Number(filter.priceTo)) return false

      const val = t.price * t.lot * 100
      if (filter.valFrom && val < Number(filter.valFrom)) return false
      if (filter.valTo && val > Number(filter.valTo)) return false

      if (filter.minLot && t.lot < Number(filter.minLot)) return false

      if (filter.timeFrom || filter.timeTo) {
        const timeStr = fmtTime(t.ts)
        if (filter.timeFrom && timeStr < filter.timeFrom) return false
        if (filter.timeTo && timeStr > filter.timeTo) return false
      }

      if (filter.buyerBroker && (!t.buyerBroker || !t.buyerBroker.toLowerCase().includes(filter.buyerBroker.toLowerCase()))) {
        return false
      }
      if (filter.sellerBroker && (!t.sellerBroker || !t.sellerBroker.toLowerCase().includes(filter.sellerBroker.toLowerCase()))) {
        return false
      }

      return true
    })
  }, [data?.prints, filter])

  // Exact Stockbit-style Merge Order ID & Whale identification engine
  const displayRows = useMemo<MergedPrint[]>(() => {
    const raw = filteredPrints
    const bigMin = data?.pressure?.bigLotMin ?? 500

    if (!isMergeOrder) {
      return raw.map((t, idx) => {
        const val = t.price * t.lot * 100
        const isWhale = t.lot >= bigMin || val >= 50_000_000
        return {
          id: `${t.ts}-${idx}`,
          ts: t.ts,
          symbol: symbol || '',
          price: t.price,
          lot: t.lot,
          freq: t.freq || 1,
          direction: t.direction,
          buyerBrokers: t.buyerBroker ? [t.buyerBroker] : [],
          sellerBrokers: t.sellerBroker ? [t.sellerBroker] : [],
          market: t.market || 'RG',
          val,
          count: 1,
          isWhale,
        }
      })
    }

    const groups = new Map<string, MergedPrint>()

    for (let i = 0; i < raw.length; i++) {
      const t = raw[i]
      let buyOrd = ''
      let sellOrd = ''
      if (t.extTradeId && t.extTradeId.includes('-')) {
        const parts = t.extTradeId.split('-')
        buyOrd = parts[0]
        sellOrd = parts[1]
      }

      let key = ''
      if (t.direction === 'buy') {
        key = buyOrd ? `buy_${buyOrd}` : `buy_${Math.floor(t.ts / 2000)}_${t.price}_${t.buyerBroker || ''}`
      } else if (t.direction === 'sell') {
        key = sellOrd ? `sell_${sellOrd}` : `sell_${Math.floor(t.ts / 2000)}_${t.price}_${t.sellerBroker || ''}`
      } else {
        key = `unk_${t.ts}_${t.price}`
      }

      const val = t.price * t.lot * 100
      const existing = groups.get(key)

      if (existing) {
        existing.lot += t.lot
        existing.val += val
        existing.freq += t.freq || 1
        existing.count += 1
        if (t.buyerBroker && !existing.buyerBrokers.includes(t.buyerBroker)) {
          existing.buyerBrokers.push(t.buyerBroker)
        }
        if (t.sellerBroker && !existing.sellerBrokers.includes(t.sellerBroker)) {
          existing.sellerBrokers.push(t.sellerBroker)
        }
        if (t.lot >= bigMin || val >= 50_000_000) existing.isWhale = true
      } else {
        const isWhale = t.lot >= bigMin || val >= 50_000_000
        groups.set(key, {
          id: key,
          ts: t.ts,
          symbol: symbol || '',
          price: t.price,
          lot: t.lot,
          freq: t.freq || 1,
          direction: t.direction,
          buyerBrokers: t.buyerBroker ? [t.buyerBroker] : [],
          sellerBrokers: t.sellerBroker ? [t.sellerBroker] : [],
          market: t.market || 'RG',
          val,
          count: 1,
          isWhale,
        })
      }
    }

    return Array.from(groups.values())
  }, [filteredPrints, isMergeOrder, data?.pressure?.bigLotMin, symbol])

  if (!symbol) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat running trade.</div>
  if (isLoading) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Memuat running trade…</div>
  if (isError || !data) return <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat running trade.</div>

  if (!data.date || !data.prints.length) {
    return (
      <div style={{ color: 'var(--text-dim)', padding: 16, fontSize: 12, lineHeight: 1.6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ color: 'var(--text-h)', fontWeight: 700 }}>{symbol}</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{
              background: 'var(--bg-sub, #1e222d)',
              color: 'var(--text-h)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 11,
              padding: '2px 6px',
            }}
          />
        </div>
        Data transaksi untuk {symbol} {selectedDate ? `pada tanggal ${selectedDate}` : 'pada periode yang dipilih'} belum tersedia.
        <br />Pembaruan akan ditampilkan otomatis setelah data tersedia.
      </div>
    )
  }

  const p = data.pressure
  const totalDirected = p ? p.buyLot + p.sellLot : 0
  const buyPct = p && totalDirected > 0 ? (p.buyLot / totalDirected) * 100 : 50

  return (
    <div style={{ padding: 8, height: '100%', display: 'flex', flexDirection: 'column', fontSize: 11, position: 'relative' }}>
      {/* Top Header Bar with Merge Toggle & Filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        {/* Merge Order ID Toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--text-h)' }}>
          <span>Merge Order ID</span>
          <div
            onClick={() => setIsMergeOrder((v) => !v)}
            style={{
              width: 32,
              height: 18,
              borderRadius: 9,
              background: isMergeOrder ? '#00d69a' : 'var(--border)',
              position: 'relative',
              transition: 'background 0.2s',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: 2,
                left: isMergeOrder ? 16 : 2,
                transition: 'left 0.2s',
              }}
            />
          </div>
        </label>

        <span style={{ flex: 1 }} />

        {/* Date Selector */}
        {availableDates.length > 0 ? (
          <select
            value={selectedDate || data.date}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{
              background: 'var(--bg-sub, #1e222d)',
              color: 'var(--text-h)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 10,
              padding: '2px 4px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            title="Pilih tanggal riwayat running trade"
          >
            {availableDates.map((d) => (
              <option key={d} value={d}>
                {d} {d === availableDates[0] ? '(Terbaru)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="date"
            value={selectedDate || data.date}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{
              background: 'var(--bg-sub, #1e222d)',
              color: 'var(--text-h)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 10,
              padding: '1px 4px',
            }}
          />
        )}

        {/* Filter Button */}
        <button
          onClick={() => setShowFilterModal((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: activeFilterCount > 0 ? 'rgba(0,214,154,0.15)' : 'var(--bg-sub, #1e222d)',
            color: activeFilterCount > 0 ? 'var(--up)' : 'var(--text-h)',
            border: activeFilterCount > 0 ? '1px solid var(--up)' : '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 10,
            padding: '2px 8px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          ⚙ Filter {activeFilterCount > 0 && `(${activeFilterCount})`}
        </button>

        {/* Limit Selector */}
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          style={{
            background: 'var(--bg-sub, #1e222d)',
            color: 'var(--text-h)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 10,
            padding: '2px 4px',
            cursor: 'pointer',
          }}
          title="Batas jumlah cetakan running trade yang ditampilkan"
        >
          <option value={0}>Semua cetakan</option>
          <option value={200}>200 cetakan</option>
          <option value={500}>500 cetakan</option>
          <option value={1000}>1.000 cetakan</option>
          <option value={2000}>2.000 cetakan</option>
          <option value={5000}>5.000 cetakan</option>
          <option value={10000}>10.000 cetakan</option>
          <option value={50000}>50.000 cetakan</option>
        </select>
      </div>

      {/* Pressure Summary Bar */}
      {p && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
            <span style={{ color: 'var(--up)' }}>
              BELI {fmtLot(p.buyLot)} lot ({fmtRp(p.buyVal)})
            </span>
            <span style={{ color: 'var(--down)' }}>
              JUAL {fmtLot(p.sellLot)} lot ({fmtRp(p.sellVal)})
            </span>
          </div>
          <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--border)' }}>
            <div style={{ width: `${buyPct}%`, background: 'var(--up)' }} />
            <div style={{ width: `${100 - buyPct}%`, background: 'var(--down)' }} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, color: 'var(--text-dim)', fontSize: 10 }}>
            <span>
              VWAP <b style={{ color: 'var(--text-h)' }}>{Math.round(p.vwap).toLocaleString('id-ID')}</b>
            </span>
            <span>
              Big print <b style={{ color: 'var(--text-h)' }}>{p.bigPrints}</b> (≥{fmtLot(p.bigLotMin)} lot)
            </span>
            {p.unknownLot > 0 && <span>Arah tak jelas {fmtLot(p.unknownLot)} lot</span>}
            <span style={{ flex: 1 }} />
            <span>Tampil: <b>{displayRows.length.toLocaleString('id-ID')}</b> baris</span>
          </div>
        </div>
      )}

      {/* Top Buyers & Sellers */}
      {((data.topBuyers && data.topBuyers.length > 0) || (data.topSellers && data.topSellers.length > 0)) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
          <div>
            <div style={{ color: 'var(--up)', fontSize: 10, marginBottom: 2 }}>TOP BUYER (agresor beli)</div>
            <TopBrokerList items={data.topBuyers ?? []} color="var(--up)" />
          </div>
          <div>
            <div style={{ color: 'var(--down)', fontSize: 10, marginBottom: 2 }}>TOP SELLER (agresor jual)</div>
            <TopBrokerList items={data.topSellers ?? []} color="var(--down)" />
          </div>
        </div>
      )}

      {/* Table Header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '55px 44px 75px 42px 65px 55px 55px 65px 32px',
          gap: 4,
          padding: '4px 6px',
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--text-dim)',
          borderBottom: '1px solid var(--border)',
          alignItems: 'center',
        }}
      >
        <span>Time ▲</span>
        <span>Code</span>
        <span style={{ textAlign: 'right' }}>Price</span>
        <span style={{ textAlign: 'center' }}>Action</span>
        <span style={{ textAlign: 'right' }}>Lot ▲</span>
        <span style={{ textAlign: 'left' }}>Buyer</span>
        <span style={{ textAlign: 'left' }}>Seller</span>
        <span style={{ textAlign: 'right' }}>Val ▲</span>
        <span style={{ textAlign: 'center' }}>Mkt</span>
      </div>

      {/* Virtualized Table Body (60fps Ultra Smooth) */}
      <VirtualTradeList
        rows={displayRows}
        symbol={symbol}
        onHoverRow={setHoveredRow}
        rowHeight={24}
      />

      {/* Filter Modal / Drawer */}
      {showFilterModal && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.88)',
            zIndex: 100,
            padding: 12,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-h)' }}>Filter Running Trade</span>
            <button
              onClick={() => setShowFilterModal(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}
            >
              ✕
            </button>
          </div>

          {/* Action Type */}
          <div>
            <div style={{ color: 'var(--text-h)', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Action Type</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'buy', 'sell'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setFilter((f) => ({ ...f, actionType: a }))}
                  style={{
                    padding: '3px 12px',
                    borderRadius: 12,
                    fontSize: 10,
                    border: filter.actionType === a ? '1px solid #00d69a' : '1px solid var(--border)',
                    background: filter.actionType === a ? 'rgba(0,214,154,0.15)' : 'var(--bg-sub, #1e222d)',
                    color: filter.actionType === a ? '#00d69a' : 'var(--text-h)',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Market Type */}
          <div>
            <div style={{ color: 'var(--text-h)', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Market Type</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['all', 'regular', 'nego', 'cash'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setFilter((f) => ({ ...f, marketType: m }))}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 12,
                    fontSize: 10,
                    border: filter.marketType === m ? '1px solid #00d69a' : '1px solid var(--border)',
                    background: filter.marketType === m ? 'rgba(0,214,154,0.15)' : 'var(--bg-sub, #1e222d)',
                    color: filter.marketType === m ? '#00d69a' : 'var(--text-h)',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {m === 'all' ? 'All' : m === 'regular' ? 'Regular' : m === 'nego' ? 'Nego' : 'Cash'}
                </button>
              ))}
            </div>
          </div>

          {/* Price Range */}
          <div>
            <div style={{ color: 'var(--text-h)', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Price Range (Rp)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                placeholder="From"
                value={filter.priceFrom}
                onChange={(e) => setFilter((f) => ({ ...f, priceFrom: e.target.value }))}
                style={{ flex: 1, padding: 4, background: 'var(--bg-sub, #1e222d)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-h)', fontSize: 10 }}
              />
              <input
                type="number"
                placeholder="To"
                value={filter.priceTo}
                onChange={(e) => setFilter((f) => ({ ...f, priceTo: e.target.value }))}
                style={{ flex: 1, padding: 4, background: 'var(--bg-sub, #1e222d)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-h)', fontSize: 10 }}
              />
            </div>
          </div>

          {/* Val Range */}
          <div>
            <div style={{ color: 'var(--text-h)', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Val Range (Rp)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                placeholder="From (Rp)"
                value={filter.valFrom}
                onChange={(e) => setFilter((f) => ({ ...f, valFrom: e.target.value }))}
                style={{ flex: 1, padding: 4, background: 'var(--bg-sub, #1e222d)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-h)', fontSize: 10 }}
              />
              <input
                type="number"
                placeholder="To (Rp)"
                value={filter.valTo}
                onChange={(e) => setFilter((f) => ({ ...f, valTo: e.target.value }))}
                style={{ flex: 1, padding: 4, background: 'var(--bg-sub, #1e222d)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-h)', fontSize: 10 }}
              />
            </div>
          </div>

          {/* Minimum Lot */}
          <div>
            <div style={{ color: 'var(--text-h)', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Minimum Lot</div>
            <input
              type="number"
              placeholder="e.g 1000"
              value={filter.minLot}
              onChange={(e) => setFilter((f) => ({ ...f, minLot: e.target.value }))}
              style={{ width: '100%', padding: 4, background: 'var(--bg-sub, #1e222d)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-h)', fontSize: 10, marginBottom: 4 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              {['100', '200', '500', '1000'].map((chip) => (
                <button
                  key={chip}
                  onClick={() => setFilter((f) => ({ ...f, minLot: chip }))}
                  style={{
                    flex: 1,
                    padding: '2px 0',
                    borderRadius: 10,
                    fontSize: 9,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-sub, #1e222d)',
                    color: 'var(--text-h)',
                    cursor: 'pointer',
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Time Range */}
          <div>
            <div style={{ color: 'var(--text-h)', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Time Range</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="from (16:00:00)"
                value={filter.timeFrom}
                onChange={(e) => setFilter((f) => ({ ...f, timeFrom: e.target.value }))}
                style={{ flex: 1, padding: 4, background: 'var(--bg-sub, #1e222d)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-h)', fontSize: 10 }}
              />
              <input
                type="text"
                placeholder="to (16:15:00)"
                value={filter.timeTo}
                onChange={(e) => setFilter((f) => ({ ...f, timeTo: e.target.value }))}
                style={{ flex: 1, padding: 4, background: 'var(--bg-sub, #1e222d)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-h)', fontSize: 10 }}
              />
            </div>
          </div>

          {/* Broker Filter */}
          <div>
            <div style={{ color: 'var(--text-h)', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>Broker Filter</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                placeholder="Buyer (e.g LG)"
                value={filter.buyerBroker}
                onChange={(e) => setFilter((f) => ({ ...f, buyerBroker: e.target.value }))}
                style={{ flex: 1, padding: 4, background: 'var(--bg-sub, #1e222d)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-h)', fontSize: 10 }}
              />
              <input
                type="text"
                placeholder="Seller (e.g XL)"
                value={filter.sellerBroker}
                onChange={(e) => setFilter((f) => ({ ...f, sellerBroker: e.target.value }))}
                style={{ flex: 1, padding: 4, background: 'var(--bg-sub, #1e222d)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-h)', fontSize: 10 }}
              />
            </div>
          </div>

          {/* Filter Footer Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => setFilter(initialFilter)}
              style={{
                flex: 1,
                padding: '6px 0',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--bg-sub, #1e222d)',
                color: 'var(--text-h)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Reset Filter
            </button>
            <button
              onClick={() => setShowFilterModal(false)}
              style={{
                flex: 1,
                padding: '6px 0',
                borderRadius: 4,
                border: 'none',
                background: '#00d69a',
                color: '#000',
                fontWeight: 700,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Terapkan Filter
            </button>
          </div>
        </div>
      )}

      {/* Stockbit-style Bottom Hover Summary Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: 'var(--text-h)',
          fontSize: 10,
          fontWeight: 600,
          marginTop: 4,
          borderTop: '1px solid var(--border)',
          paddingTop: 4,
          background: 'var(--bg-sub, #1e222d)',
          padding: '4px 8px',
          borderRadius: 4,
        }}
      >
        {hoveredRow ? (
          <>
            <span><b>{hoveredRow.count > 1 ? hoveredRow.count : hoveredRow.freq}</b> Freq</span>
            <span style={{ color: 'var(--border)' }}>|</span>
            <span><b>{fmtLot(hoveredRow.lot)}</b> Lot</span>
            <span style={{ color: 'var(--border)' }}>|</span>
            <span>Value <b style={{ color: hoveredRow.direction === 'buy' ? 'var(--up)' : 'var(--down)' }}>{fmtValShort(hoveredRow.val)}</b></span>
            <span style={{ flex: 1 }} />
            {hoveredRow.count > 1 && (
              <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>
                Merged: {hoveredRow.direction === 'buy' ? `Sellers (${hoveredRow.sellerBrokers.join(', ')})` : `Buyers (${hoveredRow.buyerBrokers.join(', ')})`}
              </span>
            )}
          </>
        ) : (
          <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>
            Arahkan kursor ke baris transaksi untuk melihat ringkasan Freq, Lot, & Val &nbsp;•&nbsp; 🥞 = Multiple Brokers (Merged) &nbsp;•&nbsp; 🐋 = Paus
          </span>
        )}
      </div>
    </div>
  )
}
