// "Acelerar con tu gráfica NVIDIA": las librerías de GPU (cuDNN, cuBLAS) son un paso aparte y opcional.
// El bot funciona en CPU desde el primer momento; esto solo lo hace más rápido.
import { useEffect, useState } from 'react'
import { api, type GpuEvent, type GpuStatus } from '../lib/api'
import { Icon, ProgressBar, useToast } from './ui'

export function GpuPanel({ botId }: { botId: string }) {
  const toast = useToast()
  const [st, setSt] = useState<GpuStatus | null>(null)
  const [ev, setEv] = useState<GpuEvent | null>(null)

  useEffect(() => {
    api.gpuStatus(botId).then((s) => { setSt(s); if (s.progreso) setEv(s.progreso) }).catch(() => {})
    const un = api.onGpu((e) => {
      if (e.bot !== botId) return
      setEv((prev) => ({ ...e, percent: e.percent ?? (e.hecho ? null : prev?.percent ?? null) }))
      if (e.hecho) {
        toast(e.ok ? 'ok' : 'error', e.ok ? 'Listo: el bot ya usa tu gráfica NVIDIA.' : `No se pudo: ${e.error}`)
        api.gpuStatus(botId).then(setSt).catch(() => {})
      }
    })
    return () => { un.then((f) => f()) }
  }, [botId, toast])

  if (!st || !st.declara || !st.nvidia) return null
  const running = ev && !ev.hecho
  if (st.instalado && !running) return null

  return (
    <section className="panel">
      <h3><Icon name="bolt" size={18} /> Acelerar con tu gráfica NVIDIA</h3>
      <p className="muted small">
        El bot ya funciona con el procesador. Con estas librerías de NVIDIA (unos 1,5 GB) transcribe mucho más rápido.
        Es opcional y puedes seguir usando el bot mientras se instala.
      </p>
      {running ? (
        <>
          <div className="muted small">{ev!.detalle}</div>
          <ProgressBar percent={ev!.percent ?? 0} label="Librerías de la gráfica" />
        </>
      ) : (
        <>
          {ev?.hecho && !ev.ok && <p className="warn small">La última vez falló: {ev.error}. Puedes reintentarlo: sigue donde se quedó.</p>}
          <button className="btn btn--primary" onClick={() => api.installGpu(botId).catch((e) => toast('error', String(e)))}>
            Instalar ahora
          </button>
        </>
      )}
    </section>
  )
}
