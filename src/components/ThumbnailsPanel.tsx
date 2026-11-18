// Bot de miniaturas: por cada vídeo, las miniaturas que creó; eliges una y queda vinculada para subirse con él.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Icon, Pill, timeAgo, useToast } from './ui'

interface Thumb { ruta: string; creada?: string; puntuacion?: number; img?: string | null }
interface Video { id: string; titulo?: string; video?: string; fecha?: string; elegida?: string | null; miniaturas: Thumb[] }


export function ThumbnailsPanel({ botId }: { botId: string }) {
  const toast = useToast()
  const [videos, setVideos] = useState<Video[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    api.thumbnails(botId).then((r) => {
      if (r.ok) { setVideos(r.data?.videos ?? []); setErr(null) } else setErr(r.data?.error ?? r.message)
    }).catch((e) => setErr(String(e)))
  }, [botId])
  useEffect(() => { load() }, [load])

  const choose = async (v: Video, t: Thumb) => {
    setBusy(t.ruta)
    const r = await api.runWith(botId, 'miniatura-elegir', { '--video': v.id, '--archivo': t.ruta })
    setBusy(null)
    toast(r.ok ? 'ok' : 'error', r.ok ? 'Miniatura elegida: se subirá con el vídeo.' : r.data?.error ?? r.message)
    load()
  }

  if (err) return <p className="panel warn">{err}</p>
  if (!videos) return <p className="panel muted">Cargando…</p>
  if (videos.length === 0) return <p className="panel muted">Todavía no hay miniaturas. Aparecerán aquí cuando el editor termine un vídeo.</p>

  return (
    <div className="stack">
      {videos.map((v) => (
        <section key={v.id} className="panel">
          <div className="section-head">
            <h3><Icon name="image" size={18} /> {v.titulo ?? v.id}</h3>
            <span className="muted small">{v.fecha ? timeAgo(v.fecha) : ''}</span>
          </div>
          <div className="thumbs">
            {v.miniaturas.map((t) => {
              const chosen = v.elegida === t.ruta
              return (
                <figure key={t.ruta} className={`thumb${chosen ? ' is-chosen' : ''}`}>
                  {t.img ? <img src={t.img} alt={`Miniatura de ${v.titulo ?? v.id}`} loading="lazy" />
                    : <div className="thumb__missing muted small">No se puede ver</div>}
                  <figcaption>
                    {chosen ? <Pill tone="ok">Elegida</Pill> : (
                      <button className="btn btn--ghost" disabled={busy !== null} onClick={() => choose(v, t)}>
                        {busy === t.ruta ? 'Guardando…' : 'Usar esta'}
                      </button>
                    )}
                    {typeof t.puntuacion === 'number' && <span className="muted small">nota {t.puntuacion.toFixed(1)}</span>}
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
