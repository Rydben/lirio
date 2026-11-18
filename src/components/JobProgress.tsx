// Barra de un trabajo largo en segundo plano: etapa, porcentaje y Cancelar.
import type { JobEvent } from '../lib/api'
import { ProgressBar } from './ui'

export function JobProgress({ job, label, onCancel }: { job: JobEvent | null; label: string; onCancel?: () => void }) {
  if (!job) return null
  if (job.hecho) {
    if (job.cancelado) return <p className="muted small">Cancelado.</p>
    return job.ok ? null : <p className="error-text small">No se pudo: {job.resultado?.error ?? job.mensaje}</p>
  }
  return (
    <div className="job">
      <div className="job__head">
        <span className="muted small">{job.etapa ?? 'Trabajando…'}{typeof job.percent === 'number' ? ` · ${job.percent} %` : ''}</span>
        {onCancel && <button className="btn btn--ghost" onClick={onCancel}>Cancelar</button>}
      </div>
      <ProgressBar percent={job.percent ?? 0} label={label} />
      <p className="muted small">Puedes seguir usando Lirio mientras tanto.</p>
    </div>
  )
}
