// Asistente guiado: el amigo crea SU proyecto gratuito de Google Cloud para subir a SU canal de YouTube.
// Lirio solo abre las páginas oficiales de Google y guarda el archivo de credenciales; nunca ve su contraseña.
// En cuanto tiene el archivo, los enlaces van directos a SU proyecto (por su project_id) y no deja autorizar hasta
// que haya marcado los tres pasos que causan casi todos los errores (APIs habilitadas y su Gmail como usuario de prueba).
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { FIXES, links, statusText, type ClientInfo, type YouTubeStatus } from '../lib/youtube'
import { Icon, useToast } from './ui'
import { FixCard, YouTubeAuth } from './YouTubeAuth'

const STEPS = [
  { title: 'Crea tu proyecto', text: 'Ponle cualquier nombre (por ejemplo «lirio») y pulsa «Crear». Es gratis: no pide tarjeta.',
    url: 'https://console.cloud.google.com/projectcreate' },
  { title: 'Configura la pantalla de permisos', text: 'Pulsa «Comenzar». Nombre de la app: «lirio»; correo: el tuyo. En «Público» elige «Externo». Acepta y pulsa «Crear».',
    url: 'https://console.cloud.google.com/auth/overview' },
  { title: 'Crea las credenciales', text: '«+ Crear credenciales» → «ID de cliente de OAuth» → Tipo «Aplicación de escritorio» (no «Aplicación web») → «Crear» → «Descargar JSON».',
    url: 'https://console.cloud.google.com/apis/credentials' },
]

type CheckKey = 'apiData' | 'apiAnalytics' | 'publico'
const CHECKS: { key: CheckKey; title: string; text: string; button: string }[] = [
  { key: 'apiData', title: 'Habilita «YouTube Data API v3»', text: 'Se abre en tu proyecto: pulsa «Habilitar».', button: 'Abrir YouTube Data API v3' },
  { key: 'apiAnalytics', title: 'Habilita «YouTube Analytics API»', text: 'Para tus estadísticas: pulsa «Habilitar».', button: 'Abrir YouTube Analytics API' },
  { key: 'publico', title: 'Añade tu Gmail como usuario de prueba',
    text: 'En «Usuarios de prueba» pulsa «+ Add users», escribe el Gmail con el que entras en YouTube y pulsa «Guardar». Sin esto Google dice «403 access_denied».',
    button: 'Abrir mis usuarios de prueba' },
]

export function YouTubeGuide({ botId, onDone }: { botId: string; onDone?: () => void }) {
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState<YouTubeStatus | null>(null)
  const [info, setInfo] = useState<ClientInfo | null>(null)
  const [badFile, setBadFile] = useState<ClientInfo | null>(null)
  const [done, setDone] = useState<Record<CheckKey, boolean>>({ apiData: false, apiAnalytics: false, publico: false })

  const fileStep = STEPS.length
  const checkStep = STEPS.length + 1
  const refresh = () => api.youtubeStatus(botId).then(setStatus).catch(() => {})
  useEffect(() => {
    api.youtubeStatus(botId).then((s) => {
      setStatus(s)
      if (s.client_secret) setStep(checkStep) // ya tiene el archivo: directo a comprobar y autorizar
    }).catch(() => {})
  }, [botId, checkStep])

  const projectId = info?.project_id ?? status?.project_id ?? null
  const l = links(projectId)
  const hasFile = !!info || !!status?.client_secret
  const allChecked = CHECKS.every((c) => done[c.key])

  const pick = async () => {
    const path = await api.pickJson('Elige el archivo JSON que descargaste de Google')
    if (!path) return
    try {
      const i = await api.youtubeCheckFile(path)
      if (i.tipo !== 'installed') { setBadFile(i); return }
      setBadFile(null)
      toast('ok', await api.installClientSecret(botId, path))
      setInfo(i)
      setStep(checkStep)
      void refresh()
    } catch (e) {
      toast('error', String(e))
    }
  }

  const st = status && statusText(status)
  return (
    <div className="guide">
      {st && <p className={st.tone === 'ok' ? 'ok-text' : st.tone === 'error' ? 'error-text' : 'warning-text'}>{st.text}</p>}
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
        <li className={step === fileStep ? 'is-active' : step > fileStep ? 'is-done' : ''}>
          <button className="guide__num" onClick={() => setStep(fileStep)} aria-label={`Paso ${fileStep + 1}`}>
            {step > fileStep && hasFile ? <Icon name="check" size={16} /> : fileStep + 1}
          </button>
          <div>
            <div className="cell-title">Dale el archivo a Lirio</div>
            {step === fileStep && (
              <div className="stack">
                <p className="muted small">El JSON que descargaste (suele llamarse «client_secret_….json» y está en Descargas).</p>
                <div className="row">
                  <button className="btn btn--outline" onClick={pick}>{hasFile ? 'Elegir otro archivo' : 'Elegir el archivo JSON'}</button>
                </div>
                {badFile && (
                  <div data-testid="archivo-no-escritorio">
                    <p className="error-text small">
                      {badFile.tipo === 'web'
                        ? 'Ese archivo es de una «Aplicación web»: con él Google da «400 redirect_uri_mismatch». No lo he guardado.'
                        : 'Ese archivo no es un «ID de cliente de OAuth» de escritorio. No lo he guardado.'}
                    </p>
                    <FixCard fix={FIXES.redirect_uri_mismatch} projectId={badFile.project_id} />
                  </div>
                )}
              </div>
            )}
          </div>
        </li>
        <li className={step === checkStep ? 'is-active' : ''}>
          <button className="guide__num" onClick={() => hasFile && setStep(checkStep)} aria-label={`Paso ${checkStep + 1}`}>{checkStep + 1}</button>
          <div>
            <div className="cell-title">Comprueba tu proyecto y autoriza</div>
            {step === checkStep && (
              <div className="stack">
                {!projectId && <p className="muted small">En Google, elige tu proyecto arriba a la izquierda antes de cada paso.</p>}
                {CHECKS.map((c) => (
                  <div key={c.key} className="stack">
                    <div className="cell-title small">{c.title}</div>
                    <p className="muted small">{c.text}</p>
                    <div className="row">
                      <button className="btn btn--outline" onClick={() => api.openUrl(l[c.key])}>{c.button}</button>
                      <label className="row small">
                        <input type="checkbox" checked={done[c.key]} onChange={(e) => setDone({ ...done, [c.key]: e.target.checked })} />
                        Ya lo hice
                      </label>
                    </div>
                  </div>
                ))}
                {!allChecked && <p className="muted small">Marca los tres «Ya lo hice» para poder autorizar.</p>}
                <YouTubeAuth botId={botId} projectId={projectId} disabled={!allChecked}
                             again={!!status?.token} onDone={() => { void refresh(); onDone?.() }} />
              </div>
            )}
          </div>
        </li>
      </ol>
      <p className="muted small">
        Todo es gratis: YouTube da una cuota diaria gratuita. El archivo se guarda solo en tu PC y Lirio no lo enseña nunca.
        Mientras tu app de Google esté en modo «Pruebas», Google pide volver a autorizar cada 7 días: Lirio te avisará.
      </p>
    </div>
  )
}
