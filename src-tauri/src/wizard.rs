//! Comandos del asistente de bienvenida (fase 2): catálogo, instalación, IA y YouTube del amigo.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{Emitter, State};

use crate::modules::{LirioConfig, ModuleEntry};
use crate::{catalog, installer, winutil, AppState};

pub const OLLAMA_URL: &str = "http://127.0.0.1:11434";
pub const CLIENT_SECRET_REL: &str = "secrets/client_secret.json";

/// ¿Es la primera vez? (no hay bots configurados)
#[tauri::command]
pub fn first_run(state: State<AppState>) -> bool {
    // también si el asistente se quedó a medias (Lirio se cerró en "Instalar"): se retoma
    !state.config_path.exists() || state.config().modulos.is_empty() || !wizard_progress(&state.data_dir).is_null()
}

#[tauri::command]
pub async fn get_catalog() -> Result<Value, String> {
    let (cat, _) = tauri::async_runtime::spawn_blocking(catalog::fetch).await.map_err(|e| e.to_string())??;
    Ok(json!({ "bots": cat.bots, "nvidia": installer::has_nvidia() }))
}

// ------------------------------------------------------------------ Instalación de bots
// Cada bot se instala en su propio hilo: si uno falla o tarda, los demás terminan igual. Se puede cancelar,
// reintentar y "saltar por ahora" (la instalación sigue sola y se ve en la página del bot). Si Lirio se cierra a
// medias, al volver se retoma aprovechando lo ya descargado (los .part de las descargas y los pasos ya hechos).

/// Instalaciones en marcha: bot -> bandera de cancelar. Y el último paso de cada una (para la página del bot).
pub static RUNNING: std::sync::LazyLock<std::sync::Mutex<std::collections::BTreeMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>> =
    std::sync::LazyLock::new(Default::default);
pub static LAST: std::sync::LazyLock<std::sync::Mutex<std::collections::BTreeMap<String, Value>>> =
    std::sync::LazyLock::new(Default::default);
/// config.json lo escriben varios hilos: de uno en uno.
static CONFIG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn is_installing(id: &str) -> bool {
    RUNNING.lock().unwrap().contains_key(id)
}

/// Lo necesario para lanzar instalaciones desde cualquier comando.
#[derive(Clone)]
struct Ctx {
    app: tauri::AppHandle,
    data_dir: PathBuf,
    config_path: PathBuf,
    use_defaults: bool,
    approver_public: Value,
}

impl Ctx {
    fn new(app: tauri::AppHandle, state: &AppState) -> Self {
        Ctx { app, data_dir: state.data_dir.clone(), config_path: state.config_path.clone(), use_defaults: state.use_defaults,
              approver_public: serde_json::to_value(state.approver.public_info()).unwrap() }
    }

    fn emit(&self, v: Value) { let _ = self.app.emit("lirio://instalacion", v); }

    /// Añade el bot (y sus sub-bots) a Lirio, aunque la instalación no haya terminado: así aparece su página
    /// con "Continuar la instalación".
    fn register(&self, dir: &Path, usuario: Option<&str>) {
        let _g = CONFIG_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let mut cfg = LirioConfig::load_with(&self.config_path, self.use_defaults);
        if let Some(u) = usuario.filter(|s| !s.is_empty()) { if cfg.usuario.is_none() { cfg.usuario = Some(u.to_string()); } }
        let mut dirs = vec![dir.to_path_buf()];
        dirs.extend(nested_modules(dir));
        for d in dirs {
            if !cfg.modulos.iter().any(|m| m.ruta == d) { cfg.modulos.push(ModuleEntry { ruta: d, tarea: None }); }
        }
        let _ = cfg.save(&self.config_path);
    }

    fn registered(&self, dir: &Path) -> bool {
        LirioConfig::load_with(&self.config_path, self.use_defaults).modulos.iter().any(|m| m.ruta == dir)
    }

