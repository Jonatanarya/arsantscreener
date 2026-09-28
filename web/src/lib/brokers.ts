import { useQuery } from '@tanstack/react-query'
import { fetchBrokers, type BrokerMaster } from '../api/client'

/**
 * Master broker dari DATABASE (tabel `brokers`, diisi Data Collector dari
 * daftar resmi Stockbit). Menggantikan daftar broker yang sebelumnya
 * ditulis tangan di komponen.
 *
 * Di-cache lama: daftar broker IDX praktis tidak berubah dalam sehari.
 */
export function useBrokerMaster() {
  const { data } = useQuery({
    queryKey: ['brokers'],
    queryFn: fetchBrokers,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  })

  const byCode = new Map<string, BrokerMaster>()
  for (const b of data ?? []) byCode.set(b.code.toUpperCase(), b)
  return byCode
}

/** "Asing"/"Lokal" dinormalkan supaya perbandingan tidak bergantung ejaan. */
function normDomicile(v?: string): 'asing' | 'lokal' | 'campuran' | '' {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return ''
  if (s.startsWith('as') || s.startsWith('for')) return 'asing'
  if (s.startsWith('lok') || s.startsWith('loc') || s.startsWith('dom')) return 'lokal'
  if (s.startsWith('camp') || s.startsWith('mix')) return 'campuran'
  return ''
}

export type FlowMark = {
  /** Domisili aliran dana yang lewat broker ini. */
  flow: 'asing' | 'lokal' | 'campuran' | ''
  /** Kebangsaan brokernya sendiri. */
  broker: 'asing' | 'lokal' | ''
  /**
   * true bila keduanya BERBEDA — kasus seperti YU: brokernya asing, tapi yang
   * bertransaksi lewat dia investor lokal. Tanpa penanda ini, flow lokal
   * gampang salah dibaca sebagai "asing masuk" hanya karena kode brokernya.
   */
  mismatch: boolean
  label: string
  title: string
}

export function flowMark(
  code: string,
  investorType: string | undefined,
  master: Map<string, BrokerMaster>,
): FlowMark {
  const m = master.get(String(code ?? '').toUpperCase())
  const brokerDom = normDomicile(m?.group) || (m?.type === 'asing' ? 'asing' : '')
  const flow = normDomicile(investorType)

  const broker: 'asing' | 'lokal' | '' = brokerDom === 'campuran' ? '' : brokerDom
  const mismatch = !!flow && !!broker && flow !== broker && flow !== 'campuran'

  let label = ''
  if (flow === 'asing') label = 'F'
  else if (flow === 'lokal') label = 'D'
  else if (flow === 'campuran') label = 'M'

  const namaBroker = broker === 'asing' ? 'broker asing' : broker === 'lokal' ? 'broker lokal' : 'broker'
  const namaFlow =
    flow === 'asing' ? 'investor asing'
      : flow === 'lokal' ? 'investor lokal'
        : flow === 'campuran' ? 'investor campuran' : 'domisili tidak diketahui'

  return {
    flow,
    broker,
    mismatch,
    label,
    title: mismatch
      ? `${code}: ${namaBroker}, tapi yang bertransaksi ${namaFlow} — jangan dibaca sebagai flow asing`
      : `${code}: ${namaBroker} · ${namaFlow}`,
  }
}

/** Nilai rata-rata per transaksi — dasar deteksi smart money. */
export function avgPerTrx(value: number, freq: number): number {
  return freq > 0 ? value / freq : 0
}

/**
 * Skema warna golongan broker — satu sumber untuk seluruh panel:
 *   Merah  = Asing
 *   Hijau  = BUMN
 *   Kuning = Lokal (termasuk institusi lokal & ritel)
 */
export const BROKER_GROUP_COLOR = {
  asing: '#ef4444',
  bumn: '#22c55e',
  lokal: '#eab308',
  unknown: '#94a3b8',
} as const

export type BrokerGroup = keyof typeof BROKER_GROUP_COLOR

/**
 * Golongan broker untuk pewarnaan. `type` dari backend lebih spesifik daripada
 * `group` Stockbit (yang cuma Asing/Lokal), jadi itu yang dipakai lebih dulu —
 * kalau tidak, BUMN akan tampil kuning karena Stockbit menggolongkannya "Lokal".
 */
export function brokerGroup(code: string, master: Map<string, BrokerMaster>): BrokerGroup {
  const m = master.get(String(code ?? '').toUpperCase())
  if (!m) return 'unknown'
  if (m.type === 'bumn') return 'bumn'
  if (m.type === 'asing') return 'asing'
  if (normDomicile(m.group) === 'asing') return 'asing'
  if (m.type) return 'lokal'
  return 'unknown'
}

export const DISTINCT_BROKER_COLORS: Record<string, string> = {
  XL: '#22d3ee', // Cyan
  YP: '#f43f5e', // Rose Red
  AK: '#a855f7', // Violet Purple
  CC: '#10b981', // Emerald Green
  XC: '#f59e0b', // Amber Gold
  HP: '#ec4899', // Hot Pink
  BK: '#3b82f6', // Bright Blue
  PD: '#84cc16', // Lime Green
  GR: '#d946ef', // Fuchsia
  YU: '#06b6d4', // Teal
  ZP: '#fb923c', // Tangerine
  LG: '#6366f1', // Indigo
  IU: '#e11d48', // Crimson
  OD: '#14b8a6', // Mint Teal
  EP: '#f97316', // Dark Orange
  NI: '#22c55e', // Spring Green
  CP: '#ff007f', // Deep Pink
  YB: '#00b0ff', // Vivid Blue
  AZ: '#eab308', // Gold Yellow
  DR: '#ab47bc', // Orchid
  KI: '#26a69a', // Sea Green
}

const PALETTE = [
  '#22d3ee', '#f43f5e', '#a855f7', '#10b981', '#f59e0b',
  '#ec4899', '#3b82f6', '#84cc16', '#d946ef', '#06b6d4',
  '#fb923c', '#6366f1', '#e11d48', '#14b8a6', '#f97316',
  '#22c55e', '#ff007f', '#4da3ff', '#eab308', '#8b5cf6',
]

export function brokerColor(code: string, _master?: Map<string, BrokerMaster>): string {
  const clean = String(code ?? '').toUpperCase().trim()
  if (!clean) return '#94a3b8'
  if (DISTINCT_BROKER_COLORS[clean]) return DISTINCT_BROKER_COLORS[clean]

  let hash = 0
  for (let i = 0; i < clean.length; i++) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash)
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

export const BROKER_GROUP_LABEL: Record<BrokerGroup, string> = {
  asing: 'Asing',
  bumn: 'BUMN',
  lokal: 'Lokal',
  unknown: '—',
}
