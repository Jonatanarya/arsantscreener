import { useState } from 'react'

type ChannelPreset = {
  id: string
  label: string
  source: string
  channelId: string
  liveEmbedUrl: string
  playlistEmbedUrl: string
  channelUrl: string
  featuredVideos: { id: string; title: string; date: string; category: string }[]
}

const CHANNEL_PRESETS: ChannelPreset[] = [
  {
    id: 'idx-channel',
    label: '📈 IDX Channel Live (Bursa Efek Indonesia)',
    source: 'IDX Channel Official',
    channelId: 'UCVp25YwW6-J-T5G4r9Q8qXg',
    liveEmbedUrl: 'https://www.youtube-nocookie.com/embed/8dNAAe5dcqQ?autoplay=1',
    playlistEmbedUrl: 'https://www.youtube-nocookie.com/embed/videoseries?list=UUVp25YwW6-J-T5G4r9Q8qXg',
    channelUrl: 'https://www.youtube.com/@idxchannel/streams',
    featuredVideos: [
      { id: '8dNAAe5dcqQ', title: '🔴 [LIVE SANGAT INI] IDX Channel Broadcast BEI', date: 'LIVE SEKARANG', category: 'IDX Live' },
      { id: 'live_stream?channel=UCVp25YwW6-J-T5G4r9Q8qXg', title: '📺 [AUTO-FEED] Stream Otomatis IDX Channel', date: 'LIVE STREAM', category: 'IDX Channel' },
      { id: 'videoseries?list=UUVp25YwW6-J-T5G4r9Q8qXg', title: '📈 Opening & Closing Bell BEI Terbaru', date: 'UPLOAD TERBARU', category: 'Market News' },
    ],
  },
  {
    id: 'sekretariat-presiden',
    label: '🇮🇩 Sekretariat Presiden (Prabowo Subianto)',
    source: 'Sekretariat Presiden RI',
    channelId: 'UC8x_z--d_S4K2s64XgQ4a4A',
    liveEmbedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UC8x_z--d_S4K2s64XgQ4a4A&autoplay=1',
    playlistEmbedUrl: 'https://www.youtube-nocookie.com/embed/videoseries?list=UU8x_z--d_S4K2s64XgQ4a4A',
    channelUrl: 'https://www.youtube.com/@SekretariatPresiden/streams',
    featuredVideos: [
      { id: 'live_stream?channel=UC8x_z--d_S4K2s64XgQ4a4A', title: '🔴 [AUTO-LIVE] Siaran Langsung Sekretariat Presiden RI', date: 'LIVE STREAM', category: 'Presiden Prabowo' },
      { id: 'videoseries?list=UU8x_z--d_S4K2s64XgQ4a4A', title: '🎬 Playlist Terbaru Pidato & Kegiatan Presiden Prabowo', date: 'UPLOAD TERBARU', category: 'Playlist' },
    ],
  },
  {
    id: 'cnbc-indonesia',
    label: '📺 CNBC Indonesia Market Live',
    source: 'CNBC Indonesia',
    channelId: 'UCn8v0C0_XkFfR0a_T2-XvQg',
    liveEmbedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UCn8v0C0_XkFfR0a_T2-XvQg&autoplay=1',
    playlistEmbedUrl: 'https://www.youtube-nocookie.com/embed/videoseries?list=UUn8v0C0_XkFfR0a_T2-XvQg',
    channelUrl: 'https://www.youtube.com/@CNBCIndonesia/streams',
    featuredVideos: [
      { id: 'live_stream?channel=UCn8v0C0_XkFfR0a_T2-XvQg', title: '🔴 [AUTO-LIVE] CNBC Indonesia Squawk Box & Market Live', date: 'LIVE STREAM', category: 'CNBC Indonesia' },
      { id: 'videoseries?list=UUn8v0C0_XkFfR0a_T2-XvQg', title: '📺 Berita Ekonomi & Pergerakan Saham Terbaru', date: 'UPLOAD TERBARU', category: 'Market Corner' },
    ],
  },
  {
    id: 'kompas-tv',
    label: '📰 Kompas TV Live News',
    source: 'Kompas TV',
    channelId: 'UC4-87T1_S2L7_a75X11t9qA',
    liveEmbedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UC4-87T1_S2L7_a75X11t9qA&autoplay=1',
    playlistEmbedUrl: 'https://www.youtube-nocookie.com/embed/videoseries?list=UU4-87T1_S2L7_a75X11t9qA',
    channelUrl: 'https://www.youtube.com/@kompastv/streams',
    featuredVideos: [
      { id: 'live_stream?channel=UC4-87T1_S2L7_a75X11t9qA', title: '🔴 [AUTO-LIVE] Kompas TV Breaking News Live', date: 'LIVE STREAM', category: 'News' },
      { id: 'videoseries?list=UU4-87T1_S2L7_a75X11t9qA', title: '📰 Berita Nasional & Ekonomi Terbaru', date: 'UPLOAD TERBARU', category: 'Playlist' },
    ],
  },
]

