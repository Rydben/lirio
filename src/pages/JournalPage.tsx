// Diario de Lirio: lo que han hecho Lirio y los bots, día a día, con espacio para tus propias notas.
// Vive solo en este PC.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon, useToast } from '../components/ui'
import { api, type JournalEntry } from '../lib/api'

const KIND: Record<string, { label: string; icon: string }> = {
  aprobacion: { label: 'Aprobación', icon: 'shield' },
  subida: { label: 'Subida', icon: 'upload' },
  arranque: { label: 'Arranque', icon: 'play' },
  parada: { label: 'Parada', icon: 'pause' },
  stop: { label: 'STOP', icon: 'stop' },
  instalacion: { label: 'Instalación', icon: 'grid' },
  actualizacion: { label: 'Actualización', icon: 'refresh' },
  diagnostico: { label: 'Diagnóstico', icon: 'stethoscope' },
  youtube: { label: 'YouTube', icon: 'yt' },
  nota: { label: 'Tu nota', icon: 'heart' },
}

/** Agrupa por día ("hoy", "ayer" o la fecha). */
export function groupByDay(entries: JournalEntry[], now = new Date()): [string, JournalEntry[]][] {
  // fecha LOCAL (el diario guarda la hora local con su zona), para que «hoy» no cambie a medianoche UTC
  const day = (d: Date) => d.toLocaleDateString('sv-SE')
  const today = day(now)
  const yesterday = day(new Date(now.getTime() - 86_400_000))
  const groups = new Map<string, JournalEntry[]>()
  for (const e of entries) {
    const k = e.at.slice(0, 10)
    const label = k === today ? 'Hoy' : k === yesterday ? 'Ayer'
      : new Date(`${k}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
    groups.set(label, [...(groups.get(label) ?? []), e])
  }
  return [...groups.entries()]
}

export function JournalPage() {
  const toast = useToast()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const grouped = useMemo(() => groupByDay(entries), [entries])
  const [days, setDays] = useState(7)
  const [note, setNote] = useState('')
  const load = useCallback(() => api.journal(days).then(setEntries).catch(() => {}), [days])
  useEffect(() => { load() }, [load])

  const save = async () => {
    try {
      await api.journalNote(note)
      setNote('')
      load()
    } catch (e) {
      toast('error', String(e))
    }
  }

  return (
    <div className="stack">
      <section className="panel intro">
        <h1>Diario</h1>
        <p className="muted">Lo que han hecho Lirio y tus bots, día a día. Se guarda solo en este PC (los últimos 90 días).</p>
      </section>
      <section className="panel">
        <h3><Icon name="heart" size={18} /> Escribe una nota</h3>
        <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Nota"
          placeholder="Por ejemplo: «hoy el directo de Minecraft fue genial, probar a subirlo el sábado»" />
        <div className="row"><button className="btn btn--primary" disabled={!note.trim()} onClick={save}>Guardar nota</button></div>
      </section>
      <section className="panel">
        <header className="section-head">
          <h3><Icon name="clock" size={18} /> Lo que ha pasado</h3>
          <div className="chips">
            {[7, 30, 90].map((d) => (
              <button key={d} className={`chip${d === days ? ' is-active' : ''}`} onClick={() => setDays(d)}>{d} días</button>
            ))}
          </div>
        </header>
        {entries.length === 0 && <p className="muted">Todavía no hay nada en estos días.</p>}
        {grouped.map(([label, items]) => (
          <div key={label} className="journal-day">
            <div className="journal-day__label">{label}</div>
            <ul className="activity">
              {items.map((e, i) => {
                const k = KIND[e.kind] ?? { label: e.kind, icon: 'bolt' }
                return (
                  <li key={`${e.at}-${i}`}>
                    <span className={`activity__icon activity__icon--${e.kind === 'nota' ? 'violet' : e.ok ? 'green' : 'red'}`}>
                      <Icon name={k.icon} size={18} />
                    </span>
                    <div>
                      <div className="activity__name">{e.kind === 'nota' ? e.text : k.label}</div>
                      <div className="muted small">
                        {new Date(e.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        {e.kind !== 'nota' && ` · ${e.text}`}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  )
}
