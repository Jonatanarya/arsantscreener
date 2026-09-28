import { useState } from 'react'
import { useTerminalStore, type LayoutPreset, type Workspace } from '../store/useTerminalStore'

export function WorkspaceModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const workspaces = useTerminalStore((s) => s.workspaces)
  const activeWorkspaceId = useTerminalStore((s) => s.activeWorkspaceId)
  const createWorkspace = useTerminalStore((s) => s.createWorkspace)
  const switchWorkspace = useTerminalStore((s) => s.switchWorkspace)
  const deleteWorkspace = useTerminalStore((s) => s.deleteWorkspace)
  const renameWorkspace = useTerminalStore((s) => s.renameWorkspace)

  const [newWsName, setNewWsName] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<LayoutPreset>('screener')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  if (!isOpen) return null

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWsName.trim()) return
    createWorkspace(newWsName.trim(), selectedPreset)
    setNewWsName('')
    onClose()
  }

  const handleSaveRename = (id: string) => {
    if (editingName.trim()) {
      renameWorkspace(id, editingName.trim())
    }
    setEditingId(null)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 520,
          maxWidth: '92vw',
          background: 'var(--panel)',
          border: '1px solid var(--border-bright)',
          borderRadius: 6,
          padding: 16,
          boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 800, fontSize: 13, letterSpacing: 0.5 }}>
              📁 MANAJEMEN WORKSPACE
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}
          >
            ✕
          </button>
        </div>

        {/* Create New Workspace Form */}
        <form
          onSubmit={handleCreate}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: 10,
            marginBottom: 14,
          }}
        >
          <div style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: 10, marginBottom: 8, letterSpacing: 0.4 }}>
            + BUAT WORKSPACE BARU
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: 8 }}>
            <input
              type="text"
              placeholder="Nama Workspace (mis. Scalping BBCA)..."
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              style={{
                background: 'var(--panel)',
                color: 'var(--text-h)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '4px 8px',
                fontSize: 11,
              }}
            />
            <select
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value as LayoutPreset)}
              style={{
                background: 'var(--panel)',
                color: 'var(--text-h)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '4px 6px',
                fontSize: 10,
              }}
            >
              <option value="screener">Layout: Screener Focus</option>
              <option value="default">Layout: Overview</option>
              <option value="trading">Layout: Tape</option>
              <option value="broker">Layout: Broker</option>
              <option value="portfolio">Layout: Portfolio</option>
              <option value="blank">Layout: Kosong (Blank)</option>
            </select>
            <button
              type="submit"
              style={{
                background: 'var(--accent)',
                color: '#000',
                border: 'none',
                borderRadius: 3,
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Simpan
            </button>
          </div>
        </form>

        {/* Existing Workspaces List */}
        <div style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, marginBottom: 6 }}>
          DAFTAR WORKSPACE TERSIMPAN ({workspaces.length}):
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {workspaces.map((ws: Workspace) => {
            const isActive = ws.id === activeWorkspaceId
            const isEditing = editingId === ws.id

            return (
              <div
                key={ws.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: isActive ? 'var(--accent-soft)' : 'var(--bg)',
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: isActive ? 'var(--accent)' : 'var(--border-bright)',
                    }}
                  />

                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => handleSaveRename(ws.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(ws.id)
                      }}
                      autoFocus
                      style={{
                        background: 'var(--panel)',
                        color: 'var(--text-h)',
                        border: '1px solid var(--accent)',
                        borderRadius: 2,
                        padding: '2px 6px',
                        fontSize: 11,
                        flex: 1,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        color: isActive ? 'var(--accent)' : 'var(--text-h)',
                        fontWeight: 700,
                        fontSize: 11.5,
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        switchWorkspace(ws.id)
                        onClose()
                      }}
                    >
                      {ws.name}
                    </span>
                  )}

                  <span className="bbg-badge" style={{ background: 'var(--panel-header)', color: 'var(--cyan)' }}>
                    {ws.preset.toUpperCase()}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!isActive && (
                    <button
                      onClick={() => {
                        switchWorkspace(ws.id)
                        onClose()
                      }}
                      style={{
                        background: 'transparent',
                        color: 'var(--cyan)',
                        border: '1px solid var(--cyan)',
                        borderRadius: 2,
                        padding: '2px 6px',
                        fontSize: 9.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Buka
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setEditingId(ws.id)
                      setEditingName(ws.name)
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11 }}
                    title="Rename workspace"
                  >
                    ✏️
                  </button>

                  {workspaces.length > 1 && (
                    <button
                      onClick={() => deleteWorkspace(ws.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--down)', cursor: 'pointer', fontSize: 12 }}
                      title="Hapus workspace"
                    >
                      🗑
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
