// Lirio portátil: pantalla del PIN al abrir. La primera vez se elige (dos veces); después se escribe para desbloquear.
// Sin PIN, la llave de aprobaciones y los secretos de los bots de la USB no se pueden usar.
import { useState } from 'react'
import { api } from '../lib/api'
import { LirioLogo } from './LirioLogo'

export const PIN_MIN = 6

export function PinGate({ exists, onUnlocked }: { exists: boolean; onUnlocked: () => void }) {
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const tooShort = pin.length < PIN_MIN
  const mismatch = !exists && pin2.length > 0 && pin !== pin2
  const canGo = !busy && !tooShort && (exists || (pin === pin2))

  const go = async () => {
    if (!canGo) return
    setBusy(true); setErr(null)
    try {
      if (exists) await api.portableUnlock(pin)
      else await api.portableCreatePin(pin)
      onUnlocked()
    } catch (e) {
      setErr(String(e))
      setPin(''); setPin2('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pin-gate">
      <div className="pin-gate__card">
        <div className="brand__logo"><LirioLogo size={56} /></div>
        <h1>{exists ? 'Escribe tu PIN' : 'Elige tu PIN'}</h1>
        <p className="muted">
          {exists
            ? 'Es el PIN de esta USB. Sin él, nadie puede usar tus llaves ni tus bots aunque se quede la USB.'
            : `Protege tu USB: si la pierdes, sin el PIN no sirve de nada. Mínimo ${PIN_MIN} caracteres; mejor 8 o más, con letras y números.`}
        </p>
        <input className="input" type="password" autoFocus value={pin} maxLength={64} aria-label="PIN"
          placeholder="PIN" onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} />
        {!exists && (
          <input className="input" type="password" value={pin2} maxLength={64} aria-label="Repite el PIN"
            placeholder="Repite el PIN" onChange={(e) => setPin2(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} />
        )}
        {pin.length > 0 && tooShort && <p className="muted small">Mínimo {PIN_MIN} caracteres.</p>}
        {mismatch && <p className="warn small">Los dos PIN no coinciden.</p>}
        {err && <p className="error-text small">{err}</p>}
        <button className="btn btn--primary" disabled={!canGo} onClick={go}>
          {busy ? 'Comprobando…' : exists ? 'Entrar' : 'Guardar mi PIN'}
        </button>
        {!exists && <p className="muted small">Apúntalo en un sitio seguro: si lo olvidas, habrá que crear la USB de nuevo.</p>}
      </div>
    </div>
  )
}
