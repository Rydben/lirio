// Aviso en la página del editor: cuántos días le quedan al permiso de YouTube (modo «Pruebas»: 7 días) y, si ha
// caducado o una subida ha fallado por algo de Google, el arreglo exacto con «Volver a autorizar» a un clic.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { fixFor, statusText, type YouTubeStatus } from '../lib/youtube'
import { FixCard, YouTubeAuth } from './YouTubeAuth'
import { YouTubeGuide } from './YouTubeGuide'

export function YouTubeConnection({ botId, waitingAuth, lastError }: { botId: string; waitingAuth: boolean; lastError?: string | null }) {
  const [s, setS] = useState<YouTubeStatus | null>(null)
  const load = useCallback(() => { api.youtubeStatus(botId).then(setS).catch(() => setS(null)) }, [botId])
  useEffect(load, [load, waitingAuth])
  if (!s) return null
  const st = statusText(s)
  const fix = fixFor(lastError)
  const needs = waitingAuth || ['caducado', 'caduca_pronto', 'desconocido'].includes(s.estado) || fix?.code === 'caducado'
  if (s.estado === 'sin_archivo' || s.estado === 'sin_autorizar') {
    return (
      <div className="stack" data-testid="youtube-conexion">
        <p className="warning-text small">YouTube sin conectar: las subidas esperan en la cola. Sigue estos pasos (solo una vez):</p>
        <YouTubeGuide botId={botId} onDone={load} />
      </div>
    )
  }
  return (
    <div className="stack" data-testid="youtube-conexion">
      {st && <p className={`small ${st.tone === 'ok' ? 'ok-text' : st.tone === 'error' ? 'error-text' : 'warning-text'}`}>{st.text}</p>}
      {fix && fix.code !== 'caducado' && <FixCard fix={fix} projectId={s.project_id} />}
      {needs && <YouTubeAuth botId={botId} projectId={s.project_id} again={s.token} onDone={load} />}
    </div>
  )
}
