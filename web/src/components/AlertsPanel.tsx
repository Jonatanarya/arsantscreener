import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { alertsWebSocketUrl, fetchAccountSession, fetchAlerts, fetchUserAlerts, fetchUserAlertSettings, fetchUserWatchlists, updateUserAlertSettings, type Alert, type UserAlertSettings } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'

type Status = 'connecting' | 'open' | 'closed' | 'error'

const statusColor: Record<Status, string> = {
  connecting: 'var(--text-dim)',
  open: 'var(--up)',
  closed: 'var(--text-dim)',
  error: 'var(--down)',
}

const statusLabel: Record<Status, string> = {
  connecting: 'menyambungkan…',
  open: 'live',
  closed: 'terputus',
  error: 'gagal',
}

const biasColor = (bias: string) =>
  bias === 'BULLISH' ? 'var(--up)' : bias === 'BEARISH' ? 'var(--down)' : 'var(--text-dim)'

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

const MAX_ALERTS = 100

const notifSupported = typeof window !== 'undefined' && 'Notification' in window
type NotifPermission = NotificationPermission | 'unsupported'

// Notifikasi desktop hanya masuk akal saat tab tidak sedang dilihat — kalau
// panel Alerts sudah kelihatan di layar, baris baru yang muncul sudah cukup.
function notifyAlert(alert: Alert, onClick: () => void) {
  const n = new Notification(`${alert.symbol}: ${alert.oldBias || '—'} → ${alert.newBias}`, {
    body: `Skor ${alert.score} · Arsant Screener`,
    tag: `outlook-alert-${alert.symbol}`,
  })
  n.onclick = () => {
    window.focus()
    onClick()
    n.close()
  }
}

function AlertRow({ alert, isNew, onSelect }: { alert: Alert; isNew: boolean; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer',
        background: isNew ? 'rgba(245,166,35,0.10)' : undefined,
      }}
    >
      <span style={{ color: 'var(--text-h)', fontWeight: 600, minWidth: 64 }}>{alert.symbol}</span>
      <span style={{ color: 'var(--text-dim)' }}>{alert.oldBias || '—'}</span>
      <span style={{ color: 'var(--text-dim)' }}>→</span>
      <span style={{ color: biasColor(alert.newBias), fontWeight: 700 }}>{alert.newBias}</span>
      <span style={{ color: 'var(--text-dim)' }}>(skor {alert.score})</span>
      <span style={{ flex: 1 }} />
      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{fmtTime(alert.createdAt)}</span>
    </div>
  )
}

