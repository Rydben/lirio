// Bot de miniaturas: por cada vídeo, las miniaturas que creó; eliges una y queda vinculada para subirse con él.
// Los comandos son del editor (`miniaturas`, `miniatura-elegir`, `miniaturas-generar`): botId es el del editor.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Icon, Pill, useToast } from './ui'

interface Thumb { archivo: string; ruta: string; texto?: string; tipo?: string; puntuacion?: number; elegida?: boolean; img?: string | null }
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

  const regenerate = async (v: Video) => {
    setBusy(v.video)
    toast('info', 'Haciendo miniaturas nuevas… puede tardar un poco.')
    const r = await api.runWith(botId, 'miniaturas-generar', { '@video': v.video })
    setBusy(null)
    toast(r.ok ? 'ok' : 'error', r.ok ? 'Miniaturas nuevas listas.' : r.data?.error ?? r.message)
    load()
  }

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
              <button className="btn btn--ghost" disabled={busy !== null} onClick={() => regenerate(v)}>
                <Icon name="refresh" size={16} /> {busy === v.video ? 'Generando…' : 'Hacer otras'}
              </button>
            )}
          </div>
          <div className="thumbs">
            {v.miniaturas.map((t) => (
              <figure key={t.ruta} className={`thumb${t.elegida ? ' is-chosen' : ''}`}>
                {t.img ? <img src={t.img} alt={`Miniatura: ${t.texto || v.titulo || v.video}`} loading="lazy" />
                  : <div className="thumb__missing muted small">No se puede ver</div>}
                <figcaption>
                  {t.elegida ? <Pill tone="ok">{v.elegida_por === 'usuario' ? 'Elegida por ti' : 'Elegida'}</Pill> : (
                    <button className="btn btn--ghost" disabled={busy !== null} onClick={() => choose(v, t)}>
                      {busy === t.ruta ? 'Guardando…' : 'Usar esta'}
                    </button>
                  )}
                  {typeof t.puntuacion === 'number' && <span className="muted small">nota {t.puntuacion.toFixed(1)}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
