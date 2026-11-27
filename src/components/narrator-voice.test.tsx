import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type NarratorVoiceEvent } from '../lib/api'
import { NarratorVoicePanel } from './NarratorVoicePanel'
import { ToastProvider } from './ui'

afterEach(() => vi.restoreAllMocks())

describe('voz del narrador', () => {
  it('se descarga aparte con progreso y se puede cancelar; al acabar dice cómo usarla', async () => {
    let emit: (e: NarratorVoiceEvent) => void = () => {}
    const status = vi.spyOn(api, 'narratorVoiceStatus').mockResolvedValue({ instalada: false, bytes: 120_575_669, descargando: false })
    vi.spyOn(api, 'onNarratorVoice').mockImplementation(async (cb) => { emit = cb; return () => {} })
    const install = vi.spyOn(api, 'narratorVoiceInstall').mockResolvedValue(undefined)
    const cancel = vi.spyOn(api, 'narratorVoiceCancel').mockResolvedValue(true)
    render(<ToastProvider><NarratorVoicePanel botId="twitch-autoeditor" /></ToastProvider>)
    expect(await screen.findByText(/no va\s+en el instalador/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Descargar voz del narrador/ }))
    expect(install).toHaveBeenCalledWith('twitch-autoeditor')
    act(() => emit({ hecho: false, percent: 42, detalle: '50 MB de 121 MB' }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(cancel).toHaveBeenCalled()
    status.mockResolvedValue({ instalada: true, bytes: 120_575_669, descargando: false })
    act(() => emit({ hecho: true, ok: true }))
    await waitFor(() => expect(screen.getByText(/elige el motor «kokoro»/)).toBeInTheDocument())
  })
})
