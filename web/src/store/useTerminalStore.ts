import type { DockviewApi } from 'dockview-react'
import { create } from 'zustand'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function monthsAgo(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return isoDate(d)
}

export type LayoutPreset = 'screener' | 'default' | 'trading' | 'broker' | 'portfolio' | 'blank'

export type Workspace = {
  id: string
  name: string
  preset: LayoutPreset
  symbol?: string
  createdAt: number
}

export const PANEL_CONFIGS: Record<string, { component: string; title: string }> = {
  chart: { component: 'chart', title: 'Chart Harga' },
  watchlist: { component: 'watchlist', title: 'Watchlist' },
  liveTape: { component: 'liveTape', title: 'Order Flow Live' },
  brokerAnalysis: { component: 'brokerAnalysis', title: 'Broker Flow' },
  brokerSummary: { component: 'brokerSummary', title: 'Broker Summary Harian' },
  pva: { component: 'pva', title: 'Volume Analysis (PVA)' },
  scanner: { component: 'scanner', title: 'Market Screener' },
  portfolio: { component: 'portfolio', title: 'Portofolio & Risiko' },
  outlook: { component: 'outlook', title: 'Market Outlook' },
  alerts: { component: 'alerts', title: 'Peringatan' },
  fundamentals: { component: 'fundamentals', title: 'Fundamental & Valuasi' },
  macro: { component: 'macro', title: 'Market Macro' },
  futureEarnings: { component: 'futureEarnings', title: 'Future Earnings' },
  decision: { component: 'decision', title: 'Sinyal Keputusan' },
  runningTrade: { component: 'runningTrade', title: 'Running Trade Flow' },
  news: { component: 'news', title: 'Berita Pasar' },
  teknikal: { component: 'teknikal', title: 'Analisis Teknikal' },
  stockProfiler: { component: 'stockProfiler', title: 'Stock Profiler' },
  brokerProfiler: { component: 'brokerProfiler', title: 'Broker Profiler' },
  foreignRadar: { component: 'foreignRadar', title: 'Foreign Flow' },
  sid: { component: 'sid', title: 'SID & Scripless' },
  liveStream: { component: 'liveStream', title: 'Market Live' },
}

const STORAGE_KEY_WORKSPACES = 'tradewise_workspaces_v1'
const STORAGE_KEY_ACTIVE_WS = 'tradewise_active_workspace_v1'

const DEFAULT_WORKSPACES: Workspace[] = [
  { id: 'master', name: 'Screener Focus', preset: 'screener', symbol: 'BBCA', createdAt: 1 },
  { id: 'trading', name: 'Tape & Scalping', preset: 'trading', symbol: 'BBCA', createdAt: 2 },
  { id: 'broker', name: 'Bandarmologi', preset: 'broker', symbol: 'BBCA', createdAt: 3 },
  { id: 'portfolio', name: 'Portfolio & Fund', preset: 'portfolio', symbol: 'BBCA', createdAt: 4 },
]

function migrateWorkspaceNames(workspaces: Workspace[]): Workspace[] {
  return workspaces.map((workspace) => {
    if (workspace.id === 'master' && workspace.name === 'Master Overview' && workspace.preset === 'default') {
      return { ...workspace, name: 'Screener Focus', preset: 'screener' }
    }
    return workspace
  })
}

function loadInitialWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_WORKSPACES)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const workspaces = migrateWorkspaceNames(parsed)
        if (workspaces.some((workspace, index) => workspace !== parsed[index])) {
          localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(workspaces))
        }
        return workspaces
      }
    }
  } catch (e) {
    console.error('Failed to load workspaces from localStorage:', e)
  }
  return DEFAULT_WORKSPACES
}

function loadInitialActiveWsId(workspaces: Workspace[]): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_WS)
    if (saved && workspaces.some((w) => w.id === saved)) return saved
  } catch (e) {
    console.error('Failed to load active workspace from localStorage:', e)
  }
  return workspaces[0]?.id || 'master'
}

let globalDockviewApi: DockviewApi | null = null

type TerminalState = {
  selectedSymbol: string | null
  selectSymbol: (symbol: string) => void
  periodFrom: string
  periodTo: string
  setPeriod: (from: string, to: string) => void
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
  activePreset: LayoutPreset
  setActivePreset: (preset: LayoutPreset) => void
  setDockviewApi: (api: DockviewApi | null) => void
  activateTab: (tabId: string) => void
  addPanelInstance: (componentKey: string, title?: string, symbolOverride?: string) => void
  popoutPanel: (componentKey: string, symbol?: string) => void
  
  // Workspaces State
  workspaces: Workspace[]
  activeWorkspaceId: string
  createWorkspace: (name: string, preset: LayoutPreset) => void
  switchWorkspace: (id: string) => void
  deleteWorkspace: (id: string) => void
  renameWorkspace: (id: string, newName: string) => void
  saveCurrentWorkspaceState: () => void
}

