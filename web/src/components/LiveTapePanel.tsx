import { useEffect, useRef, useState } from 'react'
import { tapeWebSocketUrl, type TapeMessage } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'
import { SymbolHeaderPicker } from './SymbolHeaderPicker'

type Status = 'connecting' | 'open' | 'closed' | 'error'

const statusColor: Record<Status, string> = {
  connecting: 'var(--text-dim)',
  open: 'var(--up)',
  closed: 'var(--text-dim)',
  error: 'var(--down)',
}

const statusLabel: Record<Status, string> = {
  connecting: 'menyambungkan…',
  open: 'live',
  closed: 'terputus',
  error: 'gagal',
}

const fmtLot = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 0 })

function DepthRow({
  level,
  side,
  maxLot,
  isFake,
}: {
  level: { price: number; lot: number; orders: number }
  side: 'bid' | 'offer'
  maxLot: number
  isFake: boolean
}) {
  const pct = maxLot > 0 ? (level.lot / maxLot) * 100 : 0
  const barColor = isFake ? 'rgba(245,166,35,0.35)' : side === 'bid' ? 'rgba(46,204,113,0.25)' : 'rgba(239,68,68,0.25)'
  const priceColor = side === 'bid' ? 'var(--up)' : 'var(--down)'
  return (
    <div style={{ position: 'relative', display: 'flex', fontSize: 11, padding: '2px 6px' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: `${pct}%`,
          background: barColor,
          left: side === 'bid' ? undefined : 0,
          right: side === 'bid' ? 0 : undefined,
          borderRadius: 2,
        }}
      />
      {side === 'bid' ? (
        <>
          <span style={{ position: 'relative', flex: 1, color: 'var(--text-dim)' }}>{level.orders}</span>
          <span style={{ position: 'relative', flex: 1, textAlign: 'right' }}>{fmtLot(level.lot)}</span>
          <span style={{ position: 'relative', width: 56, textAlign: 'right', color: priceColor, fontWeight: 700 }}>
            {level.price} {isFake && '⚠'}
          </span>
        </>
      ) : (
        <>
          <span style={{ position: 'relative', width: 56, color: priceColor, fontWeight: 700 }}>
            {isFake && '⚠'} {level.price}
          </span>
          <span style={{ position: 'relative', flex: 1, textAlign: 'right' }}>{fmtLot(level.lot)}</span>
          <span style={{ position: 'relative', flex: 1, textAlign: 'right', color: 'var(--text-dim)' }}>{level.orders}</span>
        </>
      )}
    </div>
  )
}

