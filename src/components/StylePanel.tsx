// Tu estilo: cada usuario le dice al editor (o al bot de miniaturas) cómo le gusta, y le da un ejemplo de referencia.
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Icon, useToast } from './ui'

interface Msg { de: 'tu' | 'bot'; texto: string; cambios?: string[] }

export function StylePanel({ botId, kind }: { botId: string; kind: 'video' | 'miniatura' }) {
  const toast = useToast()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [learned, setLearned] = useState<string[]>([])
  const end = useRef<HTMLDivElement>(null)

  const loadLearned = () => api.runWith(botId, 'estilo-ver').then((r) => {
    if (r.ok) setLearned((r.data?.reglas ?? r.data?.estilo ?? []).map((x: unknown) => typeof x === 'string' ? x : JSON.stringify(x)))
  }).catch(() => {})
  useEffect(() => { loadLearned() }, [botId])
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }) }, [msgs])

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setMsgs((m) => [...m, { de: 'tu', texto: t }])
    setText('')
    setSending(true)
    const r = await api.runWith(botId, 'estilo-chat', { '--mensaje': t.slice(0, 500) })
    setSending(false)
    setMsgs((m) => [...m, r.ok ? { de: 'bot', texto: r.data?.respuesta ?? 'Apuntado.', cambios: r.data?.cambios }
      : { de: 'bot', texto: `No he podido: ${r.data?.error ?? r.message}` }])
    if (r.ok) loadLearned()
  }

  const pickReference = async () => {
    const path = await api.pickFile(kind === 'video' ? 'Elige un vídeo de referencia' : 'Elige una miniatura de referencia', kind)
    if (!path) return
    const r = await api.runWith(botId, kind === 'video' ? 'referencia-video' : 'referencia-miniatura', { '--archivo': path })
    toast(r.ok ? 'ok' : 'error', r.ok ? (r.data?.mensaje ?? 'Referencia guardada: los próximos se parecerán.') : r.data?.error ?? r.message)
    if (r.ok) loadLearned()
  }

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
          {sending && <div className="bubble bubble--bot muted">Pensando…</div>}
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
            : 'Elige una miniatura que te guste y el bot hará las tuyas parecidas.'}
        </p>
        <button className="btn btn--outline" onClick={pickReference}><Icon name="upload" size={16} /> Elegir archivo…</button>
        <h3 style={{ marginTop: 18 }}>Lo que ya sabe de tu estilo</h3>
        {learned.length === 0 ? <p className="muted small">Todavía nada.</p> : <ul className="small">{learned.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </section>
    </div>
  )
}
