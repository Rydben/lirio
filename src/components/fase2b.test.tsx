import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Bars, fmtDur } from './Insights'
import { changedValues, fieldError, SettingsForm } from './SettingsForm'
import { TwitchConnect } from './TwitchConnect'
import { ToastProvider } from './ui'
import { VoiceRecorder } from './VoiceRecorder'

const wrap = (ui: React.ReactNode) => render(<ToastProvider>{ui}</ToastProvider>)

describe('ajustes por esquema', () => {
  it('solo manda lo que cambia', () => {
    expect(changedValues({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2, 3] })).toEqual({ b: [1, 2, 3] })
    expect(changedValues({ a: 1 }, { a: 1 })).toEqual({})
  })
  it('valida números, enteros y horas', () => {
    expect(fieldError({ clave: 'x', tipo: 'entero', titulo: 'x', min: 0, max: 5 }, 7)).toBe('Máximo 5')
    expect(fieldError({ clave: 'x', tipo: 'entero', titulo: 'x' }, 1.5)).toBe('Sin decimales')
    expect(fieldError({ clave: 'x', tipo: 'hora', titulo: 'x' }, '25:00')).toBe('Formato HH:MM')
    expect(fieldError({ clave: 'x', tipo: 'texto', titulo: 'x' }, 'hola')).toBeNull()
  })
  it('genera el formulario y guarda solo lo cambiado', async () => {
    wrap(<SettingsForm botId="twitch-autoeditor" />)
    const name = await screen.findByLabelText('Nombre visible')
    expect(screen.getByText('Sin cambios')).toBeInTheDocument()
    fireEvent.change(name, { target: { value: 'Alex Juega' } })
    expect(screen.getByText('1 cambios sin guardar')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Shorts por directo'), { target: { value: '9' } })
    expect(screen.getByText('Máximo 5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeDisabled()
  })
})

describe('huella de voz', () => {
  it('enseña el texto, graba y muestra el resultado', async () => {
    wrap(<VoiceRecorder botId="twitch-autoeditor" command="registrar-voz" />)
    expect(await screen.findByText(/esta es mi voz de siempre/)).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Grabar mi voz/ })) })
    expect(await screen.findByText(/Huella guardada/, {}, { timeout: 2000 })).toBeInTheDocument()
  })
  it('la voz de un amigo pide su nombre', async () => {
    wrap(<VoiceRecorder botId="twitch-moderator" command="enroll" friend />)
    const btn = await screen.findByRole('button', { name: /Grabar voz de mi amigo/ })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Nombre del amigo'), { target: { value: 'Ana' } })
    expect(btn).toBeEnabled()
  })
})

describe('conectar Twitch', () => {
  it('muestra el código y confirma la conexión', async () => {
    wrap(<TwitchConnect botId="twitch-moderator" />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Conectar la cuenta del bot/ })) })
    expect(await screen.findByText(/Conectado: alex_bot/)).toBeInTheDocument()
  })
})

describe('estadísticas', () => {
  it('formatea duraciones', () => {
    expect(fmtDur(3900)).toBe('1 h 5 min')
    expect(fmtDur(600)).toBe('10 min')
    expect(fmtDur(null)).toBe('—')
  })
  it('barras con tabla accesible', () => {
    render(<Bars data={[['lunes', 10], ['martes', 0]]} label="Vistas" />)
    expect(screen.getAllByRole('img', { name: 'Vistas' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Ver como tabla')).toBeInTheDocument()
  })
})
