import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAccountSession, fetchHealth, fetchMacro, fetchSymbols, logoutAccount } from '../api/client'
import { useTerminalStore, type LayoutPreset, PANEL_CONFIGS } from '../store/useTerminalStore'
import { WorkspaceModal } from './WorkspaceModal'

const FUNCTION_KEYS: { key: string; label: string; tab: string; shift?: boolean }[] = [
  { key: 'F1', label: 'HELP', tab: 'help' },
  { key: 'F2', label: 'DECISION', tab: 'decision' },
  { key: 'F3', label: 'CHART', tab: 'chart' },
  { key: 'F4', label: 'BRKR FLOW', tab: 'brokerAnalysis' },
  { key: 'F5', label: 'LIVE TAPE', tab: 'liveTape' },
  { key: 'F6', label: 'PVA/VSA', tab: 'pva' },
  { key: 'F7', label: 'OUTLOOK', tab: 'outlook' },
  { key: 'F8', label: 'FUNDAMENTAL', tab: 'fundamentals' },
  { key: 'F9', label: 'PORTFOLIO', tab: 'portfolio' },
  { key: 'F10', label: 'MACRO', tab: 'macro' },
  { key: 'F11', label: 'SCANNER', tab: 'scanner' },
  { key: 'F12', label: 'NEWS FEED', tab: 'news' },
  { key: 'F2', label: 'TEKNIKAL', tab: 'teknikal', shift: true },
  { key: 'F3', label: 'STOCK PROF', tab: 'stockProfiler', shift: true },
  { key: 'F4', label: 'BRKR PROF', tab: 'brokerProfiler', shift: true },
  { key: 'F5', label: 'FRGN RADAR', tab: 'foreignRadar', shift: true },
  { key: 'F6', label: 'SID/KSEI', tab: 'sid', shift: true },
]

const PRIMARY_NAVIGATION = [
  { label: 'DASHBOARD', tab: 'dashboard' },
  { label: 'SCREENER', tab: 'scanner' },
  { label: 'CHART', tab: 'chart' },
  { label: 'BROKER FLOW', tab: 'brokerAnalysis' },
  { label: 'MARKET', tab: 'macro' },
  { label: 'PORTFOLIO', tab: 'portfolio' },
  { label: 'ALERTS', tab: 'alerts' },
]

const COMMAND_SHORTCUTS: Record<string, string> = {
  HELP: 'help',
  DEC: 'decision',
  DECISION: 'decision',
  CHART: 'chart',
  GP: 'chart',
  BRKR: 'brokerAnalysis',
  BROKER: 'brokerAnalysis',
  BS: 'brokerSummary',
  TAPE: 'liveTape',
  PVA: 'pva',
  VSA: 'pva',
  OUTLOOK: 'outlook',
  FA: 'fundamentals',
  FUND: 'fundamentals',
  PORT: 'portfolio',
  MACRO: 'macro',
  SCAN: 'scanner',
  NEWS: 'news',
  TRADE: 'runningTrade',
  TA: 'teknikal',
  TEK: 'teknikal',
  TEKNIKAL: 'teknikal',
  SP: 'stockProfiler',
  PROFILE: 'stockProfiler',
  INV: 'stockProfiler',
  BP: 'brokerProfiler',
  INTEL: 'brokerProfiler',
  FR: 'foreignRadar',
  RADAR: 'foreignRadar',
  ASING: 'foreignRadar',
  SID: 'sid',
  KSEI: 'sid',
  OWN: 'sid',
  STREAM: 'liveStream',
  LIVE: 'liveStream',
  PRABOWO: 'liveStream',
  PRESIDENT: 'liveStream',
  YOUTUBE: 'liveStream',
}

const GROUP_COLOR: Record<string, string> = {
  indeks: 'var(--accent)',
  asia: '#f5a623',
  amerika: '#4da3ff',
  komoditas: '#c084fc',
  kurs: '#22d3ee',
  kripto: '#a3e635',
}

function BackendStatusBadge() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 15000,
  })

  let label = 'CONNECTING'
  let badgeClass = 'bbg-badge-amber'

  if (isError) {
    label = 'OFFLINE'
    badgeClass = 'bbg-badge-red'
  } else if (data) {
    label = `ONLINE (${data.env ?? 'prod'})`
    badgeClass = 'bbg-badge-green'
  }

  return <span className={`bbg-badge ${badgeClass}`}>● {label}</span>
}

