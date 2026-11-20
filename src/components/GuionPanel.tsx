// «Ver guion antes de editar»: el editor lee todo el directo y escribe el guion (gancho, planteamiento, nudo, clímax,
// cierre) sin renderizar ni subir. Tarda (transcripción + unas 10-16 llamadas a Claude): va en segundo plano.
// Si te gusta, «Editar ahora» renderiza reutilizando ese mismo plan.
import { useJob } from '../lib/jobs'
import { useToast } from './ui'
import { JobProgress } from './JobProgress'

type Tramo = [number, number, string]
interface Bloque { tipo: string; titulo?: string; rotulo?: string; musica?: string; segundos?: number; por_que?: string; tramos?: Tramo[] }
export interface Guion {
  trama?: string; objetivo_sesion?: string; duracion_objetivo_min?: number; por_que_esa_duracion?: string
  bloques?: Bloque[]; gancho?: Tramo[]; titulos?: string[]
}

const TIPO: Record<string, string> = { gancho: 'Gancho', planteamiento: 'Planteamiento', nudo: 'Nudo', climax: 'Clímax', clímax: 'Clímax', cierre: 'Cierre' }

export function mmss(s: number) {
  const t = Math.max(0, Math.round(s))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}

export function GuionView({ g }: { g: Guion }) {
  return (
    <div className="stack guion" data-testid="guion">
      {g.trama && <p><b>La historia:</b> {g.trama}</p>}
      {typeof g.duracion_objetivo_min === 'number' && (
        <p className="small"><b>Duración:</b> unos {Math.round(g.duracion_objetivo_min)} min{g.por_que_esa_duracion ? `. ${g.por_que_esa_duracion}` : ''}</p>
      )}
      <ol className="guion__bloques">
        {(g.bloques ?? []).map((b, i) => (
          <li key={i}>
            <div className="cell-title">{TIPO[b.tipo] ?? b.tipo}{b.titulo ? `: ${b.titulo}` : ''}
              {typeof b.segundos === 'number' && <span className="muted small"> · {mmss(b.segundos)}</span>}
              {b.musica && <span className="muted small"> · música: {b.musica}</span>}</div>
            {b.por_que && <div className="muted small">{b.por_que}</div>}
            {(b.tramos ?? []).length > 0 && (
              <ul className="small guion__tramos">
                {b.tramos!.map(([a, z, q], j) => <li key={j}><span className="mono">{mmss(a)}–{mmss(z)}</span> {q}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {(g.titulos ?? []).length > 0 && <p className="small"><b>Títulos posibles:</b> {g.titulos!.join(' · ')}</p>}
    </div>
  )
}

const lastFor = new Map<string, string>()

/** `C:/d/twitch_2933735688.mp4` -> `twitch_2933735688_historia` */
export function scriptName(ruta: string) {
  const base = ruta.split(/[\\/]/).pop() ?? 'directo'
  return `${base.replace(/\.[^.]+$/, '')}_historia`
}

/** Hace el guion de un directo descargado y lo enseña. Uno cada vez (es un trabajo del editor). */
export function GuionPanel({ botId, ruta, archivo }: { botId: string; ruta: string; archivo: string }) {
  const toast = useToast()
  const job = useJob(botId, 'guion')
  // el trabajo es uno por bot: solo se enseña si es de este directo
  const mine = lastFor.get(botId) === ruta
  const g = (mine && job.job?.hecho && job.job.ok ? job.job.resultado?.guion : null) as Guion | null
  // guion y render van con el mismo nombre: carpeta propia, sin pisar la del vídeo normal (ni uno ya subido)
  const nombre = scriptName(ruta)
  const start = () => { lastFor.set(botId, ruta); void job.start({ '@archivo': ruta, '--nombre': nombre }) }
  const render = useJob(botId, 'process', (e) => {
    toast(e.ok ? 'ok' : e.cancelado ? 'info' : 'error', e.ok ? 'Vídeo hecho con el guion. No se ha subido: súbelo cuando quieras desde la cola.' : e.cancelado ? 'Cancelado.' : e.resultado?.error ?? e.mensaje ?? 'No se pudo renderizar')
  })
  const renderNow = () => { void render.start({ '@archivo': ruta, '--nombre': nombre, '--no-upload': true }) }
  const otherRunning = job.running && !mine
  return (
    <section className="panel stack" data-testid="guion-panel">
      <h3>Guion de {archivo}</h3>
      {otherRunning && <p className="muted small">El editor está haciendo el guion de otro directo: espera a que termine.</p>}
      {!job.running && !g && (
        <>
          <p className="muted small">El editor lee todo el directo y te propone la historia antes de cortar nada. Tarda un rato: puedes seguir usando Lirio.</p>
          <div className="row"><button className="btn btn--outline" onClick={start}>Hacer el guion</button></div>
        </>
      )}
      {job.running && mine && <JobProgress job={job.job} label="Escribiendo el guion" onCancel={job.cancel} />}
      {mine && job.job?.hecho && !job.job.ok && !job.job.cancelado && <p className="error-text small">{job.job.resultado?.error ?? job.job.mensaje ?? 'No se pudo hacer el guion.'}</p>}
      {g && <GuionView g={g} />}
      {g && !render.running && (
        <div className="row">
          <button className="btn btn--primary" onClick={renderNow}>Hacer el vídeo con este guion</button>
          <span className="muted small">Usa este mismo guion (no vuelve a preguntar a la IA) y no sube nada.</span>
        </div>
      )}
      {render.running && <JobProgress job={render.job} label="Haciendo el vídeo con el guion" onCancel={render.cancel} />}
    </section>
  )
}
