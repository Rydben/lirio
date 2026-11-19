// Autorizar YouTube sin quedarse colgado: el bot espera en segundo plano a que el amigo acepte en su navegador.
// Si Google le enseña un error, lo elige aquí y Lirio le da el arreglo exacto con el enlace a SU proyecto.
// Si nada vuelve en 5 minutos, se cancela solo y se explica por qué suele pasar.
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useJob } from '../lib/jobs'
import { FIXES, fixFor, links, type Fix, type FixCode } from '../lib/youtube'
import { Icon, useToast } from './ui'

export const AUTH_WAIT_MS = 5 * 60 * 1000

const SEEN: { code: FixCode; label: string }[] = [
  { code: 'access_denied', label: '«Acceso bloqueado» / 403 access_denied' },
  { code: 'redirect_uri_mismatch', label: '400 redirect_uri_mismatch' },
  { code: 'no_verificada', label: '«Google no ha verificado esta aplicación»' },
  { code: 'interna', label: '403 org_internal' },
]

export function FixCard({ fix, projectId }: { fix: Fix; projectId?: string | null }) {
  const l = links(projectId)
  const extra = fix.also ? FIXES[fix.also] : null
  return (
    <div className="panel stack" data-testid={`fix-${fix.code}`}>
      <div className="cell-title">{fix.title}</div>
      <ol className="small">{fix.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      {fix.code === 'api_desactivada' && (
        <div className="row">
          <button className="btn btn--outline" onClick={() => api.openUrl(l.apiData)}>Abrir YouTube Data API v3</button>
          <button className="btn btn--outline" onClick={() => api.openUrl(l.apiAnalytics)}>Abrir YouTube Analytics API</button>
        </div>
      )}
      {fix.link && fix.code !== 'api_desactivada' && (
        <div className="row">
          <button className="btn btn--outline" onClick={() => api.openUrl(l[fix.link!.key])}>{fix.link.label}</button>
        </div>
      )}
      {extra && <FixCard fix={extra} projectId={projectId} />}
    </div>
  )
}

export function YouTubeAuth({ botId, projectId, disabled, again, onDone }: {
  botId: string; projectId?: string | null; disabled?: boolean; again?: boolean; onDone?: () => void
}) {
  const toast = useToast()
  const [fix, setFix] = useState<Fix | null>(null)
  const [failMsg, setFailMsg] = useState<string | null>(null)
  const chosen = useRef(false)
  const { job, running, start, cancel } = useJob(botId, 'auth', (e) => {
    if (chosen.current) return
    if (e.ok) { setFix(null); setFailMsg(null); toast('ok', '¡YouTube conectado!'); onDone?.(); return }
    if (e.cancelado) return
    const f = fixFor(e.mensaje)
    setFix(f)
    setFailMsg(f ? null : e.mensaje ?? 'No se terminó la autorización.')
  })

  // Si Google se queda en su página de error, el bot no se entera nunca: se corta a los 5 minutos.
  useEffect(() => {
    if (!running) return
    const t = setTimeout(() => { chosen.current = true; setFix(FIXES.no_vuelve); void api.jobCancel(`${botId}:auth`) }, AUTH_WAIT_MS)
    return () => clearTimeout(t)
  }, [running, botId])

  const go = () => {
    chosen.current = false
    setFix(null)
    setFailMsg(null)
    toast('info', 'Se abrirá tu navegador: entra con el Gmail de tu canal de YouTube y acepta.')
    void start({})
  }
  const saw = (code: FixCode) => {
    chosen.current = code !== 'no_verificada'
    setFix(FIXES[code])
    if (chosen.current) void cancel()
  }

  const showRetry = !running && (fix || failMsg || (job?.hecho && !job.ok))
  return (
    <div className="stack">
      <div className="row">
        {!running && (
          <button className="btn btn--primary" disabled={disabled} onClick={go}>
            <Icon name="key" size={16} /> {showRetry ? 'Reintentar autorización' : again ? 'Volver a autorizar' : 'Autorizar YouTube'}
          </button>
        )}
        {running && (
          <>
            <span className="muted">Esperando a que aceptes en tu navegador…</span>
            <button className="btn btn--ghost" onClick={() => { chosen.current = true; void cancel() }}>Cancelar</button>
          </>
        )}
      </div>
      {running && (
        <div className="stack">
          <div className="muted small">¿Google te enseña un error en vez de pedirte permiso? Pulsa el que veas:</div>
          <div className="row">
            {SEEN.map((s) => <button key={s.code} className="btn btn--outline small" onClick={() => saw(s.code)}>{s.label}</button>)}
          </div>
        </div>
      )}
      {fix && <FixCard fix={fix} projectId={projectId} />}
      {failMsg && <p className="error-text small">{failMsg}</p>}
    </div>
  )
}
