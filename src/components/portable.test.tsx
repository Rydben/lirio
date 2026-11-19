import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { PinGate } from './PinGate'
import { ToastProvider } from './ui'
import { UsbSection } from './UsbSection'

afterEach(() => { vi.restoreAllMocks() })

describe('PIN de la USB', () => {
  it('la primera vez pide elegirlo dos veces, con mínimo de largo', async () => {
    const create = vi.spyOn(api, 'portableCreatePin').mockResolvedValue(undefined)
    const done = vi.fn()
    render(<PinGate exists={false} onUnlocked={done} />)
    const save = screen.getByRole('button', { name: 'Guardar mi PIN' })
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '123' } })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: 'clave-123' } })
    fireEvent.change(screen.getByLabelText('Repite el PIN'), { target: { value: 'clave-124' } })
    expect(screen.getByText('Los dos PIN no coinciden.')).toBeInTheDocument()
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Repite el PIN'), { target: { value: 'clave-123' } })
    fireEvent.click(save)
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(create).toHaveBeenCalledWith('clave-123')
  })

  it('con PIN equivocado lo dice y no entra', async () => {
    vi.spyOn(api, 'portableUnlock').mockRejectedValue('PIN incorrecto')
    const done = vi.fn()
    render(<PinGate exists onUnlocked={done} />)
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: 'otro-pin-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('PIN incorrecto')).toBeInTheDocument()
    expect(done).not.toHaveBeenCalled()
    expect(screen.getByLabelText('PIN')).toHaveValue('')
  })
})

describe('Crear Lirio en una USB', () => {
  it('avisa de los cybers, elige la USB, pide PIN y crea', async () => {
    const create = vi.spyOn(api, 'usbCreate')
    render(<ToastProvider><UsbSection portable={false} /></ToastProvider>)
    expect(screen.getByText(/pregunta antes en tu cyber/)).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: /E: KINGSTON/ })).toBeInTheDocument()
    const btn = screen.getByRole('button', { name: 'Crear Lirio en la USB' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByLabelText('PIN de la USB'), { target: { value: 'clave-123' } })
    fireEvent.change(screen.getByLabelText('Repite el PIN de la USB'), { target: { value: 'clave-123' } })
    fireEvent.click(btn)
    expect(create).toHaveBeenCalledWith('E:', 'clave-123', '')
    expect(await screen.findByText(/Lirio Portátil está en E:\\Lirio-Portatil/)).toBeInTheDocument()
  })

  it('dentro de la USB: cambiar el PIN y nada de crear otra', () => {
    render(<ToastProvider><UsbSection portable /></ToastProvider>)
    expect(screen.getByRole('heading', { name: /Tu USB/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear Lirio en la USB' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cambiar PIN' })).toBeDisabled()
  })
})
