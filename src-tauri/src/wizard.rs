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
    !state.config_path.exists() || state.config().modulos.is_empty()
}

#[tauri::command]
pub async fn get_catalog() -> Result<Value, String> {
    let (cat, _) = tauri::async_runtime::spawn_blocking(catalog::fetch).await.map_err(|e| e.to_string())??;
    Ok(json!({ "bots": cat.bots, "nvidia": installer::has_nvidia() }))
}

/// Instala los bots elegidos en segundo plano. Emite `lirio://instalacion` con cada paso y, al final, `hecho`.
#[tauri::command]
pub fn install_bots(app: tauri::AppHandle, state: State<AppState>, ids: Vec<String>, answers: Value) -> Result<(), String> {
    let approver_public = serde_json::to_value(state.approver.public_info()).unwrap();
    let data_dir = state.data_dir.clone();
    let config_path = state.config_path.clone();
    let journal = crate::journal::Journal::new(&state.data_dir);
    let use_defaults = state.use_defaults;
    std::thread::spawn(move || {
        let emit = |v: Value| { let _ = app.emit("lirio://instalacion", v); };
        let result = (|| -> Result<Vec<ModuleEntry>, String> {
            let (cat, base) = catalog::fetch()?;
            let bots_root = data_dir.join("bots");
            let cache = data_dir.join("descargas");
            let mut entries = Vec::new();
            for id in &ids {
                let entry = cat.bots.iter().find(|b| &b.id == id).ok_or(format!("{id} no está en el catálogo"))?;
                if entry.padre.is_some() { continue; } // los sub-bots vienen dentro de su bot principal
                let job = installer::InstallJob { entry, base: &base, bots_root: &bots_root, cache: &cache,
                                                  approver_public: approver_public.clone(), answers: &answers };
                let dir = installer::install_bot(&job, &mut |s| emit(json!({"step": s})))?;
                entries.push(ModuleEntry { ruta: dir.clone(), tarea: None });
                for sub in nested_modules(&dir) {
                    entries.push(ModuleEntry { ruta: sub, tarea: None });
                }
            }
            Ok(entries)
        })();
        match result {
            Ok(entries) => {
                let mut cfg = LirioConfig::load_with(&config_path, use_defaults);
                cfg.usuario = answers["nombre"].as_str().filter(|s| !s.is_empty()).map(String::from).or(cfg.usuario);
                for e in entries {
                    if !cfg.modulos.iter().any(|m| m.ruta == e.ruta) { cfg.modulos.push(e); }
                }
                let saved = cfg.save(&config_path);
                journal.add("instalacion", None, &format!("Bots instalados: {}", ids.join(", ")), saved.is_ok());
                emit(json!({"hecho": true, "ok": saved.is_ok(), "error": saved.err()}));
            }
            Err(err) => {
                journal.add("instalacion", None, "La instalación no terminó", false);
                emit(json!({"hecho": true, "ok": false, "error": err}))
            }
        }
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
    if !model.chars().all(|c| c.is_ascii_alphanumeric() || ".:-_".contains(c)) {
        return Err("nombre de modelo no válido".into());
    }
    std::thread::spawn(move || {
        let emit = |v: Value| { let _ = app.emit("lirio://ollama", v); };
        let res = (|| -> Result<(), String> {
            let resp = ureq::post(&format!("{OLLAMA_URL}/api/pull")).timeout(Duration::from_secs(60 * 60 * 3))
                .send_json(json!({"model": model, "stream": true})).map_err(|e| format!("Ollama no responde: {e}"))?;
            use std::io::BufRead;
            for line in std::io::BufReader::new(resp.into_reader()).lines().map_while(Result::ok) {
                let v: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
                if let Some(err) = v["error"].as_str() { return Err(err.to_string()); }
                let pct = match (v["completed"].as_f64(), v["total"].as_f64()) {
                    (Some(c), Some(t)) if t > 0.0 => Some((c / t * 100.0) as u8),
                    _ => None,
                };
                emit(json!({"estado": v["status"], "percent": pct, "hecho": false}));
            }
            Ok(())
        })();
        emit(json!({"hecho": true, "ok": res.is_ok(), "error": res.err()}));
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
