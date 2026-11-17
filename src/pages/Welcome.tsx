// Asistente de bienvenida (primera vez en el PC de un amigo): datos, bots, IA, instalación, YouTube.
import { useEffect, useMemo, useState } from 'react'
import { AiChooser } from '../components/AiChooser'
import { Avatar } from '../components/Avatar'
import { LirioLogo } from '../components/LirioLogo'
import { YouTubeGuide } from '../components/YouTubeGuide'
import { Icon, ProgressBar } from '../components/ui'
import { api, type Answers, type CatalogBot, type InstallEvent } from '../lib/api'
import type { Expression } from '../lib/mood'

const STEPS = ['Hola', 'Tú', 'Bots', 'IA', 'Instalar', 'YouTube', 'Listo'] as const
type Step = (typeof STEPS)[number]

const FACE: Record<Step, Expression> = {
  Hola: 'boca_abierta', Tú: 'feliz', Bots: 'feliz', IA: 'confundido', Instalar: 'ojos_cerrados', YouTube: 'guino', Listo: 'feliz',
}

export function Welcome({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState<Step>('Hola')
  const [answers, setAnswers] = useState<Answers>({ nombre: '', canal_twitch: '', nombre_canal: '', carpeta_obs: '', ia: 'heuristico' })
  const [catalog, setCatalog] = useState<CatalogBot[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [log, setLog] = useState<Record<string, InstallEvent['step']>>({})
  const [result, setResult] = useState<{ ok: boolean; error?: string | null } | null>(null)

  useEffect(() => {
    api.catalog().then((c) => {
      setCatalog(c.bots)
      setChosen(c.bots.map((b) => b.id))
    }).catch((e) => setCatalogError(String(e)))
  }, [])

  useEffect(() => {
    const un = api.onInstall((e) => {
      if (e.step) setLog((l) => ({ ...l, [e.step!.bot]: e.step }))
      if (e.hecho) setResult({ ok: !!e.ok, error: e.error })
    })
    return () => { un.then((f) => f()) }
  }, [])

  const set = (patch: Partial<Answers>) => setAnswers((a) => ({ ...a, ...patch }))
  const main = useMemo(() => catalog ?? [], [catalog])
  const idx = STEPS.indexOf(step)
  const next = () => setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)])
  const back = () => setStep(STEPS[Math.max(idx - 1, 0)])
  const hasEditor = chosen.includes('twitch-autoeditor')

  const install = () => {
    setStep('Instalar')
    setResult(null)
    setLog({})
    api.installBots(chosen, { ...answers, nombre_canal: answers.nombre_canal || answers.canal_twitch })
  }

  return (
    <div className="welcome">
      <aside className="welcome__side">
        <div className="brand"><div className="brand__logo"><LirioLogo size={56} /></div><div className="brand__name">Lirio</div></div>
        <ol className="welcome__steps">
          {STEPS.map((s, i) => <li key={s} className={i === idx ? 'is-active' : i < idx ? 'is-done' : ''}>{s}</li>)}
        </ol>
        <div className="welcome__avatar"><Avatar expression={FACE[step]} height={260} working={step === 'Instalar' && !result} /></div>
      </aside>

      <main className="welcome__main" data-tauri-drag-region>
        {step === 'Hola' && (
          <section className="welcome__card">
            <h1>¡Hola! Soy <span className="accent">Lirio</span></h1>
            <p>Te ayudo a instalar unos bots para tu canal: editan tus directos para YouTube, hacen miniaturas y moderan tu chat.</p>
            <ul className="bullets">
              <li><b>Es gratis.</b> No hay pagos ni suscripciones de Lirio.</li>
              <li><b>Todo es tuyo.</b> Tu canal, tu YouTube y tu IA. Nadie más usa tus cuentas, ni tú las de nadie.</li>
              <li><b>Tú mandas.</b> Antes de publicar algo o borrar archivos, los bots te piden permiso.</li>
            </ul>
            <div className="row"><button className="btn btn--primary" onClick={next}>Empezar <Icon name="arrow" size={16} /></button></div>
          </section>
        )}

        {step === 'Tú' && (
          <section className="welcome__card">
            <h1>Cuéntame de ti</h1>
            <label className="field">¿Cómo te llamo?
              <input value={answers.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Tu nombre" />
            </label>
            <label className="field">Tu canal de Twitch (el nombre que sale en twitch.tv/…)
              <input value={answers.canal_twitch} onChange={(e) => set({ canal_twitch: e.target.value.trim().toLowerCase() })} placeholder="micanal" />
            </label>
            <label className="field">Carpeta donde OBS guarda tus grabaciones (opcional)
              <div className="row">
                <input value={answers.carpeta_obs} onChange={(e) => set({ carpeta_obs: e.target.value })} placeholder="Sin carpeta: solo VODs de Twitch" />
                <button className="btn btn--ghost" onClick={async () => { const p = await api.pickFolder('Carpeta de grabaciones de OBS'); if (p) set({ carpeta_obs: p }) }}>Elegir…</button>
              </div>
            </label>
            <Nav back={back} next={next} canNext={answers.nombre.trim().length > 0 && /^[a-z0-9_]{3,25}$/.test(answers.canal_twitch)}
              hint="Escribe tu nombre y tu canal de Twitch (solo letras, números y _)." />
          </section>
        )}

        {step === 'Bots' && (
          <section className="welcome__card">
            <h1>¿Qué bots quieres?</h1>
            {catalogError && <p className="error-text">No pude leer la lista de bots: {catalogError}</p>}
            {!catalog && !catalogError && <p className="muted">Buscando los bots disponibles…</p>}
            <div className="stack">
              {main.map((b) => (
                <label key={b.id} className={`pick${chosen.includes(b.id) ? ' is-active' : ''}`}>
                  <input type="checkbox" checked={chosen.includes(b.id)}
                    onChange={(e) => setChosen((c) => e.target.checked ? [...c, b.id] : c.filter((x) => x !== b.id))} />
                  <div>
                    <div className="cell-title">{b.nombre} <span className="muted small">v{b.version}</span></div>
                    <div className="muted small">{b.descripcion}</div>
                    {(b.incluye ?? []).map((s) => <div key={s.id} className="small ok-text">Incluye: {s.nombre}</div>)}
                    {b.id === 'twitch-moderator' && <div className="small warn">Necesitarás una cuenta de Twitch para el bot (te guío después).</div>}
                  </div>
                </label>
              ))}
            </div>
            <p className="muted small">Lirio descargará Python y las librerías de cada bot (varios GB en total). Se instala solo en tu usuario.</p>
            <Nav back={back} next={next} canNext={chosen.length > 0} hint="Elige al menos un bot." />
          </section>
        )}

        {step === 'IA' && (
          <section className="welcome__card">
            <h1>¿Qué IA usarán tus bots?</h1>
            <p><b>No necesitas Claude ni pagar nada.</b> Los bots funcionan en modo automático o con una IA gratis en tu PC; Claude es solo una opción extra si ya lo tienes.</p>
            <AiChooser value={answers.ia} model={answers.ollama_modelo}
              onChange={(ia, model) => set({ ia, ollama_modelo: ia === 'ollama' ? model : undefined })} />
            <p className="muted small">Puedes cambiarla más tarde.</p>
            <Nav back={back} next={install} nextLabel="Instalar" canNext />
          </section>
        )}

        {step === 'Instalar' && (
          <section className="welcome__card">
            <h1>{result?.ok ? '¡Instalado!' : result ? 'Algo ha fallado' : 'Instalando…'}</h1>
            <div className="stack">
              {chosen.map((id) => {
                const s = log[id]
                const name = catalog?.find((b) => b.id === id)?.nombre ?? id
                return (
                  <div key={id} className="install-row">
                    <div className="cell-title">{name}</div>
                    <div className="muted small">{s?.detalle ?? 'En espera…'}</div>
                    <ProgressBar percent={s?.paso === 'listo' ? 100 : s?.percent ?? 0} label={name} />
                  </div>
                )
              })}
            </div>
            {result && !result.ok && <p className="error-text">{result.error}</p>}
            {result && !result.ok && <div className="row"><button className="btn btn--primary" onClick={install}>Reintentar</button></div>}
            {result?.ok && <div className="row"><button className="btn btn--primary" onClick={() => setStep(hasEditor ? 'YouTube' : 'Listo')}>Seguir <Icon name="arrow" size={16} /></button></div>}
          </section>
        )}

        {step === 'YouTube' && (
          <section className="welcome__card">
            <h1>Conecta tu YouTube</h1>
            <p className="muted">Para subir vídeos a <b>tu</b> canal, Google pide que tengas tu propio «proyecto» (gratis). Te guío paso a paso: unos 10 minutos.</p>
            <YouTubeGuide botId="twitch-autoeditor" onDone={next} />
            <div className="row"><button className="btn btn--ghost" onClick={next}>Hacerlo más tarde</button></div>
          </section>
        )}

        {step === 'Listo' && (
          <section className="welcome__card">
            <h1>¡Todo listo, <span className="accent">{answers.nombre || 'amigo'}</span>!</h1>
            <p>Tus bots ya están en Lirio. Desde allí los arrancas, ves lo que hacen y apruebas lo importante manteniendo pulsado un botón.</p>
            <div className="row"><button className="btn btn--primary" onClick={onFinish}>Ir a Lirio <Icon name="arrow" size={16} /></button></div>
          </section>
        )}
      </main>
    </div>
  )
}

function Nav({ back, next, canNext, hint, nextLabel = 'Siguiente' }:
  { back: () => void; next: () => void; canNext: boolean; hint?: string; nextLabel?: string }) {
  return (
    <div className="welcome__nav">
      <button className="btn btn--ghost" onClick={back}>Atrás</button>
      {!canNext && hint && <span className="muted small">{hint}</span>}
      <button className="btn btn--primary" disabled={!canNext} onClick={next}>{nextLabel} <Icon name="arrow" size={16} /></button>
    </div>
  )
}