function extractYoutubeVideoId(url: string): string | null {
  if (!url) return null
  const clean = url.trim()
  if (clean.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(clean)) {
    return clean
  }
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|live\/|watch\?v=|\&v=)([^#\&\?]*).*/
  const match = clean.match(regExp)
  return match && match[2].length === 11 ? match[2] : null
}

export function LiveStreamPanel() {
  const [activeChannel, setActiveChannel] = useState(CHANNEL_PRESETS[0])
  const [mode, setMode] = useState<'live' | 'playlist' | 'video'>('live')
  const [selectedVideoPath, setSelectedVideoPath] = useState<string | null>(null)
  const [customInput, setCustomInput] = useState('')

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!customInput.trim()) return
    const vidId = extractYoutubeVideoId(customInput)
    if (vidId) {
      setSelectedVideoPath(vidId)
      setMode('video')
    } else {
      setSelectedVideoPath(customInput.trim())
      setMode('video')
    }
  }

  let iframeSrc = activeChannel.liveEmbedUrl
  if (mode === 'playlist') {
    iframeSrc = activeChannel.playlistEmbedUrl
  } else if (mode === 'video' && selectedVideoPath) {
    if (selectedVideoPath.startsWith('live_stream') || selectedVideoPath.startsWith('videoseries')) {
      iframeSrc = `https://www.youtube-nocookie.com/embed/${selectedVideoPath}`
    } else {
      iframeSrc = `https://www.youtube-nocookie.com/embed/${selectedVideoPath}?autoplay=1`
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {/* Header Bar */}
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
            [ SIARAN LANGSUNG AUTOMATIS &amp; VIDEO MARKET ]
          </span>
          <span className="bbg-badge bbg-badge-red" style={{ fontSize: 9 }}>
            ● LIVE AUTO
          </span>
        </div>

        {/* Channel Presets Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {CHANNEL_PRESETS.map((ch) => (
            <button
              key={ch.id}
              onClick={() => {
                setActiveChannel(ch)
                setSelectedVideoPath(null)
                setMode('live')
              }}
              style={{
                background: activeChannel.id === ch.id && !selectedVideoPath ? 'var(--accent)' : 'var(--bg)',
                color: activeChannel.id === ch.id && !selectedVideoPath ? '#000' : 'var(--text-dim)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '2px 8px',
                fontSize: 9.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {ch.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sub Header: Stream Mode Toggle & Input Custom */}
      <div
        style={{
          padding: '4px 8px',
          background: '#040608',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => {
              setMode('live')
              setSelectedVideoPath(null)
            }}
            style={{
              background: mode === 'live' ? 'var(--up-bg)' : 'transparent',
              color: mode === 'live' ? 'var(--up)' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '2px 8px',
              fontSize: 9.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            🔴 Live Stream Otomatis
          </button>
          <button
            onClick={() => {
              setMode('playlist')
              setSelectedVideoPath(null)
            }}
            style={{
              background: mode === 'playlist' ? 'var(--cyan-dim)' : 'transparent',
              color: mode === 'playlist' ? 'var(--cyan)' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '2px 8px',
              fontSize: 9.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            🎬 Upload Video Terbaru
          </button>
        </div>

        <form onSubmit={handleCustomSubmit} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 460 }}>
          <span style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>Paste Link:</span>
          <input
            type="text"
            placeholder="Paste link YouTube (mis. https://www.youtube.com/watch?v=8dNAAe5dcqQ)..."
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            style={{
              flex: 1,
              background: 'var(--panel)',
              color: 'var(--text-h)',
              border: '1px solid var(--border)',
              borderRadius: 3,
              padding: '3px 8px',
              fontSize: 10,
            }}
          />
          <button
            type="submit"
            style={{
              background: 'var(--cyan)',
              color: '#000',
              border: 'none',
              borderRadius: 3,
              padding: '3px 10px',
              fontSize: 10,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Putar
          </button>
        </form>
      </div>

      {/* Main View Area: Player Left + Video Feed List Right */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 280px', minHeight: 0 }}>
        {/* Left Player Viewport */}
        <div style={{ background: '#000', position: 'relative', overflow: 'hidden' }}>
          <iframe
            src={iframeSrc}
            title="YouTube Live Stream Player"
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>

        {/* Right Side Video Feeds List */}
        <div style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 8 }}>
          <div style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 10, marginBottom: 8, letterSpacing: 0.5 }}>
            DAFTAR STREAMING &amp; VIDEO {activeChannel.source.toUpperCase()}:
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeChannel.featuredVideos.map((v) => {
              const isSelected = (mode === 'video' && selectedVideoPath === v.id) || (mode === 'live' && v.id.includes(selectedVideoPath || '8dNAAe5dcqQ'))
              return (
                <div
                  key={v.id}
                  onClick={() => {
                    setSelectedVideoPath(v.id)
                    setMode('video')
                  }}
                  style={{
                    background: isSelected ? 'var(--cyan-dim)' : 'var(--bg)',
                    border: `1px solid ${isSelected ? 'var(--cyan)' : 'var(--border)'}`,
                    borderRadius: 4,
                    padding: '8px 10px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span className="bbg-badge" style={{ background: 'var(--down-bg)', color: 'var(--down)' }}>
                      {v.category}
                    </span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 8.5 }}>{v.date}</span>
                  </div>
                  <div style={{ color: isSelected ? 'var(--cyan)' : 'var(--text-h)', fontWeight: 700, fontSize: 10.5, lineHeight: 1.3 }}>
                    {v.title}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Direct Link Footer */}
          <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <a
              href={activeChannel.channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--accent)',
                fontSize: 10,
                fontWeight: 700,
                textDecoration: 'none',
                display: 'block',
                textAlign: 'center',
              }}
            >
              ↗ Buka Langsung Channel {activeChannel.source} di YouTube
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
