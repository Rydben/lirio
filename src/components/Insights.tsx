// Estadísticas y consejos del editor (formato `aniuzka-insights/1`): último directo, YouTube, consejos y comentarios.
// Solo lectura y gratis. Los gráficos son de una sola serie (sin leyenda: el título dice qué se mide).
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { ScreenFace } from './Face'
import { Icon, Pill, timeAgo } from './ui'
import type { Expression } from '../lib/mood'

type Insights = Record<string, any>
type Tab = 'directo' | 'youtube' | 'consejos' | 'comentarios'

const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const TEMA: Record<string, { titulo: string; cara: Expression }> = {
  horario_directo: { titulo: 'Cuándo hacer directo', cara: 'guino' },
  juegos: { titulo: 'Qué jugar', cara: 'boca_abierta' },
  subida: { titulo: 'Cuándo subir', cara: 'feliz' },
  frecuencia: { titulo: 'Cada cuánto', cara: 'ojos_cerrados' },
  edicion: { titulo: 'Qué cambiar en la edición', cara: 'sorprendido' },
}

export const fmtDur = (s?: number | null) => {
  if (!s) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

/** Barras de una sola serie con tooltip por barra (título del gráfico = qué se mide). */
export function Bars({ data, unit = '', label }: { data: [string, number][]; unit?: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(([, v]) => v))
  const W = 560, H = 180, pad = 24, band = (W - pad) / Math.max(1, data.length), bw = Math.min(24, band * 0.6)
  return (
    <figure className="chart" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H + 28}`} role="img" aria-label={label}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pad} x2={W} y1={H - t * (H - 10)} y2={H - t * (H - 10)} className="chart__grid" />
            <text x={pad - 6} y={H - t * (H - 10) + 4} className="chart__tick" textAnchor="end">{Math.round(max * t)}</text>
          </g>
        ))}
        {data.map(([k, v], i) => {
          const h = (v / max) * (H - 10)
          const x = pad + i * band + (band - bw) / 2
          return (
            <g key={k} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad + i * band} y={0} width={band} height={H} fill="transparent" />
              {h > 0 && <path className="chart__bar" d={`M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} />}
              <text x={pad + i * band + band / 2} y={H + 18} className="chart__tick" textAnchor="middle">{k.slice(0, 3)}</text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart__tip" style={{ left: `${((pad + hover * band + band / 2) / W) * 100}%` }}>
          <b>{data[hover][0]}</b>: {data[hover][1].toLocaleString('es-ES')}{unit}
        </div>
      )}
      <details className="small muted"><summary>Ver como tabla</summary>
        <table className="table"><tbody>{data.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v.toLocaleString('es-ES')}{unit}</td></tr>)}</tbody></table>
      </details>
    </figure>
  )
}

