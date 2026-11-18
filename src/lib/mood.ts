// El humor del avatar refleja el estado real del sistema.
import type { BotView } from './api'
import { stalledInput } from './progress'

export type Expression =
  | 'feliz' | 'ojos_cerrados' | 'sorprendido' | 'enojado' | 'triste' | 'guino' | 'boca_abierta' | 'confundido'

export interface Mood {
  expression: Expression
  level: 'ok' | 'working' | 'warning' | 'error'
  title: string
  detail: string
}

export function moodFor(bots: BotView[], uploading = false): Mood {
  const main = bots.filter((b) => !b.parent)
  const missing = main.filter((b) => b.state === 'files_missing')
  if (missing.length) {
    return { expression: 'triste', level: 'error', title: 'Faltan archivos',
      detail: `A ${names(missing)} le faltan archivos. Seguramente el antivirus (Norton, por ejemplo) los ha puesto en cuarentena: ` +
        'mira Configuración → Ayuda con el antivirus.' }
  }
  const broken = main.filter((b) => b.state === 'error' || b.state === 'crashed' || b.status?.last_error)
  if (broken.length) {
    return { expression: 'triste', level: 'error', title: 'Algo ha fallado',
      detail: `${names(broken)} necesita${broken.length > 1 ? 'n' : ''} que lo mires.` }
  }
  const login = main.filter((b) => b.state === 'needs_login')
  if (login.length) {
    return { expression: 'confundido', level: 'warning', title: 'Falta iniciar sesión',
      detail: `${names(login)}: Claude no tiene la sesión iniciada.` }
  }
  const approvals = main.reduce((n, b) => n + b.approvals_pending.length, 0)
  if (approvals) {
    return { expression: 'sorprendido', level: 'warning', title: 'Te necesito un momento',
      detail: approvals === 1 ? 'Hay 1 aprobación esperándote.' : `Hay ${approvals} aprobaciones esperándote.` }
  }
  const stopped = main.filter((b) => b.stop_active)
  if (stopped.length) {
    return { expression: 'sorprendido', level: 'warning', title: 'Bots en pausa',
      detail: `${names(stopped)} está${stopped.length > 1 ? 'n' : ''} parado${stopped.length > 1 ? 's' : ''} con STOP.` }
  }
  const stalled = main.filter((b) => b.state === 'stalled')
  if (stalled.length) {
    return { expression: 'confundido', level: 'warning', title: 'Un bot no responde',
      detail: `${names(stalled)} sigue abierto pero no da señales. Prueba Parar y Arrancar.` }
  }
  const idle = main.filter((b) => stalledInput(b))
  if (idle.length) {
    const st = stalledInput(idle[0])!
    return { expression: 'confundido', level: 'warning', title: 'El editor no avanza',
      detail: `${names(idle)} tiene un directo descargado desde las ${st.desde} sin editar. Míralo en su página.` }
  }
  const warned = main.filter((b) => b.status?.warning)
  if (warned.length) {
    return { expression: 'sorprendido', level: 'warning', title: 'Un aviso', detail: String(warned[0].status!.warning) }
  }
  const busy = main.filter((b) => b.state === 'running' || b.status?.current_job)
  if (busy.length || uploading) {
    return { expression: 'ojos_cerrados', level: 'working', title: 'Trabajando…',
      detail: uploading ? 'Subiendo a YouTube.' : `${names(busy)} está editando.` }
  }
  return { expression: 'feliz', level: 'ok', title: 'Todo en orden', detail: 'Listo para ayudarte.' }
}

function names(bots: BotView[]) {
  return bots.map((b) => b.name).join(', ')
}

const STATE_LABELS: Record<string, string> = {
  idle: 'En reposo', running: 'Trabajando', watching: 'Vigilando', waiting: 'Esperando', needs_login: 'Sin sesión',
  stopped: 'Parado', error: 'Error', crashed: 'Caído', stalled: 'Atascado', files_missing: 'Faltan archivos', installing: 'Instalándose', install_pending: 'Instalación sin terminar', on_demand: 'A demanda', unknown: 'Sin datos',
}

/** ¿Puede este Lirio firmar aprobaciones para el bot? null = el bot no usa aprobaciones firmadas. */
export function keyProblem(b: BotView, mine?: { id: string; llave_publica: string }): string | null {
  if (b.parent || !b.commands.includes('aprobar-firmado') || !mine) return null
  if (!b.pinned_key) return `Este bot no tiene fijada la llave de Lirio (${mine.id}): no podrás aprobar desde aquí.`
  if (b.pinned_key.llave_publica !== mine.llave_publica)
    return `La llave de este Lirio (${mine.id}) no es la que tiene fijada el bot (${b.pinned_key.id}). Las aprobaciones desde aquí no valdrán.`
  return null
}

export function stateLabel(b: BotView): string {
  if (b.stop_active) return 'STOP'
  return STATE_LABELS[b.state] ?? b.state
}

export function stateTone(b: BotView): 'ok' | 'working' | 'warning' | 'error' | 'muted' {
  if (b.stop_active) return 'warning'
  switch (b.state) {
    case 'watching': case 'idle': return 'ok'
    case 'running': return 'working'
    case 'waiting': case 'needs_login': case 'stopped': case 'stalled': return 'warning'
    case 'files_missing': return 'error'
    case 'installing': return 'working'
    case 'install_pending': return 'warning'
    case 'error': case 'crashed': return 'error'
    default: return 'muted'
  }
}
