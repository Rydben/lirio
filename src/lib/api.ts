// Puente con el núcleo de Lirio (Rust). Fuera de Tauri (navegador o tests) usa datos de demostración.
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { demo } from './demo'

export type BotState =
  | 'idle' | 'running' | 'watching' | 'waiting' | 'needs_login' | 'stopped' | 'error' | 'crashed'
  | 'on_demand' | 'unknown' | 'stalled' | 'files_missing' | 'installing' | 'install_pending' | 'downloading'

export interface Approval {
  id: string
  action: string
  risk?: string
  key?: string
  details?: Record<string, unknown>
  status: string
  created_at?: string
}

export interface BotView {
  id: string
  name: string
  description?: string
  version?: string
  parent?: string | null
  dir: string
  task?: string | null
  commands: string[]
  state: BotState
  status: Record<string, any> | null
  approvals_pending: Approval[]
  stop_active: boolean
  stop_requested: boolean
  state_note?: string | null
  missing_files?: string[]
  installing?: boolean
  pinned_key?: { id: string; llave_publica: string } | null
  icon?: string | null
}

export interface Overview {
  usuario: string
  modules: BotView[]
  errors: string[]
  uploads: string[]
  my_key?: { id: string; llave_publica: string }
}

export interface ActivityItem {
  module: string
  name: string
  kind: 'job' | 'wall'
  ok: boolean
  text: string
  at: string | null
}

export interface CliResult {
  ok: boolean
  code: number
  data: any
  message: string
}

export interface QueueItem {
  id: string
  kind: 'long' | 'short'
  title: string
  status: string
  out_dir: string
  file: string
  publish_at?: string
  video_id?: string | null
  error?: string | null
  attempts?: number
}

export interface OutputItem {
  dir: string
  name: string
  title: string | null
  file: string
  file_exists: boolean
  shorts: number
  thumbnail: string | null
  in_queue: boolean
  unlisted: { url?: string } | null
  modified: string | null
}

export interface Details {
  module: BotView
  queue: QueueItem[] | null
  hold: Record<string, { since: string; reason: string }> | null
  failures: Record<string, { attempts: number; last_error: string; failed?: boolean; at?: string }> | null
  approvals: Approval[] | { pending: Approval[] } | null
  quota: Record<string, any> | null
  outputs: OutputItem[]
}

export interface UploadEvent {
  module: string
  percent: number
  item?: string | null
  done: boolean
  result?: CliResult
}

export interface JobEvent {
  clave: string; bot: string; comando: string; percent?: number | null; etapa?: string
  hecho: boolean; ok?: boolean; cancelado?: boolean; resultado?: any; mensaje?: string
}

export interface WizardProgress { paso: string; ids: string[]; respuestas: Answers }

export interface CatalogBot {
  id: string
  nombre: string
  descripcion: string
  version: string
  incluye?: { id: string; nombre: string }[]
  padre?: string | null
  bytes: number
  modelos?: { nombre: string }[]
}

export interface InstallEvent {
  bot?: string
  terminado?: boolean
  cancelado?: boolean
  step?: { bot: string; paso: string; detalle: string; percent: number | null }
  hecho?: boolean
  ok?: boolean
  error?: string | null
}

export interface AiStatus {
  claude: boolean
  ollama_instalado: boolean
  ollama_activo: boolean
  ollama_modelos: string[]
  vram_gb: number | null
  modelo_recomendado: string
}

export interface GpuEvent { bot: string; detalle?: string; percent?: number | null; hecho: boolean; ok?: boolean; error?: string | null }
export interface GpuStatus { declara: boolean; instalado: boolean; nvidia: boolean; progreso: GpuEvent | null }

export interface PullEvent { fase?: string; estado?: string; percent?: number | null; hecho: boolean; ok?: boolean; error?: string | null }

export interface Answers {
  nombre: string
  canal_twitch: string
  nombre_canal: string
  carpeta_obs: string
  ia: 'claude_code' | 'ollama' | 'heuristico'
  ollama_modelo?: string
  ollama_url?: string
}

export interface JournalEntry { at: string; kind: string; bot?: string | null; text: string; ok: boolean }

