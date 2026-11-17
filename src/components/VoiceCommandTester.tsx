// Probar los comandos de voz del moderador SIN ejecutar nada: dice qué ha oído y qué haría.
import { useState } from 'react'
import { api } from '../lib/api'
import { Icon } from './ui'

interface Heard {
  oido?: string
  palabra_activacion?: boolean
  es_tu_voz?: boolean
  similitud?: number
  comando?: string | null
  descripcion?: string
}

export function VoiceCommandTester({ botId }: { botId: string }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Heard | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (flags: Record<string, unknown>) => {
    setBusy(true); setRes(null); setError(null)
    const r = await api.runWith(botId, 'probar-voz', flags)
    setBusy(false)
    if (r.ok) setRes(r.data); else setError(r.data?.error ?? r.message)
  }

  return (
    <div className="voice">
      <p className="muted small">Prueba qué entiende el bot. <b>No se ejecuta nada</b>: solo te dice qué haría.</p>
      <div className="row">
        <button className="btn btn--primary" disabled={busy} onClick={() => run({ '--segundos': 7 })}>
          <Icon name="play" size={16} /> {busy ? 'Escuchando…' : 'Hablar 7 segundos'}
        </button>
      </div>
      <div className="row">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label="Frase de prueba"
          placeholder="o escribe la frase, p. ej. «lirio pon el modo lento»" />
        <button className="btn btn--ghost" disabled={busy || !text.trim()} onClick={() => run({ '--texto': text.trim() })}>Probar</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {res && (
        <dl className="kv">
          <dt>He oído</dt><dd>«{res.oido ?? ''}»</dd>
          <dt>Palabra de activación</dt><dd>{res.palabra_activacion ? 'Sí' : 'No'}</dd>
          {res.es_tu_voz !== undefined && <><dt>¿Es tu voz?</dt><dd>{res.es_tu_voz ? 'Sí' : 'No'}{res.similitud != null ? ` (${Math.round(res.similitud * 100)} %)` : ''}</dd></>}
          <dt>Haría</dt><dd>{res.comando ? res.descripcion ?? res.comando : 'Nada (no es un comando)'}</dd>
        </dl>
      )}
    </div>
  )
}
