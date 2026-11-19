// Monetización: qué pide cada plataforma (datos con fuente y fecha), qué te falta con tus cifras reales,
// el tiempo real y cómo empezar a cobrar. Lirio solo guía: los contratos, los datos fiscales y los bancarios
// los rellenas tú en la web de Twitch o de Google, nunca aquí.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, ProgressBar } from '../components/ui'
import { api, type CliResult } from '../lib/api'
import { useLive } from '../lib/live'
import {
  BUNDLED, EN_DIRECTO_MS, FUERA_MS, fmt, fmtDate, lineProgress, pickData, programDone,
  type Datos, type Plataforma, type Programa,
} from '../lib/monetizacion'
import { useStore } from '../lib/store'

const BOT = { twitch: 'twitch-moderator', youtube: 'twitch-autoeditor' } as const
type Plat = keyof typeof BOT

interface Cifras { data: Record<string, any> | null; error: string | null; cargando: boolean }

function problem(r: CliResult): string {
  const m = String(r.data?.error ?? r.message ?? '')
  if (/no tiene el comando|invalid choice|argument cmd/i.test(m)) return 'Este bot todavía no sabe darte estas cifras: cuando se actualice, aparecerán aquí.'
  return m || 'No se pudieron leer las cifras.'
}

function useCifras(botId: string, installed: boolean, light: boolean): [Cifras, () => void] {
  const [c, setC] = useState<Cifras>({ data: null, error: null, cargando: installed })
  const load = useCallback((flags: Record<string, unknown> = {}) => {
    if (!installed) return
    api.runWith(botId, 'monetizacion', flags).then((r) => {
      if (r.ok && r.data) setC((old) => ({ data: { ...(old.data ?? {}), ...r.data }, error: null, cargando: false }))
      else setC((old) => ({ ...old, error: problem(r), cargando: false }))
    }).catch((e) => setC((old) => ({ ...old, error: String(e), cargando: false })))
  }, [botId, installed])
  // al abrir (o en cuanto se sepa que el bot está), todo; luego, en directo cada 30 s y fuera cada 10 min
  // (en YouTube solo lo ligero: 1 unidad de cuota)
  const started = useRef(false)
  const live = !!c.data?.en_directo?.activo
  useLive(() => { if (started.current) load(light && c.data ? { '--ligero': true } : {}) }, [], live ? EN_DIRECTO_MS : FUERA_MS)
  useEffect(() => { if (installed && !started.current) { started.current = true; load() } }, [installed, load])
  return [c, () => load({ '--refrescar': true })]
}

