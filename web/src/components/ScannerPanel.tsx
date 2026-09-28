import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  type PaginationState,
  useReactTable,
} from '@tanstack/react-table'
import { fetchScan, type ScanRow } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'

const fmtNum = (n?: number | null) =>
  n == null ? '—' : n.toLocaleString('id-ID', { maximumFractionDigits: 0 })

const phaseColor = (type?: string) => (type === 'AKUMULASI' ? 'var(--up)' : type === 'DISTRIBUSI' ? 'var(--down)' : 'var(--text-dim)')
const biasColor = (bias?: string) => (bias === 'BULLISH' ? 'var(--up)' : bias === 'BEARISH' ? 'var(--down)' : 'var(--text-dim)')
const MIN_HISTORY_DAYS = 20
const MIN_AVERAGE_TURNOVER = 1_000_000_000

function dataReadiness(row: ScanRow) {
  if (row.close == null || !row.date) return { ready: false, reason: 'Harga harian belum tersedia' }
  if ((row.historyDays ?? 0) < MIN_HISTORY_DAYS) return { ready: false, reason: `Histori baru ${row.historyDays ?? 0} hari` }
  if ((row.averageTurnover ?? 0) < MIN_AVERAGE_TURNOVER) return { ready: false, reason: 'Nilai transaksi rata-rata di bawah Rp1 miliar' }
  return { ready: true, reason: 'Harga, histori, dan likuiditas memenuhi batas minimum' }
}

function scoreReason(row: ScanRow) {
  const parts: string[] = []
  if ((row.scoreLiq ?? 0) > 0) parts.push(`Likuiditas ${row.scoreLiq}`)
  if ((row.scoreTech ?? 0) > 0) parts.push(`Teknikal ${row.scoreTech}`)
  if ((row.scorePva ?? 0) > 0) parts.push(`PVA ${row.scorePva}`)
  if (row.phase?.type) parts.push(row.phase.type)
  if (row.pvaBias) parts.push(`PVA ${row.pvaBias}`)
  return parts.length ? parts.join(' · ') : 'Skor menunggu data analisis tambahan'
}

const CATEGORY_LABEL_MAP: Record<string, { label: string; bg: string; color: string; border: string }> = {
  bluechip: { label: 'BLUECHIP', bg: 'var(--cyan-soft)', color: 'var(--cyan)', border: 'var(--cyan)' },
  second: { label: '2ND LINER', bg: 'rgba(46,204,113,0.12)', color: 'var(--up)', border: 'var(--up)' },
  third: { label: '3RD LINER', bg: 'rgba(239,68,68,0.12)', color: 'var(--down)', border: 'var(--down)' },
  unknown: { label: 'BELUM DIKLASIFIKASI', bg: 'rgba(148,163,184,0.1)', color: 'var(--text-dim)', border: 'var(--border)' },
}

function ScoreProgressBar({ value, label }: { value?: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0))
  const color = v >= 70 ? 'var(--up)' : v >= 50 ? 'var(--amber)' : 'var(--down)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 90 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#1e222d', overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${v}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ color, fontWeight: 700, fontSize: 10, minWidth: 20, textAlign: 'right' }}>{v}</span>
      {label && <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>{label}</span>}
    </div>
  )
}

const columnHelper = createColumnHelper<ScanRow>()

