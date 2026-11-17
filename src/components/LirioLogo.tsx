// Logo de Lirio: flor de lis (lirio) en línea de neón cian. Legible desde 16 px.
interface Props {
  size?: number
  glow?: boolean
  className?: string
}

export const LIRIO_PATHS = [
  'M32 6 C39 14 41 23 32 36 C23 23 25 14 32 6 Z',
  'M29 40 C27 31 21 24 14 24 C8 24 6 31 10 35 C13 38 17 36 16 32',
  'M35 40 C37 31 43 24 50 24 C56 24 58 31 54 35 C51 38 47 36 48 32',
  'M21 41 H43',
  'M32 45 V56',
  'M29 45 C27 51 23 54 18 53',
  'M35 45 C37 51 41 54 46 53',
]

export function LirioPaths({ strokeWidth = 3.2 }: { strokeWidth?: number }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {LIRIO_PATHS.map((d) => <path key={d} d={d} />)}
    </g>
  )
}

export function LirioLogo({ size = 40, glow = true, className }: Props) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} role="img" aria-label="Lirio"
      style={{ color: 'var(--cyan)', filter: glow ? 'drop-shadow(0 0 4px var(--cyan-glow))' : undefined }}>
      <LirioPaths />
    </svg>
  )
}
