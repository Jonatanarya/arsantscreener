import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  calculatePositionSize,
  closePosition,
  createPosition,
  deletePosition,
  fetchPortfolioSummary,
  fetchPositions,
  type PositionSizeResult,
} from '../api/client'
import { fmtRp } from '../lib/format'

const inputStyle: React.CSSProperties = {
  background: 'var(--panel)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 3,
  padding: '3px 6px',
  fontSize: 11,
  fontFamily: 'inherit',
  width: 90,
}

const plColor = (v: number) => (v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-dim)')

function AddPositionForm({ onAdded }: { onAdded: () => void }) {
  const [symbol, setSymbol] = useState('')
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [entryPrice, setEntryPrice] = useState('')
  const [lot, setLot] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      createPosition({
        symbol: symbol.toUpperCase(),
        entryDate,
        entryPrice: Number(entryPrice),
        lot: Number(lot),
        stopLoss: stopLoss ? Number(stopLoss) : undefined,
      }),
    onSuccess: () => {
      setSymbol('')
      setEntryPrice('')
      setLot('')
      setStopLoss('')
      setError(null)
      onAdded()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate()
      }}
      style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}
    >
      <input style={{ ...inputStyle, width: 70 }} placeholder="Simbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} required />
      <input style={inputStyle} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
      <input style={inputStyle} type="number" placeholder="Harga entry" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} required />
      <input style={{ ...inputStyle, width: 60 }} type="number" placeholder="Lot" value={lot} onChange={(e) => setLot(e.target.value)} required />
      <input style={inputStyle} type="number" placeholder="Stop loss" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} />
      <button type="submit" disabled={mutation.isPending} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
        + Tambah posisi
      </button>
      {error && <span style={{ color: 'var(--down)', fontSize: 11 }}>{error}</span>}
    </form>
  )
}

