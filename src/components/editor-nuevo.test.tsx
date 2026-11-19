import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, studioUrl, type Approval, type BotView } from '../lib/api'
import { StoreProvider } from '../lib/store'
import { ApprovalCard } from './Approvals'
import { CensorPanel } from './CensorPanel'
import { ToastProvider } from './ui'

afterEach(() => vi.restoreAllMocks())

const censura = (extra = {}) => ({ ok: true, code: 0, message: '', data: { ok: true, activado: true, estilo: 'pitido',
  base_palabras: ['joder', 'mierda'], base_frases: ['me cago en'], tus_anadidas: [], tus_quitadas: [], ...extra } })

describe('censura de palabrotas', () => {
  it('enseña la lista, añade y quita (quitar de la base vale solo para ti)', async () => {
    const run = vi.spyOn(api, 'runWith').mockImplementation(async (_id, cmd, flags) => {
      if (cmd === 'censura-anadir') return censura({ tus_anadidas: [String(flags?.['@texto'])] })
      if (cmd === 'censura-quitar') return censura({ tus_quitadas: [String(flags?.['@texto'])] })
      return censura()
    })
    render(<ToastProvider><CensorPanel botId="ed" /></ToastProvider>)
    expect(await screen.findByText(/Activada: se tapan con un pitido/)).toBeInTheDocument()
    expect(screen.getByText('Lista base (3)')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Palabra o frase/), { target: { value: 'caca' } })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith('ed', 'censura-anadir', { '@texto': 'caca' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Dejar de censurar caca' }))
    await waitFor(() => expect(run).toHaveBeenCalledWith('ed', 'censura-quitar', { '@texto': 'caca' }))
    expect(await screen.findByText(/Quitadas solo para ti: caca/)).toBeInTheDocument()
  })
})

describe('publicar después de las comprobaciones de YouTube', () => {
  it('solo enlaza a YouTube Studio', () => {
    expect(studioUrl('https://studio.youtube.com/video/abc/edit')).toBe('https://studio.youtube.com/video/abc/edit')
    expect(studioUrl('https://evil.example/studio.youtube.com/')).toBeNull()
    expect(studioUrl(undefined)).toBeNull()
  })

  it('antes de aprobar enseña qué revisar, los riesgos y el enlace a Comprobaciones', () => {
    vi.spyOn(api, 'overview').mockResolvedValue({ usuario: 'A', modules: [], errors: [], uploads: [] } as never)
    const open = vi.spyOn(api, 'openUrl').mockResolvedValue(undefined)
    const bot = { id: 'ed', name: 'Editor', commands: ['aprobar-firmado'] } as unknown as BotView
    const a = { id: 'r1', action: 'youtube.schedule_publish', status: 'pending', details: {
      studio_url: 'https://studio.youtube.com/video/abc/edit', revisa: 'Revisa Comprobaciones en YouTube Studio antes de publicar.',
      riesgos_copyright: ['Música de fondo entre 12:30 y 13:10'] } } as Approval
    render(<ToastProvider><StoreProvider><ApprovalCard bot={bot} a={a} /></StoreProvider></ToastProvider>)
    expect(screen.getByText(/Revisa Comprobaciones/)).toBeInTheDocument()
    expect(screen.getByText(/Música de fondo/)).toBeInTheDocument()
    expect(screen.queryByText(/sin copyright/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Comprobaciones en YouTube Studio' }))
    expect(open).toHaveBeenCalledWith('https://studio.youtube.com/video/abc/edit')
  })
})

describe('moderación visual antes de publicar', () => {
  it('enseña lo difuminado, lo dudoso, las capturas y lo que no detecta; la revisión obligatoria se nota', async () => {
    vi.spyOn(api, 'overview').mockResolvedValue({ usuario: 'A', modules: [], errors: [], uploads: [] } as never)
    const caps = vi.spyOn(api, 'moderationCaptures').mockResolvedValue(['data:image/jpeg;base64,AAAA', null])
    const bot = { id: 'ed', name: 'Editor', commands: ['aprobar-firmado'] } as unknown as BotView
    const a = { id: 'r2', action: 'youtube.publicar_tras_revision', status: 'pending', details: { title: 'Directo',
      moderacion: { grave: true, difuminado: 3, revisar: 1, nota: 'Había un correo y un desnudo: difuminados.',
        capturas: ['C:/out/v/v_youtube_moderacion/c1.jpg', 'C:/otra/x.jpg'] } } } as Approval
    render(<ToastProvider><StoreProvider><ApprovalCard bot={bot} a={a} /></StoreProvider></ToastProvider>)
    expect(screen.getByText(/Revisión obligatoria/)).toBeInTheDocument()
    expect(screen.getByText(/3 zonas difuminadas/)).toBeInTheDocument()
    expect(screen.getByText(/1 dudosa para revisar/)).toBeInTheDocument()
    expect(screen.getByText(/No detecta violencia/)).toBeInTheDocument()
    expect(screen.getByTestId('moderacion')).toHaveClass('is-grave')
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1)) // la ruta rechazada por el núcleo no sale
    expect(caps).toHaveBeenCalledWith('ed', a.details!.moderacion && (a.details!.moderacion as any).capturas)
  })
})
