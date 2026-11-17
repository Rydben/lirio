// Datos de demostración: solo se usan fuera de la app (navegador y tests). Nunca tocan los bots reales.
import type { ActivityItem, BotView, CliResult, Details, Overview, UploadEvent } from './api'

const now = () => new Date().toISOString()

function bots(): BotView[] {
  return [
    {
      id: 'twitch-autoeditor', name: 'Twitch AutoEditor', version: '0.2.0', dir: 'C:\\demo\\twitch-autoeditor',
      description: 'Convierte cada directo en un vídeo de YouTube editado, Shorts y miniatura.',
      task: 'TwitchAutoEditorWatch', commands: ['setup', 'run', 'watch', 'stop', 'status', 'aprobar-firmado'],
      state: 'watching', stop_active: false, stop_requested: false,
      status: { state: 'watching', current_job: null, warning: null, last_error: null,
        last_job: { source: 'directo_partida.mp4', ok: true, finished_at: now() } },
      approvals_pending: [{ id: 'a1b2c3d4', action: 'youtube.schedule_publish', risk: 'external',
        key: 'C:\\demo\\output\\partida\\partida_youtube.mp4',
        details: { title: 'La partida más absurda de la semana' }, status: 'pending', created_at: now() }],
    },
    {
      id: 'thumbnail-bot', name: 'Bot de miniaturas', version: '0.1.0', parent: 'twitch-autoeditor',
      dir: 'C:\\demo\\thumbnail', description: 'Genera 2-3 miniaturas y elige la mejor.',
      commands: ['run'], state: 'on_demand', status: null, approvals_pending: [], stop_active: false, stop_requested: false,
    },
    {
      id: 'twitch-moderator', name: 'Twitch Moderator', version: '0.1.0', dir: 'C:\\demo\\twitch-moderator',
      description: 'Modera el chat y vigila el audio mientras estás en directo.', task: 'TwitchModeratorWatch',
      commands: ['setup', 'run', 'watch', 'stop', 'status', 'aprobar-firmado'], state: 'watching',
      status: { state: 'watching', chat: 'conectado', obs: 'conectado', live: false,
        moderation: { messages: 312, deleted: 4, warned: 2, timeouts: 1, bans: 0 } },
      approvals_pending: [], stop_active: false, stop_requested: false,
    },
  ]
}

const details = (id: string): Details => {
  const module = bots().find((b) => b.id === id)!
  return {
    module,
    queue: [
      { id: 'partida_youtube', kind: 'long', title: 'La partida más absurda de la semana',
        status: 'awaiting_approval', out_dir: 'C:\\demo\\output\\partida', file: 'partida_youtube.mp4',
        publish_at: now() },
      { id: 'partida_short_1', kind: 'short', title: 'El jefe final que nos ganó', status: 'queued',
        out_dir: 'C:\\demo\\output\\partida', file: 'partida_short_1.mp4' },
    ],
    hold: { v2930258519: { since: now(), reason: 'micro: no se oye tu micrófono' } },
    failures: {},
    approvals: module.approvals_pending,
    quota: { used: 1650, limit: 10000 },
    outputs: [
      { dir: 'C:\\demo\\output\\r6', name: 'prueba_fps_rainbow_six_siege', title: 'Rainbow Six: la jugada imposible',
        file: 'r6.mp4', file_exists: true, shorts: 3, thumbnail: null, in_queue: false, unlisted: null, modified: now() },
    ],
  }
}

const activity = (): ActivityItem[] => [
  { module: 'twitch-autoeditor', name: 'Twitch AutoEditor', kind: 'job', ok: true, text: 'Vídeo editado: directo_partida.mp4', at: now() },
  { module: 'twitch-autoeditor', name: 'Twitch AutoEditor', kind: 'wall', ok: true, text: 'Pide tu aprobación: youtube.schedule_publish', at: now() },
  { module: 'twitch-moderator', name: 'Twitch Moderator', kind: 'wall', ok: true, text: 'Solicitud 1f2e desde Lirio: aprobada', at: now() },
]

const ok: CliResult = { ok: true, code: 0, data: { ok: true }, message: 'Hecho (demostración)' }
let uploadCb: ((e: UploadEvent) => void) | null = null
const listeners: Record<string, ((e: any) => void) | null> = {}
const fire = (name: string, steps: any[], ms = 250) =>
  steps.forEach((s, i) => setTimeout(() => listeners[name]?.(s), ms * (i + 1)))

/** En el navegador, `?bienvenida` enseña el asistente de primera vez. */
const welcome = () => typeof location !== 'undefined' && location.search.includes('bienvenida')

