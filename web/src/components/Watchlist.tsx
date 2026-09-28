import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { addUserWatchlistItem, createUserWatchlist, deleteUserWatchlist, deleteUserWatchlistItem, fetchAccountSession, fetchSymbols, fetchUserWatchlists, renameUserWatchlist, type WatchlistItem } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'

const fmtNum = (n?: number | null, digits = 0) =>
  n == null ? '—' : n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const fmtVolume = (n?: number | null) => {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

const columnHelper = createColumnHelper<WatchlistItem>()

const columns = [
  columnHelper.accessor('symbol', {
    header: 'TICKER',
    cell: (info) => <span style={{ color: 'var(--accent)', fontWeight: 800 }}>{info.getValue()}</span>,
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
  columnHelper.accessor('volume', {
    header: 'VOL',
    cell: (info) => <span style={{ color: 'var(--text-dim)' }}>{fmtVolume(info.getValue())}</span>,
  }),
  columnHelper.accessor('date', {
    header: 'DATE',
    cell: (info) => <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{info.getValue() ?? '—'}</span>,
  }),
]

export function Watchlist() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['symbols'],
    queryFn: fetchSymbols,
  })
  const selectedSymbol = useTerminalStore((s) => s.selectedSymbol)
  const selectSymbol = useTerminalStore((s) => s.selectSymbol)
  const [filterText, setFilterText] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 50
  const [activeList, setActiveList] = useState('Pantauan Utama')
  const [newSymbol, setNewSymbol] = useState('')
  const [showListManager, setShowListManager] = useState(false)
  const [listName, setListName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const session = useQuery({queryKey:['account-session'],queryFn:fetchAccountSession,staleTime:60_000})
  const personal = useQuery({queryKey:['user-watchlists'],queryFn:fetchUserWatchlists,enabled:session.data?.authenticated===true})
  const personalSymbols = useMemo(
    () => personal.data?.lists.find((list) => list.name === activeList)?.symbols ?? [],
    [activeList, personal.data?.lists],
  )
  const addMutation = useMutation({mutationFn:()=>addUserWatchlistItem(newSymbol.trim().toUpperCase(),activeList),onSuccess:()=>{setNewSymbol('');queryClient.invalidateQueries({queryKey:['user-watchlists']})}})
  const removeMutation = useMutation({mutationFn:(symbol:string)=>deleteUserWatchlistItem(symbol,activeList),onSuccess:()=>queryClient.invalidateQueries({queryKey:['user-watchlists']})})
  const createListMutation = useMutation({mutationFn:()=>createUserWatchlist(listName.trim()),onSuccess:(created)=>{setActiveList(created.name);setListName('');queryClient.invalidateQueries({queryKey:['user-watchlists']})}})
  const renameListMutation = useMutation({mutationFn:()=>renameUserWatchlist(activeList,listName.trim()),onSuccess:(renamed)=>{setActiveList(renamed.name);setListName('');queryClient.invalidateQueries({queryKey:['user-watchlists']})}})
  const deleteListMutation = useMutation({mutationFn:()=>deleteUserWatchlist(activeList),onSuccess:()=>{setActiveList('Pantauan Utama');setConfirmDelete(false);queryClient.invalidateQueries({queryKey:['user-watchlists']})}})

  useEffect(() => {
    setConfirmDelete(false)
  }, [activeList])

  const filteredData = useMemo(
    () => {
      const query = filterText.trim().toUpperCase()
      return (data ?? []).filter((item) => {
        const matchesQuery = !query || item.symbol.toUpperCase().includes(query) || (item.name ?? '').toUpperCase().includes(query)
        const inActiveList = !session.data?.authenticated || personalSymbols.includes(item.symbol)
        return matchesQuery && (query ? true : inActiveList)
      })
    },
    [data, filterText, personalSymbols, session.data?.authenticated],
  )
  useEffect(() => setPage(0), [filterText, activeList, session.data?.authenticated])
  const pageCount = Math.max(1, Math.ceil(filteredData.length / pageSize))
  const visibleData = useMemo(() => filteredData.slice(page * pageSize, (page + 1) * pageSize), [filteredData, page])

  const table = useReactTable({
    data: visibleData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (isLoading) return <div style={{ color: 'var(--text-dim)', padding: 12 }}>Memuat watchlist BEI…</div>
  if (isError) return <div style={{ color: 'var(--down)', padding: 12 }}>Gagal memuat watchlist.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {/* Arsant Screener Sub Header */}
      <div
        style={{
          padding: '4px 8px',
          background: 'var(--panel-header)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
        }}
      >
        <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10, letterSpacing: 0.5 }}>
          [ WL - WATCHLIST MONITOR ]
        </span>
        <input
          type="text"
          placeholder="Cari emiten..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            color: 'var(--text-h)',
            fontSize: 10,
            padding: '1px 4px',
            borderRadius: 2,
            width: 118,
          }}
        />
      </div>

      {session.data?.authenticated ? (
        <>
          <div style={{display:'flex',gap:4,padding:'4px 8px',borderBottom:'1px solid var(--border)',background:'var(--bg)',flexWrap:'wrap'}}>
            <select value={activeList} onChange={(e)=>setActiveList(e.target.value)} style={{background:'var(--panel-header)',color:'var(--text-h)',border:'1px solid var(--border)',fontSize:10}}>
              {(personal.data?.lists ?? [{ name: 'Pantauan Utama', symbols: [] }]).map((list)=><option key={list.name}>{list.name}</option>)}
            </select>
            <button onClick={()=>setShowListManager((open)=>!open)} style={{fontSize:10}}>⚙ Daftar</button>
            <input value={newSymbol} onChange={(e)=>setNewSymbol(e.target.value.toUpperCase())} onKeyDown={(e)=>{if(e.key==='Enter'&&newSymbol.trim())addMutation.mutate()}} placeholder="Tambah ticker" style={{width:90,background:'var(--panel-header)',color:'var(--text-h)',border:'1px solid var(--border)',fontSize:10}}/>
            <button disabled={!newSymbol.trim()||addMutation.isPending} onClick={()=>addMutation.mutate()}>+ Tambah</button>
            {selectedSymbol&&personalSymbols.includes(selectedSymbol)&&<button onClick={()=>removeMutation.mutate(selectedSymbol)} style={{color:'var(--down)'}}>Hapus {selectedSymbol}</button>}
          </div>
          {showListManager && (
            <div style={{display:'flex',gap:4,padding:'4px 8px',borderBottom:'1px solid var(--border)',background:'var(--panel-header)',flexWrap:'wrap'}}>
              <input value={listName} onChange={(e)=>setListName(e.target.value)} placeholder="Nama watchlist" maxLength={80} style={{width:110,background:'var(--bg)',color:'var(--text-h)',border:'1px solid var(--border)',fontSize:10}} />
              <button disabled={!listName.trim()||createListMutation.isPending} onClick={()=>createListMutation.mutate()}>+ Baru</button>
              {activeList !== 'Pantauan Utama' && <button disabled={!listName.trim()||renameListMutation.isPending} onClick={()=>renameListMutation.mutate()}>Ubah nama</button>}
              {activeList !== 'Pantauan Utama' && (
                <button onClick={()=>confirmDelete?deleteListMutation.mutate():setConfirmDelete(true)} style={{color:'var(--down)'}}>
                  {confirmDelete?'Yakin hapus?':'Hapus daftar'}
                </button>
              )}
            </div>
          )}
        </>
      ) : <div style={{padding:'4px 8px',borderBottom:'1px solid var(--border)',fontSize:10,color:'var(--text-dim)'}}>Menampilkan seluruh pasar · <a href="/account" style={{color:'var(--accent)'}}>Login untuk watchlist pribadi</a></div>}

      {/* Table Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!filteredData.length ? (
          <div style={{ color: 'var(--text-dim)', padding: 12, fontSize: 11 }}>
            {session.data?.authenticated ? 'Watchlist ini masih kosong. Tambahkan ticker di atas.' : 'Belum ada simbol pasar yang tersedia.'}
          </div>
        ) : (
          <table className="bbg-table">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
                  ))}
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
                    title="Klik untuk memilih · klik dua kali untuk membuka detail"
                    style={{
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(255, 157, 0, 0.12)' : undefined,
                      borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {filteredData.length > pageSize && <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'4px 8px',borderTop:'1px solid var(--border)',background:'var(--panel-header)',fontSize:9,color:'var(--text-dim)'}}><span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filteredData.length)} dari {filteredData.length}</span><div style={{display:'flex',gap:4}}><button disabled={page===0} onClick={()=>setPage((value)=>Math.max(0,value-1))}>←</button><button disabled={page>=pageCount-1} onClick={()=>setPage((value)=>Math.min(pageCount-1,value+1))}>→</button></div></div>}

      {/* Footer Counter */}
      <div
        style={{
          padding: '2px 8px',
          background: 'var(--panel-header)',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-dim)',
          fontSize: 10,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>TOTAL: {filteredData.length} {session.data?.authenticated ? 'WATCHLIST' : 'EQUITY SYMBOLS'}</span>
        <span>{selectedSymbol ? `ACTIVE: ${selectedSymbol} · 2× DETAIL` : 'NO SELECTION'}</span>
      </div>
    </div>
  )
}
