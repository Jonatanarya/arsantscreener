import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchNews, type NewsItem } from '../api/client'
import { useTerminalStore } from '../store/useTerminalStore'

type Sentiment = 'POSITIF' | 'NEGATIF' | 'NETRAL'
type SentimentFilter = Sentiment | 'ALL'

const TOPIC_STYLE: Record<string, { border: string; bg: string; text: string }> = {
  KORPORASI: { border: 'var(--amber)', bg: 'var(--accent-soft)', text: 'var(--amber)' },
  BURSA: { border: 'var(--cyan)', bg: 'var(--cyan-soft)', text: 'var(--cyan)' },
  PERBANKAN: { border: '#9b59b6', bg: 'rgba(155,89,182,0.12)', text: '#be90d4' },
  KOMODITAS: { border: '#e67e22', bg: 'rgba(230,126,34,0.12)', text: '#f39c12' },
  MAKRO: { border: '#3498db', bg: 'rgba(52,152,219,0.12)', text: '#74b9ff' },
  MARKET: { border: 'var(--border-bright)', bg: 'rgba(255,255,255,0.05)', text: 'var(--text-dim)' },
}

const DEFAULT_TOPIC_STYLE = TOPIC_STYLE.MARKET

function sentimentStyle(value: Sentiment) {
  if (value === 'POSITIF') return { color: 'var(--up)', background: 'var(--up-bg)', border: 'rgba(46,204,113,.35)' }
  if (value === 'NEGATIF') return { color: 'var(--down)', background: 'var(--down-bg)', border: 'rgba(239,68,68,.35)' }
  return { color: 'var(--text-dim)', background: 'rgba(255,255,255,.05)', border: 'var(--border)' }
}

function formatPublisher(source?: string, url?: string): string {
  if (source?.trim()) return source.trim().toUpperCase()
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toUpperCase() : 'BERITA PASAR'
  } catch {
    return 'BERITA PASAR'
  }
}

function formatTime(iso?: string): { absolute: string; relative: string } {
  if (!iso) return { absolute: '—', relative: '' }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return { absolute: '—', relative: '' }
  const absolute = date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000))
  if (minutes < 1) return { absolute, relative: 'baru saja' }
  if (minutes < 60) return { absolute, relative: `${minutes}m lalu` }
  if (minutes < 1_440) return { absolute, relative: `${Math.floor(minutes / 60)}j lalu` }
  return { absolute, relative: `${Math.floor(minutes / 1_440)}h lalu` }
}

function topicLabel(topic: string): string {
  return topic === 'MARKET' ? 'PASAR' : topic
}

