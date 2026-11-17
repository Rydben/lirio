import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Avatar } from './Avatar'
import { EXPRESSIONS } from './Face'
import { HoldButton } from './HoldButton'
import { ProgressBar } from './ui'

describe('HoldButton (gesto humano de 2 s)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout'] }))
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const onBegin = vi.fn(async () => 'tok')
    const onComplete = vi.fn()
    render(<HoldButton requireTrusted={false} onBegin={onBegin} onComplete={onComplete}>Aprobar</HoldButton>)
    return { onBegin, onComplete, btn: screen.getByRole('button') }
  }

  it('soltar antes de 2 s no aprueba', async () => {
    const { onBegin, onComplete, btn } = setup()
    fireEvent.pointerDown(btn, { button: 0 })
    expect(onBegin).toHaveBeenCalledOnce()
    await act(async () => { vi.advanceTimersByTime(1200) })
    fireEvent.pointerUp(btn)
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('mantener 2 s aprueba una sola vez con el token del gesto', async () => {
    const { onComplete, btn } = setup()
    fireEvent.pointerDown(btn, { button: 0 })
    await act(async () => { vi.advanceTimersByTime(2100) })
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('tok')
  })

  it('el botón derecho no cuenta', async () => {
    const { onBegin, btn } = setup()
    fireEvent.pointerDown(btn, { button: 2 })
    expect(onBegin).not.toHaveBeenCalled()
  })

  it('por defecto ignora eventos que no vienen de una persona', () => {
    const onBegin = vi.fn(async () => 'tok')
    render(<HoldButton onBegin={onBegin} onComplete={() => {}}>Aprobar</HoldButton>)
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0 }) // en jsdom isTrusted es false
    expect(onBegin).not.toHaveBeenCalled()
  })
})

describe('Avatar', () => {
  it.each(EXPRESSIONS)('dibuja la expresión %s', (e) => {
    const { container } = render(<Avatar expression={e} />)
    expect(container.querySelector(`[data-expression="${e}"]`)).toBeInTheDocument()
  })
  it('la cara normal lleva el logo de Lirio y parpadea', () => {
    const { container } = render(<Avatar expression="feliz" />)
    expect(container.querySelector('.face--blink')).toBeInTheDocument()
    expect(container.querySelectorAll('.face__main path').length).toBeGreaterThan(6)
  })
})

describe('ProgressBar', () => {
  it('limita el porcentaje a 0-100', () => {
    render(<ProgressBar percent={140} label="Subida" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})
