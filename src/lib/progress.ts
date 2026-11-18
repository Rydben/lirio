// Cómo va el trabajo actual del editor (descarga, remux, edición) y si se ha quedado parado sin avisar.
import { human } from '../components/units'
import type { BotView } from './api'

const STAGES: Record<string, string> = {
  download: 'Descargando el directo', chat: 'Descargando el chat',
  descarga: 'Descargando el directo', remux: 'Preparando el vídeo (remux)', ingest: 'Leyendo el vídeo', mic: 'Revisando tu micro',
  transcribe: 'Escuchando lo que dices', detect: 'Buscando los mejores momentos', select: 'Eligiendo los clips', edit: 'Montando el vídeo',
  thumbnail: 'Haciendo miniaturas', publish: 'Preparando la subida',
}

export const stageName = (stage?: string) => (stage ? STAGES[stage] ?? stage : 'Trabajando')

export function fmtEta(s: number): string {
  if (s < 60) return 'menos de 1 min'
  if (s < 3600) return `${Math.ceil(s / 60)} min`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`
}

/** «1,2 GB de 3,4 GB · 15,0 MB/s · quedan 3 min» (solo lo que el bot dé) */
export function jobDetail(job: Record<string, any>): string {
  const parts: string[] = []
  if (job.bytes_total) parts.push(`${human(job.bytes_done ?? 0)} de ${human(job.bytes_total)}`)
  if (job.speed_bps) parts.push(`${human(job.speed_bps)}/s`)
  if (typeof job.eta_s === 'number' && job.eta_s > 0) parts.push(`quedan ${fmtEta(job.eta_s)}`)
  return parts.join(' · ')
}

export const STALL_MIN = 15
const hhmm = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

/** ¿El editor no avanza? 1) él mismo lo dice (`atasco`: 45 min sin avanzar el bucle), o 2) vigila sin trabajo
 *  y hay un directo «pendiente» de editar desde hace más de 15 min. (Los «en_espera» o «fallido» los explica `warning`.) */
export function stalledInput(b: BotView, now = Date.now()): { desde: string; min: number; etapa?: string } | null {
  const s = b.status
  if (!s) return null
  const a = s.atasco
  if (a) {
    const t = Date.parse(a.desde)
    return { desde: Number.isNaN(t) ? String(a.desde ?? '') : hhmm(t), min: Number(a.minutos ?? 0), etapa: a.etapa }
  }
  if (s.current_job || !['watching', 'idle', 'running'].includes(b.state)) return null
  const pend = (s.pendientes_de_editar ?? []) as { estado?: string; descargado_at?: string }[]
  const t = pend.filter((p) => p.estado === 'pendiente').map((p) => Date.parse(p.descargado_at ?? '')).filter((x) => !Number.isNaN(x)).sort()[0]
  if (t === undefined) return null
  const min = Math.floor((now - t) / 60000)
  return min >= STALL_MIN ? { desde: hhmm(t), min, etapa: 'esperando para editar' } : null
}

/** Tarea en segundo plano del editor (status.json → tareas.<nombre>) */
export interface EditorTask { estado: 'en_marcha' | 'hecho' | 'error'; porcentaje?: number; etapa?: string; archivo?: string; error?: string; resultado?: any }
export const editorTask = (b: BotView | undefined, name: string): EditorTask | null => b?.status?.tareas?.[name] ?? null
