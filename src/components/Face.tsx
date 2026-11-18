// La cara de la pantalla del avatar: vectorial, en neón cian, con 8 expresiones.
// Coordenadas en una caja de 100x76 (la pantalla de la TV).
import type { ReactNode } from 'react'
import type { Expression } from '../lib/mood'

const SMILE = 'M37 52 Q50 63 63 52'
const FROWN = 'M38 60 Q50 50 62 60'

const FACES: Record<Expression, ReactNode> = {
  // Normal: solo la cara (el logo de Lirio no va en la pantalla del avatar; el «db» de la chaqueta sí se queda)
  feliz: (
    <>
      <ellipse cx="35" cy="30" rx="5" ry="7" />
      <ellipse cx="65" cy="30" rx="5" ry="7" />
      <path d={SMILE} />
    </>
  ),
  ojos_cerrados: (
    <>
      <path d="M26 34 L34 26 L42 34" />
      <path d="M58 34 L66 26 L74 34" />
      <path d={SMILE} />
    </>
  ),
  sorprendido: (
    <>
      <circle cx="35" cy="30" r="7" />
      <circle cx="65" cy="30" r="7" />
      <circle cx="50" cy="56" r="6" />
    </>
  ),
  enojado: (
    <>
      <path d="M25 24 L43 31" />
      <path d="M75 24 L57 31" />
      <path d="M29 36 Q35 41 41 36" />
      <path d="M59 36 Q65 41 71 36" />
      <path d={FROWN} />
    </>
  ),
  triste: (
    <>
      <path d="M27 31 Q34 38 42 31" />
      <path d="M58 31 Q66 38 73 31" />
      <path d={FROWN} />
    </>
  ),
  guino: (
    <>
      <circle cx="35" cy="30" r="5" className="fill" />
      <path d="M72 23 L60 30 L72 37" />
      <path d={SMILE} />
    </>
  ),
  boca_abierta: (
    <>
      <circle cx="35" cy="28" r="5" className="fill" />
      <circle cx="65" cy="28" r="5" className="fill" />
      <path d="M37 44 H63 Q63 64 50 64 Q37 64 37 44 Z" className="fill" />
    </>
  ),
  confundido: (
    <>
      <path d="M27 23 L39 30 L27 37" />
      <path d="M60 22 Q60 14 67 14 Q74 14 74 21 Q74 27 67 29 V34" />
      <circle cx="67" cy="41" r="1.5" className="fill" />
      <path d="M38 56 Q44 51 50 56 Q56 61 62 56" />
    </>
  ),
}

export const EXPRESSIONS = Object.keys(FACES) as Expression[]

interface Props {
  expression: Expression
  /** Parpadeo automático cada pocos segundos (solo con la cara normal). */
  blink?: boolean
}

export function Face({ expression, blink = true }: Props) {
  return (
    <g className={`face face--${expression}${blink && expression === 'feliz' ? ' face--blink' : ''}`}
      data-expression={expression}>
      <g className="face__main">{FACES[expression]}</g>
      {expression === 'feliz' && <g className="face__blink">{FACES.ojos_cerrados}</g>}
    </g>
  )
}

/** Pantalla suelta (para iconos de estado): marco oscuro + cara. */
export function ScreenFace({ expression, size = 48 }: { expression: Expression; size?: number }) {
  return (
    <svg viewBox="0 0 100 76" width={size} height={size * 0.76} className="screen-face" aria-label={expression}>
      <rect x="2" y="2" width="96" height="72" rx="16" className="screen-face__bg" />
      <g className="neon"><Face expression={expression} blink={false} /></g>
    </svg>
  )
}
