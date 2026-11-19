// Enlaces directos a la consola de Google del PROPIO proyecto del amigo y el arreglo exacto de cada error de
// autorización. Nada sale del PC: el project_id solo se usa para abrir su consola en su navegador.

const BASE = 'https://console.cloud.google.com'

export interface YouTubeStatus {
  estado: 'sin_archivo' | 'sin_autorizar' | 'ok' | 'caduca_pronto' | 'caducado' | 'desconocido'
  project_id?: string | null
  autorizado_en?: string | null
  dias_restantes?: number | null
  client_secret: boolean
  token: boolean
}

export interface ClientInfo { tipo: 'installed' | 'web' | 'otro'; project_id?: string | null }

const validId = (p?: string | null) => (p && /^[a-z0-9-]{6,30}$/.test(p) ? p : null)

function withProject(path: string, project?: string | null) {
  const p = validId(project)
  return p ? `${BASE}${path}?project=${encodeURIComponent(p)}` : `${BASE}${path}`
}

export const links = (project?: string | null) => ({
  credenciales: withProject('/apis/credentials', project),
  publico: withProject('/auth/audience', project),
  consentimiento: withProject('/apis/credentials/consent', project),
  apiData: withProject('/apis/library/youtube.googleapis.com', project),
  apiAnalytics: withProject('/apis/library/youtubeanalytics.googleapis.com', project),
})

export type LinkKey = keyof ReturnType<typeof links>

export type FixCode = 'access_denied' | 'redirect_uri_mismatch' | 'no_verificada' | 'api_desactivada'
  | 'cliente_invalido' | 'caducado' | 'interna' | 'no_vuelve'

export interface Fix {
  code: FixCode
  title: string
  steps: string[]
  link?: { key: LinkKey; label: string }
  /** otro arreglo que también conviene enseñar (el flujo que no vuelve tiene dos causas típicas) */
  also?: FixCode
}

