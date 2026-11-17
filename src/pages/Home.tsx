// Página de inicio (maqueta): bienvenida con el avatar, tus bots, actividad, pendientes, estado y accesos.
import { useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ScreenFace } from '../components/Face'
import { api, type ActivityItem, type BotView } from '../lib/api'
import { moodFor, stateLabel, stateTone } from '../lib/mood'
import { useStore } from '../lib/store'
import { Icon, Pill, ProgressBar, timeAgo, useToast } from '../components/ui'
import type { Page } from '../App'

const CARD_STYLE: Record<string, { tone: string; icon: string }> = {
  'twitch-autoeditor': { tone: 'violet', icon: 'film' },
  'thumbnail-bot': { tone: 'blue', icon: 'image' },
  'twitch-moderator': { tone: 'green', icon: 'shield' },
}

export function botSummary(b: BotView): string {
  const s = b.status ?? {}
  if (b.stop_active) return 'Parado con STOP'
  if (s.current_job) return `Editando: ${s.current_job.stage ?? '…'} ${s.current_job.percent ?? 0}%`
  if (b.id === 'thumbnail-bot') return 'Lo usa el bot de vídeo en cada edición'
  if (b.id === 'twitch-moderator') {
    if (b.state === 'watching') return s.live ? 'En directo: moderando el chat' : 'Esperando a que empieces el directo'
  }
  if (b.state === 'watching') return 'Vigilando nuevos directos'
  if (b.state === 'stopped' && b.state_note) return `Parado: ${b.state_note}.`
  if (b.state === 'stopped' || b.state === 'idle') return 'Parado. Pulsa Arrancar en su página para ponerlo en marcha.'
  if (b.state === 'crashed') return 'Se cerró sin avisar. Mira su página.'
  if (b.state === 'needs_login') return 'Claude necesita que inicies sesión.'
  return b.description ?? ''
}