const columns = [
  columnHelper.accessor('symbol', {
    header: 'TICKER',
    cell: (info) => <span style={{ color: 'var(--amber)', fontWeight: 800 }}>{info.getValue()}</span>,
  }),
  columnHelper.accessor('category', {
    header: 'KATEGORI',
    cell: (info) => {
      const catKey = (info.getValue() || 'unknown').toLowerCase()
      const conf = CATEGORY_LABEL_MAP[catKey] ?? CATEGORY_LABEL_MAP.unknown
      return (
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            padding: '1px 5px',
            borderRadius: 2,
            background: conf.bg,
            color: conf.color,
            border: `1px solid ${conf.border}`,
            textTransform: 'uppercase',
          }}
        >
          {conf.label}
        </span>
      )
    },
  }),
  columnHelper.accessor('close', {
    header: 'LAST',
    cell: (info) => <span style={{ color: 'var(--text-h)', fontWeight: 600 }}>{fmtNum(info.getValue())}</span>,
  }),
  columnHelper.accessor('changePct', {
    header: 'CHG %',
    cell: (info) => {
      const v = info.getValue()
      if (v == null) return '—'
      const color = v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-dim)'
      return (
        <span style={{ color, fontWeight: 700 }}>
          {v > 0 ? '+' : ''}
          {v.toFixed(2)}%
        </span>
      )
    },
  }),
  columnHelper.accessor('scoreAccum', {
    header: 'SKOR AKUMULASI',
    cell: (info) => <div title={scoreReason(info.row.original)}><ScoreProgressBar value={info.getValue() ?? 0} /><small style={{display:'block',color:'var(--text-dim)',fontSize:8,marginTop:2,maxWidth:150}}>{scoreReason(info.row.original)}</small></div>,
  }),
  columnHelper.accessor((row) => row.phase?.type ?? '', {
    id: 'phase',
    header: 'FASE & FLOW',
    cell: (info) => {
      const phase = info.row.original.phase
      if (!phase) return <span style={{ color: 'var(--text-dim)' }}>—</span>
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ color: phaseColor(phase.type), fontWeight: 700 }}>
            {phase.type} <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>({phase.actor})</span>
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{fmtRp(phase.flow)}</span>
        </div>
      )
    },
  }),
  columnHelper.accessor('pvaBias', {
    header: 'PVA',
    cell: (info) => {
      const bias = info.getValue()
      if (!bias) return <span style={{ color: 'var(--text-dim)' }}>—</span>
      return (
        <span style={{ color: biasColor(bias), fontWeight: 600 }}>
          {bias} <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>({info.row.original.pvaScore})</span>
        </span>
      )
    },
  }),
  columnHelper.accessor('tags', {
    header: 'TAGS & SINYAL',
    cell: (info) => {
      const tags = info.getValue() ?? []
      if (!tags.length) return <span style={{ color: 'var(--text-dim)' }}>—</span>
      return (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tags.slice(0, 3).map((tag, idx) => (
            <span
              key={idx}
              style={{
                fontSize: 9,
                padding: '1px 4px',
                borderRadius: 2,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border)',
                color: 'var(--text-h)',
                whiteSpace: 'nowrap',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )
    },
  }),
]

export function ScannerPanel() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['scan'],
    queryFn: fetchScan,
    staleTime: 30_000,
  })
  const selectedSymbol = useTerminalStore((s) => s.selectedSymbol)
  const selectSymbol = useTerminalStore((s) => s.selectSymbol)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'scoreAccum', desc: true }])
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [selectedProfile, setSelectedProfile] = useState<string>('ALL')
  const [searchText, setSearchText] = useState<string>('')
  const [readyOnly, setReadyOnly] = useState(true)
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })

  useEffect(() => setPagination((value) => ({ ...value, pageIndex: 0 })), [selectedCategory, selectedProfile, searchText, readyOnly])

  const filteredData = useMemo(() => {
    let list = data ?? []
    if (readyOnly) list = list.filter((row) => dataReadiness(row).ready)
    if (selectedCategory !== 'ALL') {
      list = list.filter((r) => (r.category || 'unknown').toLowerCase() === selectedCategory.toLowerCase())
    }
    if (selectedProfile !== 'ALL') {
      if (selectedProfile === 'scalp') list = list.filter((r) => (r.fitScalp ?? 0) >= 60)
      else if (selectedProfile === 'daytrade') list = list.filter((r) => (r.fitDaytrade ?? 0) >= 60)
      else if (selectedProfile === 'swing') list = list.filter((r) => (r.fitSwing ?? 0) >= 60)
    }
    if (searchText.trim()) {
      const q = searchText.trim().toUpperCase()
      list = list.filter(
        (r) =>
          r.symbol.toUpperCase().includes(q) ||
          (r.name || '').toUpperCase().includes(q) ||
          (r.tags ?? []).some((t) => t.toUpperCase().includes(q)),
      )
    }
    return list
  }, [data, selectedCategory, selectedProfile, searchText, readyOnly])

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)', fontSize: 11 }}>
      {/* Arsant Screener Sub Header */}
      <div
        style={{
          padding: '5px 8px',
          background: 'var(--panel-header)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10, letterSpacing: 0.5 }}>
            [ SCAN - MARKET SCANNER &amp; SCREENER ]
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>
            ● {filteredData.length} / {data?.length ?? 0} MATCHES
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="text"
            placeholder="Cari ticker / sinyal..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--text-h)',
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 2,
              width: 120,
            }}
          />
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--cyan)',
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 2,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {isRefetching ? '⟳...' : '⟳ REFRESH'}
          </button>
        </div>
      </div>

      {/* Category & Profile Strip */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '4px 8px',
          background: 'rgba(0,0,0,0.3)',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto',
          alignItems: 'center',
        }}
      >
        {/* Category Pills */}
        <button onClick={() => setReadyOnly((value) => !value)} title="Minimal 20 hari histori dan rata-rata nilai transaksi Rp1 miliar" style={{background:readyOnly?'var(--up-bg)':'transparent',color:readyOnly?'var(--up)':'var(--text-dim)',border:'1px solid var(--border)',borderRadius:2,padding:'2px 7px',fontSize:9,fontWeight:800,cursor:'pointer',whiteSpace:'nowrap'}}>✓ SIAP ANALISIS</button>
        <div style={{ width: 1, height: 14, background: 'var(--border)' }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 9, fontWeight: 700 }}>KATEGORI:</span>
          {['ALL', 'bluechip', 'second', 'third'].map((cat) => {
            const isSelected = selectedCategory === cat
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  color: isSelected ? '#000' : 'var(--text-dim)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  padding: '2px 6px',
                  fontSize: 9,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {cat === 'ALL' ? 'SEMUA' : cat}
              </button>
            )
          })}
        </div>

        <div style={{ width: 1, height: 14, background: 'var(--border)' }} />

        {/* Profile Fit Pills */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 9, fontWeight: 700 }}>PROFIL:</span>
          {[
            { id: 'ALL', label: 'SEMUA' },
            { id: 'scalp', label: '⚡ SCALPING' },
            { id: 'daytrade', label: '☀️ DAY TRADE' },
            { id: 'swing', label: '📈 SWING' },
          ].map((p) => {
            const isSelected = selectedProfile === p.id
            return (
              <button
                key={p.id}
                onClick={() => setSelectedProfile(p.id)}
                style={{
                  background: isSelected ? 'var(--cyan)' : 'transparent',
                  color: isSelected ? '#000' : 'var(--text-dim)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  padding: '2px 6px',
                  fontSize: 9,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Table Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && <div style={{ color: 'var(--text-dim)', padding: 12 }}>Memindai watchlist &amp; screener…</div>}
        {isError && <div style={{ color: 'var(--down)', padding: 12 }}>Gagal memuat hasil screener.</div>}

        {!isLoading && !isError && filteredData.length === 0 && (
          <div style={{ color: 'var(--text-dim)', padding: 16, lineHeight: 1.6 }}>
            {readyOnly ? 'Belum ada emiten yang memenuhi batas data dan likuiditas.' : 'Belum ada data Screener yang cocok.'}
            <br />
            {readyOnly ? 'Kriteria: harga tersedia, minimal 20 hari histori, dan rata-rata nilai transaksi Rp1 miliar per hari.' : 'Periksa kembali filter atau tunggu pembaruan data berikutnya.'}
          </div>
        )}

        {filteredData.length > 0 && (
          <table className="bbg-table">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  {hg.headers.map((h) => {
                    const sort = h.column.getIsSorted()
                    return (
                      <th
                        key={h.id}
                        onClick={h.column.getToggleSortingHandler()}
                        style={{
                          textAlign: 'left',
                          padding: '5px 8px',
                          color: 'var(--text-dim)',
                          fontWeight: 400,
                          cursor: 'pointer',
                          userSelect: 'none',
                          whiteSpace: 'nowrap',
                          fontSize: 10,
                        }}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sort === 'asc' ? ' ▲' : sort === 'desc' ? ' ▼' : ''}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const isSelected = row.original.symbol === selectedSymbol
                return (
                  <tr
                    key={row.id}
                    onClick={() => selectSymbol(row.original.symbol)}
                    onDoubleClick={() => window.location.assign(`/stock/${row.original.symbol}`)}
                    title={`${dataReadiness(row.original).reason} · ${scoreReason(row.original)} · Klik untuk memilih; klik dua kali untuk membuka detail`}
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(255, 157, 0, 0.12)' : undefined,
                      borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} style={{ padding: '5px 8px' }}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {filteredData.length > pagination.pageSize && <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 8px',borderTop:'1px solid var(--border)',background:'var(--panel-header)',fontSize:10}}><span>Halaman {table.getState().pagination.pageIndex+1} dari {table.getPageCount()} · {filteredData.length} emiten</span><div style={{display:'flex',gap:5}}><button disabled={!table.getCanPreviousPage()} onClick={()=>table.previousPage()}>← Sebelumnya</button><button disabled={!table.getCanNextPage()} onClick={()=>table.nextPage()}>Berikutnya →</button></div></div>}
    </div>
  )
}
