import { lazy, useEffect } from 'react'
import { useTerminalStore } from './store/useTerminalStore'

const HeaderBar = lazy(() => import('./components/HeaderBar').then((module) => ({ default: module.HeaderBar })))
const HelpModal = lazy(() => import('./components/HelpModal').then((module) => ({ default: module.HelpModal })))
const TerminalLayout = lazy(() => import('./components/TerminalLayout').then((module) => ({ default: module.TerminalLayout })))
const MobileNav = lazy(() => import('./components/MobileNav').then((module) => ({ default: module.MobileNav })))
const ChartPanel = lazy(() => import('./components/ChartPanel').then((module) => ({ default: module.ChartPanel })))
const LiveTapePanel = lazy(() => import('./components/LiveTapePanel').then((module) => ({ default: module.LiveTapePanel })))
const StockProfilerPanel = lazy(() => import('./components/StockProfilerPanel').then((module) => ({ default: module.StockProfilerPanel })))
const BrokerAnalysisPanel = lazy(() => import('./components/BrokerAnalysisPanel').then((module) => ({ default: module.BrokerAnalysisPanel })))
const NewsPanel = lazy(() => import('./components/NewsPanel').then((module) => ({ default: module.NewsPanel })))
const PortfolioPanel = lazy(() => import('./components/PortfolioPanel').then((module) => ({ default: module.PortfolioPanel })))
const LiveStreamPanel = lazy(() => import('./components/LiveStreamPanel').then((module) => ({ default: module.LiveStreamPanel })))
const LandingPage = lazy(() => import('./components/LandingPage').then((module) => ({ default: module.LandingPage })))
const DashboardPage = lazy(() => import('./components/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const ApiStorePage = lazy(() => import('./components/ApiStorePage').then((module) => ({ default: module.ApiStorePage })))
const UserDashboardPage = lazy(() => import('./components/UserDashboardPage').then((module) => ({ default: module.UserDashboardPage })))
const AccountPage = lazy(() => import('./components/AccountPage').then((module) => ({ default: module.AccountPage })))
const StockDetailPage = lazy(() => import('./components/StockDetailPage').then((module) => ({ default: module.StockDetailPage })))
const LegalPage = lazy(() => import('./components/LegalPage').then((module) => ({ default: module.LegalPage })))
const NotFoundPage = lazy(() => import('./components/NotFoundPage').then((module) => ({ default: module.NotFoundPage })))
const OnboardingGuide = lazy(() => import('./components/OnboardingGuide').then((module) => ({ default: module.OnboardingGuide })))
const StatusPage = lazy(() => import('./components/StatusPage').then((module) => ({ default: module.StatusPage })))
const GuidePage = lazy(() => import('./components/GuidePage').then((module) => ({ default: module.GuidePage })))
const TradePage = lazy(() => import('./components/TradePage').then((module) => ({ default: module.TradePage })))
const DataControlPage = lazy(() => import('./components/DataControlPage').then((module) => ({ default: module.DataControlPage })))

function OpenRequestedPanel() {
  const activateTab = useTerminalStore((s) => s.activateTab)
  useEffect(() => {
    const panel = new URLSearchParams(window.location.search).get('panel')
    if (!panel) return
    let attempts = 0
    const timer = window.setInterval(() => {
      activateTab(panel)
      attempts += 1
      if (attempts >= 10) window.clearInterval(timer)
    }, 150)
    return () => window.clearInterval(timer)
  }, [activateTab])
  return null
}

function PopoutView() {
  const params = new URLSearchParams(window.location.search)
  const panelKey = params.get('panel') || 'chart'
  const symbolParam = params.get('symbol')
  const selectSymbol = useTerminalStore((s) => s.selectSymbol)

  useEffect(() => {
    if (symbolParam) selectSymbol(symbolParam)
  }, [symbolParam, selectSymbol])

  return <div style={{ width: '100vw', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>
    <div style={{ background: 'var(--panel-header)', borderBottom: '1px solid var(--border)', padding: '4px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ color: 'var(--accent)', fontWeight: 800, fontSize: 11 }}>↗ DETACHED WINDOW (MONITOR 2 / 3) &bull; {panelKey.toUpperCase()} {symbolParam ? `[${symbolParam}]` : ''}</span><span style={{ color: 'var(--cyan)', fontSize: 10, fontWeight: 700 }}>ARSANT SCREENER MULTI-MONITOR</span></div>
    <div style={{ height: 'calc(100vh - 28px)' }}>{panelKey === 'chart' && <ChartPanel />}{panelKey === 'liveTape' && <LiveTapePanel />}{panelKey === 'stockProfiler' && <StockProfilerPanel />}{panelKey === 'brokerAnalysis' && <BrokerAnalysisPanel />}{panelKey === 'news' && <NewsPanel />}{panelKey === 'portfolio' && <PortfolioPanel />}{panelKey === 'liveStream' && <LiveStreamPanel />}</div>
  </div>
}

function LegacyAppRedirect() {
  useEffect(() => {
    window.location.replace('/trade')
  }, [])
  return <div className="route-loading"><img src="/arsant-logo.png" alt="" /><span>Membuka Arsant Trade…</span></div>
}

function App() {
  const isLegacyScreenerDomain = ['arsant.web.id', 'www.arsant.web.id'].includes(window.location.hostname)
  const isPopout = window.location.search.includes('popout=true')

  if (isLegacyScreenerDomain && (window.location.pathname === '/app' || window.location.pathname.startsWith('/app/'))) return <LegacyAppRedirect />
  if (!isLegacyScreenerDomain && isPopout) return <PopoutView />

  if (window.location.pathname.startsWith('/account')) return <AccountPage />
  if (window.location.pathname.startsWith('/admin/data')) return <DataControlPage />

  if (window.location.pathname.startsWith('/stock/')) return <StockDetailPage />
  if (window.location.pathname.startsWith('/trade')) return <TradePage />

  if (window.location.pathname === '/privacy') return <LegalPage kind="privacy" />
  if (window.location.pathname === '/terms') return <LegalPage kind="terms" />
  if (window.location.pathname === '/disclaimer') return <LegalPage kind="disclaimer" />
  if (window.location.pathname === '/status') return <StatusPage />
  if (window.location.pathname === '/methodology') return <GuidePage kind="methodology" />
  if (window.location.pathname === '/help') return <GuidePage kind="help" />

  // arsant.web.id remains the legacy screener surface. This hostname guard is
  // intentional: both domains can point to the same VPS/build without the
  // API store replacing the stock screener on the legacy domain.
  if (isLegacyScreenerDomain) {
    if (window.location.pathname.startsWith('/dashboard')) {
      return <DashboardPage />
    }
    if (window.location.pathname === '/' || window.location.pathname.startsWith('/screener')) {
      return <LandingPage />
    }
    return <NotFoundPage />
  }

  if (window.location.pathname.startsWith('/dashboard')) {
    return <UserDashboardPage />
  }

  if (window.location.pathname.startsWith('/market-dashboard')) {
    return <DashboardPage />
  }

  if (window.location.pathname === '/' || window.location.pathname.startsWith('/store') || window.location.pathname.startsWith('/api-key')) {
    return <ApiStorePage />
  }

  if (window.location.pathname.startsWith('/screener')) {
    return <LandingPage />
  }

  if (!window.location.pathname.startsWith('/app')) return <ApiStorePage />

  return <><HeaderBar /><OpenRequestedPanel /><main style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}><TerminalLayout /></main><HelpModal /><MobileNav /><OnboardingGuide /></>
}

export default App
