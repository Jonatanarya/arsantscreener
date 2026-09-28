import { useTerminalStore } from '../store/useTerminalStore'

export function DateRangeFilter({
  from,
  to,
  onSetPeriod,
}: {
  from: string
  to: string
  onSetPeriod: (from: string, to: string) => void
}) {
  const handlePreset = (preset: '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y') => {
    const today = new Date()
    const toStr = today.toISOString().slice(0, 10)
    const d = new Date(today)

    if (preset === '1D') d.setDate(d.getDate() - 1)
    else if (preset === '1W') d.setDate(d.getDate() - 7)
    else if (preset === '1M') d.setMonth(d.getMonth() - 1)
    else if (preset === '3M') d.setMonth(d.getMonth() - 3)
    else if (preset === 'YTD') d.setMonth(0, 1)
    else if (preset === '1Y') d.setFullYear(d.getFullYear() - 1)

    onSetPeriod(d.toISOString().slice(0, 10), toStr)
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
        <span style={{ fontSize: 9.5, color: 'var(--cyan)', fontWeight: 800 }}>📅 Periode:</span>
        <input
          type="date"
          value={from}
          onChange={(e) => onSetPeriod(e.target.value, to)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-h)',
            fontSize: 10,
            fontWeight: 700,
            outline: 'none',
            cursor: 'pointer',
          }}
        />
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>➔</span>
        <input
          type="date"
          value={to}
          onChange={(e) => onSetPeriod(from, e.target.value)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-h)',
            fontSize: 10,
            fontWeight: 700,
            outline: 'none',
            cursor: 'pointer',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 2 }}>
        {(['1D', '1W', '1M', '3M', 'YTD', '1Y'] as const).map((tf) => (
          <button
            key={tf}
            onClick={() => handlePreset(tf)}
            style={{
              background: 'var(--bg)',
              color: 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              padding: '2px 6px',
              fontSize: 9.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {tf}
          </button>
        ))}
      </div>
    </div>
  )
}

export function GlobalPeriodPicker() {
  const periodFrom = useTerminalStore((s) => s.periodFrom)
  const periodTo = useTerminalStore((s) => s.periodTo)
  const setPeriod = useTerminalStore((s) => s.setPeriod)

  return <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={setPeriod} />
}

export const PeriodPicker = GlobalPeriodPicker