    /// Lanza (o retoma) la instalación de un bot en su hilo. No hace nada si ya está en marcha.
    fn start(&self, id: String, answers: Value) {
        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let mut running = RUNNING.lock().unwrap();
            if running.contains_key(&id) { return; }
            running.insert(id.clone(), flag.clone());
        }
        let ctx = self.clone();
        std::thread::spawn(move || {
            let journal = crate::journal::Journal::new(&ctx.data_dir);
            let bots_root = ctx.data_dir.join("bots");
            let cache = ctx.data_dir.join("descargas");
            let dir = bots_root.join(&id);
            // la marca guarda las respuestas para poder retomarla aunque se cierre Lirio
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(dir.join(installer::INSTALL_MARK), serde_json::to_vec(&json!({"respuestas": answers})).unwrap());
            let result = installer::with_cancel(flag, || -> Result<PathBuf, String> {
                let (cat, base) = catalog::fetch()?;
                let entry = cat.bots.iter().find(|b| b.id == id).ok_or(format!("{id} no está en el catálogo"))?;
                let job = installer::InstallJob { entry, base: &base, bots_root: &bots_root, cache: &cache,
                                                  approver_public: ctx.approver_public.clone(), answers: &answers };
                installer::install_bot(&job, &mut |s| {
                    let v = json!({"step": s});
                    LAST.lock().unwrap().insert(id.clone(), v.clone());
                    // en cuanto el paquete está descomprimido, el bot ya aparece en Lirio
                    if s.paso != "paquete" && dir.join("aniuzka.json").exists() && !ctx.registered(&dir) { ctx.register(&dir, answers["nombre"].as_str()); }
                    ctx.emit(v);
                })
            });
            RUNNING.lock().unwrap().remove(&id);
            let cancelled = result.as_ref().err().is_some_and(|e| e == installer::CANCELLED);
            if dir.join("aniuzka.json").exists() { ctx.register(&dir, answers["nombre"].as_str()); }
            match &result {
                Ok(_) => { let _ = std::fs::remove_file(dir.join(installer::INSTALL_MARK)); }
                Err(_) if !dir.join("aniuzka.json").exists() && cancelled => { let _ = std::fs::remove_dir_all(&dir); }
                Err(_) => {}
            }
            let end = json!({"bot": id, "terminado": true, "ok": result.is_ok(), "cancelado": cancelled,
                             "error": result.as_ref().err().filter(|_| !cancelled)});
            LAST.lock().unwrap().insert(id.clone(), end.clone());
            journal.add("instalacion", Some(&id), &if result.is_ok() { format!("{id} instalado") }
                        else if cancelled { format!("{id}: instalación cancelada") } else { format!("{id}: la instalación no terminó") },
                        result.is_ok());
            ctx.emit(end);
            // Después, sin bloquear a nadie: las librerías de la gráfica NVIDIA (si hay una y el bot las usa).
            if result.is_ok() && dir.join("requirements-gpu.txt").exists() && installer::has_nvidia() {
                let r = installer::install_gpu(&id, &dir, &cache, &mut |v| { let _ = ctx.app.emit("lirio://gpu", v); });
                journal.add("gpu", Some(&id), "Librerías de la gráfica NVIDIA", r.is_ok());
            }
        });
    }
}

/// Instala los bots elegidos, cada uno por su lado. Emite `lirio://instalacion` con `{step}` y, al terminar cada
/// bot, `{bot, terminado, ok, cancelado, error}`.
#[tauri::command]
pub fn install_bots(app: tauri::AppHandle, state: State<AppState>, ids: Vec<String>, answers: Value) -> Result<(), String> {
    let ctx = Ctx::new(app, &state);
    for id in ids {
        ctx.start(id, answers.clone());
    }
    Ok(())
}

/// Cancela la instalación de un bot (lo descargado se guarda para seguir luego).
#[tauri::command]
pub fn install_cancel(id: String) -> bool {
    RUNNING.lock().unwrap().get(&id).map(|f| f.store(true, std::sync::atomic::Ordering::Relaxed)).is_some()
}

