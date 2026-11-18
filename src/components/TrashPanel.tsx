// Papelera del editor: directos descargados y vídeos ya subidos. Borrar es siempre una persona manteniendo pulsado
// (solicitud al bot + aprobación firmada), nunca una IA sola. El borrado automático también se activa con el gesto.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { HoldButton } from './HoldButton'
import { Icon, Pill, timeAgo, useToast } from './ui'
import { human } from './units'

interface Item { ruta: string; bytes: number; fecha?: string; estado?: string; se_puede_borrar?: boolean; motivo?: string;
  subido?: boolean; youtube_id?: string }
interface Trash { directos: Item[]; videos: Item[]; carpetas: Record<string, string>; auto: { directos: boolean; videos: boolean } }

const CARPETAS: Record<string, string> = { directos: 'Directos', editados: 'Vídeos editados', miniaturas: 'Miniaturas' }
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

export function TrashPanel({ botId }: { botId: string }) {
  const toast = useToast()
  const [t, setT] = useState<Trash | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    api.runWith(botId, 'papelera-listar').then((r) => {
      if (r.ok) { setT(r.data as Trash); setErr(null) } else setErr(r.data?.error ?? r.message)
    }).catch((e) => setErr(String(e)))
  }, [botId])
  useEffect(() => { load() }, [load])

  /** Pide la solicitud al bot y la aprueba firmada con el gesto (como cualquier aprobación). */
  const approve = async (token: string, command: string, flags: Record<string, unknown>, okText: string) => {
    const req = await api.runWith(botId, command, flags)
    const s = req.data?.solicitud
    if (!req.ok || !s) { toast('error', req.data?.error ?? req.message); return }
    const r = await api.signedDecision(token, botId, 'approve', s.id, s.action, s.key)
    toast(r.ok ? 'ok' : 'error', r.ok ? okText : r.message)
    load()
  }

  if (err) return <p className="panel warn">{err}</p>
  if (!t) return <p className="panel muted">Cargando…</p>
  const total = [...t.directos, ...t.videos].reduce((n, i) => n + (i.bytes ?? 0), 0)

  const list = (items: Item[], kind: 'directo' | 'video') => items.length === 0 ? <p className="muted">Nada por aquí.</p> : (
    <ul className="list">
      {items.map((i) => (
        <li key={i.ruta}>
          <div>
            <div className="cell-title">{fileName(i.ruta)}{' '}
              {kind === 'video' && (i.subido ? <Pill tone="ok">subido</Pill> : <Pill tone="muted">sin subir</Pill>)}
              {kind === 'directo' && i.estado && <Pill tone={i.se_puede_borrar ? 'ok' : 'muted'}>{i.estado}</Pill>}
            </div>
            <div className="muted small">{human(i.bytes)}{i.fecha ? ` · ${timeAgo(i.fecha)}` : ''}{i.motivo ? ` · ${i.motivo}` : ''}</div>
          </div>
          <HoldButton tone="ghost" onBegin={api.gestureBegin}
            onComplete={(tok) => approve(tok, 'papelera-borrar', { '--solicitar': i.ruta }, `${fileName(i.ruta)} borrado.`)}
            title="Mantén pulsado 2 segundos para borrarlo">Borrar</HoldButton>
        </li>
      ))}
    </ul>
  )

  const toggle = (which: 'directos' | 'videos') => {
    const on = !t.auto[which]
    return (
      <HoldButton tone={on ? 'primary' : 'ghost'} onBegin={api.gestureBegin}
        onComplete={(tok) => approve(tok, 'papelera-auto', { '--solicitar': true, [`--${which}`]: on ? 'on' : 'off' },
          on ? 'Borrado automático activado.' : 'Borrado automático desactivado.')}
        title="Mantén pulsado 2 segundos para cambiarlo">{t.auto[which] ? 'Desactivar' : 'Activar'}</HoldButton>
    )
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-head">
          <h3><Icon name="grid" size={18} /> Carpetas</h3>
          <span className="muted small">Ocupan {human(total)}</span>
        </div>
        <div className="row">
          {Object.entries(t.carpetas).map(([k, ruta]) => (
            <button key={k} className="btn btn--outline" onClick={() => api.openBotFolder(botId, ruta).catch((e) => toast('error', String(e)))}>
              <Icon name="arrow" size={16} /> Abrir {CARPETAS[k] ?? k}
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Borrado automático</h3>
        <ul className="list">
          <li><div><div className="cell-title">Borrar el directo cuando ya no haga falta para editar</div>
            <div className="muted small">{t.auto.directos ? 'Activado' : 'Desactivado'}</div></div>{toggle('directos')}</li>
          <li><div><div className="cell-title">Borrar el vídeo cuando ya esté subido a YouTube</div>
            <div className="muted small">{t.auto.videos ? 'Activado' : 'Desactivado'}</div></div>{toggle('videos')}</li>
        </ul>
        <p className="muted small">Borrar siempre lo decides tú: hay que mantener pulsado el botón. Ninguna IA borra nada sola.</p>
      </section>
      <div className="grid-2">
        <section className="panel"><h3>Directos descargados</h3>{list(t.directos, 'directo')}</section>
        <section className="panel"><h3>Vídeos editados</h3>{list(t.videos, 'video')}</section>
      </div>
    </div>
  )
}
