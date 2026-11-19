// «Aprendido de tus estadísticas»: ajustes de edición que el editor saca solo de las estadísticas.
// Se ven, se borran uno a uno (o todos) y se pueden apagar. Lo que el usuario escribe en «Tu estilo» manda.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Icon, Pill, timeAgo, useToast } from './ui'

interface Cambio { uid: string; id?: string; texto?: string; motivo?: string; estado?: string; aplicado_at?: string; resultado?: string }
interface Descartado { id?: string; texto?: string; por_que_no?: string; at?: string }
export interface Aprendido {
  ok?: boolean; etiqueta?: string; activado?: boolean; cambios?: Cambio[]; historial?: Cambio[]; descartados?: Descartado[]; limites?: string
}

const ESTADO: Record<string, [string, 'ok' | 'working' | 'muted' | 'warning']> = {
  probando: ['en pruebas', 'working'], activo: ['activo', 'ok'], deshecho: ['deshecho (empeoró)', 'warning'],
  borrado: ['borrado por ti', 'muted'], anulado: ['anulado por tu estilo', 'muted'],
}

const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])

export function LearnedPanel({ botId }: { botId: string }) {
  const toast = useToast()
  const [a, setA] = useState<Aprendido | null>(null)
  const [busy, setBusy] = useState(false)
  const [showHist, setShowHist] = useState(false)

  const apply = (d: any) => { if (d && typeof d === 'object' && ('cambios' in d || 'activado' in d)) setA(d) }
  const load = useCallback(() => api.runWith(botId, 'aprendido').then((r) => { if (r.ok) apply(r.data) }).catch(() => {}), [botId])
  useEffect(() => { load() }, [load])

  const run = async (command: string, flags: Record<string, unknown>, ok: string) => {
    setBusy(true)
    const r = await api.runWith(botId, command, flags)
    setBusy(false)
    if (r.ok) { apply(r.data); toast('ok', ok) } else toast('error', r.data?.error ?? r.message)
  }

  if (!a) return null
  const cambios = list<Cambio>(a.cambios)
  const historial = list<Cambio>(a.historial)
  const descartados = list<Descartado>(a.descartados)

  return (
    <section className="panel">
      <div className="section-head">
        <h3><Icon name="bolt" size={18} /> {a.etiqueta ? a.etiqueta[0].toUpperCase() + a.etiqueta.slice(1) : 'Aprendido de tus estadísticas'}</h3>
        <label className="row small">
          <input type="checkbox" checked={!!a.activado} disabled={busy} aria-label="Aprender de mis estadísticas"
            onChange={(e) => run('aprendido-activar', { '@valor': e.target.checked ? 'si' : 'no' }, e.target.checked ? 'Aprender de tus estadísticas: activado.' : 'Aprender de tus estadísticas: apagado.')} />
          Aprender de mis estadísticas
        </label>
      </div>
      {cambios.length === 0 ? <p className="muted small">Todavía no ha cambiado nada por su cuenta.</p> : (
        <ul className="list">
          {cambios.map((c) => {
            const [label, tone] = ESTADO[c.estado ?? ''] ?? [c.estado ?? '', 'muted']
            return (
              <li key={c.uid}>
                <div>
                  <div className="cell-title">{c.texto ?? c.id} {label && <Pill tone={tone}>{label}</Pill>}</div>
                  <div className="muted small">{c.motivo}{c.aplicado_at ? ` · ${timeAgo(c.aplicado_at)}` : ''}</div>
                </div>
                <button className="btn btn--ghost" disabled={busy} aria-label={`Quitar: ${c.texto ?? c.id}`}
                  onClick={() => run('aprendido-borrar', { '@que': c.uid }, 'Quitado: ya no se aplica.')}><Icon name="close" size={14} /></button>
              </li>
            )
          })}
        </ul>
      )}
      {cambios.length > 1 && (
        <button className="btn btn--ghost" disabled={busy} onClick={() => run('aprendido-borrar', { '@que': 'todo' }, 'Quitado todo lo aprendido.')}>Quitar todo</button>
      )}
      {descartados.length > 0 && (
        <div className="small">
          <b>No lo ha aplicado:</b>
          <ul>{descartados.map((d, i) => <li key={i}>{d.texto ?? d.id}: <span className="muted">{d.por_que_no}</span></li>)}</ul>
        </div>
      )}
      {historial.length > 0 && (
        <>
          <button className="btn btn--ghost" onClick={() => setShowHist((v) => !v)}>{showHist ? 'Ocultar historial' : `Ver historial (${historial.length})`}</button>
          {showHist && (
            <ul className="list">
              {historial.map((c) => {
                const [label, tone] = ESTADO[c.estado ?? ''] ?? [c.estado ?? '', 'muted']
                return <li key={c.uid}><div><div className="cell-title">{c.texto ?? c.id} <Pill tone={tone}>{label}</Pill></div>
                  <div className="muted small">{c.motivo}{c.resultado ? ` · ${c.resultado}` : ''}</div></div></li>
              })}
            </ul>
          )}
        </>
      )}
      {a.limites && <p className="muted small">{a.limites}</p>}
    </section>
  )
}
