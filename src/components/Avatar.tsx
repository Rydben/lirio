// El avatar de Lirio: la ilustración (cuerpo) + una pantalla vectorial animada encima de la TV.
// La pantalla original con "db" queda tapada; el "db" de la chaqueta solo cambia regenerando la ilustración.
import avatarUrl from '../assets/avatar.png'
import type { Expression } from '../lib/mood'
import { Face } from './Face'

// Posición de la pantalla dentro de avatar.png (370x441 px)
const SCREEN = { x: 141, y: 60, w: 99, h: 75 }

interface Props {
  expression: Expression
  height?: number
  working?: boolean
}

export function Avatar({ expression, height = 260, working = false }: Props) {
  return (
    <div className={`avatar${working ? ' avatar--working' : ''}`} style={{ height }} data-testid="avatar">
      <svg viewBox="0 0 370 441" height={height} role="img" aria-label={`Avatar de Lirio: ${expression}`}>
        <defs>
          <radialGradient id="screen-bg" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor="#0d1a2b" />
            <stop offset="100%" stopColor="#03050a" />
          </radialGradient>
          <filter id="neon-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id="screen-clip"><rect x="3" y="3" width="93" height="69" rx="13" /></clipPath>
        </defs>
        <image href={avatarUrl} width="370" height="441" />
        <g transform={`translate(${SCREEN.x} ${SCREEN.y}) scale(${SCREEN.w / 100} ${SCREEN.h / 76})`}>
          <rect x="3" y="3" width="93" height="69" rx="13" fill="url(#screen-bg)" />
          <g clipPath="url(#screen-clip)">
            <g className="neon" filter="url(#neon-glow)" transform="translate(0 1)">
              <Face expression={expression} />
            </g>
            <rect className="avatar__scan" x="0" y="0" width="100" height="6" />
          </g>
        </g>
      </svg>
    </div>
  )
}