export function Insights({ botId }: { botId: string }) {
  const [data, setData] = useState<Insights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Tab>('consejos')

  const load = async (refresh = false) => {
    setBusy(true)
    const r = await api.runWith(botId, 'estadisticas', refresh ? { '--refrescar': true } : {})
    setBusy(false)
    if (r.ok && r.data?.formato?.startsWith('aniuzka-insights/')) { setData(r.data); setError(null) } else setError(r.data?.error ?? r.message)
  }
  useEffect(() => { load() }, [botId])

  if (error) return <section className="panel"><p className="error-text">No pude leer las estadísticas: {error}</p></section>
  if (!data) return <section className="panel"><p className="muted">Preparando tus estadísticas…</p></section>

  const last = data.ultimo_directo
  const yt = data.youtube ?? {}
  const perDay: [string, number][] = DAYS.map((d) => [d, Number(yt.vistas_por_dia_semana_90d?.[d] ?? 0)])
  const streams: [string, number][] = (data.directos ?? []).slice(-10).map((d: any) =>
    [d.inicio ? new Date(d.inicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : d.sid, Number(d.vistas_vod ?? 0)])

  return (
    <div className="stack">
      <section className="panel insights-head">
        <div>
          <h3>Estadísticas y consejos</h3>
          <p className="muted small">
            Actualizado {timeAgo(data.generado).toLowerCase()} · consejos con {data.ia === 'heuristico' ? 'reglas (sin IA)' : data.ia}
            {' · '}tus datos pesan un {Math.round((data.peso_datos_propios ?? 0) * 100)} % (más directos = consejos más tuyos)
          </p>
        </div>
        <button className="btn btn--ghost" disabled={busy} onClick={() => load(true)}><Icon name="refresh" size={16} /> {busy ? 'Actualizando…' : 'Actualizar'}</button>
      </section>
      <nav className="tabs" role="tablist">
        {([['consejos', 'Consejos'], ['directo', 'Último directo'], ['youtube', 'YouTube'], ['comentarios', 'Comentarios']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>

      {tab === 'consejos' && (
        <div className="tips">
          {(data.consejos ?? []).map((c: any, i: number) => {
            const t = TEMA[c.tema] ?? { titulo: c.tema, cara: 'feliz' as Expression }
            return (
              <article key={i} className="tip">
                <ScreenFace expression={t.cara} size={52} />
                <div>
                  <div className="tip__head"><b>{t.titulo}</b>
                    <Pill tone={c.confianza === 'alta' ? 'ok' : c.confianza === 'media' ? 'working' : 'muted'}>confianza {c.confianza}</Pill>
                    <span className="muted small">según {c.base === 'ambos' ? 'tus datos y la investigación' : c.base === 'datos' ? 'tus datos' : 'la investigación'}</span>
                  </div>
                  <p>{c.texto}</p>
                  {c.fuentes?.length > 0 && <details className="small muted"><summary>Fuentes</summary><ul className="bullets">{c.fuentes.map((f: string) => <li key={f}>{f}</li>)}</ul></details>}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {tab === 'directo' && (
        last ? (
          <div className="grid-2">
            <section className="panel">
              <h3>{last.titulo ?? 'Último directo'}</h3>
              <div className="stat-row">
                <Stat label="Duración" value={fmtDur(last.duracion_s)} />
                <Stat label="Vistas del VOD" value={last.vistas_vod ?? '—'} />
                <Stat label="Chat por minuto" value={last.chat_por_minuto ?? '—'} />
              </div>
              {last.juegos?.length > 0 && <p className="muted small">Juegos: {last.juegos.map((g: any) => g.nombre ?? g).filter(Boolean).join(', ')}</p>}
              {last.moderador && (
                <div className="stat-row">
                  <Stat label="Espectadores (máx.)" value={last.moderador.espectadores_max ?? '—'} />
                  <Stat label="Seguidores nuevos" value={last.moderador.nuevos_seguidores ?? '—'} />
                  <Stat label="Subs" value={last.moderador.subs ?? '—'} />
                </div>
              )}
            </section>
            <section className="panel">
              <h3>Vistas de tus últimos directos</h3>
              {streams.length ? <Bars data={streams} label="Vistas del VOD por directo" /> : <p className="muted">Aún no hay directos guardados.</p>}
            </section>
          </div>
        ) : <section className="panel"><p className="muted">Todavía no hay datos de directos: aparecerán después de editar el primero.</p></section>
      )}

      {tab === 'youtube' && (
        <div className="stack">
          <section className="panel">
            <div className="stat-row">
              <Stat label="Suscriptores" value={yt.canal?.suscriptores ?? '—'} />
              <Stat label="Vistas totales" value={yt.canal?.vistas_totales ?? '—'} />
              <Stat label="Suscriptores en 28 días" value={yt.canal?.suscriptores_28d ? `+${yt.canal.suscriptores_28d.ganados} / −${yt.canal.suscriptores_28d.perdidos}` : '—'} />
            </div>
          </section>
          <section className="panel">
            <h3>Vistas por día de la semana (últimos 90 días)</h3>
            <Bars data={perDay} label="Vistas por día de la semana" />
          </section>
          <section className="panel">
            <h3>Tus vídeos</h3>
            <table className="table">
              <thead><tr><th>Vídeo</th><th>Vistas</th><th>Likes</th><th>Retención media</th><th>La mitad se va en</th></tr></thead>
              <tbody>
                {(yt.videos ?? []).map((v: any) => (
                  <tr key={v.id}>
                    <td><div className="cell-title">{v.titulo}</div><div className="muted small">{v.short ? 'Short' : 'Vídeo'} · {timeAgo(v.publicado)}</div></td>
                    <td>{v.vistas ?? '—'}</td><td>{v.likes ?? '—'}</td>
                    <td>{v.retencion_media_pct != null ? `${Math.round(v.retencion_media_pct)} %` : '—'}</td>
                    <td>{v.abandono?.mitad_se_va_en_s != null ? fmtDur(v.abandono.mitad_se_va_en_s) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {data.limitaciones?.length > 0 && <p className="muted small">Lo que YouTube no deja ver desde aquí: {data.limitaciones.join(' ')}</p>}
        </div>
      )}

      {tab === 'comentarios' && (
        <div className="grid-3">
          {([['peticiones', 'Lo que te piden'], ['gusta', 'Lo que gusta'], ['quejas', 'Quejas']] as [string, string][]).map(([k, l]) => (
            <section key={k} className="panel">
              <h3>{l}</h3>
              {(data.comentarios?.[k] ?? []).length === 0 ? <p className="muted small">Nada todavía.</p>
                : <ul className="bullets">{data.comentarios[k].map((c: any, i: number) => <li key={i}>{typeof c === 'string' ? c : c.texto}</li>)}</ul>}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: unknown }) {
  return <div className="stat"><div className="stat__value">{typeof value === 'number' ? value.toLocaleString('es-ES') : String(value)}</div><div className="muted small">{label}</div></div>
}
