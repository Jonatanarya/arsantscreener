import { useQuery, useQueries } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { fetchBrokerAnalysis, fetchBars, fetchTrades, fetchSymbols, type BrokerFlow, type BrokerMaster } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'
import { useBrokerMaster, flowMark, avgPerTrx, brokerColor, brokerGroup, BROKER_GROUP_COLOR, BROKER_GROUP_LABEL } from '../lib/brokers'
import { ModeToggle } from './BrokerSummaryPanel'
import { SymbolHeaderPicker } from './SymbolHeaderPicker'
import { DateRangeFilter } from './PeriodPicker'


const fmtLot = (v: number) => v.toLocaleString('id-ID')
const fmtPrice = (v?: number) => (v == null || v === 0 ? '—' : Math.round(v).toLocaleString('id-ID'))

function fmtShortVal(v: number): string {
  if (!v || isNaN(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`
  return `${sign}${a.toFixed(0)}`
}

function fmtPriceDecimal(v?: number): string {
  if (v == null || v === 0 || isNaN(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}



// Warna & nama broker kini berasal dari master di database (tabel `brokers`,
// diisi Data Collector dari daftar resmi Stockbit). Peta hardcoded di atas
// tinggal cadangan untuk kode yang belum sempat ter-crawl — bukan lagi sumber
// utama, sehingga broker baru/berganti nama tidak perlu edit kode.
// Warna mengikuti GOLONGAN broker (Merah=Asing, Hijau=BUMN, Kuning=Lokal),
// bukan warna acak per broker dari Stockbit — supaya sekali lihat langsung
// ketahuan asing/BUMN/lokal.
function getBrokerColor(code: string, fallbackColor: string = '#818cf8', master?: Map<string, BrokerMaster>): string {
  if (!master) return fallbackColor
  const g = brokerGroup(code, master)
  return g === 'unknown' ? fallbackColor : BROKER_GROUP_COLOR[g]
}

// Nama pendek diturunkan dari nama resmi di master DB — tidak ada lagi daftar
// singkatan yang ditulis tangan.
function getShortBrokerName(code: string, fullName?: string, master?: Map<string, BrokerMaster>): string {
  const nama = master?.get(code)?.name || fullName
  if (nama) return nama.replace(/PT\.?\s*/i, '').replace(/Sekuritas|Indonesia|Asia|Tbk/gi, '').trim().toUpperCase()
  return code
}

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>{label}</div>
      <div style={{ color: color ?? 'var(--text-h)', fontWeight: 700, fontSize: 13 }}>{value}</div>
      {sub && <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>{sub}</div>}
    </div>
  )
}

function BrokerRow({ b, maxAbsNet, side, mode, master, bigThreshold }: {
  b: BrokerFlow; maxAbsNet: number; side: 'buy' | 'sell'
  mode: 'net' | 'gross'; master: Map<string, BrokerMaster>; bigThreshold: number
}) {
  const gross = b.buyVal + b.sellVal
  const shown = mode === 'net' ? Math.abs(b.netVal) : gross
  const avgTrx = avgPerTrx(gross, b.freq)
  const big = avgTrx >= bigThreshold
  const mark = flowMark(b.code, b.investorType, master)
  const pct = maxAbsNet > 0 ? (Math.abs(b.netVal) / maxAbsNet) * 100 : 0
  const color = side === 'buy' ? 'var(--up)' : 'var(--down)'
  const barBg = side === 'buy' ? 'rgba(46,204,113,0.18)' : 'rgba(239,68,68,0.18)'
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', fontSize: 11 }}>
      <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: barBg, borderRadius: 2 }} />
      <span style={{ position: 'relative', color, fontWeight: 700, minWidth: 30 }} title={b.name}>
        {b.code}
      </span>
      <span
        style={{ position: 'relative', color: brokerColor(b.code, master), fontSize: 9, minWidth: 62 }}
        title={`${b.name} · ${b.type} · ${BROKER_GROUP_LABEL[brokerGroup(b.code, master)]}`}
      >
        {BROKER_GROUP_LABEL[brokerGroup(b.code, master)]} · {b.type}
      </span>
      {/* Penanda domisili aliran dana — kasus YU: broker asing, investor lokal */}
      {mark.label && (
        <span
          style={{
            position: 'relative', fontSize: 9, padding: '0 3px', borderRadius: 2,
            border: `1px solid ${mark.mismatch ? '#d29922' : 'var(--border)'}`,
            color: mark.mismatch ? '#d29922' : 'var(--text-dim)',
          }}
          title={mark.title}
        >
          {mark.label}{mark.mismatch ? '⚠' : ''}
        </span>
      )}
      <span style={{ position: 'relative', flex: 1, textAlign: 'right', color: 'var(--text-h)', fontWeight: 600 }}>
        {fmtRp(shown)}
      </span>
      <span
        style={{ position: 'relative', width: 52, textAlign: 'right', color: 'var(--text-dim)' }}
        title="Jumlah transaksi (frekuensi)"
      >
        {b.freq ? Math.round(b.freq).toLocaleString('id-ID') : '—'}
      </span>
      <span
        style={{ position: 'relative', width: 66, textAlign: 'right', color: big ? 'var(--up)' : 'var(--text-dim)', fontWeight: big ? 700 : 400 }}
        title={big
          ? 'Order besar — nilai per transaksi jauh di atas rata-rata pasar (ciri institusi/smart money)'
          : 'Nilai rata-rata per transaksi = Gross ÷ Freq'}
      >
        {avgTrx ? fmtRp(avgTrx) : '—'}{big ? '🐋' : ''}
      </span>
      <span style={{ position: 'relative', width: 78, textAlign: 'right', color: 'var(--text-dim)' }}>
        {fmtLot(side === 'buy' ? b.buyLot : b.sellLot)}
      </span>
      <span style={{ position: 'relative', width: 58, textAlign: 'right', color: 'var(--text-dim)' }}>
        {fmtPrice(side === 'buy' ? b.avgBuyPrice : b.avgSellPrice)}
      </span>
    </div>
  )
}

function ColumnHeader({ title, color, mode }: { title: string; color: string; mode: 'net' | 'gross' }) {
  return (
    <div style={{ display: 'flex', gap: 6, padding: '2px 6px', fontSize: 9, color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color, fontWeight: 700, minWidth: 30 }}>{title}</span>
      <span style={{ minWidth: 62 }}>Tipe</span>
      <span style={{ flex: 1, textAlign: 'right' }}>{mode === 'net' ? 'Net Rp' : 'Gross Rp'}</span>
      <span style={{ width: 52, textAlign: 'right' }}>Freq</span>
      <span style={{ width: 66, textAlign: 'right' }}>Avg/Trx</span>
      <span style={{ width: 78, textAlign: 'right' }}>Lot</span>
      <span style={{ width: 58, textAlign: 'right' }}>Avg</span>
    </div>
  )
}

export function BrokerAnalysisPanel({ params }: { params?: { symbolOverride?: string } }) {
  const [mode, setMode] = useState<'net' | 'gross'>('net')
  const master = useBrokerMaster()
  const globalSymbol = useTerminalStore((s) => s.selectedSymbol)
  const globalFrom = useTerminalStore((s) => s.periodFrom)
  const globalTo = useTerminalStore((s) => s.periodTo)

  const [periodFrom, setPeriodFrom] = useState(globalFrom)
  const [periodTo, setPeriodTo] = useState(globalTo)

  const setPeriod = (from: string, to: string) => {
    setPeriodFrom(from)
    setPeriodTo(to)
  }

  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(params?.symbolOverride || null)
  const symbol = pinnedSymbol || globalSymbol
  const isPinned = !!pinnedSymbol

  const { data, isLoading, isError } = useQuery({
    queryKey: ['broker-analysis', symbol, periodFrom, periodTo],
    queryFn: () => fetchBrokerAnalysis(symbol!, periodFrom, periodTo),
    enabled: !!symbol,
  })

  // Fetch watchlist symbols for fallback close price
  const { data: symbolsList } = useQuery({
    queryKey: ['symbols'],
    queryFn: fetchSymbols,
  })
  const symbolItem = symbolsList?.find((s) => s.symbol === symbol)

  // Fetch daily bars to calculate real PnL % relative to latest price
  const { data: bars } = useQuery({
    queryKey: ['bars', symbol],
    queryFn: () => fetchBars(symbol!),
    enabled: !!symbol,
  })

  // Fetch trades to calculate real negotiation market transactions
  const { data: tradesData } = useQuery({
    queryKey: ['trades', symbol],
    queryFn: () => fetchTrades(symbol!),
    enabled: !!symbol,
  })

  const rawLatestPrice =
    (bars && bars.length > 0 ? bars[bars.length - 1].close : 0) ||
    (tradesData?.prints && tradesData.prints.length > 0 ? tradesData.prints[0].price : 0) ||
    (symbolItem?.close || 0)

  const toDateStr = periodTo || new Date().toISOString().split('T')[0]
  const getFromDate = (days: number) => {
    const d = new Date(toDateStr)
    d.setDate(d.getDate() - days)
    return d.toISOString().split('T')[0]
  }

  const periodConfigs = useMemo(() => {
    const list = [
      { key: '1W', label: '1W', days: 7 },
      { key: '1M', label: '1M', days: 30 },
      { key: '3M', label: '3M', days: 90 },
      { key: '6M', label: '6M', days: 180 },
      { key: '1Y', label: '1Y', days: 365 },
    ]

    if (periodFrom && periodTo) {
      const fromMs = new Date(periodFrom).getTime()
      const toMs = new Date(periodTo).getTime()
      const diffDays = Math.max(1, Math.round((toMs - fromMs) / (1000 * 3600 * 24)))
      if (![7, 30, 90, 180, 365].includes(diffDays)) {
        list.push({ key: `${diffDays}D`, label: `${diffDays}D`, days: diffDays })
      }
    }

    return list
  }, [periodFrom, periodTo])

  const periodResults = useQueries({
    queries: periodConfigs.map((cfg) => ({
      queryKey: ['broker-analysis-period', symbol, cfg.key, toDateStr],
      queryFn: () => fetchBrokerAnalysis(symbol!, getFromDate(cfg.days), toDateStr),
      enabled: !!symbol,
    })),
  })

  const negoSummary = useMemo(() => {
    if (!tradesData?.prints || tradesData.prints.length === 0) return null
    const negos = tradesData.prints.filter((t: any) => {
      const b = String(t.board || t.marketBoard || t.type || '').toUpperCase()
      return b.includes('NG') || b.includes('NEGO') || b.includes('TN')
    })
    if (negos.length === 0) return null

    const count = negos.length
    let totalVal = 0
    const brokerCounts = new Map<string, number>()

    for (const t of negos as any[]) {
      const val = (t.price || 0) * (t.volume || t.lot || 0) * 100
      totalVal += val
      if (t.buyer) brokerCounts.set(t.buyer, (brokerCounts.get(t.buyer) || 0) + val)
      if (t.seller) brokerCounts.set(t.seller, (brokerCounts.get(t.seller) || 0) + val)
    }

    const sortedBrokers = Array.from(brokerCounts.entries()).sort((a, b) => b[1] - a[1])
    const topBroker = sortedBrokers.length > 0 ? sortedBrokers[0][0] : null

    return {
      count,
      totalVal,
      topBroker,
    }
  }, [tradesData])

  if (!symbol) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat analisa broker.</div>
  if (isLoading) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Memuat analisa broker…</div>
  if (isError || !data) return <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat analisa broker.</div>
  if (data.error) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>{data.error}</div>

  // Ambang "order besar": 2,5x median nilai per transaksi di pasar broker
  // saham ini, minimal Rp 12 juta/transaksi. Broker yang melewatinya nilainya
  // besar tapi frekuensinya sedikit — ciri order institusi, bukan ritel.
  const avgList = data.brokers
    .map((b) => avgPerTrx(b.buyVal + b.sellVal, b.freq))
    .filter((a) => a > 0)
    .sort((a, b) => a - b)
  const medianAvg = avgList.length ? avgList[Math.floor(avgList.length / 2)] : 0
  const bigThreshold = Math.max(medianAvg * 2.5, 12e6)

  const accum = data.brokers.filter((b) => b.netVal > 0)
  const distrib = data.brokers.filter((b) => b.netVal < 0).slice().reverse()
  const maxAccum = accum.length ? accum[0].netVal : 0
  const maxDistrib = distrib.length ? Math.abs(distrib[0].netVal) : 0
  const smartColor = data.smartNetValue >= 0 ? 'var(--up)' : 'var(--down)'

  const multiPeriodData = periodConfigs.map((cfg, idx) => {
    const q = periodResults[idx]
    const res = q?.data

    if (q?.isLoading) {
      return {
        key: cfg.key,
        isLoading: true,
        buyer: null,
        seller: null,
        totalMarketVal: 0,
      }
    }

    if (res && res.brokers && res.brokers.length > 0) {
      const bAccum = res.brokers.filter((b) => b.netVal > 0)
      const bDistrib = res.brokers.filter((b) => b.netVal < 0).sort((a, b) => a.netVal - b.netVal)
      const totalAccumNet = bAccum.reduce((s, b) => s + b.netVal, 0)
      const totalDistribNet = bDistrib.reduce((s, b) => s + Math.abs(b.netVal), 0)

      const topB = bAccum[0]
      const topS = bDistrib[0]

      // avgBuy/SellPrice opsional pada skema API (broker bisa hanya punya
      // satu sisi), jadi setiap pembacaan di-default ke 0 di sini sekali
      // saja alih-alih dijaga berulang di tiap pemakaian.
      const topBAvgBuy = topB?.avgBuyPrice ?? 0
      const topSAvgSell = topS?.avgSellPrice ?? 0
      const effectivePrice =
        rawLatestPrice > 0 ? rawLatestPrice : topSAvgSell > 0 ? topSAvgSell : topBAvgBuy > 0 ? topBAvgBuy : 0

      const buyer = topB
        ? {
            code: topB.code,
            shortName: getShortBrokerName(topB.code, topB.name, master),
            buyVal: topB.buyVal,
            netVal: topB.netVal,
            avgBuyPrice: topBAvgBuy,
            effectivePrice,
            pnlPct:
              topBAvgBuy > 0 && effectivePrice > 0 ? ((effectivePrice - topBAvgBuy) / topBAvgBuy) * 100 : 0,
            dominancePct: totalAccumNet > 0 ? (topB.netVal / totalAccumNet) * 100 : 0,
          }
        : null

      const seller = topS
        ? {
            code: topS.code,
            shortName: getShortBrokerName(topS.code, topS.name, master),
            sellVal: topS.sellVal,
            netVal: Math.abs(topS.netVal),
            avgSellPrice: topSAvgSell,
            effectivePrice,
            pnlPct:
              topSAvgSell > 0 && effectivePrice > 0 ? ((topSAvgSell - effectivePrice) / topSAvgSell) * 100 : 0,
            dominancePct: totalDistribNet > 0 ? (Math.abs(topS.netVal) / totalDistribNet) * 100 : 0,
          }
        : null

      return {
        key: cfg.key,
        isLoading: false,
        buyer,
        seller,
        totalMarketVal: res.totalValue || 0,
      }
    }

    return {
      key: cfg.key,
      isLoading: false,
      buyer: null,
      seller: null,
      totalMarketVal: 0,
    }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)', color: 'var(--text)' }}>
      <div
        style={{
          padding: '4px 8px',
          background: 'var(--panel-header)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10 }}>
            [ BRKR - BANDARMOLOGI BROKER FLOW ]
          </span>
          <SymbolHeaderPicker
            symbol={symbol}
            isPinned={isPinned}
            onPinToggle={() => (isPinned ? setPinnedSymbol(null) : setPinnedSymbol(symbol))}
            onSymbolChange={(s) => setPinnedSymbol(s)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <ModeToggle mode={mode} onChange={setMode} />
          <DateRangeFilter from={periodFrom} to={periodTo} onSetPeriod={setPeriod} />
          <span
            className={data.granularity === 'harian' ? 'bbg-badge bbg-badge-green' : 'bbg-badge bbg-badge-amber'}
            style={{ fontSize: 9 }}
          >
            {data.granularity === 'harian' ? 'DATA HARIAN' : 'SCAN AGREGAT'}
          </span>
        </div>
      </div>

      <div style={{ padding: 10, flex: 1, overflowY: 'auto', fontSize: 11 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
          <Stat label="Nilai transaksi" value={fmtRp(data.totalValue)} />
          <Stat
            label="Net smart money"
            value={fmtRp(data.smartNetValue)}
            color={smartColor}
            sub={`${data.smartSharePct >= 0 ? '+' : ''}${data.smartSharePct.toFixed(2)}% dari nilai`}
          />
          <Stat
            label="Konsentrasi top-3"
            value={`${data.top3AccumPct.toFixed(0)}%`}
            sub={data.top3AccumPct >= 60 ? 'terkonsentrasi' : 'menyebar'}
          />
          <Stat label="Broker aktif" value={String(data.brokers.length)} sub={`${accum.length} beli · ${distrib.length} jual`} />
        </div>

        {/* Multi-period Dominant Buyer & Dominant Seller Cards */}
        <div style={{ marginBottom: 16 }}>
          {/* Pembeli Dominan Card */}
          <div
            style={{
              background: 'rgba(15, 18, 23, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '12px 14px',
              marginBottom: 12,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px', color: '#f8fafc', fontWeight: 700 }}>
                    Pembeli Dominan
                  </th>
                  {periodConfigs.map((cfg) => (
                    <th key={cfg.key} style={{ textAlign: 'center', padding: '6px 4px', color: '#94a3b8', fontWeight: 700 }}>
                      {cfg.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Kode Broker */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '8px 4px', color: '#94a3b8' }}>Kode Broker</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '8px 4px', verticalAlign: 'top' }}>
                      {p.isLoading ? (
                        <span style={{ color: 'var(--text-dim)' }}>…</span>
                      ) : p.buyer ? (
                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span
                            style={{
                              color: getBrokerColor(p.buyer.code, '#ef4444', master),
                              fontWeight: 800,
                              fontSize: 13,
                              letterSpacing: 0.5,
                            }}
                          >
                            {p.buyer.code}
                          </span>
                          <span style={{ color: '#475569', fontSize: 8, lineHeight: 0.8, letterSpacing: 1.5, margin: '2px 0' }}>
                            •••••
                          </span>
                          <span style={{ color: '#94a3b8', fontSize: 9, fontWeight: 600, letterSpacing: 0.5 }}>
                            {p.buyer.shortName}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                      )}
                    </td>
                  ))}
                </tr>

                {/* Nilai Beli */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Nilai Beli</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.buyer ? fmtShortVal(p.buyer.buyVal) : '—'}
                    </td>
                  ))}
                </tr>

                {/* Nilai Beli Bersih */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Nilai Beli Bersih</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.buyer ? fmtShortVal(p.buyer.netVal) : '—'}
                    </td>
                  ))}
                </tr>

                {/* Total Nilai Pasar */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Total Nilai Pasar</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.totalMarketVal > 0 ? fmtShortVal(p.totalMarketVal) : '—'}
                    </td>
                  ))}
                </tr>

                {/* Harga Beli Rata-rata */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Harga Beli Rata-rata</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.buyer ? fmtPriceDecimal(p.buyer.avgBuyPrice) : '—'}
                    </td>
                  ))}
                </tr>

                {/* Estimasi Laba/Rugi */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Estimasi Laba/Rugi</td>
                  {multiPeriodData.map((p) => {
                    if (p.isLoading) return <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px' }}>…</td>
                    if (!p.buyer || !p.buyer.avgBuyPrice) {
                      return <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: 'var(--text-dim)' }}>—</td>
                    }
                    const isPos = p.buyer.pnlPct >= 0
                    return (
                      <td
                        key={p.key}
                        style={{
                          textAlign: 'center',
                          padding: '7px 4px',
                          color: isPos ? 'var(--up)' : 'var(--down)',
                          fontWeight: 600,
                        }}
                        title={`Harga Terakhir: ${p.buyer.effectivePrice ? fmtPrice(p.buyer.effectivePrice) : '—'} | Avg Beli: ${fmtPriceDecimal(p.buyer.avgBuyPrice)}`}
                      >
                        {isPos ? `+${p.buyer.pnlPct.toFixed(0)}%` : `${p.buyer.pnlPct.toFixed(0)}%`}
                      </td>
                    )
                  })}
                </tr>

                {/* Dominasi */}
                <tr>
                  <td style={{ padding: '7px 4px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Dominasi</span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 13,
                        height: 13,
                        borderRadius: '50%',
                        border: '1px solid #64748b',
                        color: '#64748b',
                        fontSize: 9,
                        cursor: 'help',
                      }}
                      title="Dominasi broker terhadap total net pasar"
                    >
                      ⓘ
                    </span>
                  </td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.buyer ? `${p.buyer.dominancePct.toFixed(0)}%` : '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Penjual Dominan Card */}
          <div
            style={{
              background: 'rgba(15, 18, 23, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '12px 14px',
              marginBottom: 12,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px', color: '#f87171', fontWeight: 700 }}>
                    Penjual Dominan
                  </th>
                  {periodConfigs.map((cfg) => (
                    <th key={cfg.key} style={{ textAlign: 'center', padding: '6px 4px', color: '#94a3b8', fontWeight: 700 }}>
                      {cfg.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Kode Broker */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '8px 4px', color: '#94a3b8' }}>Kode Broker</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '8px 4px', verticalAlign: 'top' }}>
                      {p.isLoading ? (
                        <span style={{ color: 'var(--text-dim)' }}>…</span>
                      ) : p.seller ? (
                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span
                            style={{
                              color: getBrokerColor(p.seller.code, '#818cf8', master),
                              fontWeight: 800,
                              fontSize: 13,
                              letterSpacing: 0.5,
                            }}
                          >
                            {p.seller.code}
                          </span>
                          <span style={{ color: '#475569', fontSize: 8, lineHeight: 0.8, letterSpacing: 1.5, margin: '2px 0' }}>
                            •••••
                          </span>
                          <span style={{ color: '#94a3b8', fontSize: 9, fontWeight: 600, letterSpacing: 0.5 }}>
                            {p.seller.shortName}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                      )}
                    </td>
                  ))}
                </tr>

                {/* Nilai Jual */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Nilai Jual</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.seller ? fmtShortVal(p.seller.sellVal) : '—'}
                    </td>
                  ))}
                </tr>

                {/* Nilai Jual Bersih */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Nilai Jual Bersih</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.seller ? fmtShortVal(p.seller.netVal) : '—'}
                    </td>
                  ))}
                </tr>

                {/* Total Nilai Pasar */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Total Nilai Pasar</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.totalMarketVal > 0 ? fmtShortVal(p.totalMarketVal) : '—'}
                    </td>
                  ))}
                </tr>

                {/* Harga Jual Rata-rata */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Harga Jual Rata-rata</td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.seller ? fmtPriceDecimal(p.seller.avgSellPrice) : '—'}
                    </td>
                  ))}
                </tr>

                {/* Estimasi Laba/Rugi */}
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  <td style={{ padding: '7px 4px', color: '#94a3b8' }}>Estimasi Laba/Rugi</td>
                  {multiPeriodData.map((p) => {
                    if (p.isLoading) return <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px' }}>…</td>
                    if (!p.seller || !p.seller.avgSellPrice) {
                      return <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: 'var(--text-dim)' }}>—</td>
                    }
                    const isPos = p.seller.pnlPct >= 0
                    return (
                      <td
                        key={p.key}
                        style={{
                          textAlign: 'center',
                          padding: '7px 4px',
                          color: isPos ? 'var(--up)' : 'var(--down)',
                          fontWeight: 600,
                        }}
                        title={`Avg Jual: ${fmtPriceDecimal(p.seller.avgSellPrice)} | Harga Terakhir: ${p.seller.effectivePrice ? fmtPrice(p.seller.effectivePrice) : '—'}`}
                      >
                        {isPos ? `+${p.seller.pnlPct.toFixed(0)}%` : `${p.seller.pnlPct.toFixed(0)}%`}
                      </td>
                    )
                  })}
                </tr>

                {/* Dominasi */}
                <tr>
                  <td style={{ padding: '7px 4px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Dominasi</span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 13,
                        height: 13,
                        borderRadius: '50%',
                        border: '1px solid #64748b',
                        color: '#64748b',
                        fontSize: 9,
                        cursor: 'help',
                      }}
                      title="Dominasi broker terhadap total net pasar"
                    >
                      ⓘ
                    </span>
                  </td>
                  {multiPeriodData.map((p) => (
                    <td key={p.key} style={{ textAlign: 'center', padding: '7px 4px', color: '#f8fafc' }}>
                      {p.isLoading ? '…' : p.seller ? `${p.seller.dominancePct.toFixed(0)}%` : '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Dynamic Market Negotiation Note Banner */}
          {negoSummary ? (
            <div
              style={{
                background: 'rgba(15, 18, 23, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 12,
                padding: '12px 16px',
                fontSize: 12,
                color: '#cbd5e1',
                lineHeight: 1.6,
              }}
            >
              Dalam periode <strong style={{ color: '#f8fafc' }}>{periodFrom} s/d {periodTo}</strong>, terdapat{' '}
              <strong style={{ color: '#f8fafc' }}>{negoSummary.count} transaksi</strong> di pasar negosiasi
              {negoSummary.topBroker && (
                <>
                  {' '}yang melibatkan broker{' '}
                  <span
                    style={{
                      color: '#818cf8',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: 'rgba(129, 140, 248, 0.15)',
                    }}
                  >
                    {negoSummary.topBroker}
                  </span>
                </>
              )}
              , dengan total nilai <strong style={{ color: '#f8fafc' }}>{fmtRp(negoSummary.totalVal)}</strong>
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(15, 18, 23, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 11.5,
                color: 'var(--text-dim)',
              }}
            >
              ℹ️ Tidak terdapat catatan transaksi pasar negosiasi untuk {symbol} pada periode terpilih ({periodFrom} - {periodTo}).
            </div>
          )}
        </div>

        {/* Detailed Single-Period AKUMULASI vs DISTRIBUSI */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <ColumnHeader title="AKUMULASI" color="var(--up)" mode={mode} />
            {accum.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: 6 }}>Tidak ada.</div>
            ) : (
              accum.map((b) => <BrokerRow key={b.code} b={b} maxAbsNet={maxAccum} side="buy" mode={mode} master={master} bigThreshold={bigThreshold} />)
            )}
          </div>
          <div>
            <ColumnHeader title="DISTRIBUSI" color="var(--down)" mode={mode} />
            {distrib.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: 6 }}>Tidak ada.</div>
            ) : (
              distrib.map((b) => <BrokerRow key={b.code} b={b} maxAbsNet={maxDistrib} side="sell" mode={mode} master={master} bigThreshold={bigThreshold} />)
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
