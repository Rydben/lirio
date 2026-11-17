// Asistente guiado: el amigo crea SU proyecto gratuito de Google Cloud para subir a SU canal de YouTube.
// Lirio solo abre las páginas oficiales de Google y guarda el archivo de credenciales; nunca ve su contraseña.
import { useState } from 'react'
import { api } from '../lib/api'
import { Icon, useToast } from './ui'

const STEPS = [
  { title: 'Crea tu proyecto', text: 'Ponle cualquier nombre (por ejemplo «lirio»). Es gratis: no pide tarjeta.',
    url: 'https://console.cloud.google.com/projectcreate' },
  { title: 'Activa la API de YouTube', text: 'Pulsa «Habilitar» en YouTube Data API v3.',
    url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com' },
  { title: 'Pantalla de consentimiento', text: 'Tipo «Externo», modo «Pruebas», y añade tu propio correo como usuario de prueba.',
    url: 'https://console.cloud.google.com/apis/credentials/consent' },
  { title: 'Crea las credenciales', text: '«Crear credenciales» → «ID de cliente de OAuth» → tipo «App de escritorio». Descarga el JSON.',
    url: 'https://console.cloud.google.com/apis/credentials' },
]

export function YouTubeGuide({ botId, onDone }: { botId: string; onDone?: () => void }) {
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    const path = await api.pickJson('Elige el archivo JSON que descargaste de Google')
    if (!path) return
    try {
      toast('ok', await api.installClientSecret(botId, path))
      setSaved(true)
    } catch (e) {
      toast('error', String(e))
    }
  }

  const authorize = async () => {
    setBusy(true)
    toast('info', 'Se abrirá tu navegador: entra con tu cuenta de YouTube y acepta.')
    const r = await api.run(botId, 'auth')
    setBusy(false)
    if (r.ok) { toast('ok', '¡YouTube conectado!'); onDone?.() } else toast('error', r.message)
  }

  return (
    <div className="guide">
      <ol className="guide__steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className={i === step ? 'is-active' : i < step ? 'is-done' : ''}>
            <button className="guide__num" onClick={() => setStep(i)} aria-label={`Paso ${i + 1}`}>
              {i < step ? <Icon name="check" size={16} /> : i + 1}
            </button>
            <div>
              <div className="cell-title">{s.title}</div>
              {i === step && (
                <>
                  <p className="muted small">{s.text}</p>
                  <div className="row">
                    <button className="btn btn--outline" onClick={() => api.openUrl(s.url)}>Abrir en Google</button>
                    <button className="btn btn--ghost" onClick={() => setStep(i + 1)}>Hecho</button>
                  </div>
                </>
              )}
            </div>
          </li>
        ))}
        <li className={step >= STEPS.length ? 'is-active' : ''}>
          <span className="guide__num">{STEPS.length + 1}</span>
          <div>
            <div className="cell-title">Dale el archivo a Lirio y autoriza</div>
            {step >= STEPS.length && (
              <div className="row">
                <button className="btn btn--outline" onClick={pick}>{saved ? 'Elegir otro archivo' : 'Elegir el archivo JSON'}</button>
                <button className="btn btn--primary" disabled={!saved || busy} onClick={authorize}>
                  <Icon name="key" size={16} /> {busy ? 'Esperando al navegador…' : 'Autorizar YouTube'}
                </button>
              </div>
            )}
          </div>
        </li>
      </ol>
      <p className="muted small">
        Todo es gratis: YouTube da una cuota diaria gratuita. El archivo se guarda solo en tu PC y Lirio no lo enseña nunca.
      </p>
    </div>
  )
}