export function MonetizationPage() {
  const { overview } = useStore()
  const [datos, setDatos] = useState<Datos>(BUNDLED)
  useEffect(() => { api.monetizacionDatos().then((r) => setDatos(pickData(r))).catch(() => {}) }, [])
  const has = (p: Plat) => !!overview?.modules.some((m) => m.id === BOT[p])
  const [tw, refreshTw] = useCifras(BOT.twitch, has('twitch'), false)
  const [yt, refreshYt] = useCifras(BOT.youtube, has('youtube'), true)
  const twData = tw.data
  const live = !!twData?.en_directo?.activo

  return (
    <div className="stack monet">
      <section className="panel">
        <header className="section-head">
          <h2><Icon name="coin" size={20} /> Monetización</h2>
          <span className="muted small" data-testid="comprobado">Requisitos comprobados el {fmtDate(datos.comprobado)}</span>
        </header>
        <p className="muted">
          Qué pide cada plataforma, qué te falta con tus cifras reales y cómo empezar a cobrar. Lirio solo te guía:
          los contratos, los datos fiscales y los bancarios los rellenas tú en la web de Twitch o de Google, nunca aquí.
        </p>
      </section>

      <RealTime tw={twData} yt={yt.data} live={live} />

      <PlatformBlock id="twitch" p={datos.plataformas.twitch} cifras={tw} installed={has('twitch')}
                     botName="el moderador" onRefresh={refreshTw}
                     cuenta={twData?.tipo_cuenta === 'partner' ? 'Ya eres socio' : twData?.tipo_cuenta === 'affiliate' ? 'Ya eres afiliado' : null} />
      <PlatformBlock id="youtube" p={datos.plataformas.youtube} cifras={yt} installed={has('youtube')}
                     botName="el editor" onRefresh={refreshYt} cuenta={null} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="monet__stat"><div className="monet__num">{value}</div><div className="muted small">{label}</div></div>
}

function RealTime({ tw, yt, live }: { tw: Record<string, any> | null; yt: Record<string, any> | null; live: boolean }) {
  const d = tw?.en_directo ?? {}
  const n = (v: unknown) => (typeof v === 'number' ? fmt(v) : '—')
  return (
    <section className="panel" data-testid="tiempo-real">
      <h3>Ahora mismo</h3>
      {live ? (
        <>
          <p className="ok-text small">En directo en Twitch (se actualiza cada 30 s)</p>
          <div className="monet__stats">
            <Stat label="Espectadores" value={n(d.espectadores)} />
            <Stat label="Seguidores nuevos" value={n(d.seguidores_nuevos)} />
            <Stat label="Subs" value={n(d.subs)} />
            <Stat label="Bits" value={n(d.bits)} />
          </div>
        </>
      ) : <p className="muted small">No estás en directo en Twitch. Cuando lo estés, aquí verás espectadores, seguidores nuevos, subs y bits.</p>}
      <div className="monet__stats">
        <Stat label="Suscriptores de YouTube" value={n(yt?.suscriptores)} />
        <Stat label="Visualizaciones de YouTube" value={n(yt?.visualizaciones_totales)} />
        <Stat label="Seguidores de Twitch" value={n(tw?.seguidores)} />
      </div>
      <p className="muted small">YouTube se consulta cada 10 minutos con la consulta más barata, para no gastar tu cuota diaria gratuita.</p>
    </section>
  )
}

function PlatformBlock({ id, p, cifras, installed, botName, onRefresh, cuenta }: {
  id: Plat; p: Plataforma; cifras: Cifras; installed: boolean; botName: string; onRefresh: () => void; cuenta: string | null
}) {
  return (
    <section className="panel stack" data-testid={`plataforma-${id}`}>
      <header className="section-head">
        <h3><Icon name={id === 'youtube' ? 'yt' : 'play'} size={18} /> {p.nombre}</h3>
        {installed && <button className="btn btn--ghost" onClick={onRefresh}><Icon name="refresh" size={16} /> Actualizar cifras</button>}
      </header>
      {!installed && <p className="warning-text small">Instala {botName} para ver tus cifras reales. Los requisitos y los pasos valen igual.</p>}
      {cifras.error && <p className="warning-text small">{cifras.error}</p>}
      {cuenta && <p className="ok-text">{cuenta}</p>}
      {(cifras.data?.avisos as string[] | undefined)?.map((a) => <p key={a} className="warning-text small">{a}</p>)}

      <h4>Qué te falta</h4>
      {p.programas.map((prog) => <ProgramCard key={prog.id} prog={prog} stats={cifras.data} />)}

      <h4>Cómo empezar a cobrar</h4>
      <ol className="monet__steps">
        {p.pasos.map((s) => (
          <li key={s.texto}>{s.texto}{s.url && <> <button className="link" onClick={() => api.openUrl(s.url!)}>Abrir</button></>}</li>
        ))}
      </ol>
      <p className="small"><b>Umbral de pago:</b> {p.pago.umbral}</p>
      <p className="small"><b>Cuándo cobras:</b> {p.pago.cuando} <button className="link" onClick={() => api.openUrl(p.pago.fuente)}>Fuente oficial</button></p>
      {p.aviso_fecha && <p className="warning-text small">{p.aviso_fecha}</p>}

      <h4>Formas de ganar</h4>
      <ul className="monet__ways">
        {p.ganar.map((g) => (
          <li key={g.nombre}><b>{g.nombre}</b>: {g.texto}{g.url && <> <button className="link" onClick={() => api.openUrl(g.url!)}>Más información</button></>}</li>
        ))}
      </ul>
    </section>
  )
}

function ProgramCard({ prog, stats }: { prog: Programa; stats: Record<string, any> | null }) {
  const done = programDone(prog, stats)
  return (
    <div className="monet__prog" data-testid={`programa-${prog.id}`}>
      <div className="section-head">
        <div className="cell-title">{prog.nombre}</div>
        {done === true && <span className="ok-text small">Lo cumples</span>}
      </div>
      <p className="muted small">{prog.resumen}</p>
      {prog.requisitos.map((l, i) => {
        const pr = lineProgress(l, stats)
        const alt = 'una_de' in l
        return (
          <div key={i} className="monet__req">
            <div className="row small">
              <span>{pr.req.texto}{alt && <span className="muted"> (o la otra opción: {l.una_de.filter((r) => r !== pr.req).map((r) => `${fmt(r.meta, r.unidad)} ${r.texto.toLowerCase()}`).join(', ')})</span>}</span>
              <span className="monet__val">{fmt(pr.valor, pr.req.unidad)} / {fmt(pr.req.meta, pr.req.unidad)}</span>
            </div>
            {pr.valor !== null ? <ProgressBar percent={pr.pct} label={pr.req.texto} />
              : <p className="muted small">{pr.motivo ?? 'Sin dato: la plataforma no lo da o el bot aún no lo sabe.'}</p>}
          </div>
        )
      })}
      {prog.notas?.map((n) => <p key={n} className="muted small">{n}</p>)}
      <button className="link small" onClick={() => api.openUrl(prog.fuente)}>Requisitos en la página oficial</button>
    </div>
  )
}
