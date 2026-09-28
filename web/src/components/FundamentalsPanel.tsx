import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchKeyStats,
  fetchFinancialStatements,
  fetchDividends,
  fetchKeyStatsRatios,
  type WatchlistItem,
  type FinancialStatementItem,
} from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'
import { SymbolHeaderPicker } from './SymbolHeaderPicker'

/**
 * Panel fundamental — SELURUHNYA dari data Stockbit yang dikumpulkan Data
 * Collector, bukan Yahoo Finance.
 *
 *   /keystats/{symbol}             -> rasio ringkas (PER, PBV, ROE, ROA, DER)
 *   /financial-statements/{symbol} -> laporan keuangan + rasio turunan Stockbit
 *                                     (EBITDA, EPS, PE Ratio, Current Ratio, …)
 *   /dividends/{symbol}            -> riwayat dividen tunai
 *
 * Versi Yahoo sebelumnya memakai ~16 field yang tidak pernah ada di respons
 * backend (longName, sector, fiftyTwoWeekLow, debtToEquity, …) sehingga
 * `npm run build` gagal total dan panelnya menampilkan "—" untuk hampir semua
 * baris.
 */

const fmtX = (v?: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}x`)
const fmtNum = (v?: number | null, digits = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('id-ID', { maximumFractionDigits: digits })
const fmtBig = (v?: number | null) => (v == null || !Number.isFinite(v) || v === 0 ? '—' : fmtRp(v))
const fmtPctRaw = (v?: number | null, digits = 2) =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`

type ReportType = 'income' | 'balance' | 'cashflow'
type StatementType = 'annual' | 'quarterly'

const REPORT_LABEL: Record<ReportType, string> = {
  income: 'Laba Rugi',
  balance: 'Neraca',
  cashflow: 'Arus Kas',
}

