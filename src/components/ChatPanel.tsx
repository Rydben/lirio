// Moderador: bans recientes (con "Deshacer ban" mediante el gesto de 2 s) y lo que el bot ha hecho en el chat y por voz.
import { useCallback, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { useLive } from '../lib/live'
import { HoldButton } from './HoldButton'
import { Icon, Pill, timeAgo, useToast } from './ui'

interface Ban { id: string; at: string; login: string; reason?: string; message?: string; category?: string; immediate?: boolean; undone?: boolean }

export function ChatPanel({ botId }: { botId: string }) {
  const toast = useToast()
  const { refresh } = useStore()
  const [bans, setBans] = useState<Ban[]>([])
  const [actions, setActions] = useState<Record<string, any>[]>([])

  const load = useCallback(() => {
    api.runWith(botId, 'bans-recientes').then((r) => r.ok && setBans(r.data?.bans ?? [])).catch(() => {})
    api.botActions(botId, ['reply', 'voice_command', 'voice_action'], 30).then(setActions).catch(() => {})
  }, [botId])
  // bans-recientes lanza el Python del bot (~0,5 s): cuando el bot cambia algo, como mucho cada 30 s, y cada minuto por si acaso
  useLive(load, [botId], 60_000, 30_000)

  /** Deshacer = pedir la solicitud de unban al bot y aprobarla firmada con el gesto (como cualquier aprobación). */
  const undo = async (token: string, login: string) => {
    const req = await api.runWith(botId, 'deshacer', { '--solicitar': login })
    const s = req.data?.solicitud
    if (!req.ok || !s) { toast('error', req.data?.error ?? req.message); return }
    const r = await api.signedDecision(token, botId, 'approve', s.id, s.action, s.key)
    toast(r.ok ? 'ok' : 'error', r.ok ? `Ban de ${login} deshecho.` : r.message)
    load(); refresh()
  }

  return (
    <div className="grid-2">
      <section className="panel">
        <h3><Icon name="shield" size={18} /> Bans recientes</h3>
        {bans.length === 0 ? <p className="muted">Ninguno.</p> : (
          <ul className="list">
            {bans.map((b) => (
              <li key={b.id}>
                <div>
                  <div className="cell-title">{b.login} {b.undone && <Pill tone="muted">deshecho</Pill>}</div>
                  <div className="muted small">{timeAgo(b.at)} · {b.reason ?? b.category ?? ''}</div>
                  {b.message && <div className="small">«{b.message}»</div>}
                </div>
                {!b.undone && (
                  <HoldButton tone="ghost" onBegin={api.gestureBegin} onComplete={(t) => undo(t, b.login)}
                    title="Mantén pulsado 2 segundos para quitar el ban">Deshacer ban</HoldButton>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Deshacer un ban queda registrado como corrección tuya: el bot aprende de ello.</p>
      </section>
      <section className="panel">
        <h3><Icon name="clock" size={18} /> Lo que ha hecho el bot</h3>
        {actions.length === 0 ? <p className="muted">Todavía nada.</p> : (
          <ul className="activity">
            {actions.map((a, i) => (
              <li key={i}>
                <span className={`activity__icon activity__icon--${a.type === 'reply' ? 'violet' : 'blue'}`}>
                  <Icon name={a.type === 'reply' ? 'heart' : 'play'} size={18} />
                </span>
                <div>
                  {a.type === 'reply' ? (
                    <>
                      <div className="activity__name">Respondió a {a.user}</div>
                      <div className="muted small">«{a.question}» → «{a.answer}»</div>
                    </>
                  ) : (
                    <>
                      <div className="activity__name">{a.type === 'voice_action' ? 'Hizo por voz' : 'Orden de voz'}: {a.command ?? a.action ?? '—'}</div>
                      <div className="muted small">{a.heard ? `«${a.heard}»` : ''}{a.is_streamer === false ? ' · no era tu voz' : ''}</div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
