import { lazy, useEffect, useRef, useState } from 'react'
import { DockviewReact, type DockviewReadyEvent, type DockviewApi } from 'dockview-react'
import 'dockview/dist/styles/dockview.css'
import { useTerminalStore, type LayoutPreset, PANEL_CONFIGS } from '../store/useTerminalStore'

const Watchlist = lazy(() => import('./Watchlist').then((m) => ({ default: m.Watchlist })))
const ChartPanel = lazy(() => import('./ChartPanel').then((m) => ({ default: m.ChartPanel })))
const BrokerSummaryPanel = lazy(() => import('./BrokerSummaryPanel').then((m) => ({ default: m.BrokerSummaryPanel })))
const PVAPanel = lazy(() => import('./PVAPanel').then((m) => ({ default: m.PVAPanel })))
const ScannerPanel = lazy(() => import('./ScannerPanel').then((m) => ({ default: m.ScannerPanel })))
const LiveTapePanel = lazy(() => import('./LiveTapePanel').then((m) => ({ default: m.LiveTapePanel })))
const PortfolioPanel = lazy(() => import('./PortfolioPanel').then((m) => ({ default: m.PortfolioPanel })))
const OutlookPanel = lazy(() => import('./OutlookPanel').then((m) => ({ default: m.OutlookPanel })))
const AlertsPanel = lazy(() => import('./AlertsPanel').then((m) => ({ default: m.AlertsPanel })))
const FundamentalsPanel = lazy(() => import('./FundamentalsPanel').then((m) => ({ default: m.FundamentalsPanel })))
const MacroPanel = lazy(() => import('./MacroPanel').then((m) => ({ default: m.MacroPanel })))
const FutureEarningsPanel = lazy(() => import('./FutureEarningsPanel').then((m) => ({ default: m.FutureEarningsPanel })))
const DecisionPanel = lazy(() => import('./DecisionPanel').then((m) => ({ default: m.DecisionPanel })))
const BrokerAnalysisPanel = lazy(() => import('./BrokerAnalysisPanel').then((m) => ({ default: m.BrokerAnalysisPanel })))
const RunningTradePanel = lazy(() => import('./RunningTradePanel').then((m) => ({ default: m.RunningTradePanel })))
const NewsPanel = lazy(() => import('./NewsPanel').then((m) => ({ default: m.NewsPanel })))
const TeknikalPanel = lazy(() => import('./TeknikalPanel').then((m) => ({ default: m.TeknikalPanel })))
const StockProfilerPanel = lazy(() => import('./StockProfilerPanel').then((m) => ({ default: m.StockProfilerPanel })))
const BrokerProfilerPanel = lazy(() => import('./BrokerProfilerPanel').then((m) => ({ default: m.BrokerProfilerPanel })))
const ForeignRadarPanel = lazy(() => import('./ForeignRadarPanel').then((m) => ({ default: m.ForeignRadarPanel })))
const SIDPanel = lazy(() => import('./SIDPanel').then((m) => ({ default: m.SIDPanel })))
const LiveStreamPanel = lazy(() => import('./LiveStreamPanel').then((m) => ({ default: m.LiveStreamPanel })))

const components = {
  watchlist: Watchlist,
  chart: ChartPanel,
  brokerSummary: BrokerSummaryPanel,
  pva: PVAPanel,
  scanner: ScannerPanel,
  liveTape: LiveTapePanel,
  portfolio: PortfolioPanel,
  outlook: OutlookPanel,
  alerts: AlertsPanel,
  fundamentals: FundamentalsPanel,
  macro: MacroPanel,
  futureEarnings: FutureEarningsPanel,
  decision: () => <DecisionPanel />,
  brokerAnalysis: BrokerAnalysisPanel,
  runningTrade: RunningTradePanel,
  news: () => <NewsPanel />,
  teknikal: TeknikalPanel,
  stockProfiler: StockProfilerPanel,
  brokerProfiler: BrokerProfilerPanel,
  foreignRadar: ForeignRadarPanel,
  sid: SIDPanel,
  liveStream: LiveStreamPanel,
}

const ANALYSIS_TABS: { id: string; component: string; title: string }[] = [
  { id: 'decision', component: 'decision', title: 'Sinyal Keputusan' },
  { id: 'brokerAnalysis', component: 'brokerAnalysis', title: 'Broker Flow' },
  { id: 'teknikal', component: 'teknikal', title: 'Analisis Teknikal' },
  { id: 'stockProfiler', component: 'stockProfiler', title: 'Stock Profiler' },
  { id: 'brokerProfiler', component: 'brokerProfiler', title: 'Broker Profiler' },
  { id: 'foreignRadar', component: 'foreignRadar', title: 'Foreign Radar' },
  { id: 'sid', component: 'sid', title: 'SID & Scripless' },
  { id: 'runningTrade', component: 'runningTrade', title: 'Running Trade' },
  { id: 'brokerSummary', component: 'brokerSummary', title: 'Broker Summary' },
  { id: 'pva', component: 'pva', title: 'PVA/VSA' },
  { id: 'outlook', component: 'outlook', title: 'Market Outlook' },
  { id: 'fundamentals', component: 'fundamentals', title: 'Fundamental' },
  { id: 'futureEarnings', component: 'futureEarnings', title: 'Future Earnings' },
  { id: 'macro', component: 'macro', title: 'Market Macro' },
  { id: 'scanner', component: 'scanner', title: 'Market Screener' },
  { id: 'portfolio', component: 'portfolio', title: 'Portofolio' },
]

