// Página de un bot: cabecera con controles (arrancar, parar, STOP) y pestañas.
// El bot de vídeo tiene cola de subida, vídeos en espera, aprobaciones, estadísticas y ajustes.
import { useCallback, useEffect, useState } from 'react'
import { ApprovalCard, useSignedDecision } from '../components/Approvals'
import { ChatPanel } from '../components/ChatPanel'
import { Insights } from '../components/Insights'
import { SettingsForm } from '../components/SettingsForm'
import { TwitchConnect } from '../components/TwitchConnect'
import { VoiceCommandTester } from '../components/VoiceCommandTester'
import { VoiceRecorder } from '../components/VoiceRecorder'
import { HoldButton } from '../components/HoldButton'
import { Icon, Pill, ProgressBar, timeAgo, useToast } from '../components/ui'
import { api, pendingApprovals, type BotView, type Details, type QueueItem } from '../lib/api'
import { keyProblem, stateLabel, stateTone } from '../lib/mood'
import { useStore } from '../lib/store'
import { botSummary } from './Home'

export type BotTab = 'resumen' | 'cola' | 'espera' | 'aprobaciones' | 'estadisticas' | 'chat' | 'twitch' | 'voz' | 'ajustes'

const VIDEO_TABS: [BotTab, string][] = [
  ['resumen', 'Resumen'], ['cola', 'Cola de subida'], ['espera', 'En espera'],
  ['aprobaciones', 'Aprobaciones'], ['estadisticas', 'Estadísticas y consejos'], ['ajustes', 'Ajustes'],
]
const OTHER_TABS: [BotTab, string][] = [['resumen', 'Resumen'], ['aprobaciones', 'Aprobaciones'], ['ajustes', 'Ajustes']]

/** Lo que el bot sabe hacer desde Lirio, preguntándole (los manifiestos no siempre lo declaran todo). */
function useCapabilities(bot: BotView | undefined) {
  const [caps, setCaps] = useState({ voz: false, ajustes: false })
  useEffect(() => {
    if (!bot || bot.parent) return
    let alive = true
    Promise.all([api.runWith(bot.id, 'voz-texto').catch(() => null), api.runWith(bot.id, 'ajustes-esquema').catch(() => null)])
      .then(([v, a]) => { if (alive) setCaps({ voz: !!v?.ok || bot.commands.includes('enroll'), ajustes: !!a?.ok }) })
    return () => { alive = false }
  }, [bot?.id])
  return caps
}

export function BotPage({ id, tab: initialTab }: { id: string; tab?: BotTab }) {
  const { overview } = useStore()
  const [tab, setTab] = useState<BotTab>(initialTab ?? 'resumen')
  const [details, setDetails] = useState<Details | null>(null)
  const bot = overview?.modules.find((m) => m.id === id)
  const caps = useCapabilities(bot)

  const load = useCallback(() => api.details(id).then(setDetails).catch(() => setDetails(null)), [id])
  useEffect(() => {
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [load])

  if (!bot) return <div className="panel">No encuentro este bot.</div>
  const isVideo = bot.id === 'twitch-autoeditor'
  const hasTwitch = bot.commands.includes('connect')
  const base = isVideo ? VIDEO_TABS : OTHER_TABS
  const tabs: [BotTab, string][] = [
    ...base.slice(0, -1),
    ...(hasTwitch ? [['chat', 'Chat'] as [BotTab, string], ['twitch', 'Twitch'] as [BotTab, string]] : []),
    ...(caps.voz ? [['voz', 'Huella de voz'] as [BotTab, string]] : []),
    base[base.length - 1],
  ]
  const approvals = details ? pendingApprovals(details.approvals) : bot.approvals_pending

  return (
    <div className="bot-page">
      <BotHeader bot={bot} />
      <nav className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>
            {label}
            {k === 'aprobaciones' && approvals.length > 0 && <span className="badge">{approvals.length}</span>}
            {k === 'espera' && details && countHeld(details) > 0 && <span className="badge">{countHeld(details)}</span>}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === 'resumen' && <Summary bot={bot} details={details} />}
        {tab === 'cola' && details && <Queue bot={bot} details={details} reload={load} />}
        {tab === 'espera' && details && <Held bot={bot} details={details} />}
        {tab === 'aprobaciones' && (
          approvals.length === 0
            ? <p className="muted panel">No hay nada esperando tu aprobación.</p>
            : <div className="stack">{approvals.map((a) => <ApprovalCard key={a.id} bot={bot} a={a} />)}</div>
        )}
        {tab === 'estadisticas' && <Insights botId={bot.id} />}
        {tab === 'chat' && <ChatPanel botId={bot.id} />}
        {tab === 'twitch' && (
          <div className="grid-2">
            <section className="panel"><h3>Cuenta del bot</h3><TwitchConnect botId={bot.id} /></section>
            <section className="panel"><h3>Tu canal</h3><TwitchConnect botId={bot.id} streamer /></section>
          </div>
        )}
        {tab === 'voz' && (
          <div className="grid-2">
            <section className="panel"><h3>Tu voz</h3>
              <VoiceRecorder botId={bot.id} command={bot.commands.includes('enroll') ? 'enroll' : 'registrar-voz'} /></section>
            {bot.commands.includes('enroll') && (
              <section className="panel"><h3>Voz de un amigo</h3><VoiceRecorder botId={bot.id} command="enroll" friend /></section>
            )}
            {bot.commands.includes('enroll') && (
              <section className="panel"><h3>Probar comandos de voz</h3><VoiceCommandTester botId={bot.id} /></section>
            )}
          </div>
        )}
        {tab === 'ajustes' && (caps.ajustes ? <SettingsForm botId={bot.id} /> : <Settings bot={bot} />)}
      </div>
    </div>
  )
}

