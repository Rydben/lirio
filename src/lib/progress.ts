// Cómo va el trabajo actual del editor (descarga, remux, edición) y si se ha quedado parado sin avisar.
import { human } from '../components/units'
import type { BotView } from './api'

const STAGES: Record<string, string> = {
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

/** El bot dice que vigila, no está haciendo nada y tiene un directo descargado esperando desde hace rato. */
export function stalledInput(b: BotView, now = Date.now()): { ruta: string; desde: string; min: number } | null {
  const s = b.status
  if (!s || s.current_job || !['watching', 'idle', 'running'].includes(b.state)) return null
  const list: { ruta: string; descargado_at: string }[] = s.pendientes_de_editar ?? []
  const oldest = list.map((p) => ({ ...p, t: Date.parse(p.descargado_at) })).filter((p) => !Number.isNaN(p.t)).sort((a, z) => a.t - z.t)[0]
  if (!oldest) return null
  const min = Math.floor((now - oldest.t) / 60000)
  if (min < STALL_MIN) return null
  return { ruta: oldest.ruta, desde: new Date(oldest.t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }), min }
}
