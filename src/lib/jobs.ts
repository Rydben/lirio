// Trabajos largos de un bot en segundo plano: se lanzan, se ve «Analizando… 42 %», no se lanzan dos veces
// y se pueden cancelar. Al volver a la página se recupera cómo iba.
import { useCallback, useEffect, useState } from 'react'
import { api, type JobEvent } from './api'

export function useJob(botId: string, command: string, onDone?: (e: JobEvent) => void) {
  const clave = `${botId}:${command}`
  const [job, setJob] = useState<JobEvent | null>(null)

  useEffect(() => {
    let alive = true
    api.jobsStatus().then((s) => { if (alive && s[clave]) setJob(s[clave]) }).catch(() => {})
    const un = api.onJob((e) => {
      if (e.clave !== clave) return
      setJob(e)
      if (e.hecho) onDone?.(e)
    })
    return () => { alive = false; un.then((f) => f()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const start = useCallback(async (flags: Record<string, unknown>) => {
    setJob({ clave, bot: botId, comando: command, percent: null, etapa: 'Empezando…', hecho: false })
    try {
      await api.jobStart(botId, command, flags)
    } catch (e) {
      setJob({ clave, bot: botId, comando: command, hecho: true, ok: false, mensaje: String(e) })
    }
  }, [botId, command, clave])

  const running = !!job && !job.hecho
  return { job, running, start, cancel: () => api.jobCancel(clave) }
}
