import { useTerminalStore } from '../store/useTerminalStore'

const MOBILE_TABS = [
  { id: 'scanner', label: 'Screener', icon: '🔎' },
  { id: 'chart', label: 'Chart', icon: '📊' },
  { id: 'watchlist', label: 'Watchlist', icon: '📋' },
  { id: 'liveTape', label: 'Tape', icon: '⚡' },
  { id: 'brokerAnalysis', label: 'Broker', icon: '🕵️' },
  { id: 'news', label: 'News', icon: '📰' },
  { id: 'portfolio', label: 'Portfolio', icon: '💼' },
]

export function MobileNav() {
  const activateTab = useTerminalStore((s) => s.activateTab)

  return (
    <nav className="mobile-bottom-nav">
      {MOBILE_TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => activateTab(t.id)}
          className="mobile-nav-item"
        >
          <span style={{ fontSize: 13 }}>{t.icon}</span>
          <span style={{ fontSize: 9, fontWeight: 700 }}>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