export const useTerminalStore = create<TerminalState>((set, get) => {
  const initialWorkspaces = loadInitialWorkspaces()
  const initialActiveId = loadInitialActiveWsId(initialWorkspaces)
  const activeWs = initialWorkspaces.find((w) => w.id === initialActiveId) || initialWorkspaces[0]

  return {
    selectedSymbol: activeWs?.symbol || 'BBCA',
    selectSymbol: (symbol) => {
      const s = symbol.toUpperCase().trim()
      if (!s || get().selectedSymbol === s) return
      set({ selectedSymbol: s })
      get().saveCurrentWorkspaceState()
    },
    periodFrom: monthsAgo(3),
    periodTo: isoDate(new Date()),
    setPeriod: (from, to) => set({ periodFrom: from, periodTo: to }),
    helpOpen: false,
    setHelpOpen: (open) => set({ helpOpen: open }),
    activePreset: activeWs?.preset || 'screener',
    setActivePreset: (preset) => {
      set({ activePreset: preset })
      get().saveCurrentWorkspaceState()
    },
    setDockviewApi: (api) => {
      globalDockviewApi = api
    },
    activateTab: (tabId) => {
      const api = globalDockviewApi
      if (!api) return

      const existing = api.getPanel(tabId)
      if (existing) {
        existing.api.setActive()
      } else {
        // Re-create closed panel dynamically
        const cfg = PANEL_CONFIGS[tabId] || { component: tabId, title: tabId }
        api.addPanel({
          id: tabId,
          component: cfg.component,
          title: cfg.title,
        })
        api.getPanel(tabId)?.api.setActive()
      }
    },
    addPanelInstance: (componentKey, customTitle, symbolOverride) => {
      const api = globalDockviewApi
      if (!api) return

      const cfg = PANEL_CONFIGS[componentKey] || { component: componentKey, title: componentKey }
      const sym = symbolOverride || get().selectedSymbol || ''
      const panelCount = api.panels.length
      const instanceId = `${componentKey}_${Date.now()}`
      const title = customTitle || `${cfg.title} ${sym ? `[${sym}]` : `#${panelCount + 1}`}`

      api.addPanel({
        id: instanceId,
        component: cfg.component,
        title: title,
        params: { symbolOverride: sym },
      })
      api.getPanel(instanceId)?.api.setActive()
    },
    popoutPanel: (componentKey, symbol) => {
      const sym = symbol || get().selectedSymbol || 'BBCA'
      const popUrl = `${window.location.origin}${window.location.pathname}?popout=true&panel=${componentKey}&symbol=${sym}`
      window.open(popUrl, `Popout_${componentKey}_${Date.now()}`, 'width=1200,height=800,left=100,top=100,resizable=yes,scrollbars=yes')
    },

    // Workspaces implementation
    workspaces: initialWorkspaces,
    activeWorkspaceId: initialActiveId,

    createWorkspace: (name, preset) => {
      const newWs: Workspace = {
        id: `ws_${Date.now()}`,
        name: name.trim() || 'New Workspace',
        preset,
        symbol: get().selectedSymbol || 'BBCA',
        createdAt: Date.now(),
      }
      const updated = [...get().workspaces, newWs]
      set({ workspaces: updated, activeWorkspaceId: newWs.id, activePreset: preset })
      localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(updated))
      localStorage.setItem(STORAGE_KEY_ACTIVE_WS, newWs.id)
    },

    switchWorkspace: (id) => {
      const target = get().workspaces.find((w) => w.id === id)
      if (!target) return
      set({ activeWorkspaceId: target.id, activePreset: target.preset })
      if (target.symbol) set({ selectedSymbol: target.symbol })
      localStorage.setItem(STORAGE_KEY_ACTIVE_WS, target.id)
    },

    deleteWorkspace: (id) => {
      const list = get().workspaces
      if (list.length <= 1) return
      const updated = list.filter((w) => w.id !== id)
      let nextActiveId = get().activeWorkspaceId
      if (nextActiveId === id) {
        nextActiveId = updated[0].id
        set({ activePreset: updated[0].preset, selectedSymbol: updated[0].symbol || 'BBCA' })
      }
      set({ workspaces: updated, activeWorkspaceId: nextActiveId })
      localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(updated))
      localStorage.setItem(STORAGE_KEY_ACTIVE_WS, nextActiveId)
    },

    renameWorkspace: (id, newName) => {
      const trimmed = newName.trim()
      if (!trimmed) return
      const updated = get().workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w))
      set({ workspaces: updated })
      localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(updated))
    },

    saveCurrentWorkspaceState: () => {
      const activeId = get().activeWorkspaceId
      const currentSymbol = get().selectedSymbol
      const currentPreset = get().activePreset
      const updated = get().workspaces.map((w) =>
        w.id === activeId ? { ...w, preset: currentPreset, symbol: currentSymbol || w.symbol } : w
      )
      set({ workspaces: updated })
      localStorage.setItem(STORAGE_KEY_WORKSPACES, JSON.stringify(updated))
    },
  }
})
