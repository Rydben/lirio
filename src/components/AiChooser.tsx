// Elegir la IA del amigo: modo automático (sin IA), IA local con Ollama o, opcionalmente, su propia cuenta de Claude.
// Nunca se comparte la suscripción de nadie: cada opción usa lo que el amigo tenga en SU PC.
import { useEffect, useState } from 'react'
import { api, type AiStatus, type Answers } from '../lib/api'
import { Icon, Pill, ProgressBar } from './ui'

type Ia = Answers['ia']

const FASES: Record<string, string> = {
  descarga: '1/4 Descargando Ollama', instalacion: '2/4 Instalando Ollama', arranque: '3/4 Abriendo Ollama', modelo: '4/4 Bajando el modelo',
}

interface Props {
  value: Ia
  model?: string
  onChange: (ia: Ia, model?: string) => void
}

export function AiChooser({ value, model, onChange }: Props) {
  const [st, setSt] = useState<AiStatus | null>(null)
  const [claude, setClaude] = useState<'?' | 'ok' | 'sin_sesion' | 'no_instalado' | 'error' | 'probando'>('?')
  const [pull, setPull] = useState<{ percent: number | null; fase?: string; estado?: string; error?: string | null; done?: boolean } | null>(null)

  const refresh = () => api.aiStatus().then(setSt).catch(() => {})
  useEffect(() => { refresh() }, [])
  useEffect(() => {
    const un = api.onPull((e) => {
      if (e.hecho) {
        setPull((p) => ({ percent: e.ok ? 100 : p?.percent ?? 0, error: e.ok ? null : e.error, done: true }))
        refresh()
      } else setPull((p) => ({ percent: e.percent ?? (p?.fase === e.fase ? p?.percent ?? null : null), fase: e.fase, estado: e.estado }))
    })
    return () => { un.then((f) => f()) }
  }, [])

  const recommended = st?.modelo_recomendado ?? 'qwen2.5:3b'
  const chosenModel = model ?? recommended
  const hasModel = st?.ollama_modelos.some((m) => m === chosenModel || m.startsWith(`${chosenModel}`)) ?? false

  // Elegir «IA local» basta: Lirio instala Ollama (si falta), lo abre y baja el modelo, sin que el amigo haga nada.
  const ready = !!st?.ollama_activo && hasModel
  const setup = () => { setPull({ percent: 0, fase: 'descarga' }); api.ollamaSetup(chosenModel).catch((e) => setPull({ percent: 0, error: String(e), done: true })) }
  useEffect(() => {
    if (value === 'ollama' && st && !ready && !pull) setup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, st, ready])

  const testClaude = async () => {
    setClaude('probando')
    const r = await api.testClaude()
    setClaude(r.ok ? 'ok' : (r.motivo as any) ?? 'error')
  }

  return (
    <div className="ai-options" role="radiogroup" aria-label="Elige tu IA">
      <label className={`ai-option${value === 'heuristico' ? ' is-active' : ''}`}>
        <input type="radio" name="ia" checked={value === 'heuristico'} onChange={() => onChange('heuristico')} />
        <div className="ai-option__head"><b>Modo automático (sin IA)</b><Pill tone="ok">Siempre funciona</Pill></div>
        <p className="muted small">Usa reglas: subidas de volumen, picos del chat… Más simple, pero no necesita nada.</p>
      </label>
      <label className={`ai-option${value === 'ollama' ? ' is-active' : ''}`}>
        <input type="radio" name="ia" checked={value === 'ollama'} onChange={() => onChange('ollama', chosenModel)} />
        <div className="ai-option__head"><b>IA local (Ollama)</b><Pill tone="working">Gratis y privada</Pill></div>
        <p className="muted small">
          Funciona en tu PC sin cuentas. Es <b>peor que Claude</b> eligiendo los mejores momentos, y usa tu gráfica
          (Lirio no la usa mientras juegas o transmites).
        </p>
        {value !== 'ollama' && !st?.ollama_instalado && (
          <p className="muted small">Si la eliges, Lirio lo instala todo solo: Ollama (unos 1,9 GB, de ollama.com) y el modelo para tu gráfica.</p>
        )}
        {value === 'ollama' && (
          <div className="ai-option__body">
            {ready ? (
              <p className="ok-text"><Icon name="check" size={16} /> Listo: IA local preparada con el modelo {chosenModel}.</p>
            ) : (
              <>
                <p className="muted small">
                  Lo preparo yo: {st?.ollama_instalado ? '' : 'instalo Ollama (de ollama.com), '}lo abro y bajo el modelo
                  recomendado para tu gráfica{st?.vram_gb ? ` (${st.vram_gb.toFixed(0)} GB)` : ''}: <b>{recommended}</b>.
                </p>
                {pull && !pull.error && (
                  <>
                    <div className="muted small">{FASES[pull.fase ?? ''] ?? 'Preparando'}{pull.estado ? ` · ${pull.estado}` : ''}</div>
                    <ProgressBar percent={pull.done ? 100 : pull.percent ?? 0} label="IA local" />
                  </>
                )}
                {pull?.error && (
                  <>
                    <p className="error-text">{pull.error}</p>
                    <button className="btn btn--primary" onClick={setup}><Icon name="refresh" size={16} /> Reintentar</button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </label>

      <label className={`ai-option${value === 'claude_code' ? ' is-active' : ''}`}>
        <input type="radio" name="ia" checked={value === 'claude_code'} onChange={() => onChange('claude_code')} />
        <div className="ai-option__head"><b>Tu cuenta de Claude</b><Pill tone="muted">Opcional</Pill><Pill tone="ok">La mejor calidad</Pill></div>
        <p className="muted small">Solo si ya tienes Claude: usa Claude Code con <b>tu propia</b> cuenta. No hace falta para nada más, y Lirio nunca usa la cuenta de nadie.</p>
        {value === 'claude_code' && (
          <div className="ai-option__body">
            {claude === 'ok' && <p className="ok-text"><Icon name="check" size={16} /> Claude responde con tu cuenta.</p>}
            {claude === 'no_instalado' && <p className="warn">Falta Claude Code en este PC. Instálalo desde la web de Claude y vuelve a probar.</p>}
            {claude === 'sin_sesion' && <p className="warn">Claude Code está instalado pero sin sesión: ábrelo una vez y entra con tu cuenta.</p>}
            {claude === 'error' && <p className="error-text">Claude no respondió. Puedes elegir otra opción y cambiarla luego.</p>}
            <div className="row">
              <button className="btn btn--ghost" onClick={() => api.openUrl('https://claude.ai/download')}>Descargar Claude</button>
              <button className="btn btn--outline" disabled={claude === 'probando'} onClick={testClaude}>
                {claude === 'probando' ? 'Probando…' : 'Probar'}
              </button>
            </div>
          </div>
        )}
      </label>

    </div>
  )
}