export function LiveTapePanel({ params }: { params?: { symbolOverride?: string } }) {
  const globalSymbol = useTerminalStore((s) => s.selectedSymbol)
  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(params?.symbolOverride || null)
  const symbol = pinnedSymbol || globalSymbol
  const isPinned = !!pinnedSymbol
  const [status, setStatus] = useState<Status>('connecting')
  const [latest, setLatest] = useState<TapeMessage | null>(null)
  const cumRef = useRef({ buyLot: 0, sellLot: 0, buyVal: 0, sellVal: 0 })
  const [cum, setCum] = useState({ buyLot: 0, sellLot: 0, buyVal: 0, sellVal: 0 })

  useEffect(() => {
    if (!symbol) return
    setLatest(null)
    setStatus('connecting')
    cumRef.current = { buyLot: 0, sellLot: 0, buyVal: 0, sellVal: 0 }
    setCum(cumRef.current)

    let rafId: number | null = null
    let latestMsg: TapeMessage | null = null
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let isMounted = true

    function connect() {
      if (!isMounted) return
      try {
        ws = new WebSocket(tapeWebSocketUrl(symbol!))
        ws.onopen = () => {
          if (isMounted) setStatus('open')
        }
        ws.onerror = () => {
          if (isMounted) setStatus('error')
        }
        ws.onclose = () => {
          if (isMounted) {
            setStatus('closed')
            reconnectTimer = setTimeout(connect, 3000)
          }
        }
        ws.onmessage = (ev) => {
          try {
            const msg: TapeMessage = JSON.parse(ev.data)
            latestMsg = msg
            cumRef.current = {
              buyLot: cumRef.current.buyLot + msg.analysis.realBuyLot,
              sellLot: cumRef.current.sellLot + msg.analysis.realSellLot,
              buyVal: cumRef.current.buyVal + msg.analysis.realBuyVal,
              sellVal: cumRef.current.sellVal + msg.analysis.realSellVal,
            }
            if (!rafId && isMounted) {
              rafId = requestAnimationFrame(() => {
                if (latestMsg) setLatest(latestMsg)
                setCum({ ...cumRef.current })
                rafId = null
              })
            }
          } catch (err) {
            console.error('Failed to parse tape message:', err)
          }
        }
      } catch (e) {
        if (isMounted) {
          setStatus('error')
          reconnectTimer = setTimeout(connect, 3000)
        }
      }
    }

    connect()

    return () => {
      isMounted = false
      if (rafId) cancelAnimationFrame(rafId)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) ws.close()
    }
  }, [symbol])

  if (!symbol) {
    return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat Live Tape.</div>
  }

  const a = latest?.analysis
  const snap = latest?.snapshot
  const bidPct = a && a.totalBid + a.totalOffer > 0 ? (a.totalBid / (a.totalBid + a.totalOffer)) * 100 : 50
  const fakeBid = new Set((a?.fake ?? []).filter((f) => f.side === 'bid').map((f) => f.price))
  const fakeOffer = new Set((a?.fake ?? []).filter((f) => f.side === 'offer').map((f) => f.price))
  const maxLot = Math.max(1, ...(snap?.bid.map((l) => l.lot) ?? []), ...(snap?.offer.map((l) => l.lot) ?? []))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {/* Arsant Screener Header */}
      <div
        style={{
          padding: '4px 8px',
          background: 'var(--panel-header)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10 }}>
            [ TAPE - LIVE DEPTH &amp; ORDERBOOK ]
          </span>
          <SymbolHeaderPicker
            symbol={symbol}
            isPinned={isPinned}
            onPinToggle={() => (isPinned ? setPinnedSymbol(null) : setPinnedSymbol(symbol))}
            onSymbolChange={(s) => setPinnedSymbol(s)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {snap && <span style={{ color: 'var(--text-h)', fontWeight: 700 }}>{snap.last}</span>}
          <span style={{ color: statusColor[status], fontSize: 10 }}>● {statusLabel[status]}</span>
        </div>
      </div>

      <div style={{ padding: 8, flex: 1, overflowY: 'auto', fontSize: 11 }}>
        {!latest && status === 'open' && (
          <div style={{ color: 'var(--text-dim)', padding: '8px 0', fontSize: 11 }}>
            Menunggu stream data transaksi dari bridge-extension...
          </div>
        )}

      {a && (
        <>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)' }}>
              <span>BID {fmtLot(a.totalBid)}</span>
              <span>OFFER {fmtLot(a.totalOffer)}</span>
            </div>
            <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--border)' }}>
              <div style={{ width: `${bidPct}%`, background: 'var(--up)' }} />
              <div style={{ width: `${100 - bidPct}%`, background: 'var(--down)' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            <span>
              <span style={{ color: 'var(--text-dim)' }}>Realisasi Buy: </span>
              <span style={{ color: 'var(--up)' }}>
                {fmtLot(cum.buyLot)} lot ({fmtRp(cum.buyVal)})
              </span>
            </span>
            <span>
              <span style={{ color: 'var(--text-dim)' }}>Sell: </span>
              <span style={{ color: 'var(--down)' }}>
                {fmtLot(cum.sellLot)} lot ({fmtRp(cum.sellVal)})
              </span>
            </span>
          </div>

          {a.pulls.length > 0 && (
            <div style={{ marginBottom: 8, color: 'var(--down)' }}>
              🚨 <b>ORDER DICABUT</b>:{' '}
              {a.pulls.map((p) => `${p.side.toUpperCase()} ${p.price} (${fmtLot(p.lot)} lot)`).join(', ')}
            </div>
          )}
          {a.marketQuiet && (
            <div style={{ marginBottom: 8, color: 'var(--text-dim)' }}>⏸ Pasar sepi — realisasi transaksi tidak bergerak</div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ display: 'flex', fontSize: 10, color: 'var(--text-dim)', padding: '0 6px' }}>
                <span style={{ flex: 1 }}>Order</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Lot</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Bid</span>
              </div>
              {snap?.bid.map((l) => (
                <DepthRow key={l.price} level={l} side="bid" maxLot={maxLot} isFake={fakeBid.has(l.price)} />
              ))}
            </div>
            <div>
              <div style={{ display: 'flex', fontSize: 10, color: 'var(--text-dim)', padding: '0 6px' }}>
                <span style={{ flex: 1 }}>Offer</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Lot</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Order</span>
              </div>
              {snap?.offer.map((l) => (
                <DepthRow key={l.price} level={l} side="offer" maxLot={maxLot} isFake={fakeOffer.has(l.price)} />
              ))}
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  )
}
