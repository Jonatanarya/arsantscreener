import { useState } from 'react'

export function SymbolHeaderPicker({
  symbol,
  isPinned,
  onPinToggle,
  onSymbolChange,
}: {
  symbol: string
  isPinned: boolean
  onPinToggle: () => void
  onSymbolChange: (newSymbol: string) => void
}) {
  const [inputVal, setInputVal] = useState('')

  const handleSubmit = () => {
    if (inputVal.trim()) {
      onSymbolChange(inputVal.trim().toUpperCase())
      setInputVal('')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {/* Symbol Input & Lock/Sync Toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg)',
          border: `1px solid ${isPinned ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 3,
          padding: '2px 4px',
        }}
      >
        <button
          onClick={onPinToggle}
          style={{
            background: isPinned ? 'var(--accent)' : 'transparent',
            color: isPinned ? '#000' : 'var(--cyan)',
            border: 'none',
            borderRadius: 2,
            padding: '1px 6px',
            fontSize: 9.5,
            fontWeight: 800,
            cursor: 'pointer',
            marginRight: 4,
          }}
          title={isPinned ? 'Panel di-Pin ke emiten ini. Klik untuk Sync Global.' : 'Terhubung ke Global Watchlist. Klik untuk Lock/Pin.'}
        >
          {isPinned ? '📌 PIN' : '🔗 SYNC'}
        </button>

        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
          }}
          onBlur={handleSubmit}
          placeholder={symbol}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent-hover)',
            fontWeight: 800,
            fontSize: 11,
            width: 65,
            outline: 'none',
          }}
        />
      </div>

      {/* Active Symbol Display Badge */}
      <span className={`bbg-badge ${isPinned ? 'bbg-badge-amber' : 'bbg-badge-cyan'}`} style={{ fontSize: 11 }}>
        {symbol} IJ
      </span>

      {/* Quick Stock Presets */}
      <div style={{ display: 'flex', gap: 2 }}>
        {['SSIA', 'IHSG', 'BBCA', 'TLKM', 'ASII', 'BREN'].map((s) => (
          <button
            key={s}
            onClick={() => onSymbolChange(s)}
            style={{
              background: symbol === s ? 'var(--accent)' : 'var(--bg)',
              color: symbol === s ? '#000' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              padding: '1px 5px',
              fontSize: 9,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