export const FIXES: Record<FixCode, Fix> = {
  access_denied: {
    code: 'access_denied',
    title: 'Error 403: access_denied (tu Gmail no está en «Usuarios de prueba»)',
    steps: [
      'Pulsa «Abrir mi lista de usuarios de prueba».',
      'En «Usuarios de prueba» pulsa «+ Add users» (o «Añadir usuarios»).',
      'Escribe el Gmail con el que entras en YouTube (el mismo que eliges al autorizar) y pulsa «Guardar».',
      'Vuelve aquí y pulsa «Reintentar autorización». Si pulsaste «Cancelar» en Google, solo reinténtalo.',
    ],
    link: { key: 'publico', label: 'Abrir mi lista de usuarios de prueba' },
  },
  redirect_uri_mismatch: {
    code: 'redirect_uri_mismatch',
    title: 'Error 400: redirect_uri_mismatch (el cliente no es de escritorio)',
    steps: [
      'Pulsa «Abrir mis credenciales».',
      '«+ Crear credenciales» → «ID de cliente de OAuth».',
      'En «Tipo de aplicación» elige «Aplicación de escritorio» (no «Aplicación web») y pulsa «Crear».',
      'Pulsa «Descargar JSON», dale ese archivo nuevo a Lirio y reintenta.',
    ],
    link: { key: 'credenciales', label: 'Abrir mis credenciales' },
  },
  no_verificada: {
    code: 'no_verificada',
    title: '«Google no ha verificado esta aplicación»: no es un error',
    steps: [
      'Es tu propia app y está en modo de pruebas: Google avisa siempre.',
      'En esa página pulsa «Configuración avanzada» (o «Avanzado»).',
      'Pulsa «Ir a … (no seguro)» con el nombre de tu proyecto.',
      'Marca todas las casillas de permisos y pulsa «Continuar».',
    ],
  },
  api_desactivada: {
    code: 'api_desactivada',
    title: 'Falta habilitar una API en tu proyecto',
    steps: [
      'Abre «YouTube Data API v3» y pulsa «Habilitar».',
      'Abre «YouTube Analytics API» y pulsa «Habilitar».',
      'Espera un minuto y reintenta.',
    ],
    link: { key: 'apiData', label: 'Abrir YouTube Data API v3' },
  },
  cliente_invalido: {
    code: 'cliente_invalido',
    title: 'Google no reconoce el archivo de credenciales (lo borraste o es de otro proyecto)',
    steps: [
      'Pulsa «Abrir mis credenciales».',
      'Crea un «ID de cliente de OAuth» nuevo de tipo «Aplicación de escritorio» y descarga el JSON.',
      'Dale ese archivo a Lirio y reintenta.',
    ],
    link: { key: 'credenciales', label: 'Abrir mis credenciales' },
  },
  caducado: {
    code: 'caducado',
    title: 'El permiso de YouTube ha caducado',
    steps: [
      'Mientras tu app de Google esté en modo «Pruebas», Google quita el permiso cada 7 días.',
      'Pulsa «Volver a autorizar» y acepta otra vez en tu navegador. Los vídeos en cola esperan y se suben solos después.',
    ],
  },
  interna: {
    code: 'interna',
    title: 'Error 403: org_internal (la app es solo «Interna»)',
    steps: [
      'Pulsa «Abrir la configuración de público».',
      'En «Tipo de usuario» cámbialo a «Externo» y deja el estado en «Pruebas».',
      'Añade tu Gmail en «Usuarios de prueba» y reintenta.',
    ],
    link: { key: 'publico', label: 'Abrir la configuración de público' },
  },
  no_vuelve: {
    code: 'no_vuelve',
    title: 'Google no ha devuelto la autorización a Lirio',
    steps: [
      'Casi siempre es una de dos cosas. La primera: tu Gmail no está en «Usuarios de prueba».',
      'Pulsa «Abrir mi lista de usuarios de prueba», añade el Gmail con el que entras en YouTube y guarda.',
      'Si Google decía «redirect_uri_mismatch», mira también el arreglo de abajo.',
    ],
    link: { key: 'publico', label: 'Abrir mi lista de usuarios de prueba' },
    also: 'redirect_uri_mismatch',
  },
}

/** El arreglo de un mensaje de error del bot o de Google, o null si no se reconoce. */
export function fixFor(message?: string | null): Fix | null {
  const m = (message ?? '').toLowerCase()
  if (!m) return null
  if (m.includes('redirect_uri_mismatch')) return FIXES.redirect_uri_mismatch
  if (m.includes('org_internal')) return FIXES.interna
  if (m.includes('access_denied') || m.includes('access denied')) return FIXES.access_denied
  if (/invalid_client|deleted_client|unauthorized_client|client.*not found/.test(m)) return FIXES.cliente_invalido
  if (/accessnotconfigured|service_disabled|has not been used in project|api.*(disabled|desactivad)/.test(m)) return FIXES.api_desactivada
  if (/invalid_grant|token has been expired|expired or revoked|ya no sirve/.test(m)) return FIXES.caducado
  return null
}

export function statusText(s: YouTubeStatus): { text: string; tone: 'ok' | 'warning' | 'error' } | null {
  switch (s.estado) {
    case 'ok': return { text: `YouTube conectado. En modo «Pruebas» el permiso dura ${s.dias_restantes} día${s.dias_restantes === 1 ? '' : 's'} más.`, tone: 'ok' }
    case 'caduca_pronto': return { text: 'El permiso de YouTube caduca hoy o mañana (modo «Pruebas»: 7 días). Vuelve a autorizar para que las subidas no se paren.', tone: 'warning' }
    case 'caducado': return { text: 'El permiso de YouTube ha caducado: las subidas esperan hasta que vuelvas a autorizar.', tone: 'error' }
    case 'desconocido': return { text: 'YouTube está conectado, pero Lirio no sabe desde cuándo. En modo «Pruebas» Google quita el permiso cada 7 días: si una subida se queda esperando, vuelve a autorizar.', tone: 'warning' }
    default: return null
  }
}
