import { useQuery } from '@tanstack/react-query'
import { fetchDataStatus } from '../api/client'

const labels: Record<string, string> = {
  price: 'Harga',
  broker: 'Broker',
  transactions: 'Transaksi',
  fundamentals: 'Fundamental',
  ownership: 'Kepemilikan',
  analysis: 'Analisis',
}

export function DataFreshness({ symbol }: { symbol: string }) {
  const status = useQuery({
    queryKey: ['data-status', symbol],
    queryFn: () => fetchDataStatus(symbol),
    enabled: !!symbol,
    staleTime: 60_000,
  })

  if (!status.data) return null
  const data = status.data
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '5px 8px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', fontSize: 9 }}>
      <strong style={{ color: data.completeness >= 80 ? 'var(--up)' : data.completeness >= 50 ? 'var(--accent)' : 'var(--down)' }}>
        DATA {data.completeness}%
      </strong>
      {Object.entries(data.areas).map(([key, area]) => (
        <span key={key} title={area.latest ? `Terakhir tersedia ${area.latest}` : 'Belum tersedia'} style={{ color: area.available ? 'var(--text-h)' : 'var(--text-dim)' }}>
          {area.available ? '●' : '○'} {labels[key] ?? key}
        </span>
      ))}
      <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>{data.latest ? `Terbaru ${data.latest}` : 'Data belum tersedia'}</span>
    </div>
  )
}
