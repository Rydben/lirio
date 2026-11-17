// Botón de "mantener pulsado 2 s": el gesto humano que exige The Wall para aprobar desde Lirio.
// El núcleo (Rust) también mide el tiempo entre `gesture_begin` y la firma: no basta con este componente.
import { useEffect, useRef, useState, type ReactNode } from 'react'

export const HOLD_MS = 2000

interface Props {
  /** Se llama al EMPEZAR a pulsar: debe devolver el token del gesto (gesture_begin). */
  onBegin: () => Promise<string>
  /** Se llama tras HOLD_MS pulsado con el token. */
  onComplete: (token: string) => Promise<void> | void
  children: ReactNode
  tone?: 'primary' | 'danger' | 'ghost'
  disabled?: boolean
  title?: string
  /** Solo para tests (jsdom no genera eventos «de confianza»). El tiempo real lo vuelve a medir el núcleo. */
  requireTrusted?: boolean
}

export function HoldButton({ onBegin, onComplete, children, tone = 'primary', disabled, title, requireTrusted = true }: Props) {
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const frame = useRef<number | null>(null)
  const done = useRef<number | null>(null)
  const start = useRef(0)
  const token = useRef<Promise<string> | null>(null)

  const stopTimers = () => {
    if (frame.current) cancelAnimationFrame(frame.current)
    if (done.current) clearTimeout(done.current)
    frame.current = null
    done.current = null
  }

  /** Soltar antes de tiempo: no pasa nada. */
  const cancel = () => {
    if (!done.current) return
    stopTimers()
    token.current = null
    setProgress(0)
  }

  useEffect(() => stopTimers, [])

  const complete = () => {
    stopTimers()
    const t = token.current
    token.current = null
    if (!t) return
    setProgress(1)
    setBusy(true)
    t.then((tok) => onComplete(tok)).catch(() => {}).finally(() => { setBusy(false); setProgress(0) })
  }

  const begin = (e: React.PointerEvent | React.KeyboardEvent) => {
    // Solo eventos generados por una persona (no por scripts dentro de la página)
    if ((requireTrusted && !e.nativeEvent.isTrusted) || disabled || busy || done.current) return
    if ('button' in e && e.button !== 0) return
    start.current = performance.now()
    token.current = onBegin()
    token.current.catch(cancel)
    // El tiempo lo mide un temporizador; la animación solo dibuja el relleno (puede ir más lenta en segundo plano)
    done.current = window.setTimeout(complete, HOLD_MS)
    const tick = () => {
      setProgress(Math.min(1, (performance.now() - start.current) / HOLD_MS))
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  return (
    <button
      type="button"
      className={`btn btn--${tone} hold${busy ? ' is-busy' : ''}`}
      disabled={disabled || busy}
      title={title ?? 'Mantén pulsado 2 segundos'}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) begin(e) }}
      onKeyUp={cancel}
      style={{ ['--hold' as string]: progress }}
    >
      <span className="hold__fill" aria-hidden />
      <span className="hold__label">{busy ? 'Un momento…' : children}</span>
    </button>
  )
}