/// Reintenta o continúa la instalación de un bot con las respuestas que se guardaron al empezarla.
#[tauri::command]
pub fn install_resume(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("bot no válido".into());
    }
    let mark = state.data_dir.join("bots").join(&id).join(installer::INSTALL_MARK);
    let answers = std::fs::read_to_string(&mark).ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok()).map(|v| v["respuestas"].clone())
        .or_else(|| wizard_progress(&state.data_dir)["respuestas"].as_object().map(|o| Value::Object(o.clone())))
        .unwrap_or_else(|| json!({}));
    Ctx::new(app, &state).start(id, answers);
    Ok(())
}

/// Cómo va cada instalación: en marcha, último paso y si quedó a medias (marca en su carpeta).
#[tauri::command]
pub fn install_status(state: State<AppState>) -> Value {
    let mut out = serde_json::Map::new();
    let last = LAST.lock().unwrap().clone();
    let bots_root = state.data_dir.join("bots");
    let mut ids: Vec<String> = last.keys().cloned().collect();
    for e in std::fs::read_dir(&bots_root).into_iter().flatten().flatten() {
        if e.path().join(installer::INSTALL_MARK).exists() { ids.push(e.file_name().to_string_lossy().to_string()); }
    }
    ids.sort();
    ids.dedup();
    for id in ids {
        out.insert(id.clone(), json!({
            "en_marcha": is_installing(&id),
            "pendiente": bots_root.join(&id).join(installer::INSTALL_MARK).exists(),
            "ultimo": last.get(&id).cloned().unwrap_or(Value::Null),
        }));
    }
    Value::Object(out)
}

// ------------------------------------------------------------------ Progreso del asistente
// Se guarda en qué paso va (y las respuestas) para retomarlo si Lirio se cierra a medias.

pub const WIZARD_FILE: &str = "asistente.json";

