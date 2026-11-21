// «Editar vídeos locales»: eliges (o arrastras) un vídeo de tu PC y el editor lo edita como un directo de Twitch.
// - Usa el `editar <ruta>` del editor: vuelve al momento (lo pone en su cola o lo empieza en segundo plano) y el
//   avance sale en su estado, así que la ventana nunca se queda parada.
// - Nunca sube nada solo: el vídeo hecho pasa por Aprobaciones como los demás.
// - Tu archivo no se mueve ni se borra: el editor solo limpia lo que hay en su carpeta de descargas.
import { useEffect, useState } from 'react'
import { api, inTauri, type BotView } from '../lib/api'
import { jobDetail, stageName } from '../lib/progress'
import { Icon, ProgressBar, useToast } from './ui'

export const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'm4v', 'webm', 'ts']

export function isVideo(p: string) {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_EXT.includes(ext)
}

const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase()
const base = (p: string) => p.split(/[\\/]/).pop() ?? p

export function LocalEditPanel({ bot }: { bot: BotView }) {
  const toast = useToast()
  const [file, setFile] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [yaEditado, setYaEditado] = useState(false)
  const [over, setOver] = useState(false)

  const pick = (p: string) => {
    if (!isVideo(p)) { toast('error', `Ese archivo no es un vídeo (${VIDEO_EXT.join(', ')}).`); return }
    setFile(p); setMsg(null); setYaEditado(false)
  }

  // arrastrar y soltar: en Lirio la ventana da la ruta real del archivo
  useEffect(() => {
    if (!inTauri()) return
    let un: (() => void) | undefined
    let alive = true
    import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload
      if (p.type === 'over' || p.type === 'enter') setOver(true)
      else if (p.type === 'leave') setOver(false)
      else if (p.type === 'drop') { setOver(false); const v = p.paths.find(isVideo); if (v) pick(v); else if (p.paths.length) toast('error', 'Suelta un archivo de vídeo.') }
    })).then((f) => { if (alive) un = f; else f() }).catch(() => {})
    return () => { alive = false; un?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = async () => {
    const p = await api.pickVideo('Elige el vídeo que quieres editar')
    if (p) pick(p)
  }

  const edit = async (rehacer = false) => {
    if (!file) return
    setBusy(true)
    const r = await api.runWith(bot.id, 'editar', rehacer ? { '@que': file, '--rehacer': true } : { '@que': file })
    setBusy(false)
    if (r.ok) {
      setYaEditado(false)
      setMsg(r.data?.mensaje ?? 'El editor se pone con él.')
      toast('ok', 'El editor se pone con tu vídeo. No se subirá nada sin tu aprobación.')
    } else if (r.data?.ya_editado) {
      setYaEditado(true)
      setMsg('Ese vídeo ya está editado. Puedes hacer otra versión (la anterior no se borra).')
    } else {
      toast('error', r.data?.error ?? r.message)
    }
  }

  const cancel = async () => {
    if (!file) return
    const r = await api.runWith(bot.id, 'editar-cancelar', { '@que': file })
    if (r.ok) { toast('info', r.data?.mensaje ?? 'Cancelado.'); setMsg(null) }
    else if (/no tiene el comando|invalid choice|argument cmd/i.test(String(r.data?.error ?? r.message))) {
      toast('info', 'Este editor aún no sabe cancelar solo un vídeo: usa «Parar» arriba (termina la etapa en curso).')
    } else toast('error', r.data?.error ?? r.message)
  }

  const s = bot.status ?? {}
  const job = s.current_job
  const mineNow = !!file && !!job?.source && norm(String(job.source)) === norm(file)
  const queued = !!file && Array.isArray(s.cola_editar) &&
    s.cola_editar.some((q: any) => norm(String(q?.video ?? q)) === norm(file))

  return (
    <section className={`panel local-edit${over ? ' is-over' : ''}`} data-testid="editar-locales">
      <h3><Icon name="film" size={18} /> Editar vídeos locales</h3>
      <p className="muted small">
        Elige o arrastra aquí un vídeo de tu PC ({VIDEO_EXT.join(', ')}) y el editor lo edita como un directo.
        Tu archivo no se mueve ni se borra, y no se sube nada sin tu aprobación.
      </p>
      <div className="row">
        <button className="btn btn--outline" onClick={choose}><Icon name="upload" size={16} /> Elegir vídeo…</button>
        {file && <span className="small" title={file}>{base(file)}</span>}
      </div>
      {file && !mineNow && !queued && (
        <div className="row">
          {!yaEditado && <button className="btn btn--primary" disabled={busy} onClick={() => edit()}>
            <Icon name="play" size={16} /> {busy ? 'Un momento…' : 'Editar este vídeo'}</button>}
          {yaEditado && <button className="btn btn--primary" disabled={busy} onClick={() => edit(true)}>Hacer otra versión</button>}
        </div>
      )}
      {mineNow && (
        <div>
          <p className="small"><b>{stageName(job.stage)}</b></p>
          <ProgressBar percent={job.percent ?? 0} label={stageName(job.stage)} />
          {jobDetail(job) && <p className="muted small">{jobDetail(job)}</p>}
        </div>
      )}
      {queued && <p className="small">En la cola del editor: empieza en cuanto termine lo que está haciendo.</p>}
      {(mineNow || queued) && <button className="btn btn--ghost" onClick={cancel}>Cancelar</button>}
      {msg && <p className="muted small">{msg}</p>}
    </section>
  )
}