export function Home({ go }: { go: (p: Page) => void }) {
  const { overview, uploads } = useStore()
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const toast = useToast()

  useEffect(() => {
    const load = () => api.activity().then(setActivity).catch(() => {})
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  const bots = overview?.modules ?? []
  const mood = moodFor(bots, Object.keys(uploads).length > 0)
  const pending = bots.flatMap((b) => b.approvals_pending.map((a) => ({ b, a })))
  const main = bots.filter((b) => !b.parent)
  const running = main.filter((b) => (b.state === 'watching' || b.state === 'running') && !b.stop_active).length

  const stopAll = async () => {
    for (const b of main) await api.killSwitchOn(b.id).catch(() => {})
    toast('info', 'He puesto STOP a todos los bots. Terminan lo que estaban haciendo y se paran.')
  }

  return (
    <div className="home">
      <div className="home__main">
        <section className="banner">
          <div className="banner__text">
            <h1>¡Bienvenido, <span className="accent">{overview?.usuario ?? '…'}</span>!</h1>
            <p>¿Qué quieres hacer hoy?</p>
            <button className="btn btn--outline" onClick={() => go({ kind: 'bot', id: 'twitch-autoeditor' })}>
              <Icon name="play" size={16} /> Abrir el bot de vídeo <Icon name="chevron" size={16} />
            </button>
          </div>
          <div className="banner__art" aria-hidden>
            <div className="banner__city" />
            <Avatar expression={mood.expression} height={380} working={mood.level === 'working'} />
          </div>
        </section>

        <section>
          <header className="section-head">
            <h2><Icon name="grid" /> Tus bots</h2>
            <span className="muted">{running} de {main.length} en marcha en este PC</span>
          </header>
          <div className="bot-cards">
            {bots.map((b) => {
              const style = CARD_STYLE[b.id] ?? { tone: 'orange', icon: 'bolt' }
              const up = uploads[b.id]
              return (
                <button key={b.id} className={`bot-card bot-card--${style.tone}`} onClick={() => go({ kind: 'bot', id: b.id })}>
                  <div className="bot-card__icon"><Icon name={style.icon} size={30} /></div>
                  <div className="bot-card__bg"><Icon name={style.icon} size={120} /></div>
                  <div className="bot-card__name">{b.name}</div>
                  <div className="bot-card__desc">{botSummary(b)}</div>
                  {up && <ProgressBar percent={up.percent} label="Subida" />}
                  <div className="bot-card__foot">
                    <Pill tone={stateTone(b)}>{stateLabel(b)}</Pill>
                    <span className="round-arrow"><Icon name="arrow" size={16} /></span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <div className="home__bottom">
          <section className="panel">
            <header className="section-head">
              <h2><Icon name="clock" /> Actividad reciente</h2>
            </header>
            {activity.length === 0 && <p className="muted">Todavía no hay actividad.</p>}
            <ul className="activity">
              {activity.slice(0, 5).map((it, i) => (
                <li key={i}>
                  <span className={`activity__icon activity__icon--${it.ok ? CARD_STYLE[it.module]?.tone ?? 'violet' : 'red'}`}>
                    <Icon name={it.kind === 'wall' ? 'shield' : CARD_STYLE[it.module]?.icon ?? 'bolt'} size={18} />
                  </span>
                  <div>
                    <div className="activity__name">{it.name}</div>
                    <div className="muted small">{timeAgo(it.at)} · {it.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <header className="section-head">
              <h2><Icon name="shield" /> Pendiente de ti</h2>
              {pending.length > 0 && <button className="link" onClick={() => go({ kind: 'approvals' })}>Ver todo <Icon name="arrow" size={14} /></button>}
            </header>
            {pending.length === 0 ? (
              <div className="empty-ok">
                <ScreenFace expression="guino" size={64} />
                <div>
                  <div className="activity__name">Nada que aprobar</div>
                  <div className="muted small">Cuando un bot necesite tu permiso, aparecerá aquí.</div>
                </div>
              </div>
            ) : (
              <ul className="activity">
                {pending.slice(0, 4).map(({ b, a }) => (
                  <li key={a.id}>
                    <span className="activity__icon activity__icon--orange"><Icon name="alert" size={18} /></span>
                    <div>
                      <div className="activity__name">{b.name}</div>
                      <div className="muted small">{a.action} · {timeAgo(a.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <aside className="home__side">
        <section className="panel">
          <header className="section-head">
            <h2><span className={`dot dot--${mood.level}`} /> Estado del asistente</h2>
          </header>
          <div className="assistant-state" data-testid="assistant-state">
            <ScreenFace expression={mood.expression} size={56} />
            <div>
              <div className="activity__name">{mood.title}</div>
              <div className="muted small">{mood.detail}</div>
            </div>
          </div>
        </section>
        <section className="panel">
          <header className="section-head"><h2><Icon name="bolt" /> Accesos rápidos</h2></header>
          <nav className="quick">
            <button onClick={() => go({ kind: 'approvals' })}><Icon name="check" /> Aprobaciones {pending.length > 0 && <span className="badge">{pending.length}</span>}<Icon name="chevron" size={16} /></button>
            <button onClick={() => go({ kind: 'bot', id: 'twitch-autoeditor', tab: 'cola' })}><Icon name="upload" /> Cola de subida<Icon name="chevron" size={16} /></button>
            <button onClick={() => go({ kind: 'bot', id: 'twitch-autoeditor', tab: 'espera' })}><Icon name="pause" /> Vídeos en espera<Icon name="chevron" size={16} /></button>
            <button onClick={() => go({ kind: 'settings' })}><Icon name="settings" /> Configuración<Icon name="chevron" size={16} /></button>
            <button className="quick--danger" onClick={stopAll}><Icon name="stop" /> Parar todos los bots<Icon name="chevron" size={16} /></button>
          </nav>
        </section>
        <section className="panel panel--free">
          <div className="free">
            <Icon name="heart" size={22} />
            <div>
              <div className="activity__name">Gratis, para siempre</div>
              <div className="muted small">Lirio y tus bots no cuestan nada extra: sin APIs ni planes de pago.</div>
            </div>
          </div>
        </section>
      </aside>
    </div>
  )
}