pub fn wizard_progress(data_dir: &Path) -> Value {
    std::fs::read_to_string(data_dir.join(WIZARD_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

#[tauri::command]
pub fn wizard_get(state: State<AppState>) -> Value {
    wizard_progress(&state.data_dir)
}

#[tauri::command]
pub fn wizard_save(state: State<AppState>, progreso: Value) -> Result<(), String> {
    std::fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
    std::fs::write(state.data_dir.join(WIZARD_FILE), serde_json::to_vec(&progreso).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wizard_clear(state: State<AppState>) {
    let _ = std::fs::remove_file(state.data_dir.join(WIZARD_FILE));
}

/// ¿Este bot puede ir más rápido con la gráfica NVIDIA? (y cómo va esa instalación, si está en curso)
#[tauri::command]
pub fn gpu_status(state: State<AppState>, id: String) -> Result<Value, String> {
    let m = state.module(&id)?;
    let mut v = installer::gpu_info(&m.dir);
    v["nvidia"] = json!(installer::has_nvidia());
    v["progreso"] = installer::GPU_PROGRESS.lock().unwrap().get(&id).cloned().unwrap_or(Value::Null);
    Ok(v)
}

/// Instala ahora (en segundo plano) las librerías de la gráfica de un bot. Avance en `lirio://gpu`.
#[tauri::command]
pub fn install_gpu(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let m = state.module(&id)?;
    if installer::GPU_PROGRESS.lock().unwrap().get(&id).is_some_and(|v| v["hecho"] == false) {
        return Err("Ya se está instalando".into());
    }
    let cache = state.data_dir.join("descargas");
    let journal = crate::journal::Journal::new(&state.data_dir);
    let dir = m.dir.clone();
    std::thread::spawn(move || {
        let r = installer::install_gpu(&id, &dir, &cache, &mut |v| { let _ = app.emit("lirio://gpu", v); });
        journal.add("gpu", Some(&id), "Librerías de la gráfica NVIDIA", r.is_ok());
    });
    Ok(())
}

/// Sub-bots (p. ej. el de miniaturas) que vienen dentro de un bot: otros aniuzka.json con `parent`.
pub fn nested_modules(dir: &Path) -> Vec<PathBuf> {
    fn walk(d: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > 4 { return; }
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if !p.is_dir() || name.starts_with('.') || name == "__pycache__" { continue; }
            if p.join("aniuzka.json").exists() { out.push(p.clone()); }
            walk(&p, depth + 1, out);
        }
    }
    let mut out = Vec::new();
    walk(dir, 0, &mut out);
    out.sort();
    out
}

// ------------------------------------------------------------------ IA del amigo

fn find_on_path(exe: &str) -> Option<PathBuf> {
    let mut c = Command::new("where");
    c.arg(exe);
    winutil::hidden(&mut c);
    let out = c.output().ok()?;
    out.status.success().then(|| PathBuf::from(String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").trim()))
}

fn ollama_models() -> Option<Vec<String>> {
    let v: Value = ureq::get(&format!("{OLLAMA_URL}/api/tags")).timeout(Duration::from_secs(3)).call().ok()?.into_json().ok()?;
    Some(v["models"].as_array()?.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect())
}

fn gpu_vram_gb() -> Option<f64> {
    let mut c = Command::new("nvidia-smi");
    c.args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"]);
    winutil::hidden(&mut c);
    let out = c.output().ok()?;
    String::from_utf8_lossy(&out.stdout).lines().next()?.trim().parse::<f64>().ok().map(|mb| mb / 1024.0)
}

/// Modelo de Ollama recomendado según la memoria de la gráfica.
pub fn recommended_ollama_model(vram_gb: Option<f64>) -> &'static str {
    match vram_gb {
        Some(v) if v >= 7.5 => "qwen2.5:7b",
        Some(v) if v >= 3.5 => "qwen2.5:3b",
        _ => "qwen2.5:1.5b",
    }
}

#[tauri::command]
pub async fn ai_status() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        let vram = gpu_vram_gb();
        json!({
            "claude": find_on_path("claude").is_some(),
            "ollama_instalado": find_on_path("ollama").is_some() || ollama_models().is_some(),
            "ollama_activo": ollama_models().is_some(),
            "ollama_modelos": ollama_models().unwrap_or_default(),
            "vram_gb": vram,
            "modelo_recomendado": recommended_ollama_model(vram),
        })
    }).await.unwrap_or(Value::Null)
}

/// Prueba real de Claude con la cuenta del AMIGO (una pregunta mínima). Sin API key: coste cero.
#[tauri::command]
pub async fn test_claude() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(exe) = find_on_path("claude") else {
            return json!({"ok": false, "motivo": "no_instalado"});
        };
        let mut c = Command::new(exe);
        c.args(["-p", "Responde solo con la palabra OK", "--output-format", "text"])
            .env_remove("ANTHROPIC_API_KEY")
            .stdin(std::process::Stdio::null());
        winutil::hidden(&mut c);
        match c.output() {
            Ok(o) if o.status.success() && String::from_utf8_lossy(&o.stdout).to_uppercase().contains("OK") => json!({"ok": true}),
            Ok(o) => {
                let txt = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)).to_lowercase();
                let motivo = if txt.contains("login") || txt.contains("logged") { "sin_sesion" } else { "error" };
                json!({"ok": false, "motivo": motivo})
            }
            Err(e) => json!({"ok": false, "motivo": "error", "detalle": e.to_string()}),
        }
    }).await.unwrap_or(json!({"ok": false}))
}

/// Descarga un modelo de Ollama mostrando el avance (`lirio://ollama`).
#[tauri::command]
pub fn ollama_pull(app: tauri::AppHandle, model: String) -> Result<(), String> {
    std::thread::spawn(move || {
        let mut emit = |fase: &str, detalle: String, percent: Option<u8>| {
            let _ = app.emit("lirio://ollama", json!({"fase": fase, "estado": detalle, "percent": percent, "hecho": false}));
        };
        let res = crate::ollama::pull(&model, &mut emit);
        let _ = app.emit("lirio://ollama", json!({"hecho": true, "ok": res.is_ok(), "error": res.err()}));
    });
    Ok(())
}