function setupLayout(api: DockviewApi, preset: LayoutPreset) {
  api.clear()

  if (preset === 'blank') {
    // Blank workspace layout
    return
  }

  if (preset === 'screener') {
    api.addPanel({
      id: 'chart',
      component: 'chart',
      title: 'Chart Harga',
    })
    api.addPanel({
      id: 'watchlist',
      component: 'watchlist',
      title: 'Watchlist',
      position: { referencePanel: 'chart', direction: 'left' },
    })
    api.addPanel({
      id: 'scanner',
      component: 'scanner',
      title: 'Market Screener',
      position: { referencePanel: 'chart', direction: 'below' },
    })
    api.addPanel({
      id: 'news',
      component: 'news',
      title: 'Berita Pasar',
      position: { referencePanel: 'watchlist', direction: 'below' },
    })
    api.getPanel('watchlist')?.api.setSize({ width: 260 })
    api.getPanel('scanner')?.api.setSize({ height: 320 })
    api.getPanel('chart')?.api.setActive()
    return
  }

  if (preset === 'trading') {
    api.addPanel({ id: 'chart', component: 'chart', title: 'Chart Harga' })
    api.addPanel({
      id: 'liveTape',
      component: 'liveTape',
      title: 'Order Flow Live',
      position: { referencePanel: 'chart', direction: 'right' },
    })
    api.addPanel({
      id: 'decision',
      component: 'decision',
      title: 'Sinyal Keputusan',
      position: { referencePanel: 'chart', direction: 'below' },
    })
    api.addPanel({
      id: 'runningTrade',
      component: 'runningTrade',
      title: 'Running Trade Flow',
      position: { referencePanel: 'decision', direction: 'within' },
    })
    api.getPanel('chart')?.api.setSize({ width: 850 })
    return
  }

  if (preset === 'broker') {
    api.addPanel({ id: 'watchlist', component: 'watchlist', title: 'Watchlist' })
    api.addPanel({
      id: 'brokerAnalysis',
      component: 'brokerAnalysis',
      title: 'Broker Flow',
      position: { referencePanel: 'watchlist', direction: 'right' },
    })
    api.addPanel({
      id: 'brokerSummary',
      component: 'brokerSummary',
      title: 'Broker Summary Harian',
      position: { referencePanel: 'brokerAnalysis', direction: 'within' },
    })
    api.addPanel({
      id: 'brokerProfiler',
      component: 'brokerProfiler',
      title: 'Broker Profiler',
      position: { referencePanel: 'brokerAnalysis', direction: 'within' },
    })
    api.addPanel({
      id: 'foreignRadar',
      component: 'foreignRadar',
      title: 'Foreign Radar',
      position: { referencePanel: 'brokerAnalysis', direction: 'within' },
    })
    api.addPanel({
      id: 'stockProfiler',
      component: 'stockProfiler',
      title: 'Stock Profiler',
      position: { referencePanel: 'brokerAnalysis', direction: 'within' },
    })
    api.addPanel({
      id: 'sid',
      component: 'sid',
      title: 'SID & Scripless',
      position: { referencePanel: 'brokerAnalysis', direction: 'within' },
    })
    api.getPanel('brokerAnalysis')?.api.setActive()
    api.addPanel({
      id: 'pva',
      component: 'pva',
      title: 'Volume Analysis (PVA)',
      position: { referencePanel: 'brokerAnalysis', direction: 'below' },
    })
    api.addPanel({
      id: 'chart',
      component: 'chart',
      title: 'Chart Harga',
      position: { referencePanel: 'pva', direction: 'within' },
    })
    return
  }

  if (preset === 'portfolio') {
    api.addPanel({ id: 'portfolio', component: 'portfolio', title: 'Portofolio & Risiko' })
    api.addPanel({
      id: 'fundamentals',
      component: 'fundamentals',
      title: 'Fundamental & Valuasi',
      position: { referencePanel: 'portfolio', direction: 'below' },
    })
    api.addPanel({
      id: 'macro',
      component: 'macro',
      title: 'Market Macro',
      position: { referencePanel: 'fundamentals', direction: 'within' },
    })
    api.addPanel({
      id: 'watchlist',
      component: 'watchlist',
      title: 'Watchlist',
      position: { referencePanel: 'portfolio', direction: 'left' },
    })
    return
  }

  // DEFAULT / MASTER PRESET
  api.addPanel({ id: 'watchlist', component: 'watchlist', title: 'Watchlist' })

  api.addPanel({
    id: 'chart',
    component: 'chart',
    title: 'Chart Harga',
    position: { referencePanel: 'watchlist', direction: 'right' },
  })

  api.addPanel({
    id: 'liveTape',
    component: 'liveTape',
    title: 'Order Flow Live',
    position: { referencePanel: 'chart', direction: 'right' },
  })

  api.addPanel({
    id: ANALYSIS_TABS[0].id,
    component: ANALYSIS_TABS[0].component,
    title: ANALYSIS_TABS[0].title,
    position: { referencePanel: 'chart', direction: 'below' },
  })
  let prevId = ANALYSIS_TABS[0].id
  for (const tab of ANALYSIS_TABS.slice(1)) {
    api.addPanel({
      id: tab.id,
      component: tab.component,
      title: tab.title,
      position: { referencePanel: prevId, direction: 'within' },
    })
    prevId = tab.id
  }
  api.getPanel(ANALYSIS_TABS[0].id)?.api.setActive()

  api.addPanel({
    id: 'news',
    component: 'news',
    title: 'Berita Pasar',
    position: { referencePanel: 'liveTape', direction: 'below' },
  })
  api.addPanel({
    id: 'alerts',
    component: 'alerts',
    title: 'Peringatan',
    position: { referencePanel: 'news', direction: 'within' },
  })
  api.getPanel('news')?.api.setActive()

  api.getPanel('chart')?.api.setSize({ width: 880 })
  api.getPanel('liveTape')?.api.setSize({ width: 360 })
}

