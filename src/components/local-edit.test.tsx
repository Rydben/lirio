import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type BotView } from '../lib/api'
import { isVideo, LocalEditPanel } from './LocalEditPanel'
import { ToastProvider } from './ui'

afterEach(() => vi.restoreAllMocks())

const editor = (status: Record<string, unknown> = {}) =>
  ({ id: 'twitch-autoeditor', name: 'Editor', commands: [], approvals_pending: [], status }) as unknown as BotView
const ok = (data: Record<string, unknown>) => ({ ok: true, code: 0, message: '', data })

describe('editar vídeos locales', () => {
  it('solo acepta vídeos', () => {
    for (const f of ['a.mp4', 'b.MKV', 'c.mov', 'd.m4v', 'e.webm', 'f.ts']) expect(isVideo(f)).toBe(true)
    for (const f of ['a.txt', 'b.exe', 'c.mp3', 'sin_extension']) expect(isVideo(f)).toBe(false)
  })

  it('elige el archivo y se lo pasa al editor; nunca pide subir nada', async () => {
    vi.spyOn(api, 'pickVideo').mockResolvedValue('D:\\Partidas\\gta.mkv')
    const run = vi.spyOn(api, 'runWith').mockResolvedValue(ok({ ok: true, modo: 'ahora', mensaje: 'Se edita ahora en segundo plano.' }))
    render(<ToastProvider><LocalEditPanel bot={editor()} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Elegir vídeo/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Editar este vídeo/ }))
    await waitFor(() => expect(run).toHaveBeenCalledWith('twitch-autoeditor', 'editar', { '@que': 'D:\\Partidas\\gta.mkv' }))
    expect(await screen.findByText('Se edita ahora en segundo plano.')).toBeInTheDocument()
    expect(run.mock.calls.every(([, cmd]) => cmd === 'editar')).toBe(true)
  })

  it('si ya estaba editado ofrece otra versión con --rehacer', async () => {
    vi.spyOn(api, 'pickVideo').mockResolvedValue('D:/v.mp4')
    const run = vi.spyOn(api, 'runWith')
      .mockResolvedValueOnce({ ok: false, code: 1, message: '', data: { ok: false, ya_editado: true, error: 'ya está editado' } })
      .mockResolvedValueOnce(ok({ ok: true, mensaje: 'En cola' }))
    render(<ToastProvider><LocalEditPanel bot={editor()} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Elegir vídeo/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Editar este vídeo/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Hacer otra versión' }))
    await waitFor(() => expect(run).toHaveBeenLastCalledWith('twitch-autoeditor', 'editar', { '@que': 'D:/v.mp4', '--rehacer': true }))
  })

  it('enseña el avance de SU vídeo y deja cancelarlo', async () => {
    vi.spyOn(api, 'pickVideo').mockResolvedValue('D:/Partidas/gta.mkv')
    const run = vi.spyOn(api, 'runWith').mockResolvedValue(ok({ ok: true, parado: true, mensaje: 'Edición cancelada.' }))
    const bot = editor({ current_job: { source: 'd:\\partidas\\GTA.mkv', stage: 'render', percent: 40 } })
    render(<ToastProvider><LocalEditPanel bot={bot} /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Elegir vídeo/ }))
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith('twitch-autoeditor', 'editar-cancelar', { '@que': 'D:/Partidas/gta.mkv' }))
  })
})
