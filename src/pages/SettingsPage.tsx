// Configuración: actualizaciones, enviar una idea, YouTube, la llave de aprobaciones y el avatar.
import { useEffect, useState } from 'react'
import { AntivirusHelp } from '../components/AntivirusHelp'
import { Avatar } from '../components/Avatar'
import { EXPRESSIONS } from '../components/Face'
import { YouTubeGuide } from '../components/YouTubeGuide'
import { Icon, useToast } from '../components/ui'
import { api, type UsageSummary } from '../lib/api'
import type { Expression } from '../lib/mood'
import { useStore } from '../lib/store'

const LABELS: Record<Expression, string> = {
  feliz: 'Feliz', ojos_cerrados: 'Ojos cerrados', sorprendido: 'Sorprendido', enojado: 'Enojado', triste: 'Triste',
  guino: 'Guiño', boca_abierta: 'Boca abierta', confundido: 'Confundido',
}

export function SettingsPage() {
  const [key, setKey] = useState<{ id: string; llave_publica: string } | null>(null)
  const [paths, setPaths] = useState<{ programa: string; datos: string } | null>(null)
  useEffect(() => { api.helpPaths().then(setPaths).catch(() => {}) }, [])
  const [expr, setExpr] = useState<Expression>('feliz')
  useEffect(() => { api.approverKey().then(setKey).catch(() => {}) }, [])

  return (
    <div className="stack">
      <section className="panel intro">
        <h1>Configuración</h1>
        <p className="muted">Lirio no cuesta nada: ni APIs ni planes de pago. Tu suscripción de Claude no se comparte con nadie.</p>
      </section>
      <div className="grid-2">
        <Updates />
        <SendIdea />
      </div>
      <AutoStart />
      <AntivirusHelp open={window.location.hash.includes('antivirus')} />
      <YouTubeSection />
      <div className="grid-2">
        <section className="panel">
          <h3><Icon name="key" size={18} /> Llave de aprobaciones</h3>
          <p className="muted small">
            Lirio firma cada aprobación que das manteniendo pulsado un botón. Los bots solo aceptan firmas de esta llave,
            que está fijada en su <span className="mono">wall_rules.json</span>. La parte secreta está cifrada con tu usuario de Windows.
          </p>
          <dl className="kv">
            <dt>Identificador</dt><dd className="mono">{key?.id ?? '…'}</dd>
            <dt>Llave pública</dt><dd className="mono wrap">{key?.llave_publica ?? '…'}</dd>
            <dt>Carpeta de datos</dt><dd className="mono wrap small">{paths?.datos ?? '…'}</dd>
            <dt>Programa</dt><dd className="mono wrap small">{paths?.programa ?? '…'}</dd>
          </dl>
        </section>
        <section className="panel">
          <h3>El avatar</h3>
          <div className="avatar-preview">
            <Avatar expression={expr} height={220} />
            <div className="chips">
              {EXPRESSIONS.map((e) => (
                <button key={e} className={`chip${e === expr ? ' is-active' : ''}`} onClick={() => setExpr(e)}>{LABELS[e]}</button>
              ))}
            </div>
          </div>
          <p className="muted small">
            La cara cambia sola según el estado de tus bots. El "db" de la chaqueta es parte del dibujo:
            para cambiarlo por el lirio hay que regenerar la ilustración con tu IA de imágenes.
          </p>
        </section>
      </div>
    </div>
  )
}

/** Busca versiones nuevas (firmadas por el creador en GitHub Releases) e instala con un clic. */
function Updates() {
  const toast = useToast()
  const [info, setInfo] = useState<{ version: string; repo: string | null } | null>(null)
  const [state, setState] = useState<{ disponible: boolean; version?: string; notas?: string; motivo?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.releaseInfo().then(setInfo).catch(() => {}) }, [])
  const check = async () => {
    setBusy(true)
    try { setState(await api.checkUpdate()) } catch (e) { toast('error', String(e)) } finally { setBusy(false) }
  }
  const install = async () => {
    setBusy(true)
    toast('info', 'Descargando la versión nueva. Lirio se reiniciará solo.')
    try { await api.installUpdate() } catch (e) { toast('error', String(e)); setBusy(false) }
  }
  return (
    <section className="panel">
      <h3><Icon name="refresh" size={18} /> Actualizaciones</h3>
      <p className="muted small">Versión {info?.version ?? '…'}. Solo se instalan versiones firmadas por el creador de Lirio.</p>
      {state?.disponible && (
        <div className="upload-live">
          <div className="cell-title">Hay una versión nueva: {state.version}</div>
          {state.notas && <p className="muted small">{state.notas}</p>}
          <button className="btn btn--primary" disabled={busy} onClick={install}>Actualizar ahora</button>
        </div>
      )}
      {state && !state.disponible && <p className="ok-text small">{state.motivo ? `Sin actualizaciones (${state.motivo}).` : 'Tienes la última versión.'}</p>}
      <button className="btn btn--ghost" disabled={busy} onClick={check}>{busy ? 'Buscando…' : 'Buscar actualizaciones'}</button>
    </section>
  )
}

export type SummaryPart = 'version' | 'bots' | 'usos' | 'errores'

