// Estado compartido: resumen de bots (se refresca solo) y subidas en curso (eventos en tiempo real).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type Overview, type UploadEvent } from './api'

interface Store {
  overview: Overview | null
  error: string | null
  refresh: () => Promise<void>
  uploads: Record<string, UploadEvent>
  lastUpload: Record<string, UploadEvent>
}

const Ctx = createContext<Store | null>(null)
export const REFRESH_MS = 3000

export function StoreProvider({ children, onUploadDone }: { children: ReactNode; onUploadDone?: (e: UploadEvent) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<Record<string, UploadEvent>>({})
  const [lastUpload, setLastUpload] = useState<Record<string, UploadEvent>>({})
  const doneCb = useRef(onUploadDone)
  doneCb.current = onUploadDone

  const refresh = useCallback(async () => {
    try {
      setOverview(await api.overview())
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    const un = api.onUpload((e) => {
      if (e.done) {
        setUploads(({ [e.module]: _, ...rest }) => rest)
        setLastUpload((l) => ({ ...l, [e.module]: e }))
        doneCb.current?.(e)
        refresh()
      } else {
        setUploads((u) => ({ ...u, [e.module]: e }))
      }
    })
    return () => { un.then((f) => f()) }
  }, [refresh])

  return <Ctx.Provider value={{ overview, error, refresh, uploads, lastUpload }}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore fuera de StoreProvider')
  return s
}