export function NewsPanel(props: { symbolOverride?: string; params?: { symbolOverride?: string }; [key: string]: unknown } = {}) {
  const symbolOverride = props.symbolOverride || props.params?.symbolOverride
  const selectedSymbol = useTerminalStore((state) => state.selectedSymbol)
  const selectSymbol = useTerminalStore((state) => state.selectSymbol)
  const symbol = symbolOverride || selectedSymbol

  const [selectedTopic, setSelectedTopic] = useState<string>('ALL')
  const [sentiment, setSentiment] = useState<SentimentFilter>('ALL')
  const [filterText, setFilterText] = useState('')
  const [onlySymbol, setOnlySymbol] = useState(Boolean(symbolOverride))
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [visibleLimit, setVisibleLimit] = useState(20)

  const requestedSymbol = onlySymbol && symbol ? symbol : undefined
  const { data = [], isLoading, isError, error, refetch, isRefetching, dataUpdatedAt } = useQuery({
    queryKey: ['market-news', requestedSymbol ?? 'all'],
    queryFn: () => fetchNews(requestedSymbol, 100),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })

  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const article of data) counts.set(article.topic, (counts.get(article.topic) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [data])

  useEffect(() => {
    if (selectedTopic !== 'ALL' && !topicCounts.some(([topic]) => topic === selectedTopic)) setSelectedTopic('ALL')
  }, [selectedTopic, topicCounts])

  const filteredArticles = useMemo(() => {
    const query = filterText.trim().toLocaleUpperCase('id-ID')
    return data.filter((article) => {
      if (selectedTopic !== 'ALL' && article.topic !== selectedTopic) return false
      if (sentiment !== 'ALL' && article.sentiment !== sentiment) return false
      if (!query) return true
      return [
        article.title,
        article.summary ?? '',
        article.source ?? '',
        article.topic,
        article.sentiment,
        ...article.impacts.flatMap((impact) => [impact.symbol, impact.reason ?? '']),
      ].some((value) => value.toLocaleUpperCase('id-ID').includes(query))
    })
  }, [data, filterText, selectedTopic, sentiment])

  useEffect(() => setVisibleLimit(20), [selectedTopic, sentiment, onlySymbol, symbol, filterText])
  const visibleArticles = useMemo(() => filteredArticles.slice(0, visibleLimit), [filteredArticles, visibleLimit])

  const toggleExpand = (id: number) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
    : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--panel)', fontSize: 11 }}>
      <div style={{ padding: '6px 8px', background: 'var(--panel-header)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{ color: 'var(--amber)', fontWeight: 800, fontSize: 10, letterSpacing: 0.5 }}>[ NWS — BERITA & DAMPAK PASAR ]</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>● {filteredArticles.length}/{data.length} BERITA</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <input
            type="search"
            aria-label="Cari berita atau emiten"
            placeholder="Cari berita / emiten..."
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-h)', fontSize: 10, padding: '3px 7px', borderRadius: 2, width: 145, fontFamily: 'inherit' }}
          />
          {symbol && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: onlySymbol ? 'var(--amber)' : 'var(--text-dim)', fontSize: 10, cursor: 'pointer', fontWeight: onlySymbol ? 700 : 400 }}>
              <input type="checkbox" checked={onlySymbol} onChange={(event) => setOnlySymbol(event.target.checked)} />
              KHUSUS {symbol}
            </label>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isRefetching}
            title={`Terakhir dimuat ${lastUpdated} WIB`}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--cyan)', fontSize: 9, padding: '3px 7px', borderRadius: 2, cursor: isRefetching ? 'wait' : 'pointer', fontWeight: 700 }}
          >
            {isRefetching ? 'MEMUAT…' : `MUAT ULANG · ${lastUpdated}`}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border)', overflowX: 'auto', flexShrink: 0 }}>
        {(['ALL', 'POSITIF', 'NEGATIF', 'NETRAL'] as const).map((value) => {
          const active = sentiment === value
          const colors = value === 'ALL' ? { color: 'var(--amber)', background: 'var(--accent-soft)' } : sentimentStyle(value)
          const count = value === 'ALL' ? data.length : data.filter((article) => article.sentiment === value).length
          return (
            <button key={value} type="button" onClick={() => setSentiment(value)} style={{ background: active ? colors.background : 'transparent', color: active ? colors.color : 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 2, padding: '2px 7px', fontSize: 9, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {value === 'ALL' ? 'SEMUA SENTIMEN' : value} ({count})
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '4px 8px', background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid var(--border)', overflowX: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
        <button type="button" onClick={() => setSelectedTopic('ALL')} style={{ background: selectedTopic === 'ALL' ? 'var(--accent)' : 'transparent', color: selectedTopic === 'ALL' ? '#000' : 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 2, padding: '2px 6px', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
          SEMUA TOPIK ({data.length})
        </button>
        {topicCounts.map(([topic, count]) => {
          const active = selectedTopic === topic
          const colors = TOPIC_STYLE[topic] ?? DEFAULT_TOPIC_STYLE
          return (
            <button key={topic} type="button" onClick={() => setSelectedTopic(topic)} style={{ background: active ? colors.bg : 'transparent', color: active ? colors.text : 'var(--text-dim)', border: `1px solid ${active ? colors.border : 'var(--border)'}`, borderRadius: 2, padding: '2px 6px', fontSize: 9, fontWeight: active ? 700 : 400, cursor: 'pointer' }}>
              {topicLabel(topic)} ({count})
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '5px 8px', overscrollBehavior: 'contain' }}>
        {isLoading && <div style={{ color: 'var(--amber)', padding: 12 }}>Memuat berita pasar…</div>}
        {isError && (
          <div style={{ color: 'var(--down)', padding: 12, lineHeight: 1.6 }}>
            Berita belum dapat dimuat. <button type="button" onClick={() => refetch()} style={{ color: 'var(--cyan)', border: 0, background: 'transparent', cursor: 'pointer' }}>Coba lagi</button>
            {error instanceof Error && <div style={{ color: 'var(--text-dim)', fontSize: 9 }}>{error.message}</div>}
          </div>
        )}
        {!isLoading && !isError && filteredArticles.length === 0 && (
          <div style={{ color: 'var(--text-dim)', padding: 16, lineHeight: 1.6 }}>
            Belum ada berita yang cocok{onlySymbol && symbol ? ` untuk ${symbol}` : ''}.
            {onlySymbol && <div><button type="button" onClick={() => setOnlySymbol(false)} style={{ marginTop: 8, color: 'var(--amber)', border: '1px solid var(--border-bright)', background: 'var(--panel-header)', padding: '4px 8px', cursor: 'pointer' }}>Tampilkan berita pasar</button></div>}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleArticles.map((article: NewsItem) => {
            const time = formatTime(article.postedAt)
            const topicColors = TOPIC_STYLE[article.topic] ?? DEFAULT_TOPIC_STYLE
            const articleSentiment = sentimentStyle(article.sentiment)
            const expanded = expandedIds.has(article.id)
            return (
              <article key={article.id} style={{ padding: '7px 8px', borderRadius: 3, border: '1px solid var(--border)', background: 'rgba(10,13,18,.62)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 8.5, fontWeight: 800, padding: '1px 5px', borderRadius: 2, border: `1px solid ${topicColors.border}`, background: topicColors.bg, color: topicColors.text }}>{topicLabel(article.topic)}</span>
                  <span style={{ fontSize: 8.5, fontWeight: 800, padding: '1px 5px', borderRadius: 2, border: `1px solid ${articleSentiment.border}`, background: articleSentiment.background, color: articleSentiment.color }}>{article.sentiment}</span>
                  {article.impacts.map((impact) => {
                    const impactColors = sentimentStyle(impact.sentiment)
                    return (
                      <button key={impact.symbol} type="button" onClick={() => selectSymbol(impact.symbol)} title={`${impact.reason || 'Emiten terkait'} · keyakinan ${Math.round(impact.confidence)}%`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', background: 'rgba(255,157,0,.1)', border: '1px solid var(--amber)', color: 'var(--amber)', fontWeight: 800, fontSize: 9, padding: '1px 5px', borderRadius: 2, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {impact.symbol}
                        <span style={{ color: impactColors.color, fontSize: 8 }}>{impact.sentiment === 'POSITIF' ? '▲' : impact.sentiment === 'NEGATIF' ? '▼' : '•'}</span>
                      </button>
                    )
                  })}
                  <span style={{ flex: 1 }} />
                  <span style={{ color: 'var(--cyan)', fontSize: 8.5, fontWeight: 700 }}>{formatPublisher(article.source, article.url)}</span>
                  <span style={{ color: 'var(--text-dim)', fontSize: 8.5 }}>{time.absolute} {time.relative && `· ${time.relative}`}</span>
                </div>

                <div style={{ marginBottom: article.summary ? 4 : 0 }}>
                  {article.url ? (
                    <a href={article.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-h)', textDecoration: 'none', fontWeight: 700, fontSize: 11.5, lineHeight: 1.4 }}>{article.title}</a>
                  ) : (
                    <span style={{ color: 'var(--text-h)', fontWeight: 700, fontSize: 11.5, lineHeight: 1.4 }}>{article.title}</span>
                  )}
                </div>

                {article.summary && (
                  <div>
                    <div style={{ color: 'var(--text-dim)', fontSize: 10.5, lineHeight: 1.45, display: expanded ? 'block' : '-webkit-box', WebkitLineClamp: expanded ? 'unset' : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis' }}>{article.summary}</div>
                    <button type="button" onClick={() => toggleExpand(article.id)} style={{ background: 'transparent', border: 0, color: 'var(--accent)', fontSize: 9, padding: 0, marginTop: 2, cursor: 'pointer', fontWeight: 600 }}>{expanded ? '▲ Ringkas' : '▼ Selengkapnya'}</button>
                  </div>
                )}
              </article>
            )
          })}

          {visibleArticles.length < filteredArticles.length && (
            <button type="button" onClick={() => setVisibleLimit((current) => current + 20)} style={{ alignSelf: 'center', margin: '4px 0 8px', padding: '5px 12px', border: '1px solid var(--border-bright)', borderRadius: 3, background: 'var(--panel-header)', color: 'var(--cyan)', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}>
              MUAT 20 BERITA BERIKUTNYA · {visibleArticles.length}/{filteredArticles.length}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
