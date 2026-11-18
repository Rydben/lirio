// Tu estilo: cada usuario le dice al editor cómo le gusta y le da un ejemplo de referencia (vídeo para el editor,
// miniatura para el bot de miniaturas). Todo se guarda en el editor como preferencias (sin IA ni coste).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useJob } from '../lib/jobs'
import { JobProgress } from './JobProgress'
import { Icon, useToast } from './ui'

interface Msg { de: 'tu' | 'bot'; texto: string; cambios?: string[] }
interface Estilo { instrucciones: { id: string; texto: string; fecha?: string }[]; video_referencia?: string | null; miniatura_referencia?: string | null }

const fileName = (p?: string | null) => (p ? p.split(/[\\/]/).pop() : null)

export function StylePanel({ botId, kind }: { botId: string; kind: 'video' | 'miniatura' }) {
  const toast = useToast()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [estilo, setEstilo] = useState<Estilo | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const refCommand = kind === 'video' ? 'estilo-video' : 'estilo-miniatura'
  const analysis = useJob(botId, refCommand, (e) => {
    if (e.ok) { toast('ok', 'Referencia guardada: los próximos se parecerán.'); apply(e.resultado) }
    else if (!e.cancelado) toast('error', e.resultado?.error ?? e.mensaje ?? 'No se pudo')
  })

  const apply = (d: any) => { if (d?.instrucciones) setEstilo(d as Estilo) }
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
    // analizar un vídeo largo tarda: va en segundo plano, con su barra, y no se puede lanzar dos veces
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
            <span className="small">Ahora: <b>{fileName(ref)}</b></span>
            <button className="btn btn--ghost" onClick={() => forget(kind === 'video' ? 'video' : 'miniatura')}>Quitar</button>
          </div>
        )}
        <JobProgress job={analysis.job} label="Analizando la referencia" onCancel={analysis.cancel} />
        <button className="btn btn--outline" disabled={analysis.running} onClick={pickReference}>
          <Icon name="upload" size={16} /> {analysis.running ? 'Analizando…' : ref ? 'Cambiar archivo…' : 'Elegir archivo…'}
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