export const demo = {
  async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    switch (cmd) {
      case 'overview': return { usuario: 'Alex', modules: bots(), errors: [], uploads: [] } as Overview as T
      case 'module_details': return details(String(args?.id)) as T
      case 'activity': return activity() as T
      case 'start_page': return null as T
      case 'first_run': return welcome() as T
      case 'journal_read': return [
        { at: now(), kind: 'aprobacion', bot: 'twitch-autoeditor', text: 'Twitch AutoEditor: aprobado desde Lirio', ok: true },
        { at: now(), kind: 'nota', text: 'Probar a subir los sábados', ok: true },
        { at: now(), kind: 'subida', bot: 'twitch-autoeditor', text: 'La subida no terminó', ok: false },
      ] as T
      case 'journal_note': return undefined as T
      case 'autostart_get': return false as T
      case 'autostart_set': return Boolean(args?.on) as T
      case 'run_with': {
        const c = String(args?.command)
        if (c === 'voz-texto') return { ...ok, data: { texto: 'Hola, soy yo. Este es mi directo y esta es mi voz de siempre.', segundos: 30 } } as T
        if (c === 'voz-dispositivos') return { ...ok, data: { dispositivos: [{ nombre: 'Micrófono USB', es_microfono: true, sugerido: true }] } } as T
        if (c === 'ajustes-esquema') return { ...ok, data: { grupos: [{ id: 'canal', titulo: 'Tu canal', campos: [
          { clave: 'canal.nombre', tipo: 'texto', titulo: 'Nombre visible', ayuda: 'Sale en las descripciones' },
          { clave: 'edicion.zoom', tipo: 'booleano', titulo: 'Zooms automáticos' },
          { clave: 'edicion.shorts', tipo: 'entero', titulo: 'Shorts por directo', min: 0, max: 5 }] }] } } as T
        if (c === 'ajustes') return { ...ok, data: { valores: { 'canal.nombre': 'Alex', 'edicion.zoom': true, 'edicion.shorts': 3 } } } as T
        if (c === 'connect') return { ...ok, data: { user_code: 'ABCD-1234', cuenta: 'la del bot', bot_login: 'alex_bot' } } as T
        return ok as T
      }
      case 'save_settings': return { ...ok, data: { ok: true, cambiados: Object.keys((args?.valores as object) ?? {}), reiniciar: false } } as T
      case 'record_voice':
        fire('voz', [{ module: args?.id, percent: 50, hecho: false }, { module: args?.id, hecho: true,
          result: { ...ok, data: { ok: true, mensaje: 'Huella guardada: se te reconoce bien.' } } }])
        return undefined as T
      case 'usage_summary': return { lirio: '0.2.0', windows: 'windows', periodo_dias: 30, dias_con_actividad: 4,
        bots: [{ id: 'twitch-autoeditor', version: '0.3.0' }], usos: { aprobacion: 3, subida: 2 },
        errores_por_bot: { 'twitch-autoeditor': 1 } } as T
      case 'get_catalog': return { nvidia: true, bots: [
        { id: 'twitch-autoeditor', nombre: 'Editor de vídeo', descripcion: 'De tu directo a un vídeo de YouTube, Shorts y miniatura.', version: '0.3.0', bytes: 2_400_000,
          incluye: [{ id: 'thumbnail-bot', nombre: 'Bot de miniaturas' }] },
        { id: 'twitch-moderator', nombre: 'Moderador de Twitch', descripcion: 'Modera tu chat y vigila tu audio.', version: '0.2.0', bytes: 900_000 },
      ] } as T
      case 'install_bots': {
        const ids = (args?.ids as string[]) ?? []
        fire('instalacion', [
          ...ids.flatMap((b) => [
            { step: { bot: b, paso: 'paquete', detalle: 'Descargando', percent: 40 } },
            { step: { bot: b, paso: 'python', detalle: 'Preparando Python', percent: null } },
            { step: { bot: b, paso: 'librerias', detalle: 'Descargando numpy 15.8 MB', percent: null } },
            { step: { bot: b, paso: 'listo', detalle: 'Instalado', percent: 100 } },
          ]),
          { hecho: true, ok: true },
        ])
        return undefined as T
      }
      case 'ai_status': return { claude: false, ollama_instalado: true, ollama_activo: true, ollama_modelos: [],
        vram_gb: 6, modelo_recomendado: 'qwen2.5:3b' } as T
      case 'test_claude': return { ok: false, motivo: 'no_instalado' } as T
      case 'ollama_pull':
        fire('ollama', [10, 45, 80, 100].map((p) => ({ estado: 'descargando', percent: p, hecho: false })).concat([{ hecho: true, ok: true } as any]))
        return undefined as T
      case 'install_client_secret': return 'Credenciales guardadas. Ahora pulsa «Autorizar YouTube».' as T
      case 'release_info': return { version: '0.2.0', repo: 'ejemplo/lirio' } as T
      case 'check_update': return { disponible: false } as T
      case 'gesture_begin': return 'demo-token' as T
      case 'approver_key': return { alg: 'ed25519', llave_publica: 'DEMO', id: 'lirio-demo' } as T
      case 'start_upload': {
        let p = 0
        const t = setInterval(() => {
          p += 10
          uploadCb?.({ module: String(args?.id), percent: Math.min(p, 100), item: 'demo.mp4', done: p >= 100,
            result: p >= 100 ? ok : undefined })
          if (p >= 100) clearInterval(t)
        }, 300)
        return undefined as T
      }
      default: return ok as T
    }
  },
  async on(name: string, cb: (e: any) => void) {
    listeners[name] = cb
    return () => { listeners[name] = null }
  },
  async onUpload(cb: (e: UploadEvent) => void) {
    uploadCb = cb
    return () => { uploadCb = null }
  },
}
