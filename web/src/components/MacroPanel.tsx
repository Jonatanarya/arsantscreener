import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createMacroSensitivity,
  deleteMacroSensitivity,
  fetchMacro,
  fetchMacroSensitivity,
  type CreateMacroSensitivityRequest,
  type MacroQuote,
} from '../api/client'

type Factor = CreateMacroSensitivityRequest['factor']
import { useTerminalStore } from '../store/useTerminalStore'

const factorLabel: Record<string, string> = {
  usdidr: 'Kurs USD/IDR',
  oil: 'Harga Minyak',
  gold: 'Harga Emas',
  copper: 'Harga Tembaga',
  nickel: 'Harga Nickel',
  coal: 'Harga Batubara',
  bi_rate: 'BI Rate',
  fed_rate: 'Fed Rate',
  other: 'Lainnya',
}

// Hanya faktor ini yang punya harga live di dashboard — dipakai untuk
// menyorot tag yang relevan dengan pergerakan hari ini. nickel/coal/BI
// Rate/Fed Rate sengaja tidak disertakan (lihat catatan di macro_handler.go).
const factorTicker: Record<string, string> = {
  usdidr: 'USDIDR=X',
  oil: 'CL=F',
  gold: 'GC=F',
  copper: 'HG=F',
}

const SIGNIFICANT_MOVE_PCT = 1.5

function fmtChange(v?: number) {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function changeColor(v?: number) {
  if (v == null) return 'var(--text-dim)'
  return v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-dim)'
}

const GROUP_LABEL: Record<string, string> = {
  indeks: 'Indeks Domestik',
  asia: 'Bursa Asia',
  amerika: 'Bursa Amerika',
  komoditas: 'Komoditas',
  kurs: 'Kurs',
  kripto: 'Kripto',
  '': 'Lainnya',
}

const GROUP_SEQ = ['indeks', 'kurs', 'komoditas', 'asia', 'amerika', 'kripto']

function groupOrder(quotes: MacroQuote[]): [string, MacroQuote[]][] {
  const byGroup = new Map<string, MacroQuote[]>()
  for (const q of quotes) {
    const g = q.group ?? ''
    const list = byGroup.get(g)
    if (list) list.push(q)
    else byGroup.set(g, [q])
  }
  const known = GROUP_SEQ.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)!] as [string, MacroQuote[]])
  const rest = [...byGroup.entries()].filter(([g]) => !GROUP_SEQ.includes(g))
  return [...known, ...rest]
}

function QuoteCard({ q }: { q: MacroQuote }) {
  if (q.error && q.price == null) {
    return (
      <div style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 4 }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>{q.name}</div>
        <div style={{ color: 'var(--down)', fontSize: 11 }}>Gagal dimuat</div>
      </div>
    )
  }
  return (
    <div style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 4 }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>{q.name}</span>
        {q.stale && <span title={q.error}>⚠</span>}
      </div>
      <div style={{ color: 'var(--text-h)', fontWeight: 700 }}>
        {q.price?.toLocaleString('id-ID', { maximumFractionDigits: 2 })}
      </div>
      <div style={{ color: changeColor(q.changePercent), fontSize: 11, fontWeight: 600 }}>{fmtChange(q.changePercent)}</div>
    </div>
  )
}