/// Todo de una vez, sin que el amigo haga nada: instala Ollama (si falta), lo arranca y baja el modelo.
#[tauri::command]
pub fn ollama_setup(app: tauri::AppHandle, state: State<AppState>, model: String) -> Result<(), String> {
    let cache = state.data_dir.join("descargas");
    let journal = crate::journal::Journal::new(&state.data_dir);
    std::thread::spawn(move || {
        let mut emit = |fase: &str, detalle: String, percent: Option<u8>| {
            let _ = app.emit("lirio://ollama", json!({"fase": fase, "estado": detalle, "percent": percent, "hecho": false}));
        };
        let res = crate::ollama::install(&cache, &mut emit).and_then(|_| crate::ollama::pull(&model, &mut emit));
        journal.add("ia", None, &format!("IA local preparada (Ollama, {model})"), res.is_ok());
        let _ = app.emit("lirio://ollama", json!({"hecho": true, "ok": res.is_ok(), "error": res.err(), "modelo": model}));
    });
    Ok(())
}

// ------------------------------------------------------------------ YouTube del amigo

/// Comprueba que el JSON es un cliente OAuth de "App de escritorio" de Google (sin enseñar su contenido).
pub fn validate_client_secret(txt: &str) -> Result<(), String> {
    let v: Value = serde_json::from_str(txt).map_err(|_| "ese archivo no es un JSON de Google".to_string())?;
    if v.get("web").is_some() {
        return Err("es de tipo «Aplicación web»: crea uno de tipo «App de escritorio»".into());
    }
    let inst = v.get("installed").ok_or("no parece un archivo de credenciales de Google (falta «installed»)")?;
    let id = inst["client_id"].as_str().unwrap_or("");
    if !id.ends_with(".apps.googleusercontent.com") || inst["client_secret"].as_str().unwrap_or("").is_empty() {
        return Err("al archivo le faltan datos (client_id o client_secret)".into());
    }
    Ok(())
}

/// Copia el archivo de credenciales de Google al bot (donde diga su manifiesto). Nunca se devuelve su contenido.
#[tauri::command]
pub fn install_client_secret(state: State<AppState>, id: String, path: String) -> Result<String, String> {
    let m = state.module(&id)?;
    let txt = std::fs::read_to_string(&path).map_err(|e| format!("no se pudo leer el archivo: {e}"))?;
    validate_client_secret(&txt)?;
    // Ruta estándar de los bots (config `youtube.client_secret` por defecto); el asistente la escribe así en config-inicial
    let dest = m.state_root().join(CLIENT_SECRET_REL);
    if let Some(p) = dest.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    std::fs::write(&dest, txt).map_err(|e| e.to_string())?;
    Ok("Credenciales guardadas. Ahora pulsa «Autorizar YouTube».".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_secret_validation() {
        let ok = r#"{"installed": {"client_id": "123-abc.apps.googleusercontent.com", "client_secret": "GOCSPX-x"}}"#;
        assert!(validate_client_secret(ok).is_ok());
        assert!(validate_client_secret(r#"{"web": {}}"#).unwrap_err().contains("escritorio"));
        assert!(validate_client_secret("hola").is_err());
        assert!(validate_client_secret(r#"{"installed": {"client_id": "x"}}"#).is_err());
    }

    #[test]
    fn ollama_model_by_vram() {
        assert_eq!(recommended_ollama_model(Some(6.0)), "qwen2.5:3b");
        assert_eq!(recommended_ollama_model(Some(12.0)), "qwen2.5:7b");
        assert_eq!(recommended_ollama_model(None), "qwen2.5:1.5b");
    }

    #[test]
    fn finds_nested_sub_bots() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("pkg/bots/thumb")).unwrap();
        std::fs::write(d.path().join("pkg/bots/thumb/aniuzka.json"), "{}").unwrap();
        std::fs::create_dir_all(d.path().join(".venv/x")).unwrap();
        std::fs::write(d.path().join(".venv/x/aniuzka.json"), "{}").unwrap();
        assert_eq!(nested_modules(d.path()), vec![d.path().join("pkg/bots/thumb")]);
    }
}
