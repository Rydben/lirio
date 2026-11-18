// «Tu estilo» con la forma REAL de `estilo --json` del editor (2026-11-18): las referencias llegan como OBJETOS.
// Con la 0.2.4/0.2.5 eso dejaba la ventana entera en negro. Nombres y rutas cambiados por genéricos.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { StoreProvider } from '../lib/store'
import { ErrorBoundary } from './ErrorBoundary'
import { refName, refSummary, StylePanel, toEstilo } from './StylePanel'
import { ToastProvider } from './ui'

const REAL = {
  ok: true,
  instrucciones: [],
  video_referencia: {
    archivo: 'Video_de_referencia_1080p.mp4',
    medido: { duration_s: 1956.9, cuts_per_min: 8.5, avg_shot_s: 7.04, zooms_per_min: 0.0, audio_hits_per_min: 35.8 },
    fecha: '2026-11-17T23:51:51',
  },
  miniatura_referencia: {
    archivo: 'Captura 2026-11-17.png',
    copia: 'C:\\Users\\amigo\\bots\\twitch-autoeditor\\state\\referencias\\miniatura_referencia.png',
    acento: [177, 76, 51], brillo_medio: 45.6, fecha: '2026-11-17T23:46:45',
  },
  ritmo_max_sin_cambio_s: 7.1,
}

afterEach(() => { vi.restoreAllMocks() })

const renderStyle = (kind: 'video' | 'miniatura', data: unknown) => {
  vi.spyOn(api, 'runWith').mockResolvedValue({ ok: true, code: 0, data, message: 'Hecho' })
  return render(<ToastProvider><StoreProvider><StylePanel botId="twitch-autoeditor" kind={kind} /></StoreProvider></ToastProvider>)
}

describe('Tu estilo con la respuesta real del editor', () => {
  it('vídeo: enseña el archivo y lo medido, sin romperse', async () => {
    renderStyle('video', REAL)
    expect(await screen.findByText('Video_de_referencia_1080p.mp4')).toBeInTheDocument()
    expect(screen.getByText(/8,5 cortes por minuto · planos de 7 s/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cambiar archivo/ })).toBeInTheDocument()
  })

  it('miniatura: enseña el archivo', async () => {
    renderStyle('miniatura', REAL)
    expect(await screen.findByText('Captura 2026-11-17.png')).toBeInTheDocument()
  })

  it('aguanta datos vacíos, parciales y de versiones viejas', () => {
    expect(toEstilo(null)).toBeNull()
    expect(toEstilo({ ok: false, error: 'x' })).toBeNull()
    expect(toEstilo({ instrucciones: null })?.instrucciones).toEqual([])
    expect(toEstilo({ instrucciones: ['más cortes'] })?.instrucciones[0].texto).toBe('más cortes')
    expect(toEstilo({ instrucciones: [{ id: 3, text: 'x' }] })?.instrucciones[0]).toEqual({ id: '3', texto: 'x', fecha: undefined })
    expect(refName('C:\\v\\viejo.mp4')).toBe('viejo.mp4')
    expect(refName({ medido: {} })).toBe('referencia guardada')
    expect(refName(null)).toBeNull()
    expect(refSummary('C:\\v\\viejo.mp4')).toBe('')
    expect(refSummary({ medido: { cuts_per_min: 3 } })).toBe('3,0 cortes por minuto')
  })
})

describe('protección por página', () => {
  it('si algo falla al pintarse: aviso con «Volver» y al Diario, no la pantalla negra', () => {
    const logged = vi.spyOn(api, 'uiError').mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => { throw new Error('p.split is not a function') }
    const back = vi.fn()
    render(<ErrorBoundary where="Twitch AutoEditor → estilo" onBack={back}><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('ha fallado al mostrarse')
    expect(screen.getByText('p.split is not a function')).toBeInTheDocument()
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('Twitch AutoEditor → estilo: p.split is not a function'))
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(back).toHaveBeenCalled()
  })
})
