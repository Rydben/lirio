// Tarjetas de aprobación (The Wall): aprobar o rechazar manteniendo pulsado 2 s.
import { useEffect, useState } from 'react'
import { api, studioUrl, type Approval, type BotView, type SignedOperation } from '../lib/api'
import { useStore } from '../lib/store'
import { HoldButton } from './HoldButton'
import { Icon, timeAgo, useToast } from './ui'

const ACTION_TEXT: Record<string, string> = {
  'youtube.schedule_publish': 'Programar la publicación en YouTube (se hará público a la hora indicada)',
  'youtube.publish_public': 'Publicar en YouTube en público ahora',
  'youtube.publicar_tras_revision': 'Revisión obligatoria: el vídeo tenía contenido sensible (difuminado). Míralo antes de publicar',
  'youtube.publish_unlisted': 'Subir a YouTube como oculto',
  'youtube.upload_private': 'Subir a YouTube como privado',
  'files.delete_source_download': 'Borrar el VOD descargado (ya editado)',
  'files.delete_uploaded_render': 'Borrar el vídeo ya subido (se guardan miniatura y datos)',
  'files.delete_temp': 'Borrar archivos temporales',
  'twitch.ban': 'Banear a un usuario del chat',
  'twitch.timeout_long': 'Timeout largo a un usuario del chat',
  'twitch.protect_mode': 'Activar el modo escudo del chat',
}

export function actionText(a: Approval): string {
  return ACTION_TEXT[a.action] ?? a.action
}

function detailText(a: Approval): string | null {
  const d = a.details ?? {}
  const parts = [d.title, d.user && `usuario ${d.user}`, d.reason].filter(Boolean) as string[]
  if (parts.length) return parts.join(' · ')
  if (a.key) return a.key.split(/[\\/]/).pop() ?? a.key
  return null
}

/** Una decisión firmada: el núcleo comprueba el gesto, firma y se la pasa al bot. */
export function useSignedDecision() {
  const toast = useToast()
  const { refresh } = useStore()
  return async (token: string, bot: string, op: SignedOperation, target: string, accion?: string, clave?: string) => {
    try {
      const r = await api.signedDecision(token, bot, op, target, accion, clave)
      toast(r.ok ? 'ok' : 'error', r.ok ? DONE[op] : r.message)
    } catch (e) {
      toast('error', String(e))
    }
    refresh()
  }
}

const DONE: Record<SignedOperation, string> = {
  approve: 'Aprobado. El bot seguirá con ello en su próxima vuelta.',
  deny: 'Rechazado. El bot no lo hará.',
  liberar: 'Vídeo liberado: el bot lo editará en su próxima vuelta.',
  reintentar: 'Listo: el bot lo volverá a intentar.',
}

/** Antes de aprobar una publicación: lo que hay que revisar en YouTube Studio y los riesgos de copyright que vio el editor.
 *  La API de YouTube no da el resultado de copyright: no se promete «sin copyright». */
function StudioChecks({ d }: { d: Record<string, unknown> }) {
  const url = studioUrl(d.studio_url)
  const riesgos = Array.isArray(d.riesgos_copyright) ? (d.riesgos_copyright as string[]) : []
  if (!url && !d.revisa && riesgos.length === 0) return null
  return (
    <div className="approval__checks" data-testid="comprobaciones-studio">
      {typeof d.revisa === 'string' && <p className="small">{d.revisa}</p>}
      {riesgos.length > 0 && <ul className="small warning-text">{riesgos.map((r) => <li key={r}>{r}</li>)}</ul>}
      {url && <button className="btn btn--outline small" onClick={() => api.openUrl(url)}>Abrir Comprobaciones en YouTube Studio</button>}
    </div>
  )
}

const NO_DETECTA = 'No detecta violencia o gore reales ni nombres reales sueltos: eso revísalo tú en el vídeo.'

/** Informe de moderación visual del editor (desnudos y datos personales difuminados): antes de aprobar publicar.
 *  Las capturas salen del vídeo ya difuminado; Lirio solo enseña las de la carpeta de moderación del propio bot. */
export function ModerationReport({ botId, d }: { botId: string; d: Record<string, unknown> }) {
  const m = (d.moderacion ?? null) as { grave?: boolean; difuminado?: number; revisar?: number; capturas?: string[]; nota?: string; no_detecta?: string } | null
  const rutas = m?.capturas ?? []
  const [imgs, setImgs] = useState<(string | null)[]>([])
  useEffect(() => {
    if (rutas.length === 0) return
    let alive = true
    api.moderationCaptures(botId, rutas).then((r) => { if (alive) setImgs(r) }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId, rutas.join('|')])
  if (!m) return null
  const n = (v: unknown) => (typeof v === 'number' ? v : 0)
  return (
    <div className={`approval__moderation${m.grave ? ' is-grave' : ''}`} data-testid="moderacion">
      <div className="small">
        <b>Moderación visual:</b> {n(m.difuminado)} {n(m.difuminado) === 1 ? 'zona difuminada' : 'zonas difuminadas'}
        {n(m.revisar) > 0 && <> · {n(m.revisar)} {n(m.revisar) === 1 ? 'dudosa para revisar' : 'dudosas para revisar'}</>}
      </div>
      {m.nota && <p className={`small ${m.grave ? 'warning-text' : 'muted'}`}>{m.nota}</p>}
      {imgs.some(Boolean) && (
        <div className="moderation__strip">
          {imgs.map((src, i) => src && <img key={rutas[i]} src={src} alt={`Captura difuminada ${i + 1}: ${rutas[i].split(/[\\/]/).pop()}`} loading="lazy" />)}
        </div>
      )}
      <p className="muted small">{m.no_detecta ?? NO_DETECTA}</p>
    </div>
  )
}

export function ApprovalCard({ bot, a }: { bot: BotView; a: Approval }) {
  const decide = useSignedDecision()
  const supported = bot.commands.includes('aprobar-firmado')
  const detail = detailText(a)
  return (
    <div className="approval">
      <div className="approval__icon"><Icon name="shield" /></div>
      <div className="approval__body">
        <div className="approval__title">{actionText(a)}</div>
        {detail && <div className="approval__detail">{detail}</div>}
        <div className="approval__meta">{bot.name} · {timeAgo(a.created_at)} · solicitud {a.id}</div>
        {!supported && <div className="approval__warn">Este bot aún no acepta aprobaciones desde Lirio.</div>}
        <ModerationReport botId={bot.id} d={a.details ?? {}} />
        <StudioChecks d={a.details ?? {}} />
      </div>
      <div className="approval__actions">
        <HoldButton tone="ghost" disabled={!supported} onBegin={api.gestureBegin}
          onComplete={(t) => decide(t, bot.id, 'deny', a.id, a.action, a.key)}>Rechazar</HoldButton>
        <HoldButton disabled={!supported} onBegin={api.gestureBegin}
          onComplete={(t) => decide(t, bot.id, 'approve', a.id, a.action, a.key)}>Aprobar</HoldButton>
      </div>
    </div>
  )
}
