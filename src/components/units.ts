/** 1234567 -> "1,2 MB" (con coma decimal, como en España) */
export function human(bytes?: number | null): string {
  const b = bytes ?? 0
  const [v, u] = b >= 1e9 ? [b / 1e9, 'GB'] : b >= 1e6 ? [b / 1e6, 'MB'] : [b / 1e3, 'KB']
  return `${v.toFixed(v >= 100 ? 0 : 1).replace('.', ',')} ${u}`
}
