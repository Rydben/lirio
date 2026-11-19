// Datos «en vivo» sin preguntar cada pocos segundos: se recargan cuando el núcleo avisa de que un bot ha cambiado
// (`lirio://cambio`), al volver a la ventana, y muy de vez en cuando por si acaso. Con Lirio minimizado no se hace nada.
import { useEffect, useRef } from 'react'
import { api } from './api'

/** Cada cuánto se recarga de todas formas (por si un cambio no se notó). */
export const FALLBACK_MS = 30_000
const DEBOUNCE_MS = 250

export interface CambioEvent { bots: string[]; config: boolean }

/** ¿Afecta este aviso a lo que enseña la página? `'any'` = cualquier bot. */
export function matches(e: CambioEvent, bots: string[] | 'any') {
  if (e.config) return true
  return bots === 'any' ? e.bots.length > 0 : e.bots.some((b) => bots.includes(b))
}

/** `minGapMs`: tiempo mínimo entre dos cargas por avisos (para lo que lanza Python: un bot que escribe su estado
 *  cada 5 s no debe lanzar Python cada 5 s). */
export function useLive(load: () => unknown, bots: string[] | 'any', fallbackMs = FALLBACK_MS, minGapMs = 0) {
  const ref = useRef(load)
  ref.current = load
  const key = bots === 'any' ? 'any' : bots.join(',')

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0
    const run = () => { if (!document.hidden) { last = Date.now(); void ref.current() } }
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { if (Date.now() - last >= minGapMs - 100) run() }, Math.max(DEBOUNCE_MS, last + minGapMs - Date.now()))
    }
    run()
    const list = key === 'any' ? 'any' : key.split(',')
    const un = api.onCambio((e) => { if (matches(e, list)) soon() })
    // por si acaso, solo si no se ha cargado hace poco
    const every = setInterval(() => { if (Date.now() - last >= fallbackMs - 100) run() }, fallbackMs)
    const onVis = () => { if (!document.hidden) soon() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimeout(timer)
      clearInterval(every)
      document.removeEventListener('visibilitychange', onVis)
      void un.then((f) => f())
    }
  }, [key, fallbackMs, minGapMs])
}
