// Tu estilo: cada usuario le dice al editor cómo le gusta y le da un ejemplo de referencia (vídeo para el editor,
// miniatura para el bot de miniaturas). Todo se guarda en el editor como preferencias (sin IA ni coste).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useJob } from '../lib/jobs'
import { editorTask } from '../lib/progress'
import { JobProgress } from './JobProgress'
import { useStore } from '../lib/store'
import { Icon, ProgressBar, useToast } from './ui'

interface Msg { de: 'tu' | 'bot'; texto: string; cambios?: string[] }
/** Referencia tal como la da el editor: un objeto {archivo, medido, acento, fecha…} (o, en versiones viejas, la ruta) */
type Ref = string | { archivo?: string; copia?: string; ruta?: string; medido?: Record<string, number>; acento?: number[]; fecha?: string } | null | undefined
interface Instr { id: string; texto: string; fecha?: string }
interface Estilo { instrucciones: Instr[]; video_referencia?: Ref; miniatura_referencia?: Ref }

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
/** Nombre del archivo de una referencia, venga como venga; null si no hay */
export function refName(r: Ref): string | null {
  if (!r) return null
  if (typeof r === 'string') return baseName(r)
  const n = r.archivo ?? r.copia ?? r.ruta
  return typeof n === 'string' && n ? baseName(n) : 'referencia guardada'
}
/** «8,5 cortes por minuto · planos de 7 s» (vídeo) o el color de acento (miniatura) */
export function refSummary(r: Ref): string {
  if (!r || typeof r !== 'object') return ''
  const m = r.medido ?? {}
  const parts: string[] = []
  if (typeof m.cuts_per_min === 'number') parts.push(`${m.cuts_per_min.toFixed(1).replace('.', ',')} cortes por minuto`)
  if (typeof m.avg_shot_s === 'number') parts.push(`planos de ${Math.round(m.avg_shot_s)} s`)
  return parts.join(' · ')
}
/** Acepta la respuesta del editor aunque le falten campos o cambien de forma */
export function toEstilo(d: any): Estilo | null {
  if (!d || typeof d !== 'object' || !('instrucciones' in d || 'video_referencia' in d || 'miniatura_referencia' in d)) return null
  const instr: Instr[] = Array.isArray(d.instrucciones)
    ? d.instrucciones.map((x: any, i: number) => (typeof x === 'string' ? { id: String(i), texto: x }
        : { id: String(x?.id ?? i), texto: String(x?.texto ?? x?.text ?? ''), fecha: x?.fecha })).filter((x: Instr) => x.texto)
    : []
  return { instrucciones: instr, video_referencia: d.video_referencia ?? null, miniatura_referencia: d.miniatura_referencia ?? null }
}

