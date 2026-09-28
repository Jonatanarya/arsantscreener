import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createCatalyst,
  deleteCatalyst,
  fetchCatalysts,
  updateCatalyst,
  type Catalyst,
  type CreateCatalystRequest,
} from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'

type Category = CreateCatalystRequest['category']
type Impact = CreateCatalystRequest['impact']
type Status = NonNullable<CreateCatalystRequest['status']>
type Confidence = CreateCatalystRequest['confidence']

const categoryLabel: Record<string, string> = {
  proyek: 'Proyek',
  ekspansi: 'Ekspansi',
  tenant: 'Tenant',
  pabrik: 'Pabrik',
  pemerintah: 'Pemerintah',
  makro: 'Makro',
  lainnya: 'Lainnya',
}

const statusLabel: Record<string, string> = {
  rumor: 'Rumor',
  confirmed: 'Confirmed',
  in_progress: 'Berjalan',
  completed: 'Selesai',
}

const impactColor = (impact: string) =>
  impact === 'bullish' ? 'var(--up)' : impact === 'bearish' ? 'var(--down)' : 'var(--text-dim)'

type FormState = {
  category: Category
  description: string
  impact: Impact
  expectedPeriod: string
  status: Status
  confidence: Confidence | ''
  sourceUrl: string
  sourceName: string
}

const emptyForm: FormState = {
  category: 'proyek',
  description: '',
  impact: 'bullish',
  expectedPeriod: '',
  status: 'rumor',
  confidence: '',
  sourceUrl: '',
  sourceName: '',
}