export function HeaderBar() {
  const selectedSymbol = useTerminalStore((s) => s.selectedSymbol)
  const selectSymbol = useTerminalStore((s) => s.selectSymbol)
  const setHelpOpen = useTerminalStore((s) => s.setHelpOpen)
  const activateTab = useTerminalStore((s) => s.activateTab)
  const addPanelInstance = useTerminalStore((s) => s.addPanelInstance)
  const popoutPanel = useTerminalStore((s) => s.popoutPanel)
  const activePreset = useTerminalStore((s) => s.activePreset)
  const setActivePreset = useTerminalStore((s) => s.setActivePreset)

  const workspaces = useTerminalStore((s) => s.workspaces)
  const activeWorkspaceId = useTerminalStore((s) => s.activeWorkspaceId)
  const switchWorkspace = useTerminalStore((s) => s.switchWorkspace)

  const [inputCmd, setInputCmd] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showAddPanelMenu, setShowAddPanelMenu] = useState(false)
  const [clockStr, setClockStr] = useState('')
  const [isWsModalOpen, setIsWsModalOpen] = useState(false)
  const [activeNavigation, setActiveNavigation] = useState('scanner')
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: symbolsData } = useQuery({
    queryKey: ['symbols'],
    queryFn: fetchSymbols,
  })

  const { data: macroData } = useQuery({
    queryKey: ['macro'],
    queryFn: fetchMacro,
    refetchInterval: 10_000,
  })
  const { data: account } = useQuery({ queryKey: ['account-session'], queryFn: fetchAccountSession, staleTime: 60_000 })

  const liveTickers = (macroData ?? []).map((q) => {
    const chg = q.changePercent
    const hasPrice = q.price != null
    return {
      key: q.ticker,
      label: q.name || q.ticker,
      group: q.group ?? '',
      price: hasPrice ? q.price!.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : '—',
      chg: hasPrice && chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '',
      up: hasPrice && chg != null ? chg >= 0 : null,
      stale: !!q.stale,
      error: q.error,
    }
  })

  // Clock Ticker
  useEffect(() => {
    const updateClock = () => {
      const d = new Date()
      const timeStr = d.toLocaleTimeString('id-ID', { hour12: false })
      const dateStr = d.toISOString().slice(0, 10)
      setClockStr(`${dateStr} ${timeStr} WIB`)
    }
    updateClock()
    const timer = setInterval(updateClock, 1000)
    return () => clearInterval(timer)
  }, [])

  // Keyboard shortcut listener for / and F1-F12
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === '/' || (e.ctrlKey && e.key === 'k')) && document.activeElement !== inputRef.current) {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }

      const matchF = FUNCTION_KEYS.find((f) => f.key === e.key && !!f.shift === e.shiftKey)
      if (matchF) {
        e.preventDefault()
        if (matchF.tab === 'help') {
          setHelpOpen(true)
        } else {
          activateTab(matchF.tab)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activateTab, setHelpOpen])

  const handleCommandSubmit = (cmdString: string) => {
    const trimmed = cmdString.trim().toUpperCase().replace('<GO>', '').trim()
    if (!trimmed) return

    if (trimmed === 'HELP') {
      setHelpOpen(true)
      setInputCmd('')
      setShowSuggestions(false)
      return
    }

    if (COMMAND_SHORTCUTS[trimmed]) {
      activateTab(COMMAND_SHORTCUTS[trimmed])
      setInputCmd('')
      setShowSuggestions(false)
      return
    }

    selectSymbol(trimmed)
    setInputCmd('')
    setShowSuggestions(false)
  }

  const allSymbols = symbolsData?.map((s) => s.symbol) ?? []
  const filteredSuggestions = inputCmd.trim()
    ? [...Object.keys(COMMAND_SHORTCUTS), ...allSymbols].filter((item) =>
      item.toUpperCase().includes(inputCmd.trim().toUpperCase()),
    ).slice(0, 8)
    : []

  return (
    <header className="header-bar-container" style={{ background: 'var(--panel-header)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      {/* Top Primary Bar */}
      <div
        className="header-top-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          gap: 12,
        }}
      >
        {/* Brand & Command Box */}
        <div className="header-primary" style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setHelpOpen(true)} aria-label="Buka bantuan Arsant Screener">
            <img src="/arsant-logo.png" alt="Arsant Screener" className="brand-logo" />
            <span
              style={{
                background: 'var(--accent)',
                color: '#000',
                fontWeight: 900,
                padding: '2px 6px',
                borderRadius: 2,
                fontSize: 11,
                letterSpacing: 1,
              }}
            >
              ARSANT
            </span>
            <span className="brand-title" style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>
              SCREENER <span style={{ color: 'var(--text-dim)', fontSize: 10 }}></span>
            </span>
          </div>

          {/* Command Prompt Box */}
          <div className="header-command" style={{ position: 'relative', flex: '0 1 320px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--bg)',
                border: '1px solid var(--accent)',
                borderRadius: 2,
                padding: '2px 6px',
                boxShadow: 'inset 0 0 4px var(--accent-glow)',
              }}
            >
              <span style={{ color: 'var(--accent)', fontWeight: 800, fontSize: 11, marginRight: 6 }}>
                &lt;CMD&gt;
              </span>
              <input
                ref={inputRef}
                type="text"
                value={inputCmd}
                onChange={(e) => {
                  setInputCmd(e.target.value)
                  setShowSuggestions(true)
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommandSubmit(inputCmd)
                }}
                placeholder={selectedSymbol ? `${selectedSymbol} <GO> or TYPE CMD...` : 'TYPE SYMBOL OR CMD...'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent-hover)',
                  width: '100%',
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
              <button
                onClick={() => handleCommandSubmit(inputCmd)}
                style={{
                  background: 'var(--accent)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 2,
                  padding: '1px 6px',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                  marginLeft: 4,
                }}
              >
                GO
              </button>
            </div>

            {/* Suggestions Dropdown */}
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: 2,
                  background: '#090d14',
                  border: '1px solid var(--accent)',
                  borderRadius: 2,
                  zIndex: 9999,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.8)',
                  maxHeight: 200,
                  overflowY: 'auto',
                }}
              >
                {filteredSuggestions.map((item) => {
                  const isCmd = !!COMMAND_SHORTCUTS[item]
                  return (
                    <div
                      key={item}
                      onMouseDown={() => handleCommandSubmit(item)}
                      style={{
                        padding: '5px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        fontSize: 11,
                      }}
                      className="bbg-suggestion-item"
                    >
                      <span style={{ color: isCmd ? 'var(--cyan)' : 'var(--accent)', fontWeight: 700 }}>
                        {item}
                      </span>
                      <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                        {isCmd ? `[CMD -> ${COMMAND_SHORTCUTS[item]}]` : '[BEI EQUITY]'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Active Symbol Display */}
          {selectedSymbol && (
            <div className="active-symbol-badge" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="bbg-badge bbg-badge-amber" style={{ fontSize: 11 }}>
                {selectedSymbol} IJ EQUITY
              </span>
            </div>
          )}
        </div>

        {/* Workspace Selector, Add Panel & Layout Controls */}
        <div className="header-controls" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Workspace Dropdown */}
          <div className="workspace-controls" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <select
              value={activeWorkspaceId}
              onChange={(e) => switchWorkspace(e.target.value)}
              style={{
                background: 'var(--bg)',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: 3,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  📁 {w.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setIsWsModalOpen(true)}
              style={{
                background: 'var(--bg)',
                color: 'var(--cyan)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '2px 6px',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              title="Kelola Workspace"
            >
              ⚙
            </button>
          </div>

          {/* Add Panel Dropdown Button */}
          <div className="add-panel-control" style={{ position: 'relative' }}>
            <button
              onClick={() => setShowAddPanelMenu(!showAddPanelMenu)}
              style={{
                background: 'var(--cyan-soft)',
                color: 'var(--cyan)',
                border: '1px solid var(--cyan)',
                borderRadius: 3,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              + TAMBAH PANEL ▼
            </button>

            {showAddPanelMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  width: 260,
                  background: '#090d14',
                  border: '1px solid var(--cyan)',
                  borderRadius: 4,
                  zIndex: 9999,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
                  padding: 6,
                  maxHeight: 320,
                  overflowY: 'auto',
                }}
              >
                <div style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 9.5, padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>
                  PILIH PANEL / MULTIPLE CHART:
                </div>
                {Object.entries(PANEL_CONFIGS).map(([key, cfg]) => (
                  <div
                    key={key}
                    onClick={() => {
                      addPanelInstance(key)
                      setShowAddPanelMenu(false)
                    }}
                    style={{
                      padding: '5px 8px',
                      cursor: 'pointer',
                      fontSize: 10,
                      fontWeight: 700,
                      color: 'var(--text-h)',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                    className="bbg-suggestion-item"
                  >
                    <span>{cfg.title}</span>
                    <span style={{ color: 'var(--accent)', fontSize: 9 }}>+ Add</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Popout Monitor 2/3 Button */}
          <button
            className="monitor-control"
            onClick={() => popoutPanel('chart')}
            style={{
              background: 'var(--bg)',
              color: 'var(--text-h)',
              border: '1px solid var(--border-bright)',
              borderRadius: 3,
              padding: '2px 6px',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Pop-out Window ke Monitor 2 / Monitor 3"
          >
            ↗ MONITOR 2/3
          </button>

          {/* Layout Presets Buttons */}
          <div className="preset-buttons-group" style={{ display: 'flex', gap: 3, background: 'var(--bg)', padding: 2, borderRadius: 3, border: '1px solid var(--border)' }}>
            {[
              { id: 'screener', label: 'SCREENER' },
              { id: 'default', label: 'OVERVIEW' },
              { id: 'trading', label: 'TAPE' },
              { id: 'broker', label: 'BROKER' },
              { id: 'portfolio', label: 'PORT' },
              { id: 'blank', label: 'KOSONG' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePreset(p.id as LayoutPreset)}
                style={{
                  background: activePreset === p.id ? 'var(--accent)' : 'transparent',
                  color: activePreset === p.id ? '#000' : 'var(--text-dim)',
                  border: 'none',
                  borderRadius: 2,
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <BackendStatusBadge />

          {account?.authenticated ? <div style={{display:'flex',alignItems:'center',gap:5,fontSize:10}}><a href="/account" style={{color:'var(--text-h)',textDecoration:'none',maxWidth:110,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{account.user?.name || account.user?.email}</a><button onClick={async()=>{await logoutAccount();window.location.assign('/')}} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)',fontSize:9,cursor:'pointer'}}>KELUAR</button></div> : <a href="/account" style={{color:'var(--accent)',fontSize:10,fontWeight:800,textDecoration:'none'}}>MASUK</a>}

          <div className="clock-display" style={{ color: 'var(--cyan)', fontSize: 11, fontWeight: 600, minWidth: 140, textAlign: 'right' }}>
            {clockStr}
          </div>
        </div>
      </div>

      {/* Primary Navigation */}
      <div
        className="primary-navigation"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '2px 12px 4px 12px',
          overflowX: 'auto',
          background: 'var(--bg)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <span className="navigation-label">WORKSPACE</span>
        {PRIMARY_NAVIGATION.map((item) => (
          <button
            key={item.tab}
            onClick={() => {
              if (item.tab === 'dashboard') {
                window.location.assign('/dashboard')
                return
              }
              setActiveNavigation(item.tab)
              activateTab(item.tab)
            }}
            className={activeNavigation === item.tab ? 'navigation-item navigation-item-active' : 'navigation-item'}
            style={{
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--mono)',
            }}
          >
            {item.label}
          </button>
        ))}
        <span className="navigation-hint">Gunakan / untuk cari saham atau perintah</span>
      </div>

      {/* Market Overview Continuous Running Text Marquee */}
      <div className="ticker-banner-container">
        <div className="ticker-label">
          MARKET OVERVIEW &bull;
        </div>
        <div className="ticker-viewport">
          <div className="ticker-track">
            {[...liveTickers, ...liveTickers].map((t, idx) => (
              <div
                key={`${t.key}-${idx}`}
                className="ticker-item"
                onClick={() => {
                  if (t.key && !t.key.startsWith('^') && !t.key.includes('=')) {
                    selectSymbol(t.key)
                  }
                }}
              >
                <span style={{ color: GROUP_COLOR[t.group] ?? 'var(--text-h)', fontWeight: 700 }}>
                  {t.label}
                </span>
                <span style={{ color: t.price === '—' ? 'var(--text-dim)' : 'var(--text)' }}>
                  {t.price}
                </span>
                <span
                  style={{
                    color: t.up === true ? 'var(--up)' : t.up === false ? 'var(--down)' : 'var(--text-dim)',
                    fontWeight: 800,
                  }}
                >
                  {t.chg}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Workspace Manager Modal */}
      <WorkspaceModal isOpen={isWsModalOpen} onClose={() => setIsWsModalOpen(false)} />
    </header>
  )
}
