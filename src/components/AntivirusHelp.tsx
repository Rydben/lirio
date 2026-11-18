// Ayuda con el antivirus (Norton y otros): Lirio no tiene firma de pago de Windows (Authenticode), así que algunos
// antivirus desconfían de lirio.exe o del Python privado de cada bot y los ponen en cuarentena.
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Icon, useToast } from './ui'

export function AntivirusHelp({ open: startOpen = false }: { open?: boolean }) {
  const toast = useToast()
  const [open, setOpen] = useState(startOpen)
  const [paths, setPaths] = useState<{ programa: string; datos: string } | null>(null)
  useEffect(() => { api.helpPaths().then(setPaths).catch(() => {}) }, [])
  useEffect(() => { if (startOpen) setOpen(true) }, [startOpen])

  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('ok', 'Copiado. Pégalo en tu antivirus.'))

  return (
    <section className="panel" id="ayuda-antivirus">
      <div className="section-head">
        <h3><Icon name="shield" size={18} /> Ayuda con el antivirus</h3>
        <button className="btn btn--ghost" onClick={() => setOpen((o) => !o)}>{open ? 'Ocultar' : 'Ver los pasos'}</button>
      </div>
      <p className="muted small">
        Si Lirio se cierra solo o un bot dice que le faltan archivos, casi siempre es el antivirus: Lirio es gratis y no
        paga la firma de Microsoft, y antivirus como Norton desconfían de programas nuevos sin firma.
      </p>
      {open && (
        <div className="stack">
          <div>
            <b>Estas son las carpetas de Lirio en este PC</b>
            {paths ? (
              <ul className="list">
                {[['Programa', paths.programa], ['Datos y bots', paths.datos]].map(([k, v]) => (
                  <li key={k}><div><div className="cell-title">{k}</div><code className="small">{v}</code></div>
                    <button className="btn btn--ghost" onClick={() => copy(v)}>Copiar</button></li>
                ))}
              </ul>
            ) : <p className="muted small">Cargando…</p>}
          </div>
          <div>
            <b>En Norton (Norton 360 / Norton AntiVirus Plus)</b>
            <ol className="small">
              <li>Abre Norton → <b>Seguridad</b> → <b>Historial</b>. Arriba, en «Mostrar», elige <b>Cuarentena</b>.</li>
              <li>Si ves <code>lirio.exe</code>, <code>python.exe</code> o <code>pythonw.exe</code>: selecciónalo →
                <b> Opciones</b> → <b>Restaurar y excluir este archivo</b>.</li>
              <li>Vuelve a Norton → <b>Configuración</b> → <b>Antivirus</b> → pestaña <b>Análisis y riesgos</b>.</li>
              <li>En <b>Exclusiones / Bajo riesgo</b>, pulsa <b>Configurar</b> en «Elementos que se excluirán de los análisis»
                → <b>Agregar carpetas</b> y pega las dos carpetas de arriba (marca «Incluir subcarpetas»).</li>
              <li>Haz lo mismo en «Elementos que se excluirán de la detección de Auto-Protect, SONAR y Download
                Intelligence». Pulsa <b>Aplicar</b>.</li>
              <li>Abre Lirio otra vez. Si un bot sigue diciendo que le faltan archivos, vuelve a instalarlo desde el
                asistente: continúa donde se quedó.</li>
            </ol>
          </div>
          <p className="muted small">
            En otros antivirus (Avast, AVG, McAfee, Bitdefender…) es parecido: busca «Cuarentena» para restaurar y
            «Exclusiones» o «Excepciones» para añadir las dos carpetas. Excluir solo estas carpetas no desactiva tu
            antivirus para nada más.
          </p>
        </div>
      )}
    </section>
  )
}