function countHeld(d: Details) {
  return Object.keys(d.hold ?? {}).length + Object.values(d.failures ?? {}).filter((f) => f.failed).length
}

function BotHeader({ bot }: { bot: BotView }) {
  const toast = useToast()
  const { refresh } = useStore()
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label)
    try {
      const r: any = await fn()
      if (r && typeof r === 'object' && 'ok' in r && !r.ok) toast('error', r.message)
      else toast('ok', ok)
    } catch (e) {
      toast('error', String(e))
    } finally {
      setBusy(null)
      refresh()
    }
  }
  const { overview } = useStore()
  const keyIssue = keyProblem(bot, overview?.my_key)
  const running = bot.state === 'watching' || bot.state === 'running'
  const sub = !!bot.parent

  return (
    <header className="bot-header panel">
      <div>
        <div className="bot-header__title">
          <h1>{bot.name}</h1>
          <Pill tone={stateTone(bot)}>{stateLabel(bot)}</Pill>
          {bot.version && <span className="muted small">v{bot.version}</span>}
        </div>
        <p className="muted">{botSummary(bot)}{bot.state_note ? ` (${bot.state_note})` : ''}</p>
        {keyIssue && <p className="warn small"><Icon name="key" size={16} /> {keyIssue}</p>}
      </div>
      {!sub && (
        <div className="bot-header__actions">
          {bot.stop_active ? (
            <HoldButton onBegin={api.gestureBegin}
              onComplete={(t) => act('resume', () => api.killSwitchOff(t, bot.id), 'STOP quitado. Ya puedes arrancarlo.')}
              title="Mantén pulsado 2 s: vuelve a dejar trabajar al bot">
              <Icon name="play" size={16} /> Reanudar (quitar STOP)
            </HoldButton>
          ) : (
            <>
              {!running && (bot.task || bot.commands.includes('watch')) && (
                <button className="btn btn--primary" disabled={!!busy}
                  onClick={() => act('start', () => api.startBot(bot.id), 'Arrancando el bot…')}>
                  <Icon name="play" size={16} /> Arrancar
                </button>
              )}
              {running && (
                <button className="btn btn--ghost" disabled={!!busy || bot.stop_requested}
                  title="Termina lo que está haciendo y se para"
                  onClick={() => act('stop', () => api.run(bot.id, 'stop'), 'Parada pedida: termina la etapa en curso y se para.')}>
                  <Icon name="pause" size={16} /> {bot.stop_requested ? 'Parando…' : 'Parar'}
                </button>
              )}
              <button className="btn btn--danger" disabled={!!busy}
                title="Interruptor de emergencia: para todo y no vuelve a arrancar hasta que lo quites"
                onClick={() => act('kill', () => api.killSwitchOn(bot.id), 'STOP activado.')}>
                <Icon name="stop" size={16} /> STOP
              </button>
            </>
          )}
          <button className="btn btn--ghost" disabled={!!busy}
            onClick={() => act('doctor', async () => {
              const r = await api.run(bot.id, 'doctor')
              const checks = r.data?.checks ?? {}
              const bad = Object.entries(checks).filter(([, v]: any) => !v.ok).map(([k]) => k)
              return { ...r, ok: r.ok, message: bad.length ? `Revisa: ${bad.join(', ')}` : r.message }
            }, 'Diagnóstico: todo correcto')}>
            <Icon name="stethoscope" size={16} /> {busy === 'doctor' ? 'Comprobando…' : 'Diagnóstico'}
          </button>
        </div>
      )}
    </header>
  )
}