export function AlertsPanel() {
  const queryClient = useQueryClient()
  const selectSymbol = useTerminalStore((s) => s.selectSymbol)
  const [status, setStatus] = useState<Status>('connecting')
  const [live, setLive] = useState<Alert[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [draft, setDraft] = useState<UserAlertSettings>({ minScore: 0, bullish: true, bearish: true, netral: true })
  const seenIds = useRef(new Set<number>())
  const [permission, setPermission] = useState<NotifPermission>(
    notifSupported ? Notification.permission : 'unsupported',
  )

  const { data: session } = useQuery({
    queryKey: ['account-session'],
    queryFn: fetchAccountSession,
    staleTime: 60_000,
  })
  const { data: watchlists } = useQuery({
    queryKey: ['user-watchlists'],
    queryFn: fetchUserWatchlists,
    enabled: session?.authenticated === true,
  })
  const { data: alertSettings } = useQuery({
    queryKey: ['user-alert-settings'],
    queryFn: fetchUserAlertSettings,
    enabled: session?.authenticated === true,
  })
  const watchedSymbols = useMemo(
    () => new Set(watchlists?.lists.flatMap((list) => list.symbols) ?? []),
    [watchlists],
  )
  const saveSettings = useMutation({
    mutationFn: updateUserAlertSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(['user-alert-settings'], saved)
      queryClient.invalidateQueries({ queryKey: ['alerts', 'history'] })
      setShowSettings(false)
    },
  })

  useEffect(() => {
    if (alertSettings) setDraft(alertSettings)
  }, [alertSettings])

  const passesSettings = (alert: Alert) => {
    if (!session?.authenticated) return true
    const settings = alertSettings ?? draft
    if (Math.abs(alert.score) < settings.minScore) return false
    if (alert.newBias === 'BULLISH') return settings.bullish
    if (alert.newBias === 'BEARISH') return settings.bearish
    return settings.netral
  }

  const requestPermission = async () => {
    if (!notifSupported) return
    setPermission(await Notification.requestPermission())
  }

  const { data: history } = useQuery({
    queryKey: ['alerts', 'history', session?.authenticated === true ? 'personal' : 'market'],
    queryFn: () => session?.authenticated ? fetchUserAlerts(50) : fetchAlerts(50),
    enabled: session != null,
  })

  useEffect(() => {
    if (session == null) return
    const ws = new WebSocket(alertsWebSocketUrl())
    ws.onopen = () => setStatus('open')
    ws.onerror = () => setStatus('error')
    ws.onclose = () => setStatus('closed')
    ws.onmessage = (ev) => {
      const alert: Alert = JSON.parse(ev.data)
      if (session?.authenticated && !watchedSymbols.has(alert.symbol)) return
      if (!passesSettings(alert)) return
      seenIds.current.add(alert.id)
      setLive((prev) => [alert, ...prev].slice(0, MAX_ALERTS))
      if (notifSupported && Notification.permission === 'granted' && document.hidden) {
        notifyAlert(alert, () => selectSymbol(alert.symbol))
      }
    }
    return () => ws.close()
  }, [selectSymbol, session, watchedSymbols, alertSettings])

  useEffect(() => {
    if (session?.authenticated) {
      setLive((items) => items.filter((alert) => watchedSymbols.has(alert.symbol)))
    }
  }, [session?.authenticated, watchedSymbols])

  const historyOnly = (history ?? []).filter((a) => !seenIds.current.has(a.id))
  const combined = [...live, ...historyOnly].slice(0, MAX_ALERTS)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px' }}>
        <span style={{ color: 'var(--text-h)', fontWeight: 600 }}>{session?.authenticated ? 'Alert Watchlist' : 'Alerts Pasar'}</span>
        <span style={{ color: statusColor[status] }}>● {statusLabel[status]}</span>
        <span style={{ flex: 1 }} />
        {session?.authenticated && (
          <button
            onClick={() => setShowSettings((open) => !open)}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-h)', fontSize: 11, cursor: 'pointer' }}
          >
            ⚙ Filter
          </button>
        )}
        {permission === 'default' && (
          <button
            onClick={requestPermission}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text-h)',
              fontSize: 11,
              padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            🔔 Aktifkan notifikasi desktop
          </button>
        )}
        {permission === 'granted' && (
          <span style={{ color: 'var(--up)', fontSize: 11 }}>🔔 notifikasi desktop aktif</span>
        )}
        {permission === 'denied' && (
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>🔕 notifikasi diblokir browser</span>
        )}
      </div>
      {session?.authenticated && showSettings && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '6px 8px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
          <label style={{ color: 'var(--text-dim)' }}>
            Skor minimum{' '}
            <input
              type="number"
              min={0}
              max={100}
              value={draft.minScore}
              onChange={(e) => setDraft((value) => ({ ...value, minScore: Math.min(100, Math.max(0, Number(e.target.value))) }))}
              style={{ width: 42, background: 'var(--panel-header)', color: 'var(--text-h)', border: '1px solid var(--border)' }}
            />
          </label>
          {(['bullish', 'bearish', 'netral'] as const).map((bias) => (
            <label key={bias} style={{ color: biasColor(bias.toUpperCase()), cursor: 'pointer' }}>
              <input type="checkbox" checked={draft[bias]} onChange={(e) => setDraft((value) => ({ ...value, [bias]: e.target.checked }))} />{' '}
              {bias.toUpperCase()}
            </label>
          ))}
          <button
            disabled={saveSettings.isPending || (!draft.bullish && !draft.bearish && !draft.netral)}
            onClick={() => saveSettings.mutate(draft)}
            style={{ background: 'var(--accent)', border: 0, color: '#111', fontWeight: 700, fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}
          >
            {saveSettings.isPending ? 'MENYIMPAN…' : 'SIMPAN'}
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {combined.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', padding: 16 }}>
            {session?.authenticated
              ? watchedSymbols.size === 0
                ? 'Watchlist masih kosong. Tambahkan saham untuk menerima alert pribadi.'
                : 'Belum ada perubahan bias pada saham di watchlist.'
              : 'Belum ada perubahan bias tercatat.'}
          </div>
        ) : (
          combined.map((a) => (
            <AlertRow key={a.id} alert={a} isNew={live.some((l) => l.id === a.id)} onSelect={() => selectSymbol(a.symbol)} />
          ))
        )}
      </div>
    </div>
  )
}
