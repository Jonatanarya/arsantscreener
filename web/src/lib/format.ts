export function fmtRp(v: number): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`
  return `${sign}${a.toFixed(0)}`
}
