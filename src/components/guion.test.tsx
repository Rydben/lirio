import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type JobEvent } from '../lib/api'
import { GuionPanel, mmss } from './GuionPanel'

afterEach(() => vi.restoreAllMocks())

describe('guion antes de editar', () => {
  it('formatea los tiempos', () => {
    expect(mmss(75)).toBe('1:15')
    expect(mmss(3725)).toBe('1:02:05')
  })

  it('lo hace en segundo plano y enseña la historia, los bloques y sus tramos', async () => {
    let emit: (e: JobEvent) => void = () => {}
    vi.spyOn(api, 'jobsStatus').mockResolvedValue({})
    vi.spyOn(api, 'onJob').mockImplementation(async (cb) => { emit = cb; return () => {} })
    const start = vi.spyOn(api, 'jobStart').mockResolvedValue('ed:guion')
    render(<GuionPanel botId="ed" ruta="C:/d/gta.mp4" archivo="gta.mp4" />)
    await waitFor(() => expect(api.onJob).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Hacer el guion' }))
    expect(start).toHaveBeenCalledWith('ed', 'guion', { '@archivo': 'C:/d/gta.mp4' })
    act(() => emit({ clave: 'ed:guion', bot: 'ed', comando: 'guion', hecho: true, ok: true, resultado: { ok: true, out_dir: 'C:/o', guion: {
      trama: 'Un atraco que sale fatal', duracion_objetivo_min: 14, por_que_esa_duracion: 'Hay material para 14 min sin relleno.',
      bloques: [{ tipo: 'gancho', titulo: 'La persecución', segundos: 40, por_que: 'Lo más intenso', tramos: [[3600, 3640, 'choque con la policía']] },
                { tipo: 'cierre', titulo: 'Escapada', segundos: 60 }],
      titulos: ['El peor atraco de GTA'] } } }))
    expect(await screen.findByText(/Un atraco que sale fatal/)).toBeInTheDocument()
    expect(screen.getByText('Gancho: La persecución')).toBeInTheDocument()
    expect(screen.getByText('1:00:00–1:00:40')).toBeInTheDocument()
    expect(screen.getByText(/El peor atraco de GTA/)).toBeInTheDocument()
  })
})
