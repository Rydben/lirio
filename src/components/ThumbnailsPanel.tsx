// Bot de miniaturas: por cada vídeo, las miniaturas que creó; eliges una y queda vinculada para subirse con él.
// Los comandos son del editor (`miniaturas`, `miniatura-elegir`, `miniaturas-generar`): botId es el del editor.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useJob } from '../lib/jobs'
import { JobProgress } from './JobProgress'
import { Icon, Pill, useToast } from './ui'

interface Thumb {
  archivo: string; ruta: string; texto?: string; tipo?: string; puntuacion?: number; elegida?: boolean; img?: string | null
  /** 0-100 (editor nuevo), con las razones cortas de esa nota */
  puntos?: number; razones?: string[]
}

const TIPO: Record<string, string> = { cara: 'Con tu cara', juego: 'Solo juego' }

/** Las de más puntos primero (si el editor ya los da); si no, en el orden de siempre. */
export function byPoints(ts: Thumb[]): Thumb[] {
  return ts.some((t) => typeof t.puntos === 'number')
    ? [...ts].sort((a, b) => (b.puntos ?? -1) - (a.puntos ?? -1))
    : ts
}
interface Video { carpeta: string; video: string; titulo?: string; elegida_por?: string; puede_regenerar?: boolean; miniaturas: Thumb[] }

export function ThumbnailsPanel({ botId }: { botId: string }) {
  const toast = useToast()
  const [videos, setVideos] = useState<Video[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    api.thumbnails(botId).then((r) => {
      if (r.ok && r.data?.videos) { setVideos(r.data.videos); setErr(null) } else setErr(r.data?.error ?? r.message)
    }).catch((e) => setErr(String(e)))
  }, [botId])
  useEffect(() => { load() }, [load])

  const choose = async (v: Video, t: Thumb) => {
    setBusy(t.ruta)
    const r = await api.runWith(botId, 'miniatura-elegir', { '@video': v.video, '@archivo': t.ruta })
    setBusy(null)
    toast(r.ok ? 'ok' : 'error', r.ok ? 'Miniatura elegida: se subirá con el vídeo.' : r.data?.error ?? r.message)
    load()
  }

  // Hacer miniaturas nuevas tarda varios minutos: en segundo plano, una cada vez
  const [regenFor, setRegenFor] = useState<string | null>(null)
  const regen = useJob(botId, 'miniaturas-generar', (e) => {
    toast(e.ok ? 'ok' : e.cancelado ? 'info' : 'error', e.ok ? 'Miniaturas nuevas listas.' : e.cancelado ? 'Cancelado.' : e.resultado?.error ?? e.mensaje ?? 'No se pudo')
    load()
  })
  const regenerate = (v: Video) => { setRegenFor(v.video); regen.start({ '@video': v.video }) }

  if (err) return <p className="panel warn">{err}</p>
  if (!videos) return <p className="panel muted">Cargando…</p>
  if (videos.length === 0) return <p className="panel muted">Todavía no hay miniaturas. Aparecerán aquí cuando el editor termine un vídeo.</p>

  return (
    <div className="stack">
      {videos.map((v) => (
        <section key={v.carpeta} className="panel">
          <div className="section-head">
            <h3><Icon name="image" size={18} /> {v.titulo || v.video}</h3>
            {v.puede_regenerar && (
              <button className="btn btn--ghost" disabled={busy !== null || regen.running} onClick={() => regenerate(v)}>
                <Icon name="refresh" size={16} /> {regen.running && regenFor === v.video ? 'Generando…' : 'Hacer otras'}
              </button>
            )}
          </div>
          {regenFor === v.video && <JobProgress job={regen.job} label="Haciendo miniaturas" onCancel={regen.cancel} />}
          <div className="thumbs">
            {byPoints(v.miniaturas).map((t) => (
              <figure key={t.ruta} className={`thumb${t.elegida ? ' is-chosen' : ''}`} title={t.razones?.join(' · ') || undefined}>
                {t.img ? <img src={t.img} alt={`Miniatura: ${t.texto || v.titulo || v.video}`} loading="lazy" />
                  : <div className="thumb__missing muted small">No se puede ver</div>}
                <figcaption>
                  {t.elegida ? <Pill tone="ok">{v.elegida_por === 'usuario' ? 'Elegida por ti' : 'Elegida'}</Pill> : (
                    <button className="btn btn--ghost" disabled={busy !== null} onClick={() => choose(v, t)}>
                      {busy === t.ruta ? 'Guardando…' : 'Usar esta'}
                    </button>
                  )}
                  {t.tipo && TIPO[t.tipo] && <span className="muted small">{TIPO[t.tipo]}</span>}
                  {typeof t.puntos === 'number' ? <span className="small thumb__pts">{Math.round(t.puntos)}/100</span>
                    : typeof t.puntuacion === 'number' && <span className="muted small">nota {t.puntuacion.toFixed(1)}</span>}
                </figcaption>
                {t.razones && t.razones.length > 0 && <p className="thumb__why muted small">{t.razones.join(' · ')}</p>}
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
