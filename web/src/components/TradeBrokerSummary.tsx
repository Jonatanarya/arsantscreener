import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchBrokerSummary,
  fetchBrokerSummaryAvailability,
  fetchBrokers,
  type BrokerRow,
} from '../api/client'
import { fmtRp } from '../lib/format'
import { useTerminalStore } from '../store/useTerminalStore'

function total(rows: BrokerRow[]): number {
  return rows.reduce((sum, row) => sum + (row.value || 0), 0)
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

type NetBrokerRow = { brokerCode: string; value: number; lot: number }

function aggregateNet(buyers: BrokerRow[], sellers: BrokerRow[]): NetBrokerRow[] {
  const rows = new Map<string, { value: number; lot: number }>()
  const add = (row: BrokerRow, direction: 1 | -1) => {
    const current = rows.get(row.brokerCode) ?? { value: 0, lot: 0 }
    current.value += Number(row.value || 0) * direction
    current.lot += Number(row.lot || 0) * direction
    rows.set(row.brokerCode, current)
  }
  buyers.forEach((row) => add(row, 1))
  sellers.forEach((row) => add(row, -1))
  return [...rows.entries()].map(([brokerCode, row]) => ({ brokerCode, ...row }))
}

function BrokerSide({ title, rows, side, names }: { title: string; rows: NetBrokerRow[]; side: 'buy' | 'sell'; names: Map<string, string> }) {
  const color = side === 'buy' ? 'var(--up)' : 'var(--down)'
  return (
    <div className="trade-broker-side">
      <div className="trade-broker-side-head"><strong style={{ color }}>{title}</strong><span>{rows.length} broker</span></div>
      <div className="trade-broker-list">
        {rows.slice(0, 8).map((row, index) => (
          <div className="trade-broker-row" key={`${side}-${row.brokerCode}`}>
            <span>{index + 1}</span>
            <b style={{ color }}>{row.brokerCode}</b>
            <small title={names.get(row.brokerCode) || row.brokerCode}>{names.get(row.brokerCode) || '—'}</small>
            <strong>{side === 'buy' ? '+' : '−'}{fmtRp(Math.abs(row.value))}</strong>
            <em>{compactNumber(Math.abs(row.lot || 0))} lot</em>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TradeBrokerSummary() {
  const symbol = useTerminalStore((state) => state.selectedSymbol) || 'BBCA'
  const availability = useQuery({
    queryKey: ['broker-summary-availability', symbol],
    queryFn: () => fetchBrokerSummaryAvailability(symbol),
    staleTime: 10 * 60_000,
  })
  const date = availability.data?.dailyTo
  const summary = useQuery({
    queryKey: ['broker-summary-daily', symbol, date],
    queryFn: () => fetchBrokerSummary(symbol, date!),
    enabled: Boolean(date),
    staleTime: 10 * 60_000,
    retry: 1,
  })
  const masters = useQuery({ queryKey: ['brokers'], queryFn: fetchBrokers, staleTime: 60 * 60_000 })
  const names = useMemo(() => new Map((masters.data ?? []).map((broker) => [broker.code, broker.name])), [masters.data])
  const buyers = summary.data?.buyers ?? []
  const sellers = summary.data?.sellers ?? []
  const buyValue = total(buyers)
  const sellValue = total(sellers)
  const netRows = aggregateNet(buyers, sellers)
  const accumulators = netRows.filter((row) => row.value > 0).sort((a, b) => b.value - a.value)
  const distributors = netRows.filter((row) => row.value < 0).sort((a, b) => a.value - b.value)
  const netActivity = netRows.reduce((sum, row) => sum + Math.abs(row.value), 0)
  const topThreeActivity = [...netRows].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3).reduce((sum, row) => sum + Math.abs(row.value), 0)
  const dominance = netActivity > 0 ? Math.round(topThreeActivity / netActivity * 100) : 0

  if (availability.isLoading || (date && summary.isLoading)) {
    return <div className="trade-panel-state">Memuat broker summary harian {symbol}…</div>
  }
  if (availability.isError || summary.isError) {
    return <div className="trade-panel-state is-error">Broker summary belum dapat dimuat. Coba muat ulang halaman.</div>
  }
  if (!date || (!buyers.length && !sellers.length)) {
    return <div className="trade-panel-state">Belum ada broker summary harian untuk {symbol}.</div>
  }

  return (
    <div className="trade-broker-daily">
      <div className="trade-broker-overview">
        <div><small>DATA TERBARU</small><strong>{date}</strong></div>
        <div><small>NILAI TERCATAT</small><strong>{fmtRp(Math.max(buyValue, sellValue))}</strong></div>
        <div><small>BROKER AKTIF</small><strong>{netRows.length}</strong></div>
        <div><small>DOMINASI TOP 3</small><strong className={dominance >= 50 ? 'up' : ''}>{dominance}%</strong></div>
      </div>
      <div className="trade-broker-columns">
        <BrokerSide title="NET ACCUMULATOR" rows={accumulators} side="buy" names={names} />
        <BrokerSide title="NET DISTRIBUTOR" rows={distributors} side="sell" names={names} />
      </div>
    </div>
  )
}
