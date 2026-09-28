import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPVA } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { SymbolHeaderPicker } from './SymbolHeaderPicker'

const biasColor = (bias: string) =>
  bias === 'BULLISH' ? 'var(--up)' : bias === 'BEARISH' ? 'var(--down)' : 'var(--text-dim)'

const scoreColor = (score: number) => (score > 0 ? 'var(--up)' : score < 0 ? 'var(--down)' : 'var(--text-dim)')

const dominanceLabel = (dominance: string) =>
  dominance === 'demand' ? 'demand dominan' : dominance === 'supply' ? 'supply dominan' : 'seimbang'

export function PVAPanel({ params }: { params?: { symbolOverride?: string } }) {
  const globalSymbol = useTerminalStore((s) => s.selectedSymbol)
  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(params?.symbolOverride || null)
  const symbol = pinnedSymbol || globalSymbol
  const isPinned = !!pinnedSymbol

  const { data, isLoading, isError } = useQuery({
    queryKey: ['pva', symbol],
    queryFn: () => fetchPVA(symbol!),
    enabled: !!symbol,
  })

  if (!symbol) {
    return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat PVA/VSA.</div>
  }
  if (isLoading) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Menganalisa price-volume…</div>
  if (isError) return <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat analisa PVA.</div>
  if (!data || data.error) {
    return <div style={{ color: 'var(--text-dim)', padding: 16 }}>{data?.error ?? 'Tidak ada data.'}</div>
  }

  const rows = [...data.rows].reverse()

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
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10 }}>[ PVA - PRICE VOLUME SPREAD ANALYSIS ]</span>
          <SymbolHeaderPicker
            symbol={symbol}
            isPinned={isPinned}
            onPinToggle={() => (isPinned ? setPinnedSymbol(null) : setPinnedSymbol(symbol))}
            onSymbolChange={(s) => setPinnedSymbol(s)}
          />
        </div>
      </div>

      <div style={{ padding: 8, overflowY: 'auto', flex: 1, fontSize: 12 }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: biasColor(data.bias), fontWeight: 700 }}>PVA {data.bias}</span>
          <span style={{ color: 'var(--text-dim)' }}> (skor {data.score})</span>
        </div>

        <div style={{ color: 'var(--text-dim)', marginBottom: 4 }}>{data.obvText}</div>

        <div style={{ marginBottom: 4 }}>
          <span style={{ color: 'var(--text-dim)' }}>Volume naik vs turun (20 hari): </span>
          <span style={{ color: 'var(--text-h)' }}>{data.upDownRatio.toFixed(2)}</span>
          <span style={{ color: 'var(--text-dim)' }}> — {dominanceLabel(data.dominance)}</span>
        </div>

        {data.climax && (
          <div style={{ marginBottom: 8, color: data.climax.type === 'SELLING CLIMAX' ? 'var(--up)' : 'var(--down)' }}>
            ⚡ <b>{data.climax.type}</b> terdeteksi {data.climax.date} — {data.climax.desc}
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-dim)' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Tanggal</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>Δ Harga</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>Vol</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Klasifikasi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td style={{ padding: '4px 8px' }}>{r.date}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: r.chgPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                  {r.chgPct >= 0 ? '+' : ''}
                  {r.chgPct.toFixed(1)}%
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.volRel.toFixed(1)}x</td>
                <td style={{ padding: '4px 8px' }}>
                  <span style={{ color: scoreColor(r.score), fontWeight: 600 }}>{r.class}</span>
                  {r.desc && <span style={{ color: 'var(--text-dim)', fontSize: 10 }}> — {r.desc}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
