// Configuración → «Crear Lirio en una USB» (en el PC normal) o «Tu USB» (dentro de Lirio portátil: cambiar el PIN).
import { useEffect, useState } from 'react'
import { api, type UsbDrive, type UsbEvent } from '../lib/api'
import { PIN_MIN } from './PinGate'
import { Icon, ProgressBar, useToast } from './ui'
import { human } from './units'

const CYBER = 'Muchos cybers bloquean los programas que se abren desde una USB o borran todo al reiniciar: pregunta antes en tu cyber si se puede.'

export function UsbSection({ portable }: { portable: boolean }) {
  return portable ? <PortableInfo /> : <CreateUsb />
}

function CreateUsb() {
  const toast = useToast()
  const [drives, setDrives] = useState<UsbDrive[] | null>(null)
  const [drive, setDrive] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [name, setName] = useState('')
  const [ev, setEv] = useState<UsbEvent | null>(null)
  const [done, setDone] = useState<UsbEvent | null>(null)

  const load = () => api.usbDrives().then((d) => { setDrives(d); if (d.length && !d.some((x) => x.letra === drive)) setDrive(d[0].letra) }).catch(() => setDrives([]))
  useEffect(() => { load() }, [])
  useEffect(() => {
    const un = api.onUsb((e) => { if (e.hecho) { setDone(e); setEv(null) } else setEv((p) => ({ ...e, percent: e.percent ?? (p?.paso === e.paso ? p?.percent : null) })) })
    return () => { un.then((f) => f()) }
  }, [])

  const running = !!ev
  const ok = pin.length >= PIN_MIN && pin === pin2 && !!drive && !running
  const create = async () => {
    setDone(null)
    try { await api.usbCreate(drive, pin, name.trim()); setEv({ paso: 'inicio', detalle: 'Empezando…', percent: null, hecho: false }) }
    catch (e) { toast('error', String(e)) }
  }
  const sel = drives?.find((d) => d.letra === drive)

  return (
    <section className="panel">
      <h3><Icon name="upload" size={18} /> Crear Lirio en una USB</h3>
      <p className="muted small">
        Para jugar en un cyber: Lirio y el moderador de Twitch funcionando desde la USB, sin instalar nada y sin dejar
        nada en el PC. El editor de vídeo no va (es demasiado pesado para un cyber). Hacen falta unos 4 GB libres.
      </p>
      <p className="warn small"><Icon name="alert" size={16} /> {CYBER}</p>
      {drives === null ? <p className="muted small">Buscando USBs…</p> : drives.length === 0 ? (
        <div className="row"><p className="muted small">No veo ninguna USB. Conéctala y pulsa «Buscar otra vez».</p>
          <button className="btn btn--ghost" onClick={load}>Buscar otra vez</button></div>
      ) : (
        <div className="stack">
          <label className="small">USB
            <select className="input" value={drive} onChange={(e) => setDrive(e.target.value)} aria-label="USB">
              {drives.map((d) => (
                <option key={d.letra} value={d.letra}>
                  {d.letra} {d.nombre || (d.extraible ? 'USB' : 'Disco')} · {human(d.libre)} libres de {human(d.total)}{d.extraible ? '' : ' (no extraíble)'}
                </option>
              ))}
            </select>
          </label>
          {sel && sel.libre < 4e9 && <p className="warn small">Esa USB tiene poco espacio: hacen falta unos 4 GB libres.</p>}
          <input className="input" value={name} maxLength={40} placeholder="Nombre de tu amigo (opcional)" aria-label="Nombre" onChange={(e) => setName(e.target.value)} />
          <input className="input" type="password" value={pin} maxLength={64} placeholder={`PIN de la USB (mínimo ${PIN_MIN})`} aria-label="PIN de la USB" onChange={(e) => setPin(e.target.value)} />
          <input className="input" type="password" value={pin2} maxLength={64} placeholder="Repite el PIN" aria-label="Repite el PIN de la USB" onChange={(e) => setPin2(e.target.value)} />
          {pin2 && pin !== pin2 && <p className="warn small">Los dos PIN no coinciden.</p>}
          <p className="muted small">El PIN lo pedirá Lirio cada vez que se abra desde la USB. Que lo elija tu amigo y lo apunte: si se olvida, hay que crear la USB otra vez.</p>
          <button className="btn btn--primary" disabled={!ok} onClick={create}>{running ? 'Creando…' : 'Crear Lirio en la USB'}</button>
        </div>
      )}
      {ev && (
        <div className="job">
          <span className="muted small">{ev.detalle}</span>
          <ProgressBar percent={ev.percent ?? 0} label="Creando la USB" />
          <p className="muted small">No quites la USB hasta que termine (descarga Python y las librerías del moderador).</p>
        </div>
      )}
      {done && (done.ok ? (
        <div className="ok-text small">
          <p><Icon name="check" size={16} /> Listo: Lirio está en {done.carpeta}. Abre Lirio.exe desde la USB.</p>
          {(done.avisos ?? []).map((a, i) => <p key={i} className="warn small">{a}</p>)}
        </div>
      ) : <p className="error-text small">No se pudo terminar: {done.error}</p>)}
    </section>
  )
}

function PortableInfo() {
  const toast = useToast()
  const [old, setOld] = useState('')
  const [n1, setN1] = useState('')
  const [n2, setN2] = useState('')
  const change = async () => {
    try { await api.portableChangePin(old, n1); toast('ok', 'PIN cambiado.'); setOld(''); setN1(''); setN2('') }
    catch (e) { toast('error', String(e)) }
  }
  return (
    <section className="panel">
      <h3><Icon name="key" size={18} /> Tu USB</h3>
      <p className="muted small">Estás usando Lirio desde la USB: todo se guarda en ella y nada en este PC. Al terminar, cierra Lirio y quita la USB.</p>
      <p className="warn small"><Icon name="alert" size={16} /> {CYBER}</p>
      <h4>Cambiar el PIN</h4>
      <div className="stack">
        <input className="input" type="password" value={old} placeholder="PIN actual" aria-label="PIN actual" onChange={(e) => setOld(e.target.value)} />
        <input className="input" type="password" value={n1} placeholder={`PIN nuevo (mínimo ${PIN_MIN})`} aria-label="PIN nuevo" onChange={(e) => setN1(e.target.value)} />
        <input className="input" type="password" value={n2} placeholder="Repite el PIN nuevo" aria-label="Repite el PIN nuevo" onChange={(e) => setN2(e.target.value)} />
        <button className="btn btn--primary" disabled={!old || n1.length < PIN_MIN || n1 !== n2} onClick={change}>Cambiar PIN</button>
      </div>
    </section>
  )
}
