// Estructura de Lirio: menú lateral, barra superior (búsqueda y botones de ventana) y la página activa.
import { useEffect, useMemo, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ApprovalCard } from './components/Approvals'
import { LirioLogo } from './components/LirioLogo'
import { ScreenFace } from './components/Face'
import { Icon, ToastProvider, useToast } from './components/ui'
import { api, inTauri, type UploadEvent } from './lib/api'
import { moodFor } from './lib/mood'
import { StoreProvider, useStore } from './lib/store'
import { BotPage, type BotTab } from './pages/BotPage'
import { Home } from './pages/Home'
import { JournalPage } from './pages/JournalPage'
import { Welcome } from './pages/Welcome'
import { SettingsPage } from './pages/SettingsPage'

export type Page =
  | { kind: 'home' }
  | { kind: 'bot'; id: string; tab?: BotTab }
  | { kind: 'approvals' }
  | { kind: 'settings' }
  | { kind: 'journal' }

const BOT_ICONS: Record<string, string> = { 'twitch-autoeditor': 'film', 'thumbnail-bot': 'image', 'twitch-moderator': 'shield' }

export default function App() {
  return (
    <ToastProvider>
      <WithStore />
    </ToastProvider>
  )
}

function WithStore() {
  const toast = useToast()
  const done = (e: UploadEvent) => {
    if (e.result?.ok) toast('ok', 'Subida terminada.')
    else toast('error', `La subida no terminó: ${e.result?.message ?? 'error'}`)
  }
  return <StoreProvider onUploadDone={done}><Shell /></StoreProvider>
}