function CatalystForm({
  form,
  setForm,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  form: FormState
  setForm: (f: FormState) => void
  onSubmit: () => void
  onCancel?: () => void
  submitLabel: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 4, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })} style={{ fontSize: 11 }}>
          {Object.entries(categoryLabel).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value as Impact })} style={{ fontSize: 11 }}>
          <option value="bullish">Bullish</option>
          <option value="bearish">Bearish</option>
          <option value="netral">Netral</option>
        </select>
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Status })} style={{ fontSize: 11 }}>
          {Object.entries(statusLabel).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={form.confidence}
          onChange={(e) => setForm({ ...form, confidence: e.target.value as Confidence | '' })}
          style={{ fontSize: 11 }}
        >
          <option value="">Keyakinan?</option>
          <option value="rendah">Rendah</option>
          <option value="sedang">Sedang</option>
          <option value="tinggi">Tinggi</option>
        </select>
        <input
          value={form.expectedPeriod}
          onChange={(e) => setForm({ ...form, expectedPeriod: e.target.value })}
          placeholder="Perkiraan waktu (mis. 2027)"
          style={{ fontSize: 11, width: 140 }}
        />
      </div>
      <textarea
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        placeholder="Deskripsi katalis…"
        rows={2}
        style={{ fontSize: 12, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          value={form.sourceName}
          onChange={(e) => setForm({ ...form, sourceName: e.target.value })}
          placeholder="Nama sumber (opsional)"
          style={{ fontSize: 11, flex: 1, minWidth: 100 }}
        />
        <input
          value={form.sourceUrl}
          onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
          placeholder="URL sumber (opsional)"
          style={{ fontSize: 11, flex: 2, minWidth: 140 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {onCancel && (
          <button onClick={onCancel} style={{ fontSize: 11, cursor: 'pointer' }}>
            Batal
          </button>
        )}
        <button onClick={onSubmit} disabled={!form.description.trim()} style={{ fontSize: 11, cursor: 'pointer' }}>
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

function CatalystCard({ c, onEdit, onDelete }: { c: Catalyst; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ padding: 8, marginBottom: 6, border: '1px solid var(--border)', borderRadius: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-h)', fontWeight: 600, fontSize: 11 }}>{categoryLabel[c.category] ?? c.category}</span>
        <span style={{ color: impactColor(c.impact), fontWeight: 700, fontSize: 11 }}>{c.impact.toUpperCase()}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{statusLabel[c.status] ?? c.status}</span>
        {c.expectedPeriod && <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>· {c.expectedPeriod}</span>}
        {c.confidence && <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>· keyakinan {c.confidence}</span>}
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-dim)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '0 4px',
          }}
        >
          {c.addedBy === 'riset' ? '🔎 riset' : '✍ manual'}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={onEdit} style={{ fontSize: 10, cursor: 'pointer' }}>
          Edit
        </button>
        <button onClick={onDelete} style={{ fontSize: 10, cursor: 'pointer' }}>
          Hapus
        </button>
      </div>
      <div style={{ fontSize: 12 }}>{c.description}</div>
      {c.sourceName || c.sourceUrl ? (
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
          Sumber:{' '}
          {c.sourceUrl ? (
            <a href={c.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text-dim)' }}>
              {c.sourceName || c.sourceUrl}
            </a>
          ) : (
            c.sourceName
          )}
        </div>
      ) : null}
    </div>
  )
}

export function FutureEarningsPanel() {
  const symbol = useTerminalStore((s) => s.selectedSymbol)
  const queryClient = useQueryClient()
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<FormState>(emptyForm)

  const { data } = useQuery({
    queryKey: ['catalysts', symbol],
    queryFn: () => fetchCatalysts(symbol!),
    enabled: !!symbol,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['catalysts', symbol] })

  const addMutation = useMutation({
    mutationFn: createCatalyst,
    onSuccess: () => {
      invalidate()
      setShowAddForm(false)
      setAddForm(emptyForm)
    },
  })

  const editMutation = useMutation({
    mutationFn: ({ id, req }: { id: number; req: FormState }) =>
      updateCatalyst(id, {
        category: req.category,
        description: req.description,
        impact: req.impact,
        expectedPeriod: req.expectedPeriod || undefined,
        status: req.status,
        confidence: req.confidence || undefined,
        sourceUrl: req.sourceUrl || undefined,
        sourceName: req.sourceName || undefined,
      }),
    onSuccess: () => {
      invalidate()
      setEditingId(null)
    },
  })

  const deleteMutation = useMutation({ mutationFn: deleteCatalyst, onSuccess: invalidate })

  if (!symbol) {
    return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat Future Earnings.</div>
  }

  const catalysts = data ?? []
  const bullishCount = catalysts.filter((c) => c.impact === 'bullish').length
  const bearishCount = catalysts.filter((c) => c.impact === 'bearish').length

  const startEdit = (c: Catalyst) => {
    setEditingId(c.id)
    setEditForm({
      category: c.category as Category,
      description: c.description,
      impact: c.impact as Impact,
      expectedPeriod: c.expectedPeriod ?? '',
      status: c.status as Status,
      confidence: (c.confidence as Confidence) ?? '',
      sourceUrl: c.sourceUrl ?? '',
      sourceName: c.sourceName ?? '',
    })
  }

  return (
    <div style={{ padding: 8, height: '100%', overflowY: 'auto', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ color: 'var(--text-h)', fontWeight: 600 }}>Future Earnings — {symbol}</span>
      </div>
      <div style={{ color: 'var(--text-dim)', marginBottom: 8 }}>
        Katalis forward-looking (proyek/ekspansi/tenant/pabrik/kebijakan pemerintah) untuk proyeksi ~2 tahun ke depan — pelengkap
        panel Fundamental agar tidak terjebak value trap. Minta saya riset katalis terbaru kapan saja lewat chat.
      </div>

      {catalysts.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <span style={{ color: 'var(--up)' }}>{bullishCount} bullish</span>
          {', '}
          <span style={{ color: 'var(--down)' }}>{bearishCount} bearish</span>
          {' dari '}
          {catalysts.length} katalis tercatat.
        </div>
      )}

      {catalysts.length === 0 && !showAddForm && (
        <div style={{ color: 'var(--text-dim)', marginBottom: 10 }}>Belum ada katalis tercatat untuk simbol ini.</div>
      )}

      {catalysts.map((c) =>
        editingId === c.id ? (
          <CatalystForm
            key={c.id}
            form={editForm}
            setForm={setEditForm}
            onCancel={() => setEditingId(null)}
            onSubmit={() => editMutation.mutate({ id: c.id, req: editForm })}
            submitLabel="Simpan"
          />
        ) : (
          <CatalystCard key={c.id} c={c} onEdit={() => startEdit(c)} onDelete={() => deleteMutation.mutate(c.id)} />
        ),
      )}

      {showAddForm ? (
        <CatalystForm
          form={addForm}
          setForm={setAddForm}
          onCancel={() => setShowAddForm(false)}
          onSubmit={() =>
            addMutation.mutate({
              symbol,
              category: addForm.category,
              description: addForm.description,
              impact: addForm.impact,
              expectedPeriod: addForm.expectedPeriod || undefined,
              status: addForm.status,
              confidence: addForm.confidence || undefined,
              sourceUrl: addForm.sourceUrl || undefined,
              sourceName: addForm.sourceName || undefined,
              addedBy: 'manual',
            })
          }
          submitLabel="Simpan Katalis"
        />
      ) : (
        <button onClick={() => setShowAddForm(true)} style={{ fontSize: 11, cursor: 'pointer' }}>
          + Tambah Katalis
        </button>
      )}
    </div>
  )
}
