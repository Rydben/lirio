// Censura de palabrotas del editor (en «Tu estilo» del vídeo): la lista base, las que añades y las que quitas
// (quitar una de la base vale solo para ti). Activarla y elegir pitido o silencio está en Ajustes.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Icon, useToast } from './ui'

interface Censura {
  activado: boolean; estilo: string; base_palabras: string[]; base_frases: string[]; tus_anadidas: string[]; tus_quitadas: string[]
}

export function CensorPanel({ botId }: { botId: string }) {
  const toast = useToast()
  const [c, setC] = useState<Censura | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = (r: { ok: boolean; data?: any; message: string }) => {
    if (r.ok && r.data) { setC(r.data); setErr(null); return true }
    setErr(r.data?.error ?? r.message)
    return false
  }
  const load = useCallback(() => api.runWith(botId, 'censura').then(apply).catch((e) => setErr(String(e))), [botId])
  useEffect(() => { void load() }, [load])

  const change = async (cmd: 'censura-anadir' | 'censura-quitar', t: string) => {
    const v = t.trim()
    if (!v) return
    setBusy(true)
    const r = await api.runWith(botId, cmd, { '@texto': v.slice(0, 80) })
    setBusy(false)
    if (apply(r)) { if (cmd === 'censura-anadir') setText(''); toast('ok', cmd === 'censura-anadir' ? `«${v}» se censurará.` : `«${v}» ya no se censura.`) }
    else toast('error', r.data?.error ?? r.message)
  }

  if (err && !c) return <section className="panel"><h3>Censura de palabrotas</h3><p className="muted small">{err}</p></section>
  if (!c) return null
  const base = [...c.base_palabras, ...c.base_frases].filter((w) => !c.tus_quitadas.includes(w))
  return (
    <section className="panel" data-testid="censura">
      <h3>Censura de palabrotas</h3>
      <p className="muted small">
        {c.activado ? `Activada: se tapan con ${c.estilo === 'silencio' ? 'silencio' : 'un pitido'}.` : 'Desactivada.'} Se activa y se elige pitido o silencio en Ajustes.
      </p>
      <div className="row">
        <input className="input" placeholder="Palabra o frase que quieres censurar" value={text} maxLength={80}
               onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void change('censura-anadir', text) }} />
        <button className="btn btn--outline" disabled={busy || !text.trim()} onClick={() => change('censura-anadir', text)}>Añadir</button>
      </div>
      {c.tus_anadidas.length > 0 && <>
        <div className="cell-title small">Las que has añadido</div>
        <div className="chips">{c.tus_anadidas.map((w) => (
          <span key={w} className="chip">{w}<button aria-label={`Dejar de censurar ${w}`} disabled={busy} onClick={() => change('censura-quitar', w)}><Icon name="close" size={12} /></button></span>
        ))}</div>
      </>}
      <details>
        <summary className="small">Lista base ({base.length})</summary>
        <div className="chips">{base.map((w) => (
          <span key={w} className="chip">{w}<button aria-label={`Dejar de censurar ${w}`} disabled={busy} onClick={() => change('censura-quitar', w)}><Icon name="close" size={12} /></button></span>
        ))}</div>
      </details>
      {c.tus_quitadas.length > 0 && <p className="muted small">Quitadas solo para ti: {c.tus_quitadas.join(', ')}. Para volver a censurar una, añádela.</p>}
    </section>
  )
}
