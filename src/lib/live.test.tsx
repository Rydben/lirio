import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { FALLBACK_MS, useLive, type CambioEvent } from './live'
import { forgetAll, remember } from './remember'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

function Probe({ load, bots, gap }: { load: () => void; bots: string[] | 'any'; gap?: number }) {
  useLive(load, bots, FALLBACK_MS, gap)
  return null
}

describe('datos en vivo', () => {
  it('recarga cuando cambia su bot, no cuando cambia otro, y no sondea cada pocos segundos', async () => {
    vi.useFakeTimers()
    let emit: (e: CambioEvent) => void = () => {}
    vi.spyOn(api, 'onCambio').mockImplementation(async (cb) => { emit = cb; return () => {} })
    const load = vi.fn()
    render(<Probe load={load} bots={['ed']} />)
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(load).toHaveBeenCalledTimes(1) // antes: cada 4 s
    act(() => emit({ bots: ['mod'], config: false }))
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(load).toHaveBeenCalledTimes(1)
    act(() => { emit({ bots: ['ed'], config: false }); emit({ bots: ['ed'], config: false }) })
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(load).toHaveBeenCalledTimes(2) // dos avisos seguidos = una carga
    await act(async () => { vi.advanceTimersByTime(2 * FALLBACK_MS) })
    expect(load).toHaveBeenCalledTimes(3) // por si acaso (solo si no se cargó hace poco)
  })

  it('lo que lanza Python respeta el mínimo entre cargas', async () => {
    vi.useFakeTimers()
    let emit: (e: CambioEvent) => void = () => {}
    vi.spyOn(api, 'onCambio').mockImplementation(async (cb) => { emit = cb; return () => {} })
    const load = vi.fn()
    render(<Probe load={load} bots={['mod']} gap={30_000} />)
    for (let i = 0; i < 6; i++) {
      act(() => emit({ bots: ['mod'], config: false }))
      await act(async () => { vi.advanceTimersByTime(5000) }) // estado cada 5 s
    }
    expect(load).toHaveBeenCalledTimes(2) // al abrir y a los 30 s, no 7 veces
  })

  it('las respuestas de un bot se recuerdan: la segunda vez no se lanza Python', async () => {
    forgetAll()
    const ask = vi.fn().mockResolvedValue({ voz: true })
    const fresh = vi.fn()
    expect(remember('caps:x@1', ask, fresh)).toBeUndefined()
    await vi.waitFor(() => expect(fresh).toHaveBeenCalledWith({ voz: true }))
    expect(remember('caps:x@1', ask, fresh)).toEqual({ voz: true })
    expect(ask).toHaveBeenCalledTimes(1)
  })
})
