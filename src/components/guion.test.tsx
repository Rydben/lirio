import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type JobEvent } from '../lib/api'
import { GuionPanel, mmss, scriptName } from './GuionPanel'
import { ToastProvider } from './ui'

afterEach(() => vi.restoreAllMocks())

describe('guion antes de editar', () => {
  it('formatea los tiempos', () => {
    expect(mmss(75)).toBe('1:15')
    expect(mmss(3725)).toBe('1:02:05')
  })

  it('lo hace en segundo plano y enseña la historia, los bloques y sus tramos', async () => {
    const listeners = new Set<(e: JobEvent) => void>()
    const emit = (e: JobEvent) => listeners.forEach((f) => f(e))
    vi.spyOn(api, 'jobsStatus').mockResolvedValue({})
    vi.spyOn(api, 'onJob').mockImplementation(async (cb) => { listeners.add(cb); return () => listeners.delete(cb) })
    const start = vi.spyOn(api, 'jobStart').mockResolvedValue('ed:guion')
    render(<ToastProvider><GuionPanel botId="ed" ruta="C:/d/gta.mp4" archivo="gta.mp4" /></ToastProvider>)
    await waitFor(() => expect(api.onJob).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Hacer el guion' }))
    expect(start).toHaveBeenCalledWith('ed', 'guion', { '@archivo': 'C:/d/gta.mp4', '--nombre': 'gta_historia' })
    act(() => emit({ clave: 'ed:guion', bot: 'ed', comando: 'guion', hecho: true, ok: true, resultado: { ok: true, out_dir: 'C:/o', guion: {
      trama: 'Un atraco que sale fatal', duracion_objetivo_min: 14, por_que_esa_duracion: 'Hay material para 14 min sin relleno.',
      bloques: [{ tipo: 'gancho', titulo: 'La persecución', segundos: 40, por_que: 'Lo más intenso', tramos: [[3600, 3640, 'choque con la policía']] },
                { tipo: 'cierre', titulo: 'Escapada', segundos: 60 }],
      titulos: ['El peor atraco de GTA'] } } }))
    expect(await screen.findByText(/Un atraco que sale fatal/)).toBeInTheDocument()
    expect(screen.getByText('Gancho: La persecución')).toBeInTheDocument()
    expect(screen.getByText('1:00:00–1:00:40')).toBeInTheDocument()
    expect(screen.getByText(/El peor atraco de GTA/)).toBeInTheDocument()
    // hacer el vídeo: mismo nombre que el guion y nunca sube
    fireEvent.click(screen.getByRole('button', { name: 'Hacer el vídeo con este guion' }))
    expect(start).toHaveBeenLastCalledWith('ed', 'process', { '@archivo': 'C:/d/gta.mp4', '--nombre': 'gta_historia', '--no-upload': true })
  })

  it('el nombre sale del archivo, con barras de Windows o normales', () => {
    expect(scriptName('work\\historia\\twitch_2933735688.mp4')).toBe('twitch_2933735688_historia')
    expect(scriptName('C:/d/gta.mkv')).toBe('gta_historia')
  })
})
