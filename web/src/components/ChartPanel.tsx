import { useEffect, useRef, useState } from 'react'
import { useTerminalStore } from '../store/useTerminalStore'

const INTERVALS = [
  { label: 'Harian', value: 'D' },
  { label: 'Mingguan', value: 'W' },
  { label: 'Bulanan', value: 'M' },
] as const

function tradingViewSymbol(symbol: string): string {
  return symbol === 'IHSG' ? 'IDX:COMPOSITE' : `IDX:${symbol}`
}

export function ChartPanel({ params }: { params?: { symbolOverride?: string } }) {
  const globalSymbol = useTerminalStore((state) => state.selectedSymbol) || 'BBCA'
  const symbol = params?.symbolOverride || globalSymbol
  const [interval, setInterval] = useState('D')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = containerRef.current
    if (!host) return

    host.replaceChildren()
    const widget = document.createElement('div')
    widget.className = 'tradingview-widget-container__widget'
    widget.style.width = '100%'
    widget.style.height = '100%'
    host.appendChild(widget)

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    script.text = JSON.stringify({
      autosize: true,
      symbol: tradingViewSymbol(symbol),
      interval,
      timezone: 'Asia/Jakarta',
      theme: 'dark',
      backgroundColor: '#081729',
      gridColor: 'rgba(83, 104, 129, 0.18)',
      style: '1',
      locale: 'id',
      withdateranges: false,
      hide_side_toolbar: true,
      hide_top_toolbar: true,
      hide_legend: false,
      hide_volume: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      details: false,
      hotlist: false,
      support_host: 'https://www.tradingview.com',
    })
    host.appendChild(script)

    return () => host.replaceChildren()
  }, [interval, symbol])

  return (
    <div className="trade-tv-chart">
      <div className="trade-tv-toolbar">
        <div>
          <span className="trade-tv-symbol">{symbol}</span>
          <small>IDX · TradingView</small>
        </div>
        <div className="trade-intervals" aria-label="Interval candle">
          <span>INTERVAL</span>
          {INTERVALS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={interval === option.value ? 'active' : ''}
              onClick={() => setInterval(option.value)}
              aria-pressed={interval === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="trade-tv-frame tradingview-widget-container" ref={containerRef} />
    </div>
  )
}
