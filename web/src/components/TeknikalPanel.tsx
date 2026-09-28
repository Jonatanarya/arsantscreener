import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTechnical, type HorizonReturn, type TechnicalAnalysis } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { SymbolHeaderPicker } from './SymbolHeaderPicker'

const fmtPrice = (v?: number) =>
  v == null || !isFinite(v) || v === 0 ? '—' : Math.round(v).toLocaleString('id-ID')

const fmtNum = (v?: number, digits = 2) =>
  v == null || !isFinite(v) ? '—' : v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const fmtPct = (v?: number) => {
  if (v == null || !isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

function biasColor(bias: string): string {
  if (bias === 'bullish') return 'var(--up)'
  if (bias === 'bearish') return 'var(--down)'
  return 'var(--text-dim)'
}

function scoreColor(score: number): string {
  if (score >= 56) return 'var(--up)'
  if (score <= 44) return 'var(--down)'
  return 'var(--accent)'
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 3, marginBottom: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '3px 6px',
          background: 'var(--panel-header)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: 10, letterSpacing: 0.5 }}>{title}</span>
        {right}
      </div>
      <div style={{ padding: 6 }}>{children}</div>
    </div>
  )
}

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 3, padding: '5px 7px' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color: color ?? 'var(--text-h)', fontWeight: 700, fontSize: 12 }}>{value}</div>
      {sub && <div style={{ color: 'var(--text-dim)', fontSize: 9 }}>{sub}</div>}
    </div>
  )
}

/** Baris level pivot — resistance merah di atas, support hijau di bawah,
 *  dengan penanda pada level yang paling dekat dengan harga sekarang. */
function PivotRow({ label, value, tone, current }: { label: string; value: number; tone: 'r' | 'p' | 's'; current: boolean }) {
  const color = tone === 'r' ? 'var(--down)' : tone === 's' ? 'var(--up)' : 'var(--accent)'
  const bg = tone === 'r' ? 'var(--down-bg)' : tone === 's' ? 'var(--up-bg)' : 'var(--accent-soft)'
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '3px 6px',
        background: bg,
        borderLeft: `2px solid ${current ? color : 'transparent'}`,
        marginBottom: 2,
        borderRadius: 2,
      }}
    >
      <span style={{ color, fontWeight: 600, fontSize: 10 }}>{label}</span>
      <span style={{ color: 'var(--text-h)', fontWeight: 700, fontSize: 11 }}>{fmtPrice(value)}</span>
    </div>
  )
}

function ReturnCell({ r }: { r: HorizonReturn }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 3, padding: '4px 6px', textAlign: 'center' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 9 }}>{r.label}</div>
      <div style={{ color: !r.ok ? 'var(--text-dim)' : r.changePct >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700, fontSize: 11 }}>
        {r.ok ? fmtPct(r.changePct) : '—'}
      </div>
    </div>
  )
}

function Week52Bar({ t }: { t: TechnicalAnalysis }) {
  const pos = Math.min(100, Math.max(0, t.week52Pos))
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', marginBottom: 3 }}>
        <span>52W Low: <b style={{ color: 'var(--up)' }}>{fmtPrice(t.week52Low)}</b></span>
        <span>52W High: <b style={{ color: 'var(--down)' }}>{fmtPrice(t.week52High)}</b></span>
      </div>
      <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: `${pos}%`, height: '100%', background: 'linear-gradient(90deg, var(--up), var(--accent), var(--down))' }} />
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: 9, marginTop: 2, textAlign: 'center' }}>
        Harga di {pos.toFixed(0)}% rentang 52 minggu
      </div>
    </div>
  )
}