/** Texto del resumen de uso con SOLO las partes que el amigo dejó marcadas. Solo cifras, nunca textos ni nombres. */
export function summaryText(s: UsageSummary, parts: Set<SummaryPart>): string {
  const lines: string[] = []
  if (parts.has('version')) lines.push(`- Lirio ${s.lirio} (${s.windows}), ${s.dias_con_actividad} días con actividad en ${s.periodo_dias}`)
  if (parts.has('bots')) lines.push(`- Bots: ${s.bots.map((b) => `${b.id} ${b.version}`).join(', ') || 'ninguno'}`)
  if (parts.has('usos')) lines.push(`- Usos: ${Object.entries(s.usos).map(([k, v]) => `${k} ${v}`).join(', ') || 'ninguno'}`)
  if (parts.has('errores')) lines.push(`- Errores: ${Object.entries(s.errores_por_bot).map(([k, v]) => `${k} ${v}`).join(', ') || 'ninguno'}`)
  return lines.length ? `Resumen de uso (sin datos personales):\n${lines.join('\n')}` : ''
}

export function ideaUrl(repo: string, title: string, body: string, version: string, summary = ''): string {
  const q = new URLSearchParams({ title: `Idea: ${title}`, body: `${body}${summary ? `\n\n${summary}` : ''}

---
Enviado desde Lirio ${version}`, labels: 'idea' })
  return `https://github.com/${repo}/issues/new?${q.toString()}`
}

/** "Enviar idea": abre un formulario de GitHub ya relleno; la envía el amigo desde su navegador. */
function SendIdea() {
  const [info, setInfo] = useState<{ version: string; repo: string | null } | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [attach, setAttach] = useState(false)
  const [parts, setParts] = useState<Set<SummaryPart>>(new Set(['version', 'bots', 'usos', 'errores']))
  useEffect(() => { api.releaseInfo().then(setInfo).catch(() => {}) }, [])
  useEffect(() => { if (attach && !summary) api.usageSummary(30).then(setSummary).catch(() => {}) }, [attach, summary])
  const repo = info?.repo
  const text = attach && summary ? summaryText(summary, parts) : ''
  const toggle = (p: SummaryPart) => setParts((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })
  return (
    <section className="panel">
      <h3><Icon name="heart" size={18} /> Enviar idea</h3>
      <p className="muted small">¿Qué te gustaría que hicieran Lirio o los bots? Se abrirá GitHub con tu idea escrita; tú decides si la envías.</p>
      <label className="field">Idea en una frase<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Que el bot haga…" /></label>
      <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Cuéntala con más detalle (opcional)" aria-label="Detalle" />
      <label className="check"><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
        Añadir un resumen de cómo me va Lirio (opcional, ayuda a mejorarlo)</label>
      {attach && (
        <div className="summary-preview">
          <div className="chips">
            {([['version', 'Versión'], ['bots', 'Bots'], ['usos', 'Qué uso'], ['errores', 'Errores']] as [SummaryPart, string][]).map(([k, l]) => (
              <label key={k} className={`chip${parts.has(k) ? ' is-active' : ''}`}>
                <input type="checkbox" hidden checked={parts.has(k)} onChange={() => toggle(k)} />{l}
              </label>
            ))}
          </div>
          <pre className="mono small" data-testid="resumen">{text || 'No se añadirá nada.'}</pre>
          <p className="muted small">Esto es exactamente lo que se añade: solo cifras. Ni tus notas, ni nombres de canal, ni rutas, ni contraseñas.</p>
        </div>
      )}
      <div className="row">
        <button className="btn btn--primary" disabled={!repo || !title.trim()}
          onClick={() => api.openUrl(ideaUrl(repo!, title.trim(), body.trim(), info!.version, text))}>Abrir en GitHub</button>
        {!repo && <span className="muted small">Disponible en las versiones publicadas.</span>}
      </div>
    </section>
  )
}

/** Arrancar los bots al encender el PC (en los PCs sin tareas programadas propias, como los de los amigos). */
function AutoStart() {
  const toast = useToast()
  const { overview } = useStore()
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => { api.autostartGet().then(setOn).catch(() => setOn(false)) }, [])
  const bots = (overview?.modules ?? []).filter((m) => !m.parent && !m.task && m.commands.includes('watch'))
  if (!bots.length) return null
  const toggle = async (v: boolean) => {
    try { setOn(await api.autostartSet(v)) } catch (e) { toast('error', String(e)) }
  }
  return (
    <section className="panel">
      <label className="check"><input type="checkbox" checked={!!on} disabled={on === null} onChange={(e) => toggle(e.target.checked)} />
        <b>Arrancar mis bots al encender el PC</b></label>
      <p className="muted small">Al iniciar Windows se ponen en marcha {bots.map((b) => b.name).join(', ')} (salvo los que tengan STOP), sin abrir ninguna ventana.</p>
    </section>
  )
}

/** Conectar YouTube (si hay un bot con subida a YouTube instalado). */
function YouTubeSection() {
  const { overview } = useStore()
  const [open, setOpen] = useState(false)
  const bot = overview?.modules.find((m) => m.commands.includes('auth') || m.id === 'twitch-autoeditor')
  if (!bot) return null
  return (
    <section className="panel">
      <header className="section-head">
        <h3><Icon name="yt" size={18} /> Tu YouTube</h3>
        <button className="btn btn--ghost" onClick={() => setOpen(!open)}>{open ? 'Cerrar' : 'Configurar YouTube'}</button>
      </header>
      {open && <YouTubeGuide botId={bot.id} onDone={() => setOpen(false)} />}
    </section>
  )
}
