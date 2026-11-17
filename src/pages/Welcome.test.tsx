import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/ui'
import { StoreProvider } from '../lib/store'
import { ideaUrl } from './SettingsPage'
import { Welcome } from './Welcome'

const renderWelcome = (onFinish = vi.fn()) => {
  render(<ToastProvider><StoreProvider><Welcome onFinish={onFinish} /></StoreProvider></ToastProvider>)
  return onFinish
}

describe('asistente de bienvenida (datos de demostración)', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('recorre todo: datos, bots, IA, instalación y fin', async () => {
    const onFinish = renderWelcome()
    fireEvent.click(screen.getByRole('button', { name: /Empezar/ }))

    // Tú: no deja seguir sin nombre ni con un canal no válido
    const next = () => screen.getByRole('button', { name: /Siguiente/ })
    expect(next()).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Tu nombre'), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByPlaceholderText('micanal'), { target: { value: 'Mal Canal!' } })
    expect(next()).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('micanal'), { target: { value: 'alex_juega' } })
    expect(next()).toBeEnabled()
    fireEvent.click(next())

    // Bots: vienen del catálogo, todos marcados; el de miniaturas va incluido en el editor
    expect(await screen.findByText(/Editor de vídeo/)).toBeInTheDocument()
    expect(screen.getByText('Incluye: Bot de miniaturas')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true)
    fireEvent.click(next())

    // IA: tres opciones, el modo automático por defecto; Ollama muestra la descarga del modelo
    expect(screen.getByRole('radio', { name: /Modo automático/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /IA local/ }))
    expect(await screen.findByText(/qwen2.5:3b/)).toBeInTheDocument()
    expect(screen.getByText(/peor que Claude/)).toBeInTheDocument()

    // Instalar
    fireEvent.click(screen.getByRole('button', { name: /Instalar/ }))
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(await screen.findByText('¡Instalado!')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Seguir/ }))

    // YouTube (porque eligió el editor): se puede dejar para luego
    expect(screen.getByText('Conecta tu YouTube')).toBeInTheDocument()
    expect(screen.getByText('Crea tu proyecto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /más tarde/ }))
    expect(screen.getByText(/Todo listo/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ir a Lirio/ }))
    expect(onFinish).toHaveBeenCalledOnce()
  })
})

describe('Enviar idea', () => {
  it('abre un formulario de GitHub ya relleno con la versión', () => {
    const url = new URL(ideaUrl('ejemplo/lirio', 'Más memes', 'Detalle', '0.2.0'))
    expect(url.origin + url.pathname).toBe('https://github.com/ejemplo/lirio/issues/new')
    expect(url.searchParams.get('title')).toBe('Idea: Más memes')
    expect(url.searchParams.get('body')).toContain('Enviado desde Lirio 0.2.0')
    expect(url.searchParams.get('labels')).toBe('idea')
  })
})

describe('resumen de uso de "Enviar idea"', () => {
  const s = { lirio: '0.2.0', windows: 'windows', periodo_dias: 30, dias_con_actividad: 4,
    bots: [{ id: 'twitch-autoeditor', version: '0.3.0' }], usos: { aprobacion: 3 }, errores_por_bot: { 'twitch-autoeditor': 1 } }
  it('solo lleva las partes marcadas', async () => {
    const { summaryText } = await import('./SettingsPage')
    const all = summaryText(s, new Set(['version', 'bots', 'usos', 'errores']))
    expect(all).toContain('Lirio 0.2.0')
    expect(all).toContain('twitch-autoeditor 0.3.0')
    expect(all).toContain('aprobacion 3')
    const some = summaryText(s, new Set(['usos']))
    expect(some).not.toContain('Errores')
    expect(some).not.toContain('Bots')
    expect(summaryText(s, new Set())).toBe('')
  })
  it('se añade al formulario de GitHub', async () => {
    const { ideaUrl } = await import('./SettingsPage')
    const url = new URL(ideaUrl('ejemplo/lirio', 'Idea', '', '0.2.0', 'Resumen de uso: X'))
    expect(url.searchParams.get('body')).toContain('Resumen de uso: X')
  })
})

describe('diario', () => {
  it('agrupa por día con hoy y ayer', async () => {
    const { groupByDay } = await import('./JournalPage')
    const now = new Date('2026-11-17T12:00:00Z')
    const g = groupByDay([
      { at: '2026-11-17T10:00:00Z', kind: 'nota', text: 'a', ok: true },
      { at: '2026-11-16T10:00:00Z', kind: 'stop', text: 'b', ok: true },
      { at: '2026-11-10T10:00:00Z', kind: 'stop', text: 'c', ok: true },
    ], now)
    expect(g.map(([k]) => k).slice(0, 2)).toEqual(['Hoy', 'Ayer'])
    expect(g).toHaveLength(3)
  })
})