export function TeknikalPanel({ params }: { params?: { symbolOverride?: string } }) {
  const globalSymbol = useTerminalStore((s) => s.selectedSymbol)
  const periodFrom = useTerminalStore((s) => s.periodFrom)
  const periodTo = useTerminalStore((s) => s.periodTo)

  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(params?.symbolOverride || null)
  const symbol = pinnedSymbol || globalSymbol
  const isPinned = !!pinnedSymbol

  const { data, isLoading, isError } = useQuery({
    queryKey: ['technical', symbol, periodFrom, periodTo],
    queryFn: () => fetchTechnical(symbol!, periodFrom, periodTo),
    enabled: !!symbol,
  })

  if (!symbol) {
    return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat analisa teknikal.</div>
  }
  if (isLoading) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Memuat indikator teknikal…</div>
  if (isError || !data) return <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat analisa teknikal.</div>
  if (data.error) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>{data.error}</div>

  const t = data.technical
  const c = data.confluence
  const pivotLevels = [
    { label: 'Resistance 2 (R2)', value: t.pivot.r2, tone: 'r' as const },
    { label: 'Resistance 1 (R1)', value: t.pivot.r1, tone: 'r' as const },
    { label: 'Pivot Point (P)', value: t.pivot.p, tone: 'p' as const },
    { label: 'Support 1 (S1)', value: t.pivot.s1, tone: 's' as const },
    { label: 'Support 2 (S2)', value: t.pivot.s2, tone: 's' as const },
  ]
  let nearestIdx = 0
  let nearestDist = Infinity
  pivotLevels.forEach((lv, i) => {
    const d = Math.abs(lv.value - t.close)
    if (d < nearestDist) {
      nearestDist = d
      nearestIdx = i
    }
  })

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
          <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10 }}>[ TEKNIKAL - INDIKATOR, PIVOT &amp; KONFLUENSI ]</span>
          <SymbolHeaderPicker
            symbol={symbol}
            isPinned={isPinned}
            onPinToggle={() => (isPinned ? setPinnedSymbol(null) : setPinnedSymbol(symbol))}
            onSymbolChange={(s) => setPinnedSymbol(s)}
          />
        </div>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>
            Close: {fmtPrice(t.close)}
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>{t.lastDate}</span>
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 8, fontSize: 11 }}>
        {/* Ringkasan harga */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 8 }}>
          <Metric label="Close" value={fmtPrice(t.close)} color={t.changePct >= 0 ? 'var(--up)' : 'var(--down)'} sub={fmtPct(t.changePct)} />
          <Metric label="Open" value={fmtPrice(t.open)} />
          <Metric label="High" value={fmtPrice(t.high)} />
          <Metric label="Low" value={fmtPrice(t.low)} />
          <Metric label="ATR (14)" value={fmtPrice(t.atr14)} sub={`${fmtNum(t.atrPct)}% rentang harian`} />
        </div>

        {/* Konfluensi TA + Flow */}
        <Section
          title="TA + FLOW CONFLUENCE"
          right={<span style={{ color: scoreColor(c.score), fontWeight: 800, fontSize: 10 }}>{c.label}</span>}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
            <span style={{ color: 'var(--text-dim)' }}>Sinyal Gabungan</span>
            <span style={{ color: scoreColor(c.score), fontWeight: 800 }}>{c.score}/100</span>
          </div>
          <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ width: `${c.score}%`, height: '100%', background: scoreColor(c.score) }} />
          </div>
          <div style={{ color: 'var(--text)', fontSize: 10, lineHeight: 1.5, marginBottom: 6 }}>
            <b style={{ color: 'var(--text-h)' }}>Analisis:</b> {c.analysis}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <Metric label="Broker Flow" value={c.brokerFlow} color={c.brokerFlow === 'Akumulasi' ? 'var(--up)' : c.brokerFlow === 'Distribusi' ? 'var(--down)' : 'var(--text)'} />
            <Metric label="Teknikal Momentum" value={c.techMomentum} color={scoreColor(t.score)} sub={`Skor teknikal ${t.score}/100`} />
          </div>
        </Section>

        {/* Indikator */}
        <Section title="INDIKATOR TEKNIKAL" right={<span style={{ color: scoreColor(t.score), fontWeight: 700, fontSize: 10 }}>{t.verdict}</span>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <Metric
              label="Moving Average"
              value={t.trendMa}
              color={t.trendMa === 'Bullish' ? 'var(--up)' : t.trendMa === 'Bearish' ? 'var(--down)' : 'var(--text)'}
              sub={`MA9 ${fmtPrice(t.ma9)} · EMA20 ${fmtPrice(t.ema20)}`}
            />
            <Metric
              label="RSI (14)"
              value={t.rsi14 ? `${t.rsi14.toFixed(0)} · ${t.rsiLabel}` : '—'}
              color={t.rsi14 >= 70 ? 'var(--down)' : t.rsi14 <= 30 ? 'var(--up)' : 'var(--text-h)'}
              sub="Oscillator"
            />
            <Metric
              label="Tren Major (EMA 200)"
              value={t.trendMajor}
              color={t.trendMajor === 'Bullish' ? 'var(--up)' : t.trendMajor === 'Bearish' ? 'var(--down)' : 'var(--text)'}
              sub={t.ema200 ? `EMA200: ${fmtPrice(t.ema200)}` : 'EMA200: data < 200 bar'}
            />
            <Metric
              label="Stochastic (14,3,3)"
              value={t.stochK || t.stochD ? `%K ${t.stochK.toFixed(0)} · %D ${t.stochD.toFixed(0)}` : '—'}
              color={t.stochLabel === 'Bullish' ? 'var(--up)' : t.stochLabel === 'Bearish' ? 'var(--down)' : 'var(--text-h)'}
              sub={t.stochLabel}
            />
          </div>
        </Section>

        {/* Pivot */}
        <Section title="LEVEL PIVOT (S/R)" right={<span style={{ color: 'var(--text-dim)', fontSize: 9 }}>Classic Pivot</span>}>
          {pivotLevels.map((lv, i) => (
            <PivotRow key={lv.label} label={lv.label} value={lv.value} tone={lv.tone} current={i === nearestIdx} />
          ))}
          <div style={{ marginTop: 6 }}>
            <Week52Bar t={t} />
          </div>
        </Section>

        {/* R:R + pola + volume */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
          <Section title="R : R SETUP" right={<span className="bbg-badge bbg-badge-amber">R:R {t.riskReward ? `1 : ${t.riskReward.toFixed(1)}` : '—'}</span>}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>Target (R1)</span>
              <span style={{ color: 'var(--up)', fontWeight: 700 }}>
                {fmtPrice(t.target)} <span style={{ fontSize: 9 }}>({fmtPct(t.distToR1Pct)})</span>
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>Stop Loss (S1)</span>
              <span style={{ color: 'var(--down)', fontWeight: 700 }}>
                {fmtPrice(t.stopLoss)} <span style={{ fontSize: 9 }}>({fmtPct(t.distToS1Pct)})</span>
              </span>
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: 9, marginTop: 5 }}>
              Rasio risiko vs potensi keuntungan jika masuk di harga saat ini.
            </div>
          </Section>

          <Section title="POLA CANDLESTICK" right={<span style={{ color: 'var(--text-dim)', fontSize: 9 }}>Daily Bar</span>}>
            <div style={{ color: biasColor(t.candle.bias), fontWeight: 700, fontSize: 12 }}>{t.candle.name}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 9, marginTop: 4, lineHeight: 1.5 }}>{t.candle.note}</div>
          </Section>

          <Section
            title="VOLUME SURGE (VPA)"
            right={
              <span style={{ color: t.volumeSurge.surgePct >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 700, fontSize: 10 }}>
                {t.volumeSurge.avg20 ? `${t.volumeSurge.surgePct >= 0 ? '+' : ''}${t.volumeSurge.surgePct.toFixed(0)}% Volume` : '—'}
              </span>
            }
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>Aktivitas Transaksi</span>
              <span style={{ color: biasColor(t.volumeSurge.bias), fontWeight: 700 }}>{t.volumeSurge.label}</span>
            </div>
            <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, (t.volumeSurge.ratio / 4) * 100)}%`,
                  height: '100%',
                  background: biasColor(t.volumeSurge.bias) === 'var(--text-dim)' ? 'var(--accent)' : biasColor(t.volumeSurge.bias),
                }}
              />
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: 9, marginTop: 5 }}>
              Perbandingan volume transaksi dengan rata-rata 20 hari.
            </div>
          </Section>
        </div>

        {/* Kinerja & proksimitas */}
        <Section title="KINERJA HARGA &amp; PROKSIMITAS BREAKOUT" right={<span style={{ color: 'var(--text-dim)', fontSize: 9 }}>Multi-Horizon</span>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: 9, marginBottom: 4 }}>HISTORIKAL RETURN %</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                {t.returns.map((r) => (
                  <ReturnCell key={r.label} r={r} />
                ))}
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-dim)', fontSize: 9, marginBottom: 4 }}>JARAK LEVEL KUNCI</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text)' }}>Jarak ke R1 (Breakout)</span>
                <span style={{ color: 'var(--up)', fontWeight: 700 }}>{fmtPct(t.distToR1Pct)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: 'var(--text)' }}>Jarak ke S1 (Defense)</span>
                <span style={{ color: 'var(--down)', fontWeight: 700 }}>{fmtPct(t.distToS1Pct)}</span>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