/** "#bot/twitch-autoeditor/cola" <-> página (recuerda dónde estabas y permite abrir Lirio en una página). */
export function pageFromHash(hash: string): Page {
  const [kind, id, tab] = hash.replace(/^#\/?/, '').split('/')
  if (kind === 'bot' && id) return { kind: 'bot', id, tab: (tab || undefined) as BotTab | undefined }
  if (kind === 'approvals' || kind === 'settings' || kind === 'journal') return { kind }
  return { kind: 'home' }
}

export function hashFromPage(p: Page): string {
  return p.kind === 'bot' ? `#bot/${p.id}${p.tab ? `/${p.tab}` : ''}` : `#${p.kind}`
}

function samePage(a: Page, b: Page) {
  return a.kind === b.kind && (a.kind !== 'bot' || (b.kind === 'bot' && a.id === b.id))
}

function Shell() {
  const [welcome, setWelcome] = useState<boolean | null>(null)
  useEffect(() => { api.firstRun().then(setWelcome).catch(() => setWelcome(false)) }, [])
  if (welcome === null) return <div className="app app--loading" />
  if (welcome) return <><Welcome onFinish={() => setWelcome(false)} /><div className="welcome__winbtns"><WindowButtons /></div></>
  return <Main />
}

function Main() {
  const [page, setPage] = useState<Page>(() => pageFromHash(window.location.hash))
  useEffect(() => {
    const onHash = () => setPage(pageFromHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    api.startPage().then((p) => { if (p) setPage(pageFromHash(`#${p}`)) }).catch(() => {})
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const [query, setQuery] = useState('')
  const { overview, error, uploads } = useStore()
  const bots = useMemo(() => overview?.modules ?? [], [overview])
  const mood = moodFor(bots, Object.keys(uploads).length > 0)
  const pendingCount = bots.reduce((n, b) => n + b.approvals_pending.length, 0)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const pages: { label: string; page: Page }[] = [
      { label: 'Inicio', page: { kind: 'home' } },
      { label: 'Aprobaciones', page: { kind: 'approvals' } },
      { label: 'Configuración', page: { kind: 'settings' } },
      { label: 'Diario', page: { kind: 'journal' } },
      { label: 'Cola de subida', page: { kind: 'bot', id: 'twitch-autoeditor', tab: 'cola' } },
      { label: 'Vídeos en espera', page: { kind: 'bot', id: 'twitch-autoeditor', tab: 'espera' } },
      ...bots.map((b) => ({ label: b.name, page: { kind: 'bot', id: b.id } as Page })),
    ]
    return pages.filter((p) => p.label.toLowerCase().includes(q)).slice(0, 6)
  }, [query, bots])

  const go = (p: Page) => {
    setPage(p)
    setQuery('')
    history.replaceState(null, '', hashFromPage(p))
  }
  const navBtn = (p: Page, icon: string, label: string, extra = '', badge = 0) => (
    <button className={`${samePage(page, p) ? 'is-active' : ''}${extra}`} onClick={() => go(p)}>
      <Icon name={icon} /> <span>{label}</span> {badge > 0 && <span className="badge">{badge}</span>}
    </button>
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__logo"><LirioLogo size={60} /></div>
          <div className="brand__name">Lirio</div>
          <div className="brand__tag">Tus bots, a un clic</div>
        </div>
        <nav className="nav">
          {navBtn({ kind: 'home' }, 'home', 'Inicio')}
          {bots.map((b) => (
            <span key={b.id}>{navBtn({ kind: 'bot', id: b.id }, BOT_ICONS[b.id] ?? 'bolt', b.name, b.parent ? ' nav__sub' : '')}</span>
          ))}
          {navBtn({ kind: 'approvals' }, 'check', 'Aprobaciones', '', pendingCount)}
          {navBtn({ kind: 'journal' }, 'clock', 'Diario')}
          {navBtn({ kind: 'settings' }, 'settings', 'Configuración')}
        </nav>
        <div className="sidebar__foot">
          <div className="online"><span className={`dot dot--${error ? 'error' : mood.level}`} /> {error ? 'Sin conexión con el núcleo' : mood.title}</div>
          <div className="user">
            <ScreenFace expression={mood.expression} size={36} />
            <span>{overview?.usuario ?? '…'}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar" data-tauri-drag-region>
          <div className="search">
            <Icon name="search" />
            <input placeholder="Buscar en Lirio…" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0].page) }} aria-label="Buscar" />
            {results.length > 0 && (
              <ul className="search__results">
                {results.map((r) => <li key={r.label}><button onClick={() => go(r.page)}>{r.label}</button></li>)}
              </ul>
            )}
          </div>
          <WindowButtons />
        </div>
        <div className="content">
          {page.kind === 'home' && <Home go={go} />}
          {page.kind === 'bot' && <BotPage key={`${page.id}-${page.tab ?? ''}`} id={page.id} tab={page.tab} />}
          {page.kind === 'approvals' && <ApprovalsPage />}
          {page.kind === 'settings' && <SettingsPage />}
          {page.kind === 'journal' && <JournalPage />}
        </div>
      </main>
    </div>
  )
}

function WindowButtons() {
  if (!inTauri()) return <div className="winbtns" />
  const w = getCurrentWindow()
  return (
    <div className="winbtns">
      <button aria-label="Minimizar" onClick={() => w.minimize()}><Icon name="min" size={18} /></button>
      <button aria-label="Maximizar" onClick={() => w.toggleMaximize()}><Icon name="max" size={16} /></button>
      <button aria-label="Cerrar" className="winbtns__close" onClick={() => w.close()}><Icon name="close" size={18} /></button>
    </div>
  )
}

function ApprovalsPage() {
  const { overview } = useStore()
  const items = (overview?.modules ?? []).flatMap((b) => b.approvals_pending.map((a) => ({ b, a })))
  return (
    <div className="stack">
      <section className="panel intro">
        <h1>Aprobaciones</h1>
        <p className="muted">
          The Wall pide tu permiso antes de publicar, enviar mensajes en tu nombre o borrar archivos.
          Para aprobar o rechazar, <b>mantén pulsado el botón 2 segundos</b>: así se sabe que eres tú y no una IA.
        </p>
      </section>
      {items.length === 0
        ? <section className="panel empty-ok"><ScreenFace expression="guino" size={64} /><span>Nada pendiente. ¡Todo en orden!</span></section>
        : items.map(({ b, a }) => <ApprovalCard key={`${b.id}-${a.id}`} bot={b} a={a} />)}
    </div>
  )
}
