import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AntivirusHelp } from './AntivirusHelp'
import { GpuPanel } from './GpuPanel'
import { StylePanel } from './StylePanel'
import { ThumbnailsPanel } from './ThumbnailsPanel'
import { TrashPanel } from './TrashPanel'
import { ToastProvider } from './ui'
import { human } from './units'

const wrap = (ui: React.ReactNode) => render(<ToastProvider>{ui}</ToastProvider>)

describe('papelera', () => {
  it('borrar y el borrado automático son siempre con el gesto de mantener pulsado', async () => {
    wrap(<TrashPanel botId="twitch-autoeditor" />)
    expect(await screen.findByText('2026-11-14.mp4')).toBeInTheDocument()
    const borrar = screen.getAllByRole('button', { name: 'Borrar' })
    expect(borrar).toHaveLength(2)
    borrar.forEach((b) => expect(b).toHaveAttribute('title', expect.stringContaining('2 segundos')))
    expect(screen.getByRole('button', { name: 'Activar' })).toHaveAttribute('title', expect.stringContaining('2 segundos'))
    expect(screen.getByRole('button', { name: /Abrir Directos/ })).toBeInTheDocument()
    expect(screen.getByText(/Ocupan 7,3 GB/)).toBeInTheDocument()
  })
})

describe('miniaturas', () => {
  it('enseña las de cada vídeo y cuál está elegida', async () => {
    wrap(<ThumbnailsPanel botId="thumbnail-bot" />)
    expect(await screen.findByText(/Directo del viernes/)).toBeInTheDocument()
    expect(screen.getByText('Elegida')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Usar esta' })).toBeInTheDocument()
  })
})

describe('tu estilo', () => {
  it('manda el mensaje al editor y enseña lo que cambió', async () => {
    wrap(<StylePanel botId="twitch-autoeditor" kind="video" />)
    expect(await screen.findByText('Cortes rápidos en las jugadas')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mensaje para el editor'), { target: { value: 'cortes más rápidos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText(/haré los cortes más rápidos/)).toBeInTheDocument()
    expect(screen.getByText('Vídeo de referencia')).toBeInTheDocument()
  })
})

describe('gráfica NVIDIA', () => {
  it('ofrece acelerar solo si el bot la usa y hay NVIDIA', async () => {
    wrap(<GpuPanel botId="twitch-autoeditor" />)
    expect(await screen.findByRole('button', { name: 'Instalar ahora' })).toBeInTheDocument()
    const other = wrap(<GpuPanel botId="twitch-moderator" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(other.container.textContent).toBe('')
  })
})

describe('antivirus', () => {
  it('da los pasos de Norton y las carpetas para copiar', async () => {
    wrap(<AntivirusHelp open />)
    expect(await screen.findByText(/LirioDatos/)).toBeInTheDocument()
    expect(screen.getByText(/Restaurar y excluir este archivo/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Copiar' })).toHaveLength(2)
  })
})

it('tamaños con coma decimal', () => {
  expect(human(6_400_000_000)).toBe('6,4 GB')
  expect(human(900_000_000)).toBe('900 MB')
  expect(human(0)).toBe('0,0 KB')
})
