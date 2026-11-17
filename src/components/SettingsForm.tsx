// Ajustes de un bot sin tocar config.yaml: el formulario se genera con el esquema que declara el propio bot
// (`ajustes-esquema`). El bot valida y guarda; nunca incluye permisos, The Wall ni secretos.
import { useEffect, useMemo, useState } from 'react'
import { api, type SettingsField, type SettingsSchema } from '../lib/api'
import { Icon, useToast } from './ui'

type Values = Record<string, unknown>

/** Solo lo que ha cambiado respecto a lo guardado (lo que se manda al bot). */
export function changedValues(original: Values, current: Values): Values {
  const out: Values = {}
  for (const [k, v] of Object.entries(current)) {
    if (JSON.stringify(v) !== JSON.stringify(original[k])) out[k] = v
  }
  return out
}

/** Validación rápida en pantalla (el bot vuelve a validar al guardar). */
export function fieldError(f: SettingsField, v: unknown): string | null {
  if ((f.tipo === 'numero' || f.tipo === 'entero') && v !== '' && v !== null && v !== undefined) {
    const n = Number(v)
    if (Number.isNaN(n)) return 'Tiene que ser un número'
    if (f.tipo === 'entero' && !Number.isInteger(n)) return 'Sin decimales'
    if (f.min !== undefined && n < f.min) return `Mínimo ${f.min}`
    if (f.max !== undefined && n > f.max) return `Máximo ${f.max}`
  }
  if (f.tipo === 'hora' && typeof v === 'string' && v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return 'Formato HH:MM'
  return null
}

export function SettingsForm({ botId }: { botId: string }) {
  const toast = useToast()
  const [schema, setSchema] = useState<SettingsSchema | null>(null)
  const [saved, setSaved] = useState<Values>({})
  const [values, setValues] = useState<Values>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    const [s, v] = await Promise.all([api.runWith(botId, 'ajustes-esquema'), api.runWith(botId, 'ajustes')])
    if (!s.ok || !v.ok) { setLoadError(s.ok ? v.message : s.message); return }
    setSchema(s.data)
    setSaved(v.data.valores ?? {})
    setValues(v.data.valores ?? {})
  }
  useEffect(() => { load().catch((e) => setLoadError(String(e))) }, [botId])

  const changes = useMemo(() => changedValues(saved, values), [saved, values])
  const fields = schema?.grupos.flatMap((g) => g.campos) ?? []
  const localErrors = Object.fromEntries(fields.map((f) => [f.clave, fieldError(f, values[f.clave])]).filter(([, e]) => e))

  const save = async () => {
    setBusy(true)
    try {
      const r = await api.saveSettings(botId, changes)
      if (r.ok) {
        toast('ok', r.data?.reiniciar ? 'Guardado. Se aplicará cuando el bot se reinicie (Parar y Arrancar).' : 'Guardado.')
        setErrors({})
        await load()
      } else {
        setErrors(r.data?.errores ?? {})
        toast('error', r.data?.errores ? 'Revisa los campos marcados.' : r.message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <section className="panel"><p className="error-text">No pude leer los ajustes: {loadError}</p></section>
  if (!schema) return <section className="panel"><p className="muted">Cargando ajustes…</p></section>

  return (
    <div className="stack">
      {schema.grupos.map((g) => {
        const visible = g.campos.filter((f) => advanced || !f.avanzado)
        if (!visible.length) return null
        return (
          <section key={g.id} className="panel">
            <h3>{g.titulo}</h3>
            <div className="form-grid">
              {visible.map((f) => (
                <Field key={f.clave} f={f} value={values[f.clave]} error={errors[f.clave] ?? localErrors[f.clave] ?? null}
                  onChange={(v) => setValues((s) => ({ ...s, [f.clave]: v }))} />
              ))}
            </div>
          </section>
        )
      })}
      <div className="save-bar">
        <label className="check"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} /> Mostrar ajustes avanzados</label>
        <span className="muted small">{Object.keys(changes).length ? `${Object.keys(changes).length} cambios sin guardar` : 'Sin cambios'}</span>
        <button className="btn btn--ghost" disabled={!Object.keys(changes).length || busy} onClick={() => setValues(saved)}>Deshacer</button>
        <button className="btn btn--primary" disabled={!Object.keys(changes).length || busy || Object.keys(localErrors).length > 0} onClick={save}>
          <Icon name="check" size={16} /> {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

function Field({ f, value, error, onChange }: { f: SettingsField; value: unknown; error: string | null; onChange: (v: unknown) => void }) {
  const id = `campo-${f.clave}`
  const input = (() => {
    switch (f.tipo) {
      case 'booleano':
        return <label className="check"><input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {f.titulo}</label>
      case 'opcion':
        return (
          <select id={id} className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {(f.opciones ?? []).map((o) => {
              const [val, label] = typeof o === 'object' ? [o.valor, o.titulo] : [o, o]
              return <option key={String(val)} value={String(val)}>{String(label)}</option>
            })}
          </select>
        )
      case 'numero': case 'entero':
        return <input id={id} className="input" type="number" min={f.min} max={f.max} step={f.tipo === 'entero' ? 1 : 'any'}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      case 'lista':
        return <input id={id} className="input" value={Array.isArray(value) ? value.join(', ') : ''} placeholder="separado por comas"
          onChange={(e) => onChange(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
      case 'carpeta': case 'archivo':
        return (
          <div className="row">
            <input id={id} className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
            <button className="btn btn--ghost" onClick={async () => {
              const p = f.tipo === 'carpeta' ? await api.pickFolder(f.titulo) : await api.pickJson(f.titulo)
              if (p) onChange(p)
            }}>Elegir…</button>
          </div>
        )
      case 'color':
        return <input id={id} type="color" value={String(value ?? '#000000')} onChange={(e) => onChange(e.target.value)} />
      case 'hora':
        return <input id={id} className="input" type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      default:
        return <input id={id} className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    }
  })()
  return (
    <div className={`form-field${error ? ' has-error' : ''}`}>
      {f.tipo !== 'booleano' && <label htmlFor={id} className="form-field__label">{f.titulo}</label>}
      {input}
      {f.ayuda && <div className="muted small">{f.ayuda}</div>}
      {error && <div className="error-text small">{error}</div>}
    </div>
  )
}
