// Monetización: requisitos (datos con fuente y fecha) + cifras reales del canal (comando `monetizacion` de cada bot).
// Lirio solo guía: nunca acepta contratos ni toca datos fiscales o bancarios.
import bundled from '../data/monetizacion.json'

export interface Requisito { id: string; texto: string; meta: number; unidad?: 'min' | 'h'; dato: string }
export type Linea = Requisito | { una_de: Requisito[] }
export interface Programa { id: string; nombre: string; resumen: string; fuente: string; requisitos: Linea[]; notas?: string[] }
export interface Paso { texto: string; url?: string }
export interface Plataforma {
  nombre: string; programas: Programa[]
  pago: { umbral: string; cuando: string; fuente: string }
  pasos: Paso[]; ganar: { nombre: string; texto: string; url?: string }[]; aviso_fecha?: string
}
export interface Datos { formato: string; comprobado: string; nota?: string; plataformas: { twitch: Plataforma; youtube: Plataforma } }

export const BUNDLED = bundled as unknown as Datos

/** La copia publicada (firmada) si es igual de nueva o más que la de dentro; si no, la de dentro. */
export function pickData(remote: unknown): Datos {
  const r = remote as Datos | null
  if (r && r.formato === BUNDLED.formato && typeof r.comprobado === 'string' && r.comprobado >= BUNDLED.comprobado
      && r.plataformas?.twitch && r.plataformas?.youtube) return r
  return BUNDLED
}

/** `ultimos_30_dias.minutos_emitidos` -> valor numérico de las cifras del bot (null si no lo sabe). */
export function valueAt(stats: unknown, path: string): number | null {
  let v: unknown = stats
  for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Por qué no hay un dato: el `motivo` que dé el bot (p. ej. `motivos.seguidores`) o null. */
export function reasonAt(stats: unknown, path: string): string | null {
  const s = stats as Record<string, any> | null
  const parts = path.split('.')
  const key = parts.pop()!
  // el motivo puede venir junto al dato (`ultimos_30_dias.motivos.media_espectadores`) o arriba (`motivos.seguidores`)
  let parent: any = s
  for (const k of parts) parent = parent?.[k]
  return parent?.motivos?.[key] ?? s?.motivos?.[path] ?? s?.motivos?.[key] ?? null
}

export interface Progreso { req: Requisito; valor: number | null; pct: number; hecho: boolean; motivo: string | null }

export function progress(req: Requisito, stats: unknown): Progreso {
  const valor = valueAt(stats, req.dato)
  const pct = valor === null ? 0 : Math.max(0, Math.min(100, (valor / req.meta) * 100))
  return { req, valor, pct, hecho: valor !== null && valor >= req.meta, motivo: valor === null ? reasonAt(stats, req.dato) : null }
}

/** De varias alternativas («una de»), la que va más avanzada. */
export function bestOf(reqs: Requisito[], stats: unknown): Progreso {
  return reqs.map((r) => progress(r, stats)).sort((a, b) => Number(b.hecho) - Number(a.hecho) || b.pct - a.pct)[0]
}

export function lineProgress(l: Linea, stats: unknown): Progreso {
  return 'una_de' in l ? bestOf(l.una_de, stats) : progress(l, stats)
}

/** ¿Cumple todo el programa? null si falta algún dato para saberlo. */
export function programDone(p: Programa, stats: unknown): boolean | null {
  const ps = p.requisitos.map((l) => lineProgress(l, stats))
  if (ps.every((x) => x.hecho)) return true
  if (ps.some((x) => x.valor === null)) return null
  return false
}

const nf = new Intl.NumberFormat('es-ES')
export function fmt(v: number | null, unidad?: string): string {
  if (v === null) return '—'
  if (unidad === 'min') return `${nf.format(Math.round((v / 60) * 10) / 10)} h`
  if (unidad === 'h') return `${nf.format(Math.round(v))} h`
  return nf.format(Math.round(v * 10) / 10)
}

/** Fecha «2026-11-19» -> «19 de noviembre de 2026». */
export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Cada cuánto se pregunta a los bots: en directo, a menudo (Twitch); fuera, poco (la cuota de YouTube es de 10 000 al día). */
export const EN_DIRECTO_MS = 30_000
export const FUERA_MS = 10 * 60_000
