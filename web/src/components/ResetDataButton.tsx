import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { resetAllData, type ResetDataSummary } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'

// Konfirmasi inline (bukan window.confirm/prompt) — konsisten dgn tema
// terminal dan bisa diverifikasi lewat automation, sama seperti pola yang
// dipakai PortfolioPanel utk aksi tutup posisi.
export function ResetDataButton() {
  const [confirming, setConfirming] = useState(false)
  const [summary, setSummary] = useState<ResetDataSummary | null>(null)
  const queryClient = useQueryClient()
  const selectSymbol = useTerminalStore((s) => s.selectSymbol)

  const mutation = useMutation({
    mutationFn: resetAllData,
    onSuccess: (res) => {
      setConfirming(false)
      setSummary(res)
      selectSymbol('')
      queryClient.clear() // buang semua cache — data lama sudah tidak ada di server
    },
  })

  // Ringkasan hasil: dulu tombolnya diam saja setelah sukses, jadi tidak ada
  // cara memastikan tabel yang dimaksud benar-benar ikut terhapus.
  if (summary) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        <span style={{ color: 'var(--up)' }}>
          ✔ {summary.tableCount} tabel dikosongkan, {summary.totalRows.toLocaleString('id-ID')} baris terhapus
        </span>
        <button
          onClick={() => setSummary(null)}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 3, padding: '3px 8px', cursor: 'pointer' }}
        >
          Tutup
        </button>
      </div>
    )
  }

  if (confirming) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        <span style={{ color: 'var(--down)' }}>
          Kosongkan SEMUA tabel database? Tidak bisa dibatalkan.
        </span>
        {mutation.isError && (
          <span style={{ color: 'var(--down)' }}>Gagal: {(mutation.error as Error).message}</span>
        )}
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          style={{ background: 'var(--down)', color: '#fff', border: 'none', borderRadius: 3, padding: '3px 8px', cursor: 'pointer' }}
        >
          {mutation.isPending ? 'Menghapus…' : 'Ya, hapus semua'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={mutation.isPending}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 3, padding: '3px 8px', cursor: 'pointer' }}
        >
          Batal
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Kosongkan semua data di database (struktur tabel tetap)"
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        color: 'var(--text-dim)',
        borderRadius: 3,
        padding: '3px 8px',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      🗑 Reset Data
    </button>
  )
}
