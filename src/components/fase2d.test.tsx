import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BotView } from '../lib/api'
import { moodFor } from '../lib/mood'
import { fmtEta, jobDetail, stageName, stalledInput } from '../lib/progress'
import { JobProgress } from './JobProgress'
import { TrashPanel } from './TrashPanel'
import { ToastProvider } from './ui'

const bot = (status: Record<string, any>, state = 'watching') =>
  ({ id: 'twitch-autoeditor', name: 'Twitch AutoEditor', state, status, commands: [], approvals_pending: [] }) as unknown as BotView

describe('progreso del editor', () => {
  it('descarga con bytes, velocidad y tiempo que queda', () => {
    expect(stageName('descarga')).toBe('Descargando el directo')
    expect(stageName('remux')).toMatch(/remux/)
    expect(jobDetail({ bytes_done: 1.2e9, bytes_total: 3.4e9, speed_bps: 15e6, eta_s: 150 }))
      .toBe('1,2 GB de 3,4 GB · 15,0 MB/s · quedan 3 min')
    expect(jobDetail({ percent: 40 })).toBe('')
    expect(fmtEta(30)).toBe('menos de 1 min')
    expect(fmtEta(3720)).toBe('1 h 2 min')
  })

  it('avisa si vigila pero un directo descargado lleva rato sin editar', () => {
    const now = Date.parse('2026-11-18T00:00:00Z')
    const old = { pendientes_de_editar: [{ ruta: 'C:\\d\\v.mp4', descargado_at: '2026-11-17T23:00:00Z' }] }
    expect(stalledInput(bot(old), now)?.min).toBe(60)
    expect(stalledInput(bot({ pendientes_de_editar: [{ ruta: 'x', descargado_at: '2026-11-17T23:55:00Z' }] }), now)).toBeNull()
    expect(stalledInput(bot({ ...old, current_job: { stage: 'edit' } }), now)).toBeNull()
    expect(stalledInput(bot(old, 'stopped'), now)).toBeNull()
    expect(moodFor([bot(old)]).title).toBe('El editor no avanza')
  })
})

describe('trabajos largos', () => {
  it('enseña la etapa, el % y Cancelar mientras trabaja; nada si acabó bien', () => {
    const { rerender } = render(<JobProgress job={{ clave: 'b:estilo-video', bot: 'b', comando: 'estilo-video', percent: 42, etapa: 'Analizando cortes', hecho: false }}
      label="Analizando" onCancel={() => {}} />)
    expect(screen.getByText('Analizando cortes · 42 %')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    rerender(<JobProgress job={{ clave: 'b:x', bot: 'b', comando: 'x', hecho: true, ok: true }} label="x" />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    rerender(<JobProgress job={{ clave: 'b:x', bot: 'b', comando: 'x', hecho: true, ok: false, mensaje: 'ya se está analizando' }} label="x" />)
    expect(screen.getByText(/ya se está analizando/)).toBeInTheDocument()
  })

  it('la papelera ofrece «Editar ahora» solo en los directos sin editar', async () => {
    render(<ToastProvider><TrashPanel botId="twitch-autoeditor" /></ToastProvider>)
    expect(await screen.findByText('2026-11-14.mp4')).toBeInTheDocument()
    // el de la demostración ya está editado
    expect(screen.queryByRole('button', { name: /Editar ahora/ })).toBeNull()
  })
})
