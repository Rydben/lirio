import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, type JobEvent } from '../lib/api'
import { fixFor, links, statusText } from '../lib/youtube'
import { ToastProvider } from './ui'
import { AUTH_WAIT_MS, YouTubeAuth } from './YouTubeAuth'
import { YouTubeGuide } from './YouTubeGuide'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const status = (estado: string, extra = {}) => ({ estado, client_secret: estado !== 'sin_archivo', token: false, project_id: null, ...extra }) as never

describe('enlaces y arreglos de YouTube', () => {
  it('los enlaces van al proyecto del amigo, y nunca con un id raro', () => {
    expect(links('lirio-123456').publico).toBe('https://console.cloud.google.com/auth/audience?project=lirio-123456')
    expect(links('lirio-123456').apiAnalytics).toBe('https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com?project=lirio-123456')
    expect(links('x&evil=1').credenciales).toBe('https://console.cloud.google.com/apis/credentials')
    expect(links(null).publico).toBe('https://console.cloud.google.com/auth/audience')
  })

  it('reconoce cada error y da su arreglo', () => {
    expect(fixFor('AccessDeniedError: (access_denied) The user denied')?.code).toBe('access_denied')
    expect(fixFor('Error 400: redirect_uri_mismatch')?.code).toBe('redirect_uri_mismatch')
    expect(fixFor("invalid_grant: Token has been expired or revoked.")?.code).toBe('caducado')
    expect(fixFor('El token de YouTube ya no sirve (x)')?.code).toBe('caducado')
    expect(fixFor('accessNotConfigured: YouTube Analytics API has not been used in project 1')?.code).toBe('api_desactivada')
    expect(fixFor('invalid_client: The OAuth client was deleted.')?.code).toBe('cliente_invalido')
    expect(fixFor('algo distinto')).toBeNull()
  })

  it('avisa de los 7 días', () => {
    expect(statusText(status('ok', { dias_restantes: 3 }))?.text).toContain('3 días')
    expect(statusText(status('caducado'))?.tone).toBe('error')
    expect(statusText(status('desconocido'))?.text).toContain('7 días')
  })
})

describe('asistente de YouTube', () => {
  it('un archivo de «Aplicación web» no se guarda y explica cómo hacerlo de escritorio, con enlace a su proyecto', async () => {
    vi.spyOn(api, 'youtubeStatus').mockResolvedValue(status('sin_archivo'))
    vi.spyOn(api, 'pickJson').mockResolvedValue('C:/Descargas/client_secret_web.json')
    vi.spyOn(api, 'youtubeCheckFile').mockResolvedValue({ tipo: 'web', project_id: 'mi-proyecto-9' })
    const install = vi.spyOn(api, 'installClientSecret')
    const open = vi.spyOn(api, 'openUrl').mockResolvedValue(undefined)
    render(<ToastProvider><YouTubeGuide botId="ed" /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Paso 4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Elegir el archivo JSON' }))
    await screen.findByTestId('archivo-no-escritorio')
    expect(install).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mis credenciales' }))
    expect(open).toHaveBeenCalledWith('https://console.cloud.google.com/apis/credentials?project=mi-proyecto-9')
  })

  it('no deja autorizar hasta marcar las APIs y el usuario de prueba', async () => {
    vi.spyOn(api, 'youtubeStatus').mockResolvedValue(status('sin_autorizar', { project_id: 'lirio-123456' }))
    const open = vi.spyOn(api, 'openUrl').mockResolvedValue(undefined)
    render(<ToastProvider><YouTubeGuide botId="ed" /></ToastProvider>)
    const auth = await screen.findByRole('button', { name: /Autorizar YouTube/ })
    expect(auth).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mis usuarios de prueba' }))
    expect(open).toHaveBeenCalledWith('https://console.cloud.google.com/auth/audience?project=lirio-123456')
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    expect(auth).not.toBeDisabled()
  })
})

describe('autorizar', () => {
  const setup = () => {
    let emit: (e: JobEvent) => void = () => {}
    vi.spyOn(api, 'jobsStatus').mockResolvedValue({})
    vi.spyOn(api, 'onJob').mockImplementation(async (cb) => { emit = cb; return () => {} })
    const startJob = vi.spyOn(api, 'jobStart').mockResolvedValue('ed:auth')
    const cancel = vi.spyOn(api, 'jobCancel').mockResolvedValue(true)
    return { emit: (e: Partial<JobEvent>) => act(() => emit({ clave: 'ed:auth', bot: 'ed', comando: 'auth', hecho: true, ...e })), startJob, cancel }
  }

  it('si Google vuelve con access_denied, enseña el arreglo y «Reintentar autorización»', async () => {
    const { emit, startJob } = setup()
    render(<ToastProvider><YouTubeAuth botId="ed" projectId="lirio-123456" /></ToastProvider>)
    await waitFor(() => expect(api.onJob).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Autorizar YouTube/ }))
    expect(startJob).toHaveBeenCalledWith('ed', 'auth', {})
    emit({ ok: false, mensaje: 'oauthlib.oauth2.rfc6749.errors.AccessDeniedError: (access_denied)' })
    expect(await screen.findByTestId('fix-access_denied')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reintentar autorización/ }))
    expect(startJob).toHaveBeenCalledTimes(2)
  })

  it('si el amigo ve el error en Google, lo elige y se cancela la espera', async () => {
    const { cancel } = setup()
    render(<ToastProvider><YouTubeAuth botId="ed" projectId="lirio-123456" /></ToastProvider>)
    await waitFor(() => expect(api.onJob).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Autorizar YouTube/ }))
    fireEvent.click(await screen.findByRole('button', { name: '400 redirect_uri_mismatch' }))
    expect(cancel).toHaveBeenCalledWith('ed:auth')
    expect(screen.getByTestId('fix-redirect_uri_mismatch')).toBeInTheDocument()
  })

  it('si no vuelve nada en 5 minutos, cancela y explica las dos causas típicas', async () => {
    const { cancel } = setup()
    render(<ToastProvider><YouTubeAuth botId="ed" projectId="lirio-123456" /></ToastProvider>)
    await waitFor(() => expect(api.onJob).toHaveBeenCalled())
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /Autorizar YouTube/ }))
    await act(async () => { vi.advanceTimersByTime(AUTH_WAIT_MS + 10) })
    expect(cancel).toHaveBeenCalledWith('ed:auth')
    expect(screen.getByTestId('fix-no_vuelve')).toBeInTheDocument()
    expect(screen.getByTestId('fix-redirect_uri_mismatch')).toBeInTheDocument()
  })
})
