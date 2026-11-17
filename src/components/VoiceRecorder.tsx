// Huella de voz desde Lirio: el texto para leer en grande, el micro, una barra mientras graba y el resultado.
// Solo se guardan números (la huella), nunca el audio. Para el moderador también: "voz de un amigo" (audio del PC).
import { useEffect, useState } from 'react'
import { api, type CliResult } from '../lib/api'
import { Icon, ProgressBar } from './ui'

interface Device { nombre: string; es_microfono: boolean; sugerido: boolean }

export function VoiceRecorder({ botId, command, friend = false }: { botId: string; command: 'registrar-voz' | 'enroll'; friend?: boolean }) {
  const [text, setText] = useState<{ texto: string; segundos: number } | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [device, setDevice] = useState('')
  const [name, setName] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const [result, setResult] = useState<CliResult | null>(null)

  useEffect(() => {
    api.runWith(botId, 'voz-texto').then((r) => r.ok && setText(r.data)).catch(() => {})
    if (!friend) {
      api.runWith(botId, 'voz-dispositivos').then((r) => {
        if (!r.ok) return
        setDevices(r.data.dispositivos ?? [])
        setDevice((r.data.dispositivos ?? []).find((d: Device) => d.sugerido)?.nombre ?? '')
      }).catch(() => {})
    }
  }, [botId, friend])

  useEffect(() => {
    const un = api.onVoice((e) => {
      if (e.module !== botId) return
      if (e.hecho) { setPercent(null); setResult(e.result ?? null) } else setPercent(e.percent ?? 0)
    })
    return () => { un.then((f) => f()) }
  }, [botId])

  const start = () => {
    setResult(null)
    setPercent(0)
    const flags: Record<string, unknown> = { '--segundos': text?.segundos ?? 30 }
    if (device && !friend) flags['--dispositivo'] = device
    if (friend) { flags['--desde-pc'] = true; flags['--nombre'] = name.trim() }
    api.recordVoice(botId, command, flags).catch((e) => { setPercent(null); setResult({ ok: false, code: -1, data: null, message: String(e) }) })
  }

  const recording = percent !== null
  return (
    <div className="voice">
      {friend ? (
        <p className="muted small">
          Tu amigo habla en Discord <b>solo</b> durante {text?.segundos ?? 30} segundos (que lea el texto) mientras Lirio graba el audio del PC.
        </p>
      ) : (
        <p className="muted small">Lee este texto en voz alta, con tu voz normal de directo. Solo se guarda una huella numérica; el audio no se guarda.</p>
      )}
      {text && <blockquote className={`voice__text${recording ? ' is-recording' : ''}`}>{text.texto}</blockquote>}
      <div className="row">
        {friend ? (
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de tu amigo" aria-label="Nombre del amigo" />
        ) : devices.length > 0 && (
          <select className="input" value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Micrófono">
            {devices.map((d) => <option key={d.nombre} value={d.nombre}>{d.nombre}{d.es_microfono ? '' : ' (no es un micrófono)'}</option>)}
          </select>
        )}
        <button className="btn btn--primary" disabled={recording || (friend && !name.trim())} onClick={start}>
          <Icon name="play" size={16} /> {recording ? 'Grabando…' : friend ? 'Grabar voz de mi amigo' : 'Grabar mi voz'}
        </button>
      </div>
      {recording && <ProgressBar percent={percent ?? 0} label="Grabación" />}
      {result && (
        <div className={result.ok ? 'ok-text' : 'error-text'}>
          <Icon name={result.ok ? 'check' : 'alert'} size={16} /> {result.data?.mensaje ?? result.message}
          {result.data?.calidad?.problemas?.length > 0 && (
            <ul className="bullets small">{result.data.calidad.problemas.map((p: string) => <li key={p}>{p}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  )
}