function Summary({ bot, details }: { bot: BotView; details: Details | null }) {
  const s = bot.status ?? {}
  const job = s.current_job
  const last = s.last_job
  return (
    <div className="grid-2">
      <section className="panel">
        <h3>Ahora mismo</h3>
        {job ? (
          <>
            <p>Editando <b>{fileName(job.source)}</b> — etapa {job.stage} ({job.stage_index}/{job.stages_total})</p>
            <ProgressBar percent={job.percent ?? 0} label="Edición" />
          </>
        ) : <p className="muted">{botSummary(bot)}</p>}
        {s.warning && <p className="warn"><Icon name="alert" size={16} /> {String(s.warning)}</p>}
        {s.last_error && <p className="error-text"><Icon name="alert" size={16} /> {String(s.last_error)}</p>}
        {bot.id === 'twitch-moderator' && s.moderation && (
          <dl className="kv">
            <dt>Chat</dt><dd>{s.chat ?? '—'}</dd>
            <dt>OBS</dt><dd>{s.obs ?? '—'}</dd>
            <dt>En directo</dt><dd>{s.live ? 'Sí' : 'No'}</dd>
            <dt>Mensajes</dt><dd>{s.moderation.messages}</dd>
            <dt>Borrados / avisos</dt><dd>{s.moderation.deleted} / {s.moderation.warned}</dd>
            <dt>Timeouts / bans</dt><dd>{s.moderation.timeouts} / {s.moderation.bans}</dd>
          </dl>
        )}
      </section>
      {bot.id !== 'twitch-autoeditor' ? (
        <section className="panel">
          <h3>Avisos</h3>
          {(s.audio_warnings ?? []).length === 0 && !s.warning
            ? <p className="muted">Sin avisos.</p>
            : <ul className="bullets">{(s.audio_warnings ?? []).map((w: string) => <li key={w}>{w}</li>)}</ul>}
        </section>
      ) : (
      <section className="panel">
        <h3>Último trabajo</h3>
        {last ? (
          <dl className="kv">
            <dt>Vídeo</dt><dd>{fileName(last.source)}</dd>
            <dt>Resultado</dt><dd>{last.ok ? 'Correcto' : `Falló: ${last.error ?? ''}`}</dd>
            <dt>Terminó</dt><dd>{timeAgo(last.finished_at)}</dd>
            {last.metrics?.wall_time_s && <><dt>Tardó</dt><dd>{Math.round(last.metrics.wall_time_s / 60)} min</dd></>}
          </dl>
        ) : <p className="muted">Sin trabajos todavía.</p>}
        {details?.quota && <QuotaLine quota={details.quota} />}
      </section>
      )}
    </div>
  )
}

function QuotaLine({ quota }: { quota: Record<string, any> }) {
  const used = Number(quota.used ?? quota.units ?? 0)
  const limit = Number(quota.limit ?? 10000)
  return (
    <div className="quota">
      <div className="muted small">Cuota gratuita de YouTube hoy: {used} / {limit}</div>
      <ProgressBar percent={(used / limit) * 100} label="Cuota" />
    </div>
  )
}

const QUEUE_STATUS: Record<string, [string, 'ok' | 'working' | 'warning' | 'error' | 'muted']> = {
  queued: ['En cola', 'working'], awaiting_approval: ['Esperando tu aprobación', 'warning'],
  waiting_auth: ['Falta autorizar YouTube', 'warning'], scheduled: ['Programado', 'ok'], uploaded: ['Subido', 'ok'],
  published: ['Publicado', 'ok'], failed: ['Falló', 'error'], done: ['Hecho', 'ok'],
}

