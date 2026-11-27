// Voz del narrador del editor: ~115 MB que no van en el instalador. Botón con progreso real (reanudable y comprobado).
// Sin ella, el editor narra solo con tarjetas de texto.
import { useEffect, useState } from 'react'
import { api, type NarratorVoiceEvent } from '../lib/api'
import { human } from './units'
import { Icon, ProgressBar, useToast } from './ui'

export function NarratorVoicePanel({ botId }: { botId: string }) {
  const toast = useToast()
  const [st, setSt] = useState<{ instalada: boolean; bytes: number; descargando: boolean } | null>(null)
  const [ev, setEv] = useState<NarratorVoiceEvent | null>(null)

  const load = () => api.narratorVoiceStatus(botId).then(setSt).catch(() => setSt(null))
  useEffect(() => {
    void load()
    const un = api.onNarratorVoice((e) => {
      setEv(e)
      if (e.hecho) {
        toast(e.ok ? 'ok' : 'error', e.ok ? 'Voz del narrador lista.' : `No se pudo bajar la voz: ${e.error ?? 'error'}`)
        void load()
      }
    })
    return () => { void un.then((f) => f()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId])

  if (!st) return null
  const running = st.descargando || (!!ev && !ev.hecho)
  const start = async () => {
    try { setEv({ hecho: false, percent: 0, detalle: 'Empezando…' }); await api.narratorVoiceInstall(botId) }
    catch (e) { setEv(null); toast('error', String(e)) }
  }
  return (
    <section className="panel" data-testid="voz-narrador">
      <h3><Icon name="play" size={18} /> Voz del narrador</h3>
      {st.instalada ? (
        <p className="ok-text small">Instalada. En los ajustes del narrador, elige el motor «kokoro» para que hable con esta voz.</p>
      ) : (
        <>
          <p className="muted small">
            El narrador puede hablar con una voz local y gratis (Kokoro, licencia Apache 2.0). Pesa {human(st.bytes)} y no va
            en el instalador. Sin ella, el narrador sale solo con tarjetas de texto.
          </p>
          {!running && <button className="btn btn--outline" onClick={start}><Icon name="upload" size={16} /> Descargar voz del narrador</button>}
          {running && (
            <div>
              <ProgressBar percent={ev?.percent ?? 0} label="Descargando la voz" />
              {ev?.detalle && <p className="muted small">{ev.detalle}</p>}
              <button className="btn btn--ghost" onClick={() => api.narratorVoiceCancel()}>Cancelar</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
