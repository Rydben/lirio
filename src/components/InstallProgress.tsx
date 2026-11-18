// Instalación de bots: cada uno por su lado, con su barra, Cancelar y Reintentar/Continuar.
// Se usa en el asistente (paso «Instalar») y en la página de un bot cuya instalación quedó a medias.
import { useEffect, useState } from 'react'
import { api, type InstallEvent } from '../lib/api'
import { Icon, ProgressBar, useToast } from './ui'

export interface BotInstall {
  step?: NonNullable<InstallEvent['step']>
  running: boolean
  ok?: boolean
  cancelled?: boolean
  error?: string | null
}

export function useInstalls(ids: string[]) {
  const [st, setSt] = useState<Record<string, BotInstall>>({})
  const key = ids.join(',')
  useEffect(() => {
    let alive = true
    api.installStatus().then((s) => {
      if (!alive) return
      setSt((prev) => {
        const next = { ...prev }
        for (const id of ids) {
          const x = s[id]
          if (!x) continue
          const u = x.ultimo ?? {}
          next[id] = {
            running: x.en_marcha, step: u.step,
            ...(u.terminado ? { ok: u.ok, cancelled: u.cancelado, error: u.error } : {}),
            ...(!x.en_marcha && x.pendiente && !u.terminado ? { ok: false, cancelled: true } : {}),
          }
        }
        return next
      })
    }).catch(() => {})
    const un = api.onInstall((e) => {
      if (e.step) {
        const s = e.step
        setSt((prev) => {
          const old = prev[s.bot]
          // sin porcentaje («instalando…») se mantiene el último del mismo paso en vez de volver a 0
          const percent = s.percent ?? (old?.step?.paso === s.paso ? old.step.percent : null)
          return { ...prev, [s.bot]: { running: true, step: { ...s, percent } } }
        })
      }
      if (e.bot && e.terminado) {
        const b = e.bot
        setSt((prev) => ({ ...prev, [b]: { ...prev[b], running: false, ok: !!e.ok, cancelled: !!e.cancelado, error: e.error } }))
      }
    })
    return () => { alive = false; un.then((f) => f()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return st
}

export function InstallRow({ id, name, s }: { id: string; name: string; s?: BotInstall }) {
  const toast = useToast()
  const done = s?.ok === true
  const failed = s && !s.running && s.ok === false
  const resume = () => api.installResume(id).catch((e) => toast('error', String(e)))
  const detail = done ? 'Instalado' : s?.cancelled ? 'Pausada: lo descargado se guarda y sigue donde se quedó.'
    : failed ? `No terminó: ${s?.error ?? 'error desconocido'}` : s?.step?.detalle ?? 'En espera…'
  return (
    <div className="install-row">
      <div className="install-row__head">
        <div className="cell-title">{done && <Icon name="check" size={16} />} {name}</div>
        {s?.running && (
          <button className="btn btn--ghost" onClick={() => api.installCancel(id)}>Cancelar</button>
        )}
        {failed && (
          <button className="btn btn--primary" onClick={resume}>
            <Icon name="refresh" size={16} /> {s?.cancelled ? 'Continuar' : 'Reintentar'}
          </button>
        )}
      </div>
      <div className={`small ${failed && !s?.cancelled ? 'error-text' : 'muted'}`}>{detail}</div>
      <ProgressBar percent={done ? 100 : s?.step?.paso === 'listo' ? 100 : s?.step?.percent ?? 0} label={name} />
    </div>
  )
}

/** Página del bot: su instalación quedó a medias (o está en marcha): verla, cancelarla o continuarla. */
export function InstallPanel({ botId, name }: { botId: string; name: string }) {
  const st = useInstalls([botId])
  return (
    <section className="panel">
      <h3><Icon name="upload" size={18} /> Instalación</h3>
      <p className="muted small">Mientras no termine, el bot no puede arrancar. Lo ya descargado no se pierde.</p>
      <InstallRow id={botId} name={name} s={st[botId] ?? { running: false, ok: false, cancelled: true }} />
    </section>
  )
}