function PositionSizeCalculator() {
  const [equity, setEquity] = useState('100000000')
  const [riskPct, setRiskPct] = useState('2')
  const [entryPrice, setEntryPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [result, setResult] = useState<PositionSizeResult | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      calculatePositionSize({
        equity: Number(equity),
        riskPct: Number(riskPct) / 100,
        entryPrice: Number(entryPrice),
        stopLoss: Number(stopLoss),
      }),
    onSuccess: setResult,
  })

  return (
    <div style={{ marginBottom: 12, padding: 8, border: '1px solid var(--border)', borderRadius: 4 }}>
      <div style={{ color: 'var(--text-h)', fontWeight: 600, marginBottom: 6 }}>Kalkulator Position Sizing</div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate()
        }}
        style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Modal <input style={inputStyle} type="number" value={equity} onChange={(e) => setEquity(e.target.value)} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Risiko %{' '}
          <input style={{ ...inputStyle, width: 50 }} type="number" step="0.1" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Entry <input style={inputStyle} type="number" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} required />
        </label>
        <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Stop loss <input style={inputStyle} type="number" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} required />
        </label>
        <button type="submit" disabled={mutation.isPending} style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}>
          Hitung
        </button>
      </form>
      {result && (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          {result.error ? (
            <span style={{ color: 'var(--down)' }}>{result.error}</span>
          ) : (
            <span>
              Beli <b>{result.lots.toLocaleString('id-ID')} lot</b> ({result.shares.toLocaleString('id-ID')} lembar) — nilai posisi{' '}
              {fmtRp(result.positionValue)}, risiko {fmtRp(result.riskAmount)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function PortfolioPanel() {
  const queryClient = useQueryClient()
  const { data: positions, isLoading, isError } = useQuery({ queryKey: ['positions', 'open'], queryFn: () => fetchPositions('open') })
  const { data: summary } = useQuery({ queryKey: ['portfolio-summary'], queryFn: fetchPortfolioSummary })
  const [closingId, setClosingId] = useState<number | null>(null)
  const [exitPriceInput, setExitPriceInput] = useState('')

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['positions'] })
    queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] })
  }

  const closeMutation = useMutation({
    mutationFn: ({ id, exitPrice }: { id: number; exitPrice: number }) =>
      closePosition(id, { exitDate: new Date().toISOString().slice(0, 10), exitPrice }),
    onSuccess: () => {
      setClosingId(null)
      setExitPriceInput('')
      refresh()
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePosition(id),
    onSuccess: refresh,
  })

  const confirmClose = (id: number) => {
    const exitPrice = Number(exitPriceInput)
    if (!exitPrice || exitPrice <= 0) return
    closeMutation.mutate({ id, exitPrice })
  }

  if (isError) return <div style={{padding:24,color:'var(--text-h)'}}><b>Login diperlukan</b><p style={{color:'var(--text-dim)'}}>Portfolio disimpan terpisah untuk setiap akun.</p><a href="/account" style={{color:'var(--accent)'}}>Masuk atau buat akun →</a></div>

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
        }}
      >
        <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10 }}>
          [ PORT - PORTFOLIO &amp; RISK CALCULATOR ]
        </span>
        {summary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
            <span>UNREALIZED P&amp;L:</span>
            <span style={{ color: plColor(summary.totalUnrealizedPL), fontWeight: 800 }}>
              {fmtRp(summary.totalUnrealizedPL)} ({summary.totalUnrealizedPLPct.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>

      <div style={{ padding: 8, flex: 1, overflowY: 'auto', fontSize: 11 }}>
        <PositionSizeCalculator />

        <AddPositionForm onAdded={refresh} />

        {summary && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            <span>
              <span style={{ color: 'var(--text-dim)' }}>Total P&amp;L: </span>
              <span style={{ color: plColor(summary.totalUnrealizedPL) }}>
                {fmtRp(summary.totalUnrealizedPL)} ({summary.totalUnrealizedPLPct.toFixed(2)}%)
              </span>
            </span>
          <span>
            <span style={{ color: 'var(--text-dim)' }}>Nilai portofolio: </span>
            <span style={{ color: 'var(--text-h)' }}>{fmtRp(summary.totalMarketValue)}</span>
          </span>
        </div>
      )}

      {summary?.warnings.map((w, i) => (
        <div key={i} style={{ marginBottom: 4, color: 'var(--down)' }}>
          ⚠ Konsentrasi {w.kind === 'stock' ? 'saham' : 'sektor'} <b>{w.key}</b> {(w.pct * 100).toFixed(1)}% — melebihi batas{' '}
          {(w.limit * 100).toFixed(0)}%
        </div>
      ))}

      {isLoading ? (
        <div style={{ color: 'var(--text-dim)' }}>Memuat posisi…</div>
      ) : !positions?.length ? (
        <div style={{ color: 'var(--text-dim)' }}>Belum ada posisi terbuka.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-dim)' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 400 }}>Simbol</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 400 }}>Entry</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 400 }}>Lot</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 400 }}>Now</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 400 }}>P&L</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 400 }} />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id}>
                <td style={{ padding: '4px 6px' }}>{p.symbol}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{p.entryPrice.toLocaleString('id-ID')}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{p.lot}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{p.currentPrice?.toLocaleString('id-ID') ?? '—'}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: plColor(p.unrealizedPL) }}>
                  {fmtRp(p.unrealizedPL)} ({p.unrealizedPLPct.toFixed(1)}%)
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {closingId === p.id ? (
                    <>
                      <input
                        autoFocus
                        style={{ ...inputStyle, width: 70, marginRight: 4 }}
                        type="number"
                        placeholder="Harga exit"
                        value={exitPriceInput}
                        onChange={(e) => setExitPriceInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && confirmClose(p.id)}
                      />
                      <button
                        onClick={() => confirmClose(p.id)}
                        disabled={closeMutation.isPending}
                        style={{ ...inputStyle, width: 'auto', padding: '2px 6px', cursor: 'pointer', marginRight: 4 }}
                      >
                        OK
                      </button>
                      <button
                        onClick={() => {
                          setClosingId(null)
                          setExitPriceInput('')
                        }}
                        style={{ ...inputStyle, width: 'auto', padding: '2px 6px', cursor: 'pointer' }}
                      >
                        Batal
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setClosingId(p.id)
                          setExitPriceInput('')
                        }}
                        style={{ ...inputStyle, width: 'auto', padding: '2px 6px', cursor: 'pointer', marginRight: 4 }}
                      >
                        Tutup
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(p.id)}
                        disabled={deleteMutation.isPending}
                        style={{ ...inputStyle, width: 'auto', padding: '2px 6px', cursor: 'pointer', color: 'var(--down)' }}
                      >
                        Hapus
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </div>
    </div>
  )
}