export interface UsageSummary {
  lirio: string
  windows: string
  periodo_dias: number
  dias_con_actividad: number
  bots: { id: string; version: string }[]
  usos: Record<string, number>
  errores_por_bot: Record<string, number>
}

export interface SettingsField {
  clave: string
  tipo: 'texto' | 'numero' | 'entero' | 'booleano' | 'opcion' | 'lista' | 'carpeta' | 'archivo' | 'color' | 'hora'
  titulo: string
  ayuda?: string
  opciones?: (string | number | { valor: string | number; titulo: string })[]
  min?: number
  max?: number
  por_defecto?: unknown
  avanzado?: boolean
}

export interface SettingsSchema { grupos: { id: string; titulo: string; campos: SettingsField[] }[] }

export interface VoiceEvent { module: string; percent?: number; hecho: boolean; result?: CliResult }

export type SignedOperation = 'approve' | 'deny' | 'liberar' | 'reintentar'

export const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return inTauri() ? invoke<T>(cmd, args) : demo.call<T>(cmd, args)
}

export const api = {
  overview: () => call<Overview>('overview'),
  details: (id: string) => call<Details>('module_details', { id }),
  activity: () => call<ActivityItem[]>('activity'),
  run: (id: string, command: string, args: string[] = []) => call<CliResult>('run_command', { id, command, args }),
  startUpload: (id: string, dir?: string) => call<void>('start_upload', { id, dir: dir ?? null }),
  gestureBegin: () => call<string>('gesture_begin'),
  signedDecision: (token: string, id: string, operacion: SignedOperation, objetivo: string,
    accion?: string | null, clave?: string | null) =>
    call<CliResult>('signed_decision', { token, id, operacion, objetivo, accion: accion ?? null, clave: clave ?? null }),
  signedApproveDeletes: (token: string, id: string, objetivos: string[]) =>
    call<CliResult>('signed_approve_deletes', { token, id, objetivos }),
  killSwitchOn: (id: string) => call<void>('kill_switch_on', { id }),
  killSwitchOff: (token: string, id: string) => call<void>('kill_switch_off', { token, id }),
  startBot: (id: string) => call<void>('start_bot', { id }),
  startPage: () => call<string | null>('start_page'),
  approverKey: () => call<{ alg: string; llave_publica: string; id: string }>('approver_key'),
  runWith: (id: string, command: string, flags: Record<string, unknown> = {}) =>
    call<CliResult>('run_with', { id, command, flags }),
  recordVoice: (id: string, command: 'registrar-voz' | 'enroll', flags: Record<string, unknown>) =>
    call<void>('record_voice', { id, command, flags }),
  saveSettings: (id: string, valores: Record<string, unknown>) => call<CliResult>('save_settings', { id, valores }),
  onVoice: (cb: (e: VoiceEvent) => void): Promise<UnlistenFn> =>
    inTauri() ? listen<VoiceEvent>('lirio://voz', (e) => cb(e.payload)) : demo.on('voz', cb),
  autostartGet: () => call<boolean>('autostart_get'),
  autostartSet: (on: boolean) => call<boolean>('autostart_set', { on }),
  botActions: (id: string, tipos: string[], limite = 30) => call<Record<string, any>[]>('bot_actions', { id, tipos, limite }),
  journal: (dias: number) => call<JournalEntry[]>('journal_read', { dias }),
  journalNote: (texto: string) => call<void>('journal_note', { texto }),
  usageSummary: (dias: number) => call<UsageSummary>('usage_summary', { dias }),
  firstRun: () => call<boolean>('first_run'),
  catalog: () => call<{ bots: CatalogBot[]; nvidia: boolean }>('get_catalog'),
  installBots: (ids: string[], answers: Answers) => call<void>('install_bots', { ids, answers }),
  installCancel: (id: string) => call<boolean>('install_cancel', { id }),
  installResume: (id: string) => call<void>('install_resume', { id }),
  installStatus: () => call<Record<string, { en_marcha: boolean; pendiente: boolean; ultimo: any }>>('install_status'),
  wizardGet: () => call<WizardProgress | null>('wizard_get'),
  wizardSave: (progreso: WizardProgress) => call<void>('wizard_save', { progreso }),
  wizardClear: () => call<void>('wizard_clear'),
  jobStart: (id: string, command: string, flags: Record<string, unknown>) => call<string>('job_start', { id, command, flags }),
  jobsStatus: () => call<Record<string, JobEvent>>('jobs_status'),
  jobCancel: (clave: string) => call<boolean>('job_cancel', { clave }),
  onJob: (cb: (e: JobEvent) => void): Promise<UnlistenFn> =>
    inTauri() ? listen<JobEvent>('lirio://trabajo', (e) => cb(e.payload)) : demo.on('trabajo', cb),
  thumbnails: (id: string) => call<CliResult>('thumbnails', { id }),
  openBotFolder: (id: string, ruta: string) => call<void>('open_bot_folder', { id, ruta }),
  pickFile: (title: string, kind: 'video' | 'miniatura') =>
    inTauri() ? openDialog({ title, filters: kind === 'video'
      ? [{ name: 'Vídeos', extensions: ['mp4', 'mkv', 'mov', 'webm', 'flv'] }]
      : [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }) as Promise<string | null>
      : Promise.resolve(kind === 'video' ? 'C:\\Videos\\referencia.mp4' : 'C:\\Imagenes\\referencia.png'),
  helpPaths: () => call<{ programa: string; datos: string }>('help_paths'),
  lastSession: () => call<{ cerrado_de_golpe: boolean }>('last_session'),
  gpuStatus: (id: string) => call<GpuStatus>('gpu_status', { id }),
  installGpu: (id: string) => call<void>('install_gpu', { id }),
  onGpu: (cb: (e: GpuEvent) => void): Promise<UnlistenFn> =>
    inTauri() ? listen<GpuEvent>('lirio://gpu', (e) => cb(e.payload)) : demo.on('gpu', cb),
  aiStatus: () => call<AiStatus>('ai_status'),
  testClaude: () => call<{ ok: boolean; motivo?: string }>('test_claude'),
  ollamaPull: (model: string) => call<void>('ollama_pull', { model }),
  ollamaSetup: (model: string) => call<void>('ollama_setup', { model }),
  installClientSecret: (id: string, path: string) => call<string>('install_client_secret', { id, path }),
  releaseInfo: () => call<{ version: string; repo: string | null; prueba?: boolean; datos?: string }>('release_info'),
  checkUpdate: () => call<{ disponible: boolean; version?: string; notas?: string; motivo?: string }>('check_update'),
  installUpdate: () => call<void>('install_update'),
  onInstall: (cb: (e: InstallEvent) => void): Promise<UnlistenFn> =>
    inTauri() ? listen<InstallEvent>('lirio://instalacion', (e) => cb(e.payload)) : demo.on('instalacion', cb),
  onPull: (cb: (e: PullEvent) => void): Promise<UnlistenFn> =>
    inTauri() ? listen<PullEvent>('lirio://ollama', (e) => cb(e.payload)) : demo.on('ollama', cb),
  /** Abre una página en el navegador del amigo (solo dominios permitidos en capabilities). */
  openUrl: (url: string) => (inTauri() ? openUrl(url) : Promise.resolve(void window.open(url, '_blank'))),
  pickFolder: (title: string) =>
    inTauri() ? openDialog({ directory: true, title }) as Promise<string | null> : Promise.resolve('D:/Videos/OBS'),
  pickJson: (title: string) =>
    inTauri() ? openDialog({ title, filters: [{ name: 'Credenciales de Google', extensions: ['json'] }] }) as Promise<string | null>
      : Promise.resolve('C:/Descargas/client_secret.json'),
  onUpload: (cb: (e: UploadEvent) => void): Promise<UnlistenFn> =>
    inTauri() ? listen<UploadEvent>('lirio://upload', (e) => cb(e.payload)) : demo.onUpload(cb),
}

export function pendingApprovals(d: Details['approvals']): Approval[] {
  const list = Array.isArray(d) ? d : d?.pending ?? []
  return list.filter((a) => a.status === 'pending')
}
