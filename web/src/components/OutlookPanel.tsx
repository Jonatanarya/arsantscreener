import { useState, type ReactNode } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  fetchOutlook,
  fetchKeyStats,
  fetchDividends,
  fetchFinancialStatements,
  fetchInsiderTransactions,
  fetchCatalysts,
  fetchNews,
  fetchFundamentals,
  generateAIOutlook,
  type Outlook,
} from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'
import { fmtRp } from '../lib/format'

const GEMINI_KEY_STORAGE = 'tradewise_gemini_api_key'

const biasColor = (bias: string) =>
  bias === 'BULLISH' ? 'var(--up)' : bias === 'BEARISH' ? 'var(--down)' : 'var(--text-dim)'

function SignalList({ signals, color }: { signals: Outlook['bullish']; color: string }) {
  if (!signals.length) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>Tidak ada sinyal.</div>
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {signals.map((s, i) => (
        <li key={i} style={{ marginBottom: 6, display: 'flex', gap: 6 }}>
          <span style={{ color, fontWeight: 700, minWidth: 24 }}>
            {s.points > 0 ? '+' : ''}
            {s.points}
          </span>
          <span>{s.text}</span>
        </li>
      ))}
    </ul>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          color: 'var(--text-dim)',
          fontSize: 11,
          fontWeight: 600,
          marginBottom: 6,
          borderBottom: '1px solid var(--border)',
          paddingBottom: 2,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Empty({ text = 'Belum ada data. Push dari extension (tab Push Data) untuk mengisi bagian ini.' }: { text?: string }) {
  return <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{text}</div>
}

export function OutlookPanel() {
  const symbol = useTerminalStore((s) => s.selectedSymbol)

  const [apiKey, setApiKey] = useState(() => localStorage.getItem(GEMINI_KEY_STORAGE) ?? '')
  const [showKey, setShowKey] = useState(false)

  const outlookQ = useQuery({
    queryKey: ['outlook', symbol],
    queryFn: () => fetchOutlook(symbol!),
    enabled: !!symbol,
  })
  const keyStatsQ = useQuery({
    queryKey: ['keystats', symbol],
    queryFn: () => fetchKeyStats(symbol!),
    enabled: !!symbol,
  })
  const fundamentalsQ = useQuery({
    queryKey: ['fundamentals', symbol],
    queryFn: () => fetchFundamentals(symbol!),
    enabled: !!symbol,
  })
  const dividendsQ = useQuery({
    queryKey: ['dividends', symbol],
    queryFn: () => fetchDividends(symbol!),
    enabled: !!symbol,
  })
  const financialsQ = useQuery({
    queryKey: ['financial-statements', symbol],
    queryFn: () => fetchFinancialStatements(symbol!),
    enabled: !!symbol,
  })
  const insiderQ = useQuery({
    queryKey: ['insider-transactions', symbol],
    queryFn: () => fetchInsiderTransactions(symbol!),
    enabled: !!symbol,
  })
  const catalystsQ = useQuery({
    queryKey: ['catalysts', symbol],
    queryFn: () => fetchCatalysts(symbol!),
    enabled: !!symbol,
  })
  const newsQ = useQuery({
    queryKey: ['news', symbol, 5],
    queryFn: () => fetchNews(symbol!, 5),
    enabled: !!symbol,
  })

  const aiMutation = useMutation({
    mutationFn: () => generateAIOutlook(symbol!, apiKey),
  })

  if (!symbol) {
    return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Pilih simbol dari watchlist untuk melihat Outlook.</div>
  }
  if (outlookQ.isLoading) return <div style={{ color: 'var(--text-dim)', padding: 16 }}>Merangkum analisa…</div>
  if (outlookQ.isError || !outlookQ.data) return <div style={{ color: 'var(--down)', padding: 16 }}>Gagal memuat outlook.</div>

  const data = outlookQ.data
  const hasAnySignal = data.bullish.length > 0 || data.bearish.length > 0

  const ks = keyStatsQ.data
  const hasKeyStats = !!ks && ks.marketCap != null && ks.marketCap > 0
  const fund = fundamentalsQ.data

  const divs = dividendsQ.data ?? []
  const insiders = insiderQ.data ?? []
  const catalysts = catalystsQ.data ?? []
  const news = newsQ.data ?? []

  // Tren laba/rugi tahunan: kelompokkan item Revenue & Net Profit per periode
  const financials = financialsQ.data ?? []
  const incomeAnnual = financials.filter((f) => f.reportType === 'income' && f.statementType === 'annual')
  const periods = [...new Set(incomeAnnual.map((f) => f.period))].sort().slice(-4)
  const revenueByPeriod = new Map<string, number>()
  const profitByPeriod = new Map<string, number>()
  for (const item of incomeAnnual) {
    const lower = item.itemName.toLowerCase()
    if (lower.includes('revenue') || lower.includes('penjualan')) revenueByPeriod.set(item.period, item.value ?? 0)
    if (lower.includes('net profit') || lower.includes('laba bersih')) profitByPeriod.set(item.period, item.value ?? 0)
  }

  const handleSaveKey = (v: string) => {
    setApiKey(v)
    localStorage.setItem(GEMINI_KEY_STORAGE, v)
  }

  return (
    <div style={{ padding: 8, height: '100%', overflowY: 'auto', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ color: 'var(--text-h)', fontWeight: 600 }}>{symbol}</span>
        <span style={{ color: biasColor(data.bias), fontWeight: 700, fontSize: 16 }}>{data.bias}</span>
        <span style={{ color: 'var(--text-dim)' }}>(skor {data.score})</span>
      </div>
      <div style={{ color: 'var(--text-dim)', marginBottom: 10 }}>
        Rangkuman dari deteksi fase akumulasi/distribusi dan PVA/VSA — lihat panel Chart, PVA/VSA, dan Keputusan untuk detail
        tambahan.
      </div>

      {!hasAnySignal && (
        <div style={{ color: 'var(--text-dim)', marginBottom: 10 }}>Belum cukup data (fase atau PVA) untuk simbol ini.</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ color: 'var(--up)', fontSize: 11, marginBottom: 4 }}>BULLISH</div>
          <SignalList signals={data.bullish} color="var(--up)" />
        </div>
        <div>
          <div style={{ color: 'var(--down)', fontSize: 11, marginBottom: 4 }}>BEARISH</div>
          <SignalList signals={data.bearish} color="var(--down)" />
        </div>
      </div>

      <Section title="FUNDAMENTAL RINGKAS">
        {hasKeyStats || fund ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <Metric label="P/E" value={fmtX(hasKeyStats ? ks!.peRatio : fund?.peRatio)} />
            <Metric label="P/BV" value={fmtX(hasKeyStats ? ks!.pbvRatio : fund?.priceToBook)} />
            <Metric label="ROE" value={fmtPct(hasKeyStats ? (ks!.roe ?? 0) / 100 : fund?.roe)} />
            <Metric
              label="Dividend Yield"
              value={fmtPct(hasKeyStats ? (ks!.dividendYield ?? 0) / 100 : fund?.dividendYield)}
            />
            <Metric label="Market Cap" value={fmtBig(hasKeyStats ? ks!.marketCap : fund?.marketCap)} />
            {fund && <Metric label="Revenue Growth" value={fmtPct(fund.revenueGrowth)} />}
            {fund && <Metric label="Earnings Growth" value={fmtPct(fund.earningsGrowth)} />}
            {fund?.recommendationKey && <Metric label="Rekomendasi Analis" value={fund.recommendationKey.toUpperCase()} />}
          </div>
        ) : (
          <Empty text="Belum ada KeyStats/Fundamental. Push KeyStats dari extension, atau buka panel Fundamental untuk tarik data Yahoo Finance." />
        )}
      </Section>

      <Section title="DIVIDEN TERAKHIR">
        {divs.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {divs.slice(0, 3).map((d, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                Cum date <b>{d.cumDate}</b> — Rp {(d.amount ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })}/saham
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="TREN LAPORAN KEUANGAN (LABA RUGI TAHUNAN)">
        {periods.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: 'var(--text-dim)', fontWeight: 500, paddingBottom: 4 }}>Periode</th>
                <th style={{ textAlign: 'right', color: 'var(--text-dim)', fontWeight: 500, paddingBottom: 4 }}>Revenue</th>
                <th style={{ textAlign: 'right', color: 'var(--text-dim)', fontWeight: 500, paddingBottom: 4 }}>Laba Bersih</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p}>
                  <td style={{ padding: '2px 0' }}>{p}</td>
                  <td style={{ textAlign: 'right' }}>{revenueByPeriod.has(p) ? fmtRp(revenueByPeriod.get(p)!) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{profitByPeriod.has(p) ? fmtRp(profitByPeriod.get(p)!) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text="Belum ada Laporan Keuangan. Push dari tab Push Data extension (pilih simbol ini)." />
        )}
      </Section>

      <Section title="TRANSAKSI INSIDER TERAKHIR">
        {insiders.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {insiders.slice(0, 5).map((t, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <span style={{ color: 'var(--text-dim)' }}>{t.txDate}</span> — {t.holderName}{' '}
                <span style={{ color: t.actionType?.toUpperCase() === 'BUY' ? 'var(--up)' : 'var(--down)', fontWeight: 700 }}>
                  {t.actionType}
                </span>{' '}
                {t.shares?.toLocaleString('id-ID')} lembar @ {t.price}
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="KATALIS">
        {catalysts.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {catalysts.map((c) => (
              <li key={c.id} style={{ marginBottom: 4 }}>
                <span style={{ color: c.impact === 'bullish' ? 'var(--up)' : c.impact === 'bearish' ? 'var(--down)' : 'var(--text-dim)', fontWeight: 700 }}>
                  [{c.impact}]
                </span>{' '}
                {c.expectedPeriod && <span style={{ color: 'var(--text-dim)' }}>({c.expectedPeriod})</span>} {c.category}: {c.description}
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="BERITA TERKAIT">
        {news.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {news.map((n) => (
              <li key={n.id} style={{ marginBottom: 4 }}>
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-h)' }}>
                    {n.title}
                  </a>
                ) : (
                  n.title
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="🤖 ANALISA AI (GEMINI)">
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => handleSaveKey(e.target.value)}
              placeholder="Masukkan Gemini API key Anda"
              style={{
                flex: 1,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '4px 6px',
                color: 'var(--text-h)',
                fontSize: 11,
              }}
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              style={{ fontSize: 10, padding: '4px 6px', cursor: 'pointer', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)' }}
            >
              {showKey ? 'sembunyikan' : 'lihat'}
            </button>
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>
            Key tersimpan hanya di browser Anda (localStorage), dikirim langsung ke server lokal Anda per-request — tidak
            disimpan di server. Dapatkan API key gratis di{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>
              aistudio.google.com/apikey
            </a>
            .
          </div>
        </div>

        <button
          onClick={() => aiMutation.mutate()}
          disabled={!apiKey.trim() || aiMutation.isPending}
          style={{
            background: apiKey.trim() ? 'var(--accent)' : 'var(--border)',
            color: apiKey.trim() ? '#000' : 'var(--text-dim)',
            border: 'none',
            borderRadius: 3,
            padding: '6px 12px',
            fontSize: 11,
            fontWeight: 700,
            cursor: apiKey.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          {aiMutation.isPending ? 'Menghasilkan analisa…' : '✨ Buat Analisa AI'}
        </button>

        {aiMutation.isError && (
          <div style={{ color: 'var(--down)', marginTop: 8, fontSize: 11 }}>
            Gagal: {(aiMutation.error as Error).message}
          </div>
        )}

        {aiMutation.data && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              background: 'rgba(0,214,154,0.06)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
              fontSize: 12,
            }}
          >
            {aiMutation.data.analysis}
            <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 8 }}>
              Dihasilkan {new Date(aiMutation.data.generatedAt).toLocaleString('id-ID')} · alat bantu analisa, bukan nasihat
              keuangan.
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: 'var(--text-dim)', fontSize: 10 }}>{label}</div>
      <div style={{ color: 'var(--text-h)', fontWeight: 600 }}>{value}</div>
    </div>
  )
}

const fmtX = (v?: number | null) => (v == null || v === 0 ? '—' : `${v.toFixed(2)}x`)
const fmtPct = (v?: number | null) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`)
const fmtBig = (v?: number | null) => (v == null || v === 0 ? '—' : fmtRp(v))
