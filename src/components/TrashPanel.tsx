// Papelera del editor: directos descargados y vídeos editados. Borrar es siempre una persona manteniendo pulsado:
// el editor crea una solicitud por archivo, Lirio la firma con el gesto (aprobar-firmado) y se repite el borrado.
// Ninguna IA borra sola. El borrado automático se cambia en Ajustes (y aun así el editor pide aprobación).
import { useCallback, useEffect, useState } from 'react'
import { api, pendingApprovals } from '../lib/api'
import { HoldButton } from './HoldButton'
import { Icon, Pill, timeAgo, useToast } from './ui'
import { human } from './units'

interface Directo { archivo: string; ruta: string; mb: number; fecha?: string; estado?: string; se_puede_borrar?: boolean; aviso?: string | null }
interface Editado { carpeta: string; nombre: string; titulo?: string; video?: string; shorts?: number; mb: number; fecha?: string;
  subido?: boolean; youtube?: { url?: string } | null }
interface Trash {
  directos: Directo[]; editados: Editado[]; carpetas: Record<string, string>
  automatica: { borrar_directo_tras_editar: boolean; borrar_video_tras_subir: boolean }
}

const CARPETAS: [string, string][] = [['directos', 'Directos'], ['editados', 'Vídeos editados'], ['miniaturas', 'Miniaturas']]
const ESTADO: Record<string, string> = { pendiente: 'sin editar', editado: 'editado', en_espera: 'en espera', editando: 'editándose' }

export function TrashPanel({ botId, goSettings }: { botId: string; goSettings?: () => void }) {
  const toast = useToast()
  const [t, setT] = useState<Trash | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    api.runWith(botId, 'papelera').then((r) => {
      if (r.ok && r.data?.directos) { setT(r.data as Trash); setErr(null) } else setErr(r.data?.error ?? r.message)
    }).catch((e) => setErr(String(e)))
  }, [botId])
  useEffect(() => { load() }, [load])

  /** 1) pide borrar (el editor crea la solicitud), 2) Lirio la firma con el gesto, 3) se repite y ahora sí borra. */
  const remove = async (token: string, ruta: string, label: string) => {
    const first = await api.runWith(botId, 'papelera-borrar', { '@rutas': [ruta] })
    if (first.ok) { toast('ok', `${label}: borrado.`); load(); return }
    const ids: string[] = first.data?.pendientes_de_aprobacion ?? []
    if (first.code !== 5 || ids.length === 0) { toast('error', first.data?.mensaje ?? first.data?.error ?? first.message); load(); return }
    const pending = pendingApprovals((await api.details(botId)).approvals)
    for (const id of ids) {
      const a = pending.find((p) => p.id === id)
      const r = await api.signedDecision(token, botId, 'approve', id, a?.action, a?.key)
      if (!r.ok) { toast('error', r.message); load(); return }
    }
    const second = await api.runWith(botId, 'papelera-borrar', { '@rutas': [ruta] })
    toast(second.ok ? 'ok' : 'error', second.ok ? `${label}: borrado${second.data?.liberado_mb ? ` (${human(second.data.liberado_mb * 1e6)} libres)` : ''}.`
      : second.data?.mensaje ?? second.message)
    load()
  }

  if (err) return <p className="panel warn">{err}</p>
  if (!t) return <p className="panel muted">Cargando…</p>
  const total = [...t.directos, ...t.editados].reduce((n, i) => n + (i.mb ?? 0), 0) * 1e6
  const hold = (ruta: string, label: string, disabled = false) => (
    <HoldButton tone="ghost" disabled={disabled} onBegin={api.gestureBegin} onComplete={(tok) => remove(tok, ruta, label)}
      title={disabled ? 'Ahora no se puede borrar' : 'Mantén pulsado 2 segundos para borrarlo'}>Borrar</HoldButton>
  )

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-head">
          <h3><Icon name="grid" size={18} /> Carpetas</h3>
          <span className="muted small">Ocupan {human(total)}</span>
        </div>
        <div className="row">
          {CARPETAS.filter(([k]) => t.carpetas[k]).map(([k, label]) => (
            <button key={k} className="btn btn--outline" onClick={() => api.openBotFolder(botId, t.carpetas[k]).catch((e) => toast('error', String(e)))}>
              <Icon name="arrow" size={16} /> Abrir {label}
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="section-head">
          <h3>Borrado automático</h3>
          {goSettings && <button className="btn btn--ghost" onClick={goSettings}>Cambiarlo en Ajustes</button>}
        </div>
        <ul className="list">
          <li><div className="cell-title">Borrar el directo cuando ya esté editado</div>
            <Pill tone={t.automatica.borrar_directo_tras_editar ? 'ok' : 'muted'}>{t.automatica.borrar_directo_tras_editar ? 'Activado' : 'Desactivado'}</Pill></li>
          <li><div className="cell-title">Borrar el vídeo cuando ya esté subido a YouTube</div>
            <Pill tone={t.automatica.borrar_video_tras_subir ? 'ok' : 'muted'}>{t.automatica.borrar_video_tras_subir ? 'Activado' : 'Desactivado'}</Pill></li>
        </ul>
        <p className="muted small">Borrar siempre lo decides tú: hay que mantener pulsado el botón. Ninguna IA borra nada sola.</p>
      </section>
      <div className="grid-2">
        <section className="panel">
          <h3>Directos descargados</h3>
          {t.directos.length === 0 ? <p className="muted">Nada por aquí.</p> : (
            <ul className="list">
              {t.directos.map((d) => (
                <li key={d.ruta}>
                  <div>
                    <div className="cell-title">{d.archivo} {d.estado && <Pill tone={d.se_puede_borrar ? 'ok' : 'muted'}>{ESTADO[d.estado] ?? d.estado}</Pill>}</div>
                    <div className="muted small">{human(d.mb * 1e6)}{d.fecha ? ` · ${timeAgo(d.fecha)}` : ''}{d.aviso ? ` · ${d.aviso}` : ''}</div>
                  </div>
                  {hold(d.ruta, d.archivo, d.estado === 'editando')}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h3>Vídeos editados</h3>
          {t.editados.length === 0 ? <p className="muted">Nada por aquí.</p> : (
            <ul className="list">
              {t.editados.map((e) => (
                <li key={e.carpeta}>
                  <div>
                    <div className="cell-title">{e.titulo || e.nombre} {e.subido ? <Pill tone="ok">subido</Pill> : <Pill tone="muted">sin subir</Pill>}</div>
                    <div className="muted small">{human(e.mb * 1e6)}{e.shorts ? ` · ${e.shorts} Shorts` : ''}{e.fecha ? ` · ${timeAgo(e.fecha)}` : ''}</div>
                  </div>
                  {hold(e.carpeta, e.titulo || e.nombre)}
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">De un vídeo se borran el vídeo largo y sus Shorts; la información y las miniaturas se quedan.</p>
        </section>
      </div>
    </div>
  )
}
