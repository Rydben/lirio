import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AntivirusHelp } from './AntivirusHelp'
import { GpuPanel } from './GpuPanel'
import { InstallRow } from './InstallProgress'
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
    expect(screen.getByRole('button', { name: /Abrir Directos/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Abrir nota/ })).toBeNull()
    expect(screen.getByText(/Ocupan 7,3 GB/)).toBeInTheDocument()
    expect(screen.getByText('3 Shorts', { exact: false })).toBeInTheDocument()
  })
})

describe('miniaturas', () => {
  it('enseña las de cada vídeo y cuál está elegida', async () => {
    wrap(<ThumbnailsPanel botId="thumbnail-bot" />)
    expect(await screen.findByText(/Directo del viernes/)).toBeInTheDocument()
    expect(screen.getByText('Elegida')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Usar esta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hacer otras/ })).toBeInTheDocument()
  })
})

describe('tu estilo', () => {
  it('manda el mensaje al editor y enseña lo que cambió', async () => {
    wrap(<StylePanel botId="twitch-autoeditor" kind="video" />)
    expect(await screen.findByText('Cortes rápidos en las jugadas')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Mensaje para el editor'), { target: { value: 'cortes más rápidos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText(/haré los cortes más rápidos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Olvidar: Cortes rápidos/ })).toBeInTheDocument()
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

describe('instalación por bot', () => {
  it('en marcha se puede cancelar; si falla, reintentar; si se pausó, continuar', () => {
    const step = { bot: 'b', paso: 'librerias', detalle: 'Descargando librerías: 3 de 40 paquetes', percent: 12 }
    const { rerender } = wrap(<InstallRow id="b" name="Editor" s={{ running: true, step }} />)
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByText(/3 de 40 paquetes/)).toBeInTheDocument()
    rerender(<ToastProvider><InstallRow id="b" name="Editor" s={{ running: false, ok: false, error: 'sin internet', step }} /></ToastProvider>)
    expect(screen.getByRole('button', { name: /Reintentar/ })).toBeInTheDocument()
    expect(screen.getByText(/sin internet/)).toBeInTheDocument()
    rerender(<ToastProvider><InstallRow id="b" name="Editor" s={{ running: false, ok: false, cancelled: true, step }} /></ToastProvider>)
    expect(screen.getByRole('button', { name: /Continuar/ })).toBeInTheDocument()
    rerender(<ToastProvider><InstallRow id="b" name="Editor" s={{ running: false, ok: true }} /></ToastProvider>)
    expect(screen.getByText('Instalado')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