function Queue({ bot, details, reload }: { bot: BotView; details: Details; reload: () => void }) {
  const toast = useToast()
  const { uploads, lastUpload } = useStore()
  const up = uploads[bot.id]
  const last = lastUpload[bot.id]
  const queue = details.queue ?? []
  const pending = queue.filter((q) => ['queued', 'awaiting_approval', 'waiting_auth'].includes(q.status))
  const ready = details.outputs.filter((o) => o.file_exists && !o.in_queue && !o.unlisted)
  const waitingAuth = queue.some((q) => q.status === 'waiting_auth')

  const start = async (dir?: string) => {
    try {
      await api.startUpload(bot.id, dir)
    } catch (e) {
      toast('error', String(e))
    }
    reload()
  }
  const auth = async () => {
    toast('info', 'Se abrirá tu navegador para que autorices a YouTube…')
    const r = await api.run(bot.id, 'auth')
    toast(r.ok ? 'ok' : 'error', r.ok ? 'YouTube autorizado.' : r.message)
  }

  return (
    <div className="stack">
      <section className="panel">
        <header className="section-head">
          <h3>Subida a YouTube</h3>
          <div className="row">
            {waitingAuth && <button className="btn btn--ghost" onClick={auth}><Icon name="key" size={16} /> Autorizar YouTube</button>}
            <button className="btn btn--primary" disabled={!!up || pending.length === 0} onClick={() => start()}>
              <Icon name="upload" size={16} /> Subir la cola ahora
            </button>
          </div>
        </header>
        {up ? (
          <div className="upload-live" data-testid="upload-progress">
            <div className="muted small">Subiendo {up.item ?? '…'}</div>
            <ProgressBar percent={up.percent} label="Subida" />
          </div>
        ) : last?.result && (
          <p className={last.result.ok ? 'ok-text' : 'error-text'}>
            Última subida: {last.result.ok ? 'terminada' : last.result.message}
          </p>
        )}
        {queue.length === 0 ? <p className="muted">La cola está vacía.</p> : (
          <table className="table">
            <thead><tr><th>Vídeo</th><th>Tipo</th><th>Estado</th><th>Publicación</th></tr></thead>
            <tbody>
              {queue.map((q: QueueItem) => {
                const [label, tone] = QUEUE_STATUS[q.status] ?? [q.status, 'muted']
                return (
                  <tr key={q.id}>
                    <td><div className="cell-title">{q.title}</div>{q.error && <div className="error-text small">{q.error}</div>}</td>
                    <td>{q.kind === 'long' ? 'Vídeo' : 'Short'}</td>
                    <td><Pill tone={tone}>{label}</Pill></td>
                    <td className="muted small">{q.video_id ? <span>youtu.be/{q.video_id}</span> : fmtDate(q.publish_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h3>Editados, listos para subir</h3>
        {ready.length === 0 ? <p className="muted">No hay vídeos editados pendientes de subir.</p> : (
          <ul className="list">
            {ready.map((o) => (
              <li key={o.dir}>
                <div>
                  <div className="cell-title">{o.title ?? o.name}</div>
                  <div className="muted small">{o.shorts} Shorts · {timeAgo(o.modified)}</div>
                </div>
                <button className="btn btn--outline" disabled={!!up} onClick={() => start(o.dir)}>
                  <Icon name="upload" size={16} /> Subir
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Se sube como privado y se programa según tu configuración; publicar en público pide tu aprobación.</p>
      </section>
    </div>
  )
}

function Held({ bot, details }: { bot: BotView; details: Details }) {
  const decide = useSignedDecision()
  const hold = Object.entries(details.hold ?? {})
  const failed = Object.entries(details.failures ?? {}).filter(([, f]) => f.failed)
  const supported = bot.commands.includes('aprobar-firmado')
  return (
    <div className="stack">
      <section className="panel">
        <h3>VODs en espera</h3>
        <p className="muted small">El bot no los edita hasta que los liberes (por ejemplo, si no se oía tu micro).</p>
        {hold.length === 0 ? <p className="muted">Ninguno.</p> : (
          <ul className="list">
            {hold.map(([vod, h]) => (
              <li key={vod}>
                <div>
                  <div className="cell-title">{vod}</div>
                  <div className="muted small">{h.reason || 'sin motivo'} · desde {timeAgo(h.since)}</div>
                </div>
                <HoldButton disabled={!supported} onBegin={api.gestureBegin}
                  onComplete={(t) => decide(t, bot.id, 'liberar', vod)}>Liberar</HoldButton>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel">
        <h3>Fallaron 3 veces</h3>
        {failed.length === 0 ? <p className="muted">Ninguno.</p> : (
          <ul className="list">
            {failed.map(([name, f]) => (
              <li key={name}>
                <div>
                  <div className="cell-title">{name}</div>
                  <div className="error-text small">{f.last_error}</div>
                </div>
                <HoldButton tone="ghost" disabled={!supported} onBegin={api.gestureBegin}
                  onComplete={(t) => decide(t, bot.id, 'reintentar', name)}>
                  <Icon name="refresh" size={16} /> Reintentar
                </HoldButton>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Settings({ bot }: { bot: BotView }) {
  return (
    <section className="panel">
      <h3>Ajustes</h3>
      <dl className="kv">
        <dt>Carpeta</dt><dd className="mono">{bot.dir}</dd>
        {bot.task && <><dt>Tarea de Windows</dt><dd className="mono">{bot.task}</dd></>}
        <dt>Comandos</dt><dd>{bot.commands.join(', ')}</dd>
      </dl>
      <p className="muted small">
        En la fase 2 podrás cambiar desde aquí las fuentes, el estilo de edición y las carpetas de assets.
        De momento se cambian en el archivo <span className="mono">config.yaml</span> del bot.
      </p>
    </section>
  )
}

function fileName(p?: string) {
  return p ? p.split(/[\\/]/).pop() : '—'
}

function fmtDate(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
}