export function StylePanel({ botId, kind }: { botId: string; kind: 'video' | 'miniatura' }) {
  const toast = useToast()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [estilo, setEstilo] = useState<Estilo | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const refCommand = kind === 'video' ? 'estilo-video' : 'estilo-miniatura'
  // analizar tarda: es un trabajo en segundo plano con su etapa y %; no se lanza dos veces
  const analysis = useJob(botId, refCommand, (e) => {
    if (e.ok) { toast('ok', 'Referencia analizada: los próximos se parecerán.'); apply(e.resultado); load() }
    else if (e.resultado?.ya_en_marcha) toast('info', 'Ya se está analizando una referencia.')
    else if (!e.cancelado) toast('error', e.resultado?.error ?? e.mensaje ?? 'No se pudo')
  })
  // …y si se lanzó desde fuera de Lirio, el editor lo cuenta en status.json → tareas
  const { overview } = useStore()
  const task = editorTask(overview?.modules.find((m) => m.id === botId), kind === 'video' ? 'estilo_video' : 'estilo_miniatura')
  const outside = task?.estado === 'en_marcha' && !analysis.running
  const busy = analysis.running || outside

  const apply = (d: any) => { const e = toEstilo(d); if (e) setEstilo(e) }
  const load = useCallback(() => api.runWith(botId, 'estilo').then((r) => apply(r.data)).catch(() => {}), [botId])
  useEffect(() => { load() }, [load])
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }) }, [msgs])

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setMsgs((m) => [...m, { de: 'tu', texto: t }])
    setText('')
    setSending(true)
    const r = await api.runWith(botId, 'estilo-chat', { '@mensaje': t.slice(0, 500) })
    setSending(false)
    setMsgs((m) => [...m, r.ok
      ? { de: 'bot', texto: r.data?.respuesta ?? 'Apuntado.', cambios: (r.data?.cambios ?? []).map((c: any) => c?.texto ?? String(c)) }
      : { de: 'bot', texto: `No he podido: ${r.data?.error ?? r.message}` }])
    apply(r.data)
  }

  const forget = async (que: string) => {
    const r = await api.runWith(botId, 'estilo-borrar', { '@que': que })
    if (r.ok) apply(r.data); else toast('error', r.data?.error ?? r.message)
  }

  const pickReference = async () => {
    const path = await api.pickFile(kind === 'video' ? 'Elige un vídeo de referencia' : 'Elige una miniatura de referencia', kind)
    if (!path) return
    analysis.start({ '@archivo': path })
  }

  const ref = kind === 'video' ? estilo?.video_referencia : estilo?.miniatura_referencia
  return (
    <div className="grid-2">
      <section className="panel style-chat">
        <h3><Icon name="heart" size={18} /> Dime cómo lo quieres</h3>
        <p className="muted small">
          {kind === 'video'
            ? 'Por ejemplo: «cortes más rápidos», «sin música en los clips», «deja más tiempo las reacciones».'
            : 'Por ejemplo: «letras más grandes», «mi cara a la derecha», «colores más vivos».'}
        </p>
        <div className="style-chat__log">
          {msgs.map((m, i) => (
            <div key={i} className={`bubble bubble--${m.de}`}>
              {m.texto}
              {m.cambios && m.cambios.length > 0 && <ul className="small">{m.cambios.map((c, j) => <li key={j}>{c}</li>)}</ul>}
            </div>
          ))}
          {sending && <div className="bubble bubble--bot muted">Apuntando…</div>}
          <div ref={end} />
        </div>
        <div className="row">
          <input className="input" value={text} maxLength={500} placeholder="Escribe lo que quieres cambiar…"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }} aria-label="Mensaje para el editor" />
          <button className="btn btn--primary" disabled={!text.trim() || sending} onClick={send}>Enviar</button>
        </div>
      </section>
      <section className="panel">
        <h3><Icon name={kind === 'video' ? 'film' : 'image'} size={18} /> {kind === 'video' ? 'Vídeo de referencia' : 'Miniatura de referencia'}</h3>
        <p className="muted small">
          {kind === 'video'
            ? 'Elige un vídeo que te guste cómo está editado (tuyo o de otro canal) y el editor intentará que los tuyos se parezcan.'
            : 'Elige una miniatura que te guste y el bot hará las tuyas parecidas (sobre todo el color).'}
        </p>
        {ref && (
          <div className="row">
            <span className="small">Ahora: <b>{refName(ref)}</b>{refSummary(ref) ? <span className="muted"> · {refSummary(ref)}</span> : null}</span>
            <button className="btn btn--ghost" onClick={() => forget(kind === 'video' ? 'video' : 'miniatura')}>Quitar</button>
          </div>
        )}
        <JobProgress job={analysis.job} label="Analizando la referencia" onCancel={analysis.cancel} />
        {outside && (
          <div className="job">
            <span className="muted small">{task?.etapa ?? 'Analizando…'}{typeof task?.porcentaje === 'number' ? ` · ${task.porcentaje} %` : ''}</span>
            <ProgressBar percent={task?.porcentaje ?? 0} label="Analizando la referencia" />
          </div>
        )}
        <button className="btn btn--outline" disabled={busy} onClick={pickReference}>
          <Icon name="upload" size={16} /> {busy ? 'Analizando…' : ref ? 'Cambiar archivo…' : 'Elegir archivo…'}
        </button>
        <h3 style={{ marginTop: 18 }}>Lo que ya sabe de tu estilo</h3>
        {!estilo || estilo.instrucciones.length === 0 ? <p className="muted small">Todavía nada.</p> : (
          <ul className="list">
            {estilo.instrucciones.map((i) => (
              <li key={i.id}><span className="small">{i.texto}</span>
                <button className="btn btn--ghost" aria-label={`Olvidar: ${i.texto}`} onClick={() => forget(i.id)}><Icon name="close" size={14} /></button></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
