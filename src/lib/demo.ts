// Datos de demostración: solo se usan fuera de la app (navegador y tests). Nunca tocan los bots reales.
import type { ActivityItem, BotView, CliResult, Details, Overview, UploadEvent } from './api'

const now = () => new Date().toISOString()

function bots(): BotView[] {
  return [
    {
      id: 'twitch-autoeditor', name: 'Twitch AutoEditor', version: '0.2.0', dir: 'C:\\demo\\twitch-autoeditor',
      description: 'Convierte cada directo en un vídeo de YouTube editado, Shorts y miniatura.',
      task: 'TwitchAutoEditorWatch', commands: ['setup', 'run', 'watch', 'stop', 'status', 'aprobar-firmado', ],
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
const listeners: Record<string, Set<(e: any) => void>> = {}
let heartbeat: ReturnType<typeof setInterval> | undefined
const fire = (name: string, steps: any[], ms = 250) =>
  steps.forEach((s, i) => setTimeout(() => listeners[name]?.forEach((cb) => cb(s)), ms * (i + 1)))

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
      case 'bot_actions': return [
        { type: 'reply', user: 'ana', question: '¿a qué hora es el directo?', answer: 'Los viernes a las 20:00', at: now() },
        { type: 'voice_command', heard: 'lirio pon el modo lento', similarity: 0.8, is_streamer: true, command: 'modo_lento', at: now() },
      ] as T
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
        if (c === 'probar-voz') return { ...ok, data: { oido: 'lirio pon el modo lento', palabra_activacion: true, es_tu_voz: true,
          similitud: 0.82, comando: 'modo_lento', descripcion: 'Activar el modo lento del chat (30 s)', ejecutado: false } } as T
        if (c === 'monetizacion' && args?.id === 'twitch-moderator') return { ...ok, data: { ok: true, canal: { login: 'alex' }, tipo_cuenta: '',
          seguidores: 18, ultimos_30_dias: { dias_emitidos: 5, minutos_emitidos: 610, media_espectadores: 2.4, directos: 6 },
          en_directo: { activo: false }, motivos: {}, avisos: [] } } as T
        if (c === 'monetizacion') return { ...ok, data: { ok: true, suscriptores: 212, videos_publicos_90d: 7, horas_publicas_12m: 640,
          vistas_shorts_90d: null, visualizaciones_totales: 15840, motivos: { vistas_shorts_90d: 'YouTube Analytics no separa las vistas de Shorts para este canal.' }, avisos: [] } } as T
        if (c === 'carpetas') return { ...ok, data: { editados: 'C:\\v\\output', directos: 'C:\\v\\downloads', miniaturas: 'C:\\v\\output', nota: 'x' } } as T
        if (c === 'papelera') return { ...ok, data: {
          carpetas: { editados: 'C:\\v\\output', directos: 'C:\\v\\downloads', miniaturas: 'C:\\v\\output' },
          automatica: { borrar_directo_tras_editar: false, borrar_video_tras_subir: true },
          directos: [{ archivo: '2026-11-14.mp4', ruta: 'C:\\v\\downloads\\2026-11-14.mp4', mb: 6400, fecha: now(), estado: 'editado', se_puede_borrar: true }],
          editados: [{ carpeta: 'C:\\v\\output\\viernes', nombre: 'viernes', titulo: 'Directo del viernes', mb: 900, shorts: 3, fecha: now(), subido: true }] } } as T
        if (c === 'papelera-borrar') return { ...ok, data: { ok: true, liberado_mb: 900 } } as T
        if (c.startsWith('aprendido')) return { ...ok, data: { ok: true, etiqueta: 'aprendido de tus estadísticas', activado: c === 'aprendido-activar' ? args?.flags && (args.flags as any)['@valor'] === 'si' : true,
          cambios: c === 'aprendido-borrar' ? [] : [{ uid: 'u1', id: 'gancho', texto: 'Gancho más corto al empezar', motivo: 'La gente se va en los primeros 20 s (−18 %)', estado: 'probando', aplicado_at: now() }],
          historial: [{ uid: 'u0', id: 'mas_shorts', texto: 'Más Shorts', motivo: 'Los Shorts traen el 60 % de las visitas', estado: 'deshecho', resultado: 'empeoró' }],
          descartados: [{ id: 'mas_shorts', texto: 'Más Shorts', por_que_no: 'tu instrucción «menos Shorts» manda' }],
          limites: 'Como mucho 1-2 cambios por vídeo; si empeora, se deshace solo. Lo que tú escribes en «Tu estilo» manda.' } } as T
        if (c.startsWith('estilo')) return { ...ok, data: { ok: true, respuesta: 'Hecho: haré los cortes más rápidos.',
          cambios: [{ tipo: 'instruccion', id: 'i2', texto: 'cortes más rápidos' }],
          instrucciones: [{ id: 'i1', texto: 'Cortes rápidos en las jugadas' }], video_referencia: null, miniatura_referencia: null } } as T
        if (c === 'editar') return { ...ok, data: { ok: true, modo: 'cola', posicion: 1, mensaje: 'En cola: el editor lo coge en su próxima vuelta.' } } as T
        if (c === 'miniatura-elegir' || c === 'miniaturas-generar') return { ...ok, data: { ok: true } } as T
        if (c === 'bans-recientes') return { ...ok, data: { bans: [{ id: 'b1', at: now(), login: 'spammer123', reason: 'enlaces',
          message: 'compra seguidores en…', category: 'spam', rule: 'R3', immediate: true, undone: false }] } } as T
        if (c === 'deshacer') return { ...ok, data: { solicitud: { id: 's1', action: 'twitch.unban', key: 'unban:spammer123', status: 'pending' } } } as T
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
          ...ids.map((b) => ({ bot: b, terminado: true, ok: true })),
        ])
        return undefined as T
      }
      case 'install_cancel': return true as T
      case 'install_resume': return undefined as T
      case 'install_status': return {} as T
      case 'wizard_get': return null as T
      case 'wizard_save': case 'wizard_clear': return undefined as T
      case 'ai_status': return { claude: false, ollama_instalado: true, ollama_activo: true, ollama_modelos: [],
        vram_gb: 6, modelo_recomendado: 'qwen2.5:3b' } as T
      case 'test_claude': return { ok: false, motivo: 'no_instalado' } as T
      case 'thumbnails': return { ...ok, data: { videos: [{ carpeta: 'C:\\o\\v1', video: 'v1', titulo: 'Directo del viernes', elegida_por: 'bot',
        puede_regenerar: true, miniaturas: [{ archivo: 'v1_miniatura_1.jpg', ruta: 'C:\\o\\v1\\v1_miniatura_1.jpg', puntuacion: 8.2, elegida: true, img: null },
          { archivo: 'v1_miniatura_2.jpg', ruta: 'C:\\o\\v1\\v1_miniatura_2.jpg', puntuacion: 7.1, elegida: false, img: null }] }] } } as T
      case 'open_bot_folder': return undefined as T
      case 'job_start': {
        const clave = `${args?.id}:${args?.command}`
        const base = { clave, bot: args?.id, comando: args?.command }
        fire('trabajo', [{ ...base, percent: 20, etapa: 'Analizando cortes', hecho: false }, { ...base, percent: 80, etapa: 'Analizando cortes', hecho: false },
          { ...base, percent: 100, hecho: true, ok: true, resultado: { ok: true, instrucciones: [], video_referencia: 'C:\\Videos\\referencia.mp4' } }])
        return clave as T
      }
      case 'jobs_status': return {} as T
      case 'monetizacion_datos': return null as T
      case 'youtube_status': return { estado: 'ok', project_id: 'lirio-demo-1', autorizado_en: new Date().toISOString(), dias_restantes: 7, client_secret: true, token: true } as T
      case 'youtube_check_file': return { tipo: 'installed', project_id: 'lirio-demo-1' } as T
      case 'job_cancel': return true as T
      case 'signed_approve_deletes': return ok as T
      case 'ui_error': return undefined as T
      case 'portable_status': return { portatil: false } as T
      case 'portable_create_pin': case 'portable_unlock': case 'portable_change_pin': return undefined as T
      case 'usb_drives': return [{ letra: 'E:', nombre: 'KINGSTON', extraible: true, libre: 28e9, total: 32e9 }] as T
      case 'usb_create':
        fire('usb', [{ paso: 'velocidad', detalle: 'Midiendo la velocidad de la USB…', percent: null, hecho: false },
          { paso: 'bot', detalle: 'Moderador de Twitch: Descargando librerías', percent: 50, hecho: false },
          { hecho: true, ok: true, avisos: [], carpeta: 'E:\\Lirio-Portatil' }])
        return undefined as T
      case 'help_paths': return { programa: 'C:\\Users\\Ana\\AppData\\Local\\Lirio', datos: 'C:\\Users\\Ana\\AppData\\Local\\LirioDatos' } as T
      case 'last_session': return { cerrado_de_golpe: false } as T
      case 'gpu_status': return { declara: args?.id === 'twitch-autoeditor', instalado: false, nvidia: true, progreso: null } as T
      case 'install_gpu':
        fire('gpu', [5, 40, 90].map((p) => ({ bot: args?.id, detalle: `Descargando librerías: ${p}%`, percent: p, hecho: false }))
          .concat([{ bot: args?.id, hecho: true, ok: true } as any]))
        return undefined as T
      case 'ollama_setup':
        fire('ollama', [['descarga', 30], ['descarga', 100], ['instalacion', 60], ['arranque', null], ['modelo', 50], ['modelo', 100]]
          .map(([fase, p]) => ({ fase, estado: '', percent: p, hecho: false })).concat([{ hecho: true, ok: true } as any]))
        return undefined as T
      case 'ollama_pull':
        fire('ollama', [10, 45, 80, 100].map((p) => ({ estado: 'descargando', percent: p, hecho: false })).concat([{ hecho: true, ok: true } as any]))
        return undefined as T
      case 'install_client_secret': return 'Credenciales guardadas. Ahora pulsa «Autorizar YouTube».' as T
      case 'release_info': return { version: '0.2.0', repo: 'ejemplo/lirio', portatil: false, edicion: 'Lirio Desktop' } as T
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
    // como el moderador de verdad, que escribe su estado cada 5 s
    if (name === 'cambio' && !heartbeat) heartbeat = setInterval(() => listeners.cambio?.forEach((f) => f({ bots: ['twitch-moderator'], config: false })), 5000)
    ;(listeners[name] ??= new Set()).add(cb)
    return () => { listeners[name]?.delete(cb) }
  },
  async onUpload(cb: (e: UploadEvent) => void) {
    uploadCb = cb
    return () => { uploadCb = null }
  },
}