function Metric({ label, value, color, title }: { label: string; value: string; color?: string; title?: string }) {
  return (
    <div style={{ padding: '4px 8px' }} title={title}>
      <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>{label}</div>
      <div style={{ color: color ?? 'var(--text-h)', fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          color: 'var(--text-dim)', fontSize: 11, fontWeight: 600, marginBottom: 4,
          borderBottom: '1px solid var(--border)', paddingBottom: 2,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span>{title}</span>
        {right}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>{children}</div>
    </div>
  )
}

/** Indeks laporan: itemName -> {period -> value}, plus daftar periode terurut. */
function indexStatements(rows: FinancialStatementItem[]) {
  const byItem = new Map<string, Map<string, number>>()
  const periods = new Set<string>()
  for (const r of rows) {
    if (!r.itemName || !r.period) continue
    periods.add(r.period)
    let m = byItem.get(r.itemName)
    if (!m) { m = new Map(); byItem.set(r.itemName, m) }
    m.set(r.period, r.value ?? 0)
  }
  // "12M 2025" / "3M 2025 Q1" — diurutkan dari tahun terbaru
  const sorted = [...periods].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  return { byItem, periods: sorted }
}

/** Ambil nilai satu akun pada periode tertentu, toleran terhadap variasi nama. */
function pickItem(byItem: Map<string, Map<string, number>>, period: string, ...names: string[]): number | null {
  for (const n of names) {
    const exact = byItem.get(n)
    if (exact?.has(period)) return exact.get(period)!
  }
  const lowered = names.map((n) => n.toLowerCase())
  for (const [key, m] of byItem) {
    const k = key.toLowerCase()
    if (lowered.some((n) => k === n || k.startsWith(n)) && m.has(period)) return m.get(period)!
  }
  return null
}

const growth = (now: number | null, prev: number | null): number | null =>
  now == null || prev == null || prev === 0 ? null : ((now - prev) / Math.abs(prev)) * 100

export function FundamentalsPanel({ params }: { params?: { symbolOverride?: string } }) {
  const globalSymbol = useTerminalStore((s) => s.selectedSymbol)
  const [pinnedSymbol, setPinnedSymbol] = useState<string | null>(params?.symbolOverride || null)
  const [reportType, setReportType] = useState<ReportType>('income')
  const [statementType, setStatementType] = useState<StatementType>('annual')
  const symbol = pinnedSymbol || globalSymbol
  const isPinned = !!pinnedSymbol

  const queryClient = useQueryClient()

  const keystats = useQuery({
    queryKey: ['keystats', symbol],
    queryFn: () => fetchKeyStats(symbol!),
    enabled: !!symbol,
  })
  const statements = useQuery({
    queryKey: ['financial-statements', symbol, reportType, statementType],
    queryFn: () => fetchFinancialStatements(symbol!, { reportType, statementType }),
    enabled: !!symbol,
  })
  // Rasio turunan Stockbit (EBITDA/EPS/PE/ROE) selalu ada di laporan Laba Rugi
  // tahunan, jadi diambil terpisah agar ringkasan tidak ikut berubah saat user
  // menggeser tab laporan.
  const incomeAnnual = useQuery({
    queryKey: ['financial-statements', symbol, 'income', 'annual'],
    queryFn: () => fetchFinancialStatements(symbol!, { reportType: 'income', statementType: 'annual' }),
    enabled: !!symbol,
  })
  const ratios = useQuery({
    queryKey: ['keystats-ratios', symbol],
    queryFn: () => fetchKeyStatsRatios(symbol!),
    enabled: !!symbol,
  })
  const dividends = useQuery({
    queryKey: ['dividends', symbol],
    queryFn: () => fetchDividends(symbol!),
    enabled: !!symbol,
  })

  const symbols = queryClient.getQueryData<WatchlistItem[]>(['symbols'])
  const currentPrice = symbols?.find((s) => s.symbol === symbol)?.close ?? null

  if (!symbol) {
    return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat data fundamental.</div>
  }

  const ks = keystats.data
  const income = indexStatements(incomeAnnual.data ?? [])
  const p0 = income.periods[0]
  const p1 = income.periods[1]

  const revenue = p0 ? pickItem(income.byItem, p0, 'Total Revenue', 'Total Pendapatan') : null
  const revenuePrev = p1 ? pickItem(income.byItem, p1, 'Total Revenue', 'Total Pendapatan') : null
  const grossProfit = p0 ? pickItem(income.byItem, p0, 'Gross Profit', 'Laba Kotor') : null
  const netIncome = p0 ? pickItem(income.byItem, p0, 'Net Income For The Period', 'Laba Bersih Tahun Berjalan') : null
  const netIncomePrev = p1 ? pickItem(income.byItem, p1, 'Net Income For The Period', 'Laba Bersih Tahun Berjalan') : null
  const ebitda = p0 ? pickItem(income.byItem, p0, 'EBITDA (Annual)', 'EBITDA') : null
  const eps = p0 ? pickItem(income.byItem, p0, 'EPS (Annual)', 'EPS') : null
  const peAnnual = p0 ? pickItem(income.byItem, p0, 'PE Ratio (Annual)') : null
  const psAnnual = p0 ? pickItem(income.byItem, p0, 'Price to Sales (Annual)') : null
  const roaAnnual = p0 ? pickItem(income.byItem, p0, 'Return on Assets (Annual)') : null
  const roeAnnual = p0 ? pickItem(income.byItem, p0, 'Return on Equity (Annual)') : null
  const interestCover = p0 ? pickItem(income.byItem, p0, 'Interest Coverage (Annual)') : null

  const grossMargin = revenue && grossProfit != null && revenue !== 0 ? (grossProfit / revenue) * 100 : null
  const netMargin = revenue && netIncome != null && revenue !== 0 ? (netIncome / revenue) * 100 : null

  const table = indexStatements(statements.data ?? [])
  const shownPeriods = table.periods.slice(0, 6)
  const loadingAll = keystats.isLoading && incomeAnnual.isLoading
  const noData = !ks && !incomeAnnual.data?.length && !incomeAnnual.isLoading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      <div
        style={{
          padding: '4px 8px', background: 'var(--panel-header)', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10 }}>
            [ FA - FINANCIAL ANALYSIS &amp; RATIOS ]
          </span>
          <SymbolHeaderPicker
            symbol={symbol}
            isPinned={isPinned}
            onPinToggle={() => (isPinned ? setPinnedSymbol(null) : setPinnedSymbol(symbol))}
            onSymbolChange={(s) => setPinnedSymbol(s)}
          />
        </div>
        <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>DATA FUNDAMENTAL TERSTRUKTUR</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {loadingAll && <div style={{ color: 'var(--text-dim)' }}>Mengambil data fundamental…</div>}

        {noData && (
          <div style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.6 }}>
            Data fundamental untuk {symbol} belum tersedia.
            <br />Pembaruan data akan ditampilkan otomatis setelah tersedia.
          </div>
        )}

        {!noData && (
          <>
            <div
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-h)' }}>{symbol}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                  {p0 ? `Laporan terakhir: ${p0}` : 'Belum ada laporan keuangan'}
                </div>
              </div>
              {currentPrice != null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>Harga</div>
                  <div style={{ color: 'var(--text-h)', fontWeight: 700, fontSize: 13 }}>{fmtNum(currentPrice, 0)}</div>
                </div>
              )}
            </div>

            <Section title="VALUASI">
              <Metric label="Market Cap" value={fmtBig(ks?.marketCap)} />
              <Metric label="PER" value={fmtX(ks?.peRatio || peAnnual)} title="KeyStats; cadangan: PE Ratio (Annual) dari laporan" />
              <Metric label="PBV" value={fmtX(ks?.pbvRatio)} />
              <Metric label="EPS" value={fmtNum(eps)} />
              <Metric label="Price to Sales" value={fmtX(psAnnual)} />
              <Metric label="DER" value={fmtX(ks?.der)} />
            </Section>

            <Section title="PROFITABILITAS">
              <Metric label="ROE" value={fmtPctRaw(ks?.roe || roeAnnual)} />
              <Metric label="ROA" value={fmtPctRaw(ks?.roa || roaAnnual)} />
              <Metric label="Gross Margin" value={fmtPctRaw(grossMargin)} />
              <Metric label="Net Margin" value={fmtPctRaw(netMargin)} />
              <Metric label="EBITDA" value={fmtBig(ebitda)} />
              <Metric label="Interest Coverage" value={fmtX(interestCover)} />
            </Section>

            <Section title={`PERTUMBUHAN (${p1 ?? '—'} → ${p0 ?? '—'})`}>
              <Metric
                label="Pendapatan"
                value={fmtPctRaw(growth(revenue, revenuePrev))}
                color={(growth(revenue, revenuePrev) ?? 0) > 0 ? 'var(--up)' : 'var(--down)'}
              />
              <Metric
                label="Laba Bersih"
                value={fmtPctRaw(growth(netIncome, netIncomePrev))}
                color={(growth(netIncome, netIncomePrev) ?? 0) > 0 ? 'var(--up)' : 'var(--down)'}
              />
              <Metric label="Pendapatan" value={fmtBig(revenue)} />
              <Metric label="Laba Kotor" value={fmtBig(grossProfit)} />
              <Metric label="Laba Bersih" value={fmtBig(netIncome)} />
            </Section>

            <Section title="DIVIDEN">
              <Metric label="Dividend Yield" value={fmtPctRaw(ks?.dividendYield)} />
              <Metric label="Dividen Terakhir" value={fmtNum(dividends.data?.[0]?.amount)} />
              <Metric label="Cum Date" value={dividends.data?.[0]?.cumDate || '—'} />
            </Section>

            {!!ratios.data?.length && (
              <Section title={`RASIO KEUANGAN (${ratios.data.length})`}>
                <div style={{ gridColumn: '1 / -1' }}>
                  {[...new Set(ratios.data.map((r) => r.group))].map((g) => (
                    <div key={g} style={{ marginBottom: 8 }}>
                      <div style={{ color: 'var(--cyan)', fontSize: 10, fontWeight: 700, marginBottom: 2 }}>{g}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 8px' }}>
                        {ratios.data!.filter((r) => r.group === g).map((r) => (
                          <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '1px 0' }}>
                            <span style={{ color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
                              {r.name}
                            </span>
                            <span style={{ color: 'var(--text-h)', fontWeight: 600, whiteSpace: 'nowrap', paddingLeft: 6 }}>
                              {r.rawValue || fmtNum(r.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section
              title="LAPORAN KEUANGAN"
              right={
                <span style={{ display: 'flex', gap: 4 }}>
                  {(['income', 'balance', 'cashflow'] as ReportType[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setReportType(r)}
                      style={{
                        fontSize: 9, padding: '1px 6px', cursor: 'pointer', borderRadius: 2,
                        border: '1px solid var(--border)',
                        background: reportType === r ? 'var(--accent, #238636)' : 'transparent',
                        color: reportType === r ? '#fff' : 'var(--text-dim)',
                      }}
                    >
                      {REPORT_LABEL[r]}
                    </button>
                  ))}
                  {(['annual', 'quarterly'] as StatementType[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatementType(s)}
                      style={{
                        fontSize: 9, padding: '1px 6px', cursor: 'pointer', borderRadius: 2,
                        border: '1px solid var(--border)',
                        background: statementType === s ? 'var(--accent, #238636)' : 'transparent',
                        color: statementType === s ? '#fff' : 'var(--text-dim)',
                      }}
                    >
                      {s === 'annual' ? 'Tahunan' : 'Kuartalan'}
                    </button>
                  ))}
                </span>
              }
            >
              <div style={{ gridColumn: '1 / -1', overflowX: 'auto' }}>
                {statements.isLoading ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: 6 }}>Memuat…</div>
                ) : !table.byItem.size ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: 6 }}>
                    Belum ada {REPORT_LABEL[reportType]} {statementType === 'annual' ? 'tahunan' : 'kuartalan'} untuk {symbol}.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 400 }}>Akun</th>
                        {shownPeriods.map((p) => (
                          <th key={p} style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400, whiteSpace: 'nowrap' }}>
                            {p}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...table.byItem.entries()].map(([name, byPeriod]) => (
                        <tr key={name}>
                          <td style={{ padding: '3px 6px', color: 'var(--text-h)', whiteSpace: 'nowrap' }}>{name}</td>
                          {shownPeriods.map((p) => {
                            const v = byPeriod.get(p)
                            return (
                              <td
                                key={p}
                                style={{
                                  padding: '3px 6px', textAlign: 'right', whiteSpace: 'nowrap',
                                  color: v == null ? 'var(--text-dim)' : v < 0 ? 'var(--down)' : 'var(--text-h)',
                                }}
                              >
                                {v == null ? '—' : Math.abs(v) >= 1e6 ? fmtRp(v) : fmtNum(v)}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
