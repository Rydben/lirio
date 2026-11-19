// Respuestas de la CLI de un bot que casi nunca cambian (qué páginas tiene, si sabe de voz…): preguntar lanza su
// Python (~0,5–0,8 s cada vez). Se guardan por bot y versión: la página sale al instante con lo último que se supo,
// y se vuelve a preguntar una sola vez por sesión, en segundo plano.
const mem = new Map<string, unknown>()
const asked = new Set<string>()
const PREFIX = 'lirio.recuerda.'

function read<T>(key: string): T | undefined {
  if (mem.has(key)) return mem.get(key) as T
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw != null) { const v = JSON.parse(raw) as T; mem.set(key, v); return v }
  } catch { /* sin almacenamiento: se pregunta */ }
  return undefined
}

export function remembered<T>(key: string): T | undefined {
  return read<T>(key)
}

/** Devuelve lo guardado (si hay) y, una vez por sesión, pregunta de nuevo y avisa con `onFresh` si cambió. */
export function remember<T>(key: string, ask: () => Promise<T>, onFresh: (v: T) => void): T | undefined {
  const cached = read<T>(key)
  if (!asked.has(key)) {
    asked.add(key)
    // si ya se sabía, se comprueba más tarde para no competir con la página que se está abriendo
    const wait = cached === undefined ? Promise.resolve() : new Promise((r) => setTimeout(r, 4000))
    wait.then(ask).then((v) => {
      mem.set(key, v)
      try { localStorage.setItem(PREFIX + key, JSON.stringify(v)) } catch { /* da igual */ }
      if (JSON.stringify(v) !== JSON.stringify(cached)) onFresh(v)
    }).catch(() => asked.delete(key))
  }
  return cached
}

/** Para las pruebas. */
export function forgetAll() {
  mem.clear()
  asked.clear()
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)) } catch { /* nada */ }
}
