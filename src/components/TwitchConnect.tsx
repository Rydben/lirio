// Conectar con Twitch sin terminal (moderador): Lirio pide un código, el amigo lo escribe en twitch.tv/activate
// con la cuenta que toque (la del bot o la suya) y Lirio espera la confirmación. Nunca se escribe una contraseña.
import { useState } from 'react'
import { api } from '../lib/api'
import { Icon, useToast } from './ui'

export function TwitchConnect({ botId, streamer = false }: { botId: string; streamer?: boolean }) {
  const toast = useToast()
  const [code, setCode] = useState<{ user_code: string; verification_uri?: string; cuenta?: string } | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const begin = async () => {
    setDone(null)
    const r = await api.runWith(botId, 'connect', { '--iniciar': true, '--streamer': streamer })
    if (!r.ok) { toast('error', r.data?.error ?? r.message); return }
    setCode(r.data)
    setWaiting(true)
    const w = await api.runWith(botId, 'connect', { '--esperar': true, '--streamer': streamer })
    setWaiting(false)
    if (w.ok) { setDone(w.data?.bot_login ?? 'conectado'); setCode(null); toast('ok', '¡Conectado con Twitch!') }
    else toast('error', w.data?.error ?? w.message)
  }

  return (
    <div className="twitch-connect">
      {!code && !done && (
        <>
          <p className="muted small">
            {streamer ? 'Conecta tu propio canal (para leer subs, bits y seguidores).'
              : 'Primero crea en Twitch una cuenta para el bot (por ejemplo «tucanal_bot») y entra con ella en el navegador.'}
          </p>
          <button className="btn btn--primary" onClick={begin}><Icon name="key" size={16} /> {streamer ? 'Conectar mi canal' : 'Conectar la cuenta del bot'}</button>
        </>
      )}
      {code && (
        <div className="twitch-connect__code">
          <p>Abre la página de Twitch y escribe este código{code.cuenta ? <> con la cuenta <b>{code.cuenta}</b></> : null}:</p>
          <div className="big-code" aria-label="Código">{code.user_code}</div>
          <button className="btn btn--outline" onClick={() => api.openUrl(code.verification_uri ?? 'https://www.twitch.tv/activate')}>Abrir twitch.tv/activate</button>
          {waiting && <p className="muted small">Esperando a que lo confirmes en Twitch…</p>}
        </div>
      )}
      {done && <p className="ok-text"><Icon name="check" size={16} /> Conectado: {done}</p>}
    </div>
  )
}
