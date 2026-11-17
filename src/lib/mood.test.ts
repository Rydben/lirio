import { describe, expect, it } from 'vitest'
import type { BotView } from './api'
import { keyProblem, moodFor, stateLabel, stateTone } from './mood'

const bot = (over: Partial<BotView> = {}): BotView => ({
  id: 'b', name: 'Bot', dir: '', commands: [], state: 'watching', status: {}, approvals_pending: [],
  stop_active: false, stop_requested: false, ...over,
})

describe('moodFor', () => {
  it('todo en orden -> feliz', () => {
    expect(moodFor([bot()]).expression).toBe('feliz')
  })
  it('trabajando -> ojos cerrados', () => {
    expect(moodFor([bot({ status: { current_job: { stage: 'edit' } } })]).expression).toBe('ojos_cerrados')
    expect(moodFor([bot()], true).level).toBe('working')
  })
  it('aviso o aprobación -> sorprendido', () => {
    expect(moodFor([bot({ status: { warning: 'plan heurístico' } })]).expression).toBe('sorprendido')
    const m = moodFor([bot({ approvals_pending: [{ id: 'x', action: 'a', status: 'pending' }] })])
    expect(m.expression).toBe('sorprendido')
    expect(m.detail).toContain('1 aprobación')
  })
  it('error manda sobre todo lo demás -> triste', () => {
    const m = moodFor([bot({ state: 'crashed', approvals_pending: [{ id: 'x', action: 'a', status: 'pending' }] })])
    expect(m.expression).toBe('triste')
    expect(m.level).toBe('error')
  })
  it('sin sesión de Claude -> confundido', () => {
    expect(moodFor([bot({ state: 'needs_login' })]).expression).toBe('confundido')
  })
  it('atascado -> confundido, con un consejo', () => {
    const m = moodFor([bot({ state: 'stalled' })])
    expect(m.expression).toBe('confundido')
    expect(m.detail).toContain('Parar')
  })
  it('los sub-bots no cuentan para el humor', () => {
    expect(moodFor([bot(), bot({ parent: 'b', state: 'error' })]).expression).toBe('feliz')
  })
})

describe('llave de aprobaciones', () => {
  const mine = { id: 'lirio-a', llave_publica: 'AAA' }
  const signed = (pinned?: { id: string; llave_publica: string } | null) =>
    bot({ commands: ['aprobar-firmado'], pinned_key: pinned })
  it('coincide -> sin aviso', () => expect(keyProblem(signed(mine), mine)).toBeNull())
  it('otra llave -> aviso con los dos ids', () => {
    const msg = keyProblem(signed({ id: 'lirio-b', llave_publica: 'BBB' }), mine)!
    expect(msg).toContain('lirio-a')
    expect(msg).toContain('lirio-b')
  })
  it('sin llave fijada -> aviso', () => expect(keyProblem(signed(null), mine)).toContain('no tiene fijada'))
  it('bots sin aprobaciones firmadas -> nada', () => expect(keyProblem(bot(), mine)).toBeNull())
})

describe('etiquetas', () => {
  it('STOP tiene prioridad', () => {
    expect(stateLabel(bot({ stop_active: true }))).toBe('STOP')
    expect(stateTone(bot({ stop_active: true }))).toBe('warning')
  })
  it('traduce los estados', () => {
    expect(stateLabel(bot({ state: 'crashed' }))).toBe('Caído')
    expect(stateTone(bot({ state: 'crashed' }))).toBe('error')
  })
})
