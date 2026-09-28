import { useEffect } from 'react'
import { useTerminalStore } from '../store/useTerminalStore'

export function HelpModal() {
  const helpOpen = useTerminalStore((s) => s.helpOpen)
  const setHelpOpen = useTerminalStore((s) => s.setHelpOpen)
  const activateTab = useTerminalStore((s) => s.activateTab)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && helpOpen) {
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [helpOpen, setHelpOpen])

  if (!helpOpen) return null

  const handleShortcutClick = (tabId: string) => {
    activateTab(tabId)
    setHelpOpen(false)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(3, 5, 7, 0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={() => setHelpOpen(false)}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 860,
          maxHeight: '90vh',
          background: '#090d14',
          border: '2px solid var(--accent)',
          boxShadow: '0 0 30px rgba(255, 157, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'var(--mono)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div
          style={{
            background: 'var(--accent)',
            color: '#000000',
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontWeight: 800,
            letterSpacing: 1,
            fontSize: 12,
          }}
        >
          <span>ARSANT SCREENER &bull; HELP & CHEAT SHEET [F1]</span>
          <button
            onClick={() => setHelpOpen(false)}
            style={{
              background: '#000',
              color: 'var(--accent)',
              border: 'none',
              padding: '2px 8px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            ESC / CLOSE
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 16, overflowY: 'auto', flex: 1, fontSize: 12, color: 'var(--text)' }}>
          {/* Top Banner */}
          <div
            style={{
              border: '1px solid var(--cyan)',
              background: 'var(--cyan-dim)',
              padding: '10px 12px',
              marginBottom: 16,
              borderRadius: 3,
            }}
          >
            <div style={{ color: 'var(--cyan)', fontWeight: 700, marginBottom: 4 }}>
              ⚡ ARSANT SCREENER - SYSTEM DIRECTORY
            </div>
            <div>
              Workspace analisis kuantitatif pasar saham BEI (Indonesia Stock Exchange). Mengintegrasikan deteksi fase
              akumulasi/distribusi bandar, VSA/PVA volume spread analysis, real-time live tape & orderbook analysis, serta
              kalkulator risiko portofolio.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Function Keys Shortcuts */}
            <div style={{ border: '1px solid var(--border)', padding: 12, background: 'var(--panel-header)' }}>
              <div style={{ color: 'var(--accent)', fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>
                FUNCTION KEYS (F1 - F12 &amp; ⇧F2 - ⇧F6)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                {[
                  { key: 'F1', label: 'HELP', tab: 'help' },
                  { key: 'F2', label: 'DECISION', tab: 'decision' },
                  { key: 'F3', label: 'CHART', tab: 'chart' },
                  { key: 'F4', label: 'BROKER FLOW', tab: 'brokerAnalysis' },
                  { key: 'F5', label: 'LIVE TAPE', tab: 'liveTape' },
                  { key: 'F6', label: 'PVA / VSA', tab: 'pva' },
                  { key: 'F7', label: 'OUTLOOK', tab: 'outlook' },
                  { key: 'F8', label: 'FUNDAMENTAL', tab: 'fundamentals' },
                  { key: 'F9', label: 'PORTFOLIO', tab: 'portfolio' },
                  { key: 'F10', label: 'MACRO', tab: 'macro' },
                  { key: 'F11', label: 'SCANNER', tab: 'scanner' },
                  { key: 'F12', label: 'NEWS FEED', tab: 'news' },
                  { key: '⇧F2', label: 'TEKNIKAL', tab: 'teknikal' },
                  { key: '⇧F3', label: 'STOCK PROFILER', tab: 'stockProfiler' },
                  { key: '⇧F4', label: 'BROKER PROFILER', tab: 'brokerProfiler' },
                  { key: '⇧F5', label: 'FOREIGN RADAR', tab: 'foreignRadar' },
                  { key: '⇧F6', label: 'SID & SCRIPLESS', tab: 'sid' },
                ].map((item) => (
                  <div
                    key={item.key}
                    onClick={() => item.tab !== 'help' && handleShortcutClick(item.tab)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      padding: '2px 4px',
                      borderRadius: 2,
                    }}
                  >
                    <span className="bbg-badge bbg-badge-amber">{item.key}</span>
                    <span style={{ color: 'var(--text-h)' }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Arsant Command Codes */}
            <div style={{ border: '1px solid var(--border)', padding: 12, background: 'var(--panel-header)' }}>
              <div style={{ color: 'var(--cyan)', fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>
                ARSANT COMMAND CODES (&lt;CMD&gt;)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>[SYMBOL] &lt;GO&gt;</span> &bull; Ganti saham aktif
                  (contoh: <code style={{ color: 'var(--cyan)' }}>BBCA</code>, <code style={{ color: 'var(--cyan)' }}>TLKM</code>)
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>BRKR</span> &bull; Buka Analisa Broker Flow & Bandar
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>TAPE</span> &bull; Buka Orderbook Live Tape
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>DEC</span> &bull; Ringkasan Sinyal Keputusan Trading
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>PORT</span> &bull; Kelola Posisi & Kalkulator Risiko
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>TA</span> &bull; Indikator Teknikal, Pivot &amp; Konfluensi TA+Flow
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>SP</span> &bull; Stock Profiler: aliran asing, floor akumulator &amp; inventory broker
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>BP</span> &bull; Broker Profiler: intel broker&times;saham &amp; portofolio broker
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>FR</span> &bull; Foreign Radar: konsistensi akumulasi asing &amp; rotasi sektor
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>SID</span> &bull; Kepemilikan KSEI: perubahan pemegang, scripless &amp; divergensi
                </div>
                <div>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>/ atau Ctrl+K</span> &bull; Sorot Kolom Perintah &lt;CMD&gt;
                </div>
              </div>
            </div>
          </div>

          {/* Core Analytics Guide */}
          <div style={{ border: '1px solid var(--border)', padding: 12, background: 'var(--panel-header)' }}>
            <div style={{ color: 'var(--up)', fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 8 }}>
              GLOSARIUM ANALISA BANDARMOLOGI &amp; RISK MANAGEMENT
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 11 }}>
              <div>
                <strong style={{ color: 'var(--text-h)' }}>Deteksi Fase Akumulasi / Distribusi:</strong>
                <p style={{ margin: '4px 0 8px 0', color: 'var(--text-dim)' }}>
                  Kotak Hijau menandakan area akumulasi smart money. Kotak Merah menandakan distribusi broker besar.
                </p>
                <strong style={{ color: 'var(--text-h)' }}>Orderbook Fake Warning (⚠):</strong>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-dim)' }}>
                  Peringatan jika terdapat antrian bid/offer yang sering dicabut (fake wall) untuk mengelabui trader ritel.
                </p>
              </div>
              <div>
                <strong style={{ color: 'var(--text-h)' }}>Aturan Manajemen Risiko 2%:</strong>
                <p style={{ margin: '4px 0 8px 0', color: 'var(--text-dim)' }}>
                  Maksimal kerugian per transaksi dianjurkan 2% dari total equity portofolio. Hitung lot ideal di panel Portfolio [F9].
                </p>
                <strong style={{ color: 'var(--text-h)' }}>Sinyal Skor Keputusan:</strong>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-dim)' }}>
                  Skor &ge; +4 merekomendasikan BELI, sedangkan Skor &le; -3 merekomendasikan HINDARI.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            background: 'var(--panel-header)',
            borderTop: '1px solid var(--border)',
            padding: '6px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            color: 'var(--text-dim)',
            fontSize: 10,
          }}
        >
          <span>ARSANT SCREENER v2.5 &bull; ANALYSIS WORKSPACE</span>
          <span>TEKAN ESC UNTUK MENUTUP</span>
        </div>
      </div>
    </div>
  )
}