function EmptyWorkspacePlaceholder() {
  const addPanelInstance = useTerminalStore((s) => s.addPanelInstance)
  const popoutPanel = useTerminalStore((s) => s.popoutPanel)

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 5,
        textAlign: 'center',
      }}
    >
      <div style={{ color: 'var(--accent)', fontWeight: 900, fontSize: 16, marginBottom: 4, letterSpacing: 1 }}>
        [ WORKSPACE KOSONG · CUSTOM TEMPLATE ]
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 20, maxWidth: 500 }}>
        Workspace ini belum memiliki panel. Klik tombol di bawah untuk menambahkan panel utama, membuat <b>multiple chart</b>, atau kirim panel ke <b>Monitor 2 / Monitor 3</b>.
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 10,
          width: '100%',
          maxWidth: 840,
        }}
      >
        {Object.entries(PANEL_CONFIGS).map(([key, cfg]) => (
          <div
            key={key}
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--border-bright)',
              borderRadius: 6,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <div>
              <div style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 11 }}>{cfg.title}</div>
              <div style={{ color: 'var(--text-dim)', fontSize: 9 }}>Kode panel: {key}</div>
            </div>

            <div style={{ display: 'flex', gap: 6, width: '100%' }}>
              <button
                onClick={() => addPanelInstance(key)}
                style={{
                  flex: 1,
                  background: 'var(--accent)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 3,
                  padding: '4px 8px',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                + Tambah Panel
              </button>
              <button
                onClick={() => popoutPanel(key)}
                style={{
                  background: 'var(--panel-header)',
                  color: 'var(--cyan)',
                  border: '1px solid var(--cyan)',
                  borderRadius: 3,
                  padding: '4px 6px',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
                title="Pop-out ke Monitor 2 / 3"
              >
                ↗ Monitor 2/3
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TerminalLayout() {
  const setDockviewApi = useTerminalStore((s) => s.setDockviewApi)
  const activePreset = useTerminalStore((s) => s.activePreset)
  const apiRef = useRef<DockviewApi | null>(null)
  const [panelCount, setPanelCount] = useState<number>(0)

  function onReady(event: DockviewReadyEvent) {
    const { api } = event
    apiRef.current = api
    setDockviewApi(api)
    setupLayout(api, activePreset)
    setPanelCount(api.panels.length)

    api.onDidAddPanel(() => setPanelCount(api.panels.length))
    api.onDidRemovePanel(() => setPanelCount(api.panels.length))
  }

  const activeWorkspaceId = useTerminalStore((s) => s.activeWorkspaceId)

  useEffect(() => {
    if (apiRef.current) {
      setupLayout(apiRef.current, activePreset)
      setPanelCount(apiRef.current.panels.length)
    }
  }, [activePreset, activeWorkspaceId])

  return (
    <div className="dockview-theme-dark" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <DockviewReact components={components} onReady={onReady} />
      {panelCount === 0 && <EmptyWorkspacePlaceholder />}
    </div>
  )
}