export function MacroPanel() {
  const symbol = useTerminalStore((s) => s.selectedSymbol)
  const queryClient = useQueryClient()
  const [factor, setFactor] = useState<Factor>('usdidr')
  const [direction, setDirection] = useState<'diuntungkan' | 'dirugikan'>('diuntungkan')
  const [note, setNote] = useState('')

  const { data: macro } = useQuery({ queryKey: ['macro'], queryFn: fetchMacro, refetchInterval: 5 * 60 * 1000 })

  const { data: tags } = useQuery({
    queryKey: ['macro-sensitivity', symbol],
    queryFn: () => fetchMacroSensitivity(symbol!),
    enabled: !!symbol,
  })

  const addTag = useMutation({
    mutationFn: createMacroSensitivity,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['macro-sensitivity', symbol] })
      setNote('')
    },
  })

  const removeTag = useMutation({
    mutationFn: deleteMacroSensitivity,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['macro-sensitivity', symbol] }),
  })

  const quoteByTicker = new Map((macro ?? []).map((q) => [q.ticker, q]))

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
          [ MACRO - GLOBAL &amp; COMMODITY SENSITIVITY ]
        </span>
        {symbol && <span className="bbg-badge bbg-badge-amber">{symbol}</span>}
      </div>

      <div style={{ padding: 8, flex: 1, overflowY: 'auto', fontSize: 11 }}>
        {/* Dikelompokkan per `group` dari API: daftar instrumen sudah
            selusin lebih sejak indeks Asia & Amerika ikut, dan grid datar
            membuatnya tidak bisa dipindai. Urutan kelompok tetap; kelompok
            tak dikenal jatuh ke akhir supaya instrumen baru di server tidak
            pernah hilang dari tampilan. */}
        {!macro && <div style={{ color: 'var(--text-dim)', marginBottom: 14 }}>Memuat data macro…</div>}
        {macro &&
          groupOrder(macro).map(([group, quotes]) => (
            <div key={group} style={{ marginBottom: 12 }}>
              <div
                style={{
                  color: 'var(--cyan)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                {GROUP_LABEL[group] ?? group}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {quotes.map((q) => (
                  <QuoteCard key={q.ticker} q={q} />
                ))}
              </div>
            </div>
          ))}

      {!symbol ? (
        <div style={{ color: 'var(--text-dim)' }}>Pilih simbol dari watchlist untuk melihat & mengatur sensitivitas macro.</div>
      ) : (
        <>
          <div style={{ color: 'var(--text-h)', fontWeight: 600, marginBottom: 6 }}>Sensitivitas Macro — {symbol}</div>

          {(tags ?? []).length === 0 && (
            <div style={{ color: 'var(--text-dim)', marginBottom: 10 }}>Belum ada tag untuk simbol ini.</div>
          )}

          {(tags ?? []).map((t) => {
            const ticker = factorTicker[t.factor]
            const q = ticker ? quoteByTicker.get(ticker) : undefined
            const isSignificant = q?.changePercent != null && Math.abs(q.changePercent) >= SIGNIFICANT_MOVE_PCT
            return (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  marginBottom: 4,
                  borderRadius: 4,
                  background: isSignificant ? 'rgba(245,166,35,0.12)' : 'transparent',
                  border: '1px solid var(--border)',
                }}
              >
                <span style={{ color: 'var(--text-h)', fontWeight: 600, minWidth: 100 }}>{factorLabel[t.factor] ?? t.factor}</span>
                <span style={{ color: t.impactDirection === 'diuntungkan' ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>
                  {t.impactDirection}
                </span>
                {t.note && <span style={{ color: 'var(--text-dim)' }}>— {t.note}</span>}
                {isSignificant && q && (
                  <span style={{ color: 'var(--text-h)', fontSize: 11 }}>
                    ⚡ {q.name} bergerak {fmtChange(q.changePercent)} hari ini
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button onClick={() => removeTag.mutate(t.id)} style={{ fontSize: 11, cursor: 'pointer' }}>
                  Hapus
                </button>
              </div>
            )
          })}

          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={factor} onChange={(e) => setFactor(e.target.value as Factor)} style={{ fontSize: 11 }}>
              {Object.entries(factorLabel).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'diuntungkan' | 'dirugikan')} style={{ fontSize: 11 }}>
              <option value="diuntungkan">Diuntungkan</option>
              <option value="dirugikan">Dirugikan</option>
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Catatan (opsional)"
              style={{ fontSize: 11, flex: 1, minWidth: 100 }}
            />
            <button
              disabled={addTag.isPending}
              onClick={() => addTag.mutate({ symbol, factor, impactDirection: direction, note: note || undefined })}
              style={{ fontSize: 11, cursor: 'pointer' }}
            >
              + Tambah Tag
            </button>
          </div>
        </>
      )}
      </div>
    </div>
  )
}
