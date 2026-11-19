import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/ui'
import { api, type Overview } from '../lib/api'
import { BUNDLED, bestOf, fmt, lineProgress, pickData, programDone, valueAt } from '../lib/monetizacion'
import { StoreProvider } from '../lib/store'
import { MonetizationPage } from './MonetizationPage'

afterEach(() => vi.restoreAllMocks())

const afiliado = BUNDLED.plataformas.twitch.programas.find((p) => p.id === 'afiliado')!
const anuncios = BUNDLED.plataformas.youtube.programas.find((p) => p.id === 'anuncios')!

describe('cálculo de lo que falta', () => {
  it('lee cifras anidadas y no se inventa las que faltan', () => {
    expect(valueAt({ ultimos_30_dias: { dias_emitidos: 3 } }, 'ultimos_30_dias.dias_emitidos')).toBe(3)
    expect(valueAt({ seguidores: null }, 'seguidores')).toBeNull()
    expect(valueAt(null, 'seguidores')).toBeNull()
  })

  it('afiliado de Twitch: hecho solo si se cumplen los cuatro; sin un dato no se sabe', () => {
    const all = { seguidores: 30, ultimos_30_dias: { minutos_emitidos: 300, dias_emitidos: 5, media_espectadores: 3.2 } }
    expect(programDone(afiliado, all)).toBe(true)
    expect(programDone(afiliado, { ...all, seguidores: 10 })).toBe(false)
    expect(programDone(afiliado, { ...all, ultimos_30_dias: { ...all.ultimos_30_dias, media_espectadores: null } })).toBeNull()
  })

  it('YouTube: horas o Shorts, cuenta la alternativa más avanzada', () => {
    const una = anuncios.requisitos.find((l) => 'una_de' in l)!
    const pr = lineProgress(una, { horas_publicas_12m: 1000, vistas_shorts_90d: 8_000_000 })
    expect(pr.req.id).toBe('shorts')
    expect(Math.round(pr.pct)).toBe(80)
    expect(bestOf('una_de' in una ? una.una_de : [], { horas_publicas_12m: 4200 }).hecho).toBe(true)
  })

  it('formatos: minutos como horas', () => {
    expect(fmt(240, 'min')).toBe('4 h')
    expect(fmt(null)).toBe('—')
  })

  it('usa la copia publicada solo si es igual de nueva o más', () => {
    expect(pickData(null)).toBe(BUNDLED)
    expect(pickData({ ...BUNDLED, comprobado: '2020-01-01' })).toBe(BUNDLED)
    const newer = { ...BUNDLED, comprobado: '2099-01-01' }
    expect(pickData(newer)).toBe(newer)
  })

  it('todas las fuentes son enlaces oficiales', () => {
    const urls = Object.values(BUNDLED.plataformas).flatMap((p) => [p.pago.fuente, ...p.programas.map((x) => x.fuente)])
    for (const u of urls) expect(u).toMatch(/^https:\/\/(help\.twitch\.tv|support\.google\.com)\//)
  })
})

describe('página de Monetización', () => {
  const overview = (ids: string[]) => ({ usuario: 'A', errors: [], uploads: [],
    modules: ids.map((id) => ({ id, name: id, commands: [], approvals_pending: [], state: 'idle' })) }) as unknown as Overview

  it('enseña la fecha de comprobación, las cifras reales y los pasos sin aceptar nada por el usuario', async () => {
    vi.spyOn(api, 'overview').mockResolvedValue(overview(['twitch-moderator', 'twitch-autoeditor']))
    vi.spyOn(api, 'monetizacionDatos').mockResolvedValue(null)
    const run = vi.spyOn(api, 'runWith').mockImplementation(async (id) => ({ ok: true, code: 0, message: '', data:
      id === 'twitch-moderator'
        ? { seguidores: 18, ultimos_30_dias: { dias_emitidos: 5, minutos_emitidos: 610, media_espectadores: 2.4 }, en_directo: { activo: false } }
        : { suscriptores: 212, videos_publicos_90d: 7, horas_publicas_12m: 640, vistas_shorts_90d: null,
            motivos: { vistas_shorts_90d: 'YouTube no separa las vistas de Shorts.' } } }))
    render(<ToastProvider><StoreProvider><MonetizationPage /></StoreProvider></ToastProvider>)
    expect(screen.getByTestId('comprobado')).toHaveTextContent('19 de noviembre de 2026')
    const tw = await screen.findByTestId('programa-afiliado')
    await waitFor(() => expect(within(tw).getByText('18 / 25')).toBeInTheDocument())
    expect(within(tw).getByText('10,2 h / 4 h')).toBeInTheDocument()
    expect(run).toHaveBeenCalledWith('twitch-moderator', 'monetizacion', {})
    expect(run.mock.calls.every(([, cmd]) => cmd === 'monetizacion')).toBe(true) // solo lectura
    expect(screen.getAllByText(/Lirio nunca/).length).toBeGreaterThan(0)
  })

  it('sin el bot instalado o sin el comando, lo dice claro', async () => {
    vi.spyOn(api, 'overview').mockResolvedValue(overview(['twitch-moderator']))
    vi.spyOn(api, 'monetizacionDatos').mockResolvedValue(null)
    vi.spyOn(api, 'runWith').mockResolvedValue({ ok: false, code: 2, message: "Twitch Moderator no tiene el comando 'monetizacion'", data: null })
    render(<ToastProvider><StoreProvider><MonetizationPage /></StoreProvider></ToastProvider>)
    expect(await screen.findByText(/todavía no sabe darte estas cifras/)).toBeInTheDocument()
    expect(within(screen.getByTestId('plataforma-youtube')).getByText(/Instala el editor/)).toBeInTheDocument()
  })
})

describe('formato real del moderador', () => {
  it('lee los motivos que vienen junto al dato', async () => {
    const { reasonAt } = await import('../lib/monetizacion')
    const s = { ultimos_30_dias: { media_espectadores: null, motivos: { media_espectadores: 'El bot no midió espectadores en estos días.' } },
                motivos: { seguidores: 'Conecta la cuenta del streamer.' } }
    expect(reasonAt(s, 'ultimos_30_dias.media_espectadores')).toMatch(/no midió/)
    expect(reasonAt(s, 'seguidores')).toMatch(/Conecta/)
  })
})

describe('formato real del editor', () => {
  it('enseña la explicación de horas y Shorts aunque haya cifra, y lo de los suscriptores ocultos', async () => {
    const { progress, BUNDLED: B } = await import('../lib/monetizacion')
    const anun = B.plataformas.youtube.programas.find((p) => p.id === 'anuncios')!
    const una = anun.requisitos.find((l) => 'una_de' in l)!
    const horas = ('una_de' in una ? una.una_de : []).find((r) => r.id === 'horas')!
    const s = { horas_publicas_12m: 24.3, horas_motivo: 'Incluye vídeos ocultos si los hubo.', suscriptores: null, suscriptores_ocultos: true }
    expect(progress(horas, s).motivo).toMatch(/ocultos si los hubo/)
    expect(progress(horas, s).valor).toBe(24.3)
    const subs = anun.requisitos.find((l) => !('una_de' in l) && l.id === 'suscriptores')!
    expect(progress(subs as never, s).motivo).toMatch(/oculto/)
  })
})
