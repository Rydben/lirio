// La app completa con datos de demostración (fuera de Tauri no toca ningún bot real).
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App, { hashFromPage, pageFromHash } from './App'

describe('Lirio', () => {
  beforeEach(() => history.replaceState(null, '', '#home'))
  it('la página de inicio muestra bienvenida, los 3 bots y el estado del asistente', async () => {
    render(<App />)
    expect(await screen.findByText('Alex', { selector: '.accent' })).toBeInTheDocument()
    const cards = document.querySelectorAll('.bot-card')
    expect(cards).toHaveLength(3)
    expect(screen.getByText('Tus bots')).toBeInTheDocument()
    // hay una aprobación pendiente en la demo -> el avatar se sorprende
    expect(within(screen.getByTestId('assistant-state')).getByText('Te necesito un momento')).toBeInTheDocument()
    expect(document.querySelector('[data-testid="avatar"] [data-expression="sorprendido"]')).toBeInTheDocument()
    expect(screen.queryByText(/Modo Pro/i)).not.toBeInTheDocument()
  })

  it('la página del bot de vídeo enseña la cola, los vídeos en espera y las aprobaciones', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Abrir el bot de vídeo/ }))
    expect(await screen.findByRole('heading', { name: 'Twitch AutoEditor' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Cola de subida/ }))
    expect(await screen.findByText('El jefe final que nos ganó')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Subir la cola ahora/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('tab', { name: /En espera/ }))
    expect(await screen.findByText('v2930258519')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Liberar/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Aprobaciones/ }))
    expect(screen.getByText(/Programar la publicación/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aprobar' })).toHaveAttribute('title', 'Mantén pulsado 2 segundos')
  })

  it('la búsqueda lleva a las páginas', async () => {
    render(<App />)
    await screen.findByText('Tus bots')
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'aprob' } })
    fireEvent.keyDown(screen.getByLabelText('Buscar'), { key: 'Enter' })
    expect(await screen.findByRole('heading', { name: 'Aprobaciones' })).toBeInTheDocument()
  })
})

describe('rutas', () => {
  it('ida y vuelta entre página y dirección', () => {
    expect(pageFromHash('#bot/twitch-autoeditor/cola')).toEqual({ kind: 'bot', id: 'twitch-autoeditor', tab: 'cola' })
    expect(pageFromHash('#approvals')).toEqual({ kind: 'approvals' })
    expect(pageFromHash('')).toEqual({ kind: 'home' })
    expect(pageFromHash('#cualquier-cosa')).toEqual({ kind: 'home' })
    expect(hashFromPage({ kind: 'bot', id: 'x' })).toBe('#bot/x')
  })
})
