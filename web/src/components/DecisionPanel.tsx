import { useQuery } from '@tanstack/react-query'
import { fetchDecision, type Decision } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { DataFreshness } from './DataFreshness'

const VERDICT_STYLE: Record<string, { bg: string; fg: string; note: string }> = {
  BELI: { bg: 'rgba(46,204,113,0.15)', fg: 'var(--up)', note: 'Sinyal searah — pertimbangkan entry sesuai rencana di bawah.' },
  PANTAU: { bg: 'rgba(245,166,35,0.12)', fg: '#f5a623', note: 'Sinyal campur/lemah — tunggu konfirmasi sebelum masuk.' },
  HINDARI: { bg: 'rgba(239,68,68,0.14)', fg: 'var(--down)', note: 'Sinyal negatif dominan — hindari entry baru, evaluasi posisi lama.' },
}

const SOURCE_LABEL: Record<string, string> = {
  fase: 'Fase',
  pva: 'PVA/VSA',
  broker: 'Broker',
  tape: 'Running Trade',
  katalis: 'Katalis',
  valuasi: 'Valuasi',
}

const fmtNum = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 })

function PlanBox({ plan }: { plan: NonNullable<Decision['plan']> }) {
  const risk = plan.entry - plan.stopLoss
  const reward = plan.takeProfit - plan.entry
  const cells: { label: string; value: string; color?: string; sub?: string }[] = [
    { label: 'Entry (harga terakhir)', value: fmtNum(plan.entry) },
    { label: 'Stop Loss', value: fmtNum(plan.stopLoss), color: 'var(--down)', sub: `-${fmtNum(risk)} (${((risk / plan.entry) * 100).toFixed(1)}%)` },
    { label: 'Take Profit', value: fmtNum(plan.takeProfit), color: 'var(--up)', sub: `+${fmtNum(reward)} (${((reward / plan.entry) * 100).toFixed(1)}%)` },
    { label: 'ATR(14)', value: fmtNum(plan.atr), sub: `R:R ≈ 1:${plan.riskReward}` },
  ]
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 4 }}>
        RENCANA TRADING (stop 1.5×ATR, target 3×ATR)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {cells.map((c) => (
          <div key={c.label} style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>{c.label}</div>
            <div style={{ color: c.color ?? 'var(--text-h)', fontWeight: 700, fontSize: 14 }}>{c.value}</div>
            {c.sub && <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>{c.sub}</div>}
          </div>
        ))}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 6 }}>
        Ukuran posisi: pakai kalkulator di panel Portfolio (risiko 2% ekuitas dari jarak entry ke stop loss).
      </div>
    </div>
  )
}

export function DecisionPanel({ showDataStatus = true }: { showDataStatus?: boolean }) {
  const symbol = useTerminalStore((s) => s.selectedSymbol)
  const periodFrom = useTerminalStore((s) => s.periodFrom)
  const periodTo = useTerminalStore((s) => s.periodTo)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['decision', symbol, periodFrom, periodTo],
    queryFn: () => fetchDecision(symbol!, periodFrom, periodTo),
    enabled: !!symbol,
  })

  if (!symbol) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat keputusan.</div>
  if (isLoading) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Menghitung keputusan…</div>
  if (isError || !data) return <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat keputusan.</div>

  const style = VERDICT_STYLE[data.verdict] ?? VERDICT_STYLE.PANTAU
  const positives = data.signals.filter((s) => s.points > 0)
  const negatives = data.signals.filter((s) => s.points < 0)

  const SignalList = ({ items, color }: { items: Decision['signals']; color: string }) => {
    if (!items.length) return <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>Tidak ada.</div>
    return (
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((s, i) => (
          <li key={i} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
            <span style={{ color, fontWeight: 700, minWidth: 22 }}>
              {s.points > 0 ? '+' : ''}
              {s.points}
            </span>
            <span>
              <span style={{ color: 'var(--text-dim)' }}>[{SOURCE_LABEL[s.source] ?? s.source}]</span> {s.text}
            </span>
          </li>
        ))}
      </ul>
    )
  }

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
          [ DEC - QUANT TRADING DECISION SIGNAL ]
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="bbg-badge bbg-badge-amber">{symbol}</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
            PERIODE: {data.from} s/d {data.to}
          </span>
        </div>
      </div>

      {showDataStatus && <DataFreshness symbol={symbol} />}

      <div style={{ padding: 10, flex: 1, overflowY: 'auto', fontSize: 11 }}>
        <div style={{ background: style.bg, borderRadius: 4, padding: '10px 12px', marginBottom: 10, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--text-h)', fontWeight: 800, fontSize: 14 }}>{symbol}</span>
            <span style={{ color: style.fg, fontWeight: 900, fontSize: 20, letterSpacing: 1 }}>{data.verdict}</span>
            <span className="bbg-badge bbg-badge-cyan">SKOR {data.score}</span>
            <span style={{ flex: 1 }} />
          </div>
          <div style={{ color: 'var(--text-h)', marginTop: 4, fontSize: 11 }}>{style.note}</div>
        </div>

      {data.quality && !data.quality.eligible && <div style={{ marginBottom: 10, padding: '9px 11px', border: '1px solid rgba(245,165,26,.45)', background: 'rgba(245,165,26,.08)', color: 'var(--text)', fontSize: 10 }}>
        <b style={{ display: 'block', marginBottom: 5, color: 'var(--accent)' }}>KUALITAS SINYAL · BELUM MEMADAI</b>
        {data.quality.reasons.join(' · ')}
      </div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <div style={{ color: 'var(--up)', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>
            MENDUKUNG ({positives.length})
          </div>
          <SignalList items={positives} color="var(--up)" />
        </div>
        <div>
          <div style={{ color: 'var(--down)', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>
            MENENTANG ({negatives.length})
          </div>
          <SignalList items={negatives} color="var(--down)" />
        </div>
      </div>

      {data.plan && <PlanBox plan={data.plan} />}

      <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
        Skor gabungan dari fase akumulasi/distribusi, PVA/VSA, aliran broker, tekanan running trade, katalis Future Earnings, dan
        valuasi. Ambang: ≥4 BELI · ≤-3 HINDARI. Ini alat bantu analisa pribadi Anda, bukan nasihat keuangan — keputusan akhir tetap
        di tangan Anda.
      </div>
    </div>
    </div>
  )
}
