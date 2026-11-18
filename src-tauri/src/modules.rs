//! Bots como módulos Aniuzka: se descubren por su manifiesto `aniuzka.json` y se leen SIN tocarlos
//! (solo lectura de `state/` y de `STOP`; las acciones van siempre por su CLI).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::winutil;

/// Configuración de Lirio (`%APPDATA%\Lirio\config.json`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LirioConfig {
    #[serde(default)]
    pub usuario: Option<String>,
    #[serde(default)]
    pub modulos: Vec<ModuleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleEntry {
    /// Carpeta que contiene `aniuzka.json`.
    pub ruta: PathBuf,
    /// Tarea programada que mantiene el bot en marcha (`schtasks /Run`), si la hay.
    #[serde(default)]
    pub tarea: Option<String>,
}

impl LirioConfig {
    /// `use_defaults=false`: nunca rellena con los bots del creador (configuraciones de prueba con LIRIO_CONFIG).
    pub fn load_with(path: &Path, use_defaults: bool) -> Self {
        if let Ok(txt) = std::fs::read_to_string(path) {
            if let Ok(cfg) = serde_json::from_str::<LirioConfig>(&txt) {
                return cfg;
            }
        }
        let cfg = if use_defaults { Self::defaults() } else { Self::default() };
        if !cfg.modulos.is_empty() {
            let _ = cfg.save(path); // solo en el PC del creador; en el de un amigo, lo guarda el asistente
        }
        cfg
    }

    /// Los bots del PC del usuario. En la fase 2, el asistente de amigos rellenará esto.
    /// En el PC del creador, sus bots de desarrollo; en el de un amigo, nada (lo rellena el asistente).
    pub fn defaults() -> Self {
        Self::defaults_in(&dirs::home_dir().unwrap_or_default().join("Projects"))
    }

    pub fn defaults_in(projects: &Path) -> Self {
        let editor = projects.join("twitch-autoeditor");
        let candidates = vec![
            ModuleEntry { ruta: editor.clone(), tarea: Some("TwitchAutoEditorWatch".into()) },
            ModuleEntry { ruta: editor.join("twitch_autoeditor").join("bots").join("thumbnail"), tarea: None },
            ModuleEntry { ruta: projects.join("twitch-moderator"), tarea: Some("TwitchModeratorWatch".into()) },
        ];
        Self { usuario: None, modulos: candidates.into_iter().filter(|m| m.ruta.join("aniuzka.json").exists()).collect() }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(path, serde_json::to_vec_pretty(self).unwrap()).map_err(|e| e.to_string())
    }
}

/// Un módulo descubierto: el manifiesto ya resuelto a rutas absolutas.
#[derive(Debug, Clone)]
pub struct Module {
    pub id: String,
    pub dir: PathBuf,
    pub manifest: Value,
    pub task: Option<String>,
}

impl Module {
    pub fn load(entry: &ModuleEntry) -> Result<Self, String> {
        let mpath = entry.ruta.join("aniuzka.json");
        let txt = std::fs::read_to_string(&mpath).map_err(|e| format!("{}: {e}", mpath.display()))?;
        let manifest: Value = serde_json::from_str(&txt).map_err(|e| format!("{}: {e}", mpath.display()))?;
        let spec = manifest["spec"].as_str().unwrap_or_default();
        if !spec.starts_with("aniuzka-module/") {
            return Err(format!("{}: spec desconocida '{spec}'", mpath.display()));
        }
        let id = manifest["id"].as_str().ok_or("manifiesto sin id")?.to_string();
        Ok(Self { id, dir: entry.ruta.clone(), manifest, task: entry.tarea.clone() })
    }

    pub fn name(&self) -> String {
        self.manifest["name"].as_str().unwrap_or(&self.id).to_string()
    }

    /// Carpeta de trabajo de la CLI (`entrypoint.cwd`, relativa al manifiesto).
    pub fn cwd(&self) -> PathBuf {
        normalize(&self.dir.join(self.manifest["entrypoint"]["cwd"].as_str().unwrap_or(".")))
    }

    pub fn python(&self) -> PathBuf {
        let p = self.manifest["entrypoint"]["python"].as_str().unwrap_or("python");
        normalize(&self.dir.join(p))
    }

    /// Archivos imprescindibles del bot que han desaparecido (típico de un antivirus que los pone en cuarentena:
    /// el Python privado del bot y su pythonw, sin firma de Authenticode). Vacío si todo está.
    pub fn missing_files(&self) -> Vec<String> {
        let py = self.python();
        // "python" a secas = el del sistema (bots del creador): no se comprueba aquí
        if !py.is_absolute() || !py.parent().is_some_and(|d| d.ends_with("Scripts")) { return vec![]; }
        // solo si el resto de ese Python sigue ahí (lo que deja una cuarentena): su DLL o el pyvenv.cfg del venv
        let scripts = py.parent().unwrap();
        let rest = scripts.join("python312.dll").exists()
            || scripts.parent().is_some_and(|v| v.join("pyvenv.cfg").exists());
        let mut out = vec![];
        if !rest { return out; }
        if !py.exists() { out.push(py.display().to_string()); }
        let pyw = py.with_file_name("pythonw.exe");
        if py.exists() && !pyw.exists() && py.with_file_name("python312.dll").exists() { out.push(pyw.display().to_string()); }
        out
    }

    pub fn py_module(&self) -> String {
        self.manifest["entrypoint"]["module"].as_str().unwrap_or_default().to_string()
    }

    /// Raíz donde viven state/, logs/ y STOP: la del propio módulo o, para los sub-bots, la de su padre.
    pub fn state_root(&self) -> PathBuf {
        if self.manifest.get("paths").is_some() { self.dir.clone() } else { self.cwd() }
    }

    fn rel(&self, key: &str, default: &str) -> PathBuf {
        let r = self.manifest["paths"][key].as_str().unwrap_or(default);
        self.state_root().join(r)
    }

    pub fn status_path(&self) -> PathBuf { self.rel("status", "state/status.json") }
    pub fn approvals_path(&self) -> PathBuf { self.rel("approvals", "state/approvals.json") }
    pub fn kill_switch_path(&self) -> PathBuf {
        let f = self.manifest["wall"]["kill_switch"]["file"].as_str()
            .or_else(|| self.manifest["paths"]["kill_switch"].as_str()).unwrap_or("STOP");
        self.state_root().join(f)
    }
    pub fn state_file(&self, name: &str) -> PathBuf { self.state_root().join("state").join(name) }
    pub fn log_dir(&self) -> PathBuf { self.rel("logs", "logs/") }

    pub fn has_command(&self, name: &str) -> bool {
        self.manifest["commands"].get(name).is_some()
    }

    pub fn is_sub_bot(&self) -> bool {
        self.manifest.get("parent").is_some()
    }

    /// Vista para la interfaz: manifiesto resumido + estado real leído de disco.
    pub fn view(&self) -> Value {
        let status = if self.is_sub_bot() { Value::Null } else { read_json(&self.status_path()) };
        let mut state = status["state"].as_str().unwrap_or(if self.is_sub_bot() { "on_demand" } else { "unknown" }).to_string();
        let mut note: Option<&str> = None;
        if matches!(state.as_str(), "running" | "watching") {
            if let Some(pid) = status["pid"].as_u64() {
                if !winutil::pid_alive(pid as u32) {
                    (state, note) = self.liveness(&status);
                } else if heartbeat_age_s(&status).is_some_and(|age| age > HEARTBEAT_STALE_S) {
                    // vivo pero sin latido: colgado (p. ej. esperando a la red sin tiempo límite)
                    state = "stalled".into();
                    note = Some("sigue abierto pero no da señales de vida");
                }
            }
        }
        let installing = self.dir.join(crate::installer::INSTALL_MARK).exists();
        if installing {
            let running = self.dir.file_name().is_some_and(|n| crate::wizard::is_installing(&n.to_string_lossy()));
            state = if running { "installing" } else { "install_pending" }.into();
            note = Some(if running { "instalándose" } else { "la instalación no terminó: puedes continuarla" });
        }
        let missing = if installing { vec![] } else { self.missing_files() };
        if !missing.is_empty() {
            state = "files_missing".into();
            note = Some("faltan archivos del bot: puede que el antivirus los haya puesto en cuarentena");
        }
        // Un sub-bot (miniaturas) comparte el estado de su bot principal: sus solicitudes ya salen en el principal,
        // que es quien las aprueba. Aquí no se repiten.
        let pending: Vec<Value> = if self.is_sub_bot() { vec![] } else { pending_list(&read_json(&self.approvals_path())) };
        let stop_active = !self.is_sub_bot() && self.kill_switch_path().exists();
        let stop_requested = self.state_file("stop.flag").exists();
        json!({
            "id": self.id,
            "name": self.name(),
            "description": self.manifest["description"],
            "version": self.manifest["version"],
            "parent": self.manifest["parent"],
            "dir": self.dir,
            "task": self.task,
            "commands": self.manifest["commands"].as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),
            "state": state,
            "state_note": note,
            "status": status,
            "pinned_key": self.pinned_key(),
            "approvals_pending": pending,
            "stop_active": stop_active,
            "stop_requested": stop_requested,
            "icon": icon_data_url(&self.dir, &self.manifest),
            "missing_files": missing,
            "installing": installing,
        })
    }
}

impl Module {
    /// status.json dice "en marcha" pero su PID ya no existe. Antes de decir "caído" se comprueba de verdad:
    /// otro proceso del bot vivo (state/watch.pid), su tarea programada en marcha, o que el PC se haya reiniciado.
    fn liveness(&self, status: &Value) -> (String, Option<&'static str>) {
        if let Ok(txt) = std::fs::read_to_string(self.state_file("watch.pid")) {
            if txt.trim().parse::<u32>().is_ok_and(winutil::pid_alive) {
                return ("watching".into(), Some("estado sin actualizar, pero el proceso está vivo"));
            }
        }
        if let Some(task) = &self.task {
            if task_running(task) {
                return ("watching".into(), Some("arrancando con su tarea de Windows"));
            }
        }
        let updated = status["heartbeat_at"].as_str().or(status["updated_at"].as_str())
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok());
        if let (Some(u), Some(boot)) = (updated, winutil::boot_time()) {
            if u.with_timezone(&chrono::Utc) < boot {
                return ("stopped".into(), Some("el PC se reinició desde la última vez"));
            }
        }
        ("crashed".into(), Some("se cerró sin avisar"))
    }

    /// Llave pública de Lirio fijada en wall_rules.json del bot (en los sub-bots, la de su bot principal).
    pub fn pinned_key(&self) -> Value {
        let rel = self.manifest["paths"]["wall_rules"].as_str().unwrap_or("wall_rules.json");
        let rules = read_json(&self.state_root().join(rel));
        let lirio = &rules["aprobadores_humanos"]["lirio"];
        if lirio.is_object() { json!({"id": lirio["id"], "llave_publica": lirio["llave_publica"]}) } else { Value::Null }
    }
}

/// El editor renueva `heartbeat_at` cada 30 s; más de 2 min sin latido con el proceso vivo = colgado.
pub const HEARTBEAT_STALE_S: i64 = 120;

/// Segundos desde el último latido (None si el bot no publica latido).
pub fn heartbeat_age_s(status: &Value) -> Option<i64> {
    let t = chrono::DateTime::parse_from_rfc3339(status["heartbeat_at"].as_str()?).ok()?;
    Some((chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds())
}

/// ¿Está en marcha la tarea programada? ("Running" / "En ejecución" según el idioma de Windows)
fn task_running(task: &str) -> bool {
    if !task.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return false;
    }
    let mut c = std::process::Command::new("schtasks");
    c.args(["/Query", "/TN", task, "/FO", "CSV", "/NH"]);
    winutil::hidden(&mut c);
    c.output().map(|o| {
        let t = String::from_utf8_lossy(&o.stdout).to_lowercase();
        t.contains("running") || t.contains("en ejecuci")
    }).unwrap_or(false)
}

fn pending_list(approvals: &Value) -> Vec<Value> {
    // editor: lista; moderador (`approvals --json`): {"pending": [...]}; en disco puede ser cualquiera de las dos
    let list = if approvals.is_array() { approvals.clone() } else { approvals["pending"].clone() };
    list.as_array().map(|a| a.iter().filter(|r| r["status"] == "pending").cloned().collect()).unwrap_or_default()
}

/// Lee un JSON; si falta o está a medio escribir, devuelve Null (nunca rompe la interfaz).
pub fn read_json(path: &Path) -> Value {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

fn icon_data_url(dir: &Path, manifest: &Value) -> Value {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let Some(rel) = manifest["assets"]["icon"].as_str() else { return Value::Null };
    let p = dir.join(rel);
    match std::fs::read(&p) {
        Ok(bytes) if bytes.len() < 512 * 1024 => Value::String(format!("data:image/png;base64,{}", B64.encode(bytes))),
        _ => Value::Null,
    }
}

/// Quita `..` y `.` sin tocar el disco (para rutas relativas de los manifiestos).
pub fn normalize(p: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => { out.pop(); }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn discover(cfg: &LirioConfig) -> (Vec<Module>, Vec<String>) {
    let mut mods = Vec::new();
    let mut errors = Vec::new();
    for e in &cfg.modulos {
        match Module::load(e) {
            Ok(m) if mods.iter().any(|x: &Module| x.id == m.id) => errors.push(format!("id repetido: {}", m.id)),
            Ok(m) => mods.push(m),
            Err(err) => errors.push(err),
        }
    }
    (mods, errors)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, v: &Value) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, serde_json::to_vec(v).unwrap()).unwrap();
    }

    fn fake_module(root: &Path) -> ModuleEntry {
        write(&root.join("aniuzka.json"), &json!({
            "spec": "aniuzka-module/0.1", "id": "bot-x", "name": "Bot X", "version": "1.0.0",
            "entrypoint": {"python": ".venv/Scripts/python.exe", "module": "bot_x", "cwd": "."},
            "commands": {"status": {"argv": ["status"]}, "stop": {"argv": ["stop"]}},
            "paths": {"status": "state/status.json", "approvals": "state/approvals.json", "kill_switch": "STOP"}
        }));
        ModuleEntry { ruta: root.to_path_buf(), tarea: None }
    }

    #[test]
    fn discovers_and_reads_state() {
        let d = tempfile::tempdir().unwrap();
        let entry = fake_module(d.path());
        write(&d.path().join("state/status.json"), &json!({"state": "idle"}));
        write(&d.path().join("state/approvals.json"), &json!([
            {"id": "a1", "status": "pending", "action": "youtube.publish_public"},
            {"id": "a2", "status": "used"}]));
        let m = Module::load(&entry).unwrap();
        assert_eq!(m.python(), d.path().join(".venv").join("Scripts").join("python.exe"));
        let v = m.view();
        assert_eq!(v["state"], "idle");
        assert_eq!(v["approvals_pending"].as_array().unwrap().len(), 1);
        assert_eq!(v["stop_active"], false);
        std::fs::write(d.path().join("STOP"), "").unwrap();
        assert_eq!(m.view()["stop_active"], true);
    }

    #[test]
    fn dead_pid_means_crashed() {
        let d = tempfile::tempdir().unwrap();
        let entry = fake_module(d.path());
        write(&d.path().join("state/status.json"), &json!({"state": "watching", "pid": 4_000_000_000u64}));
        assert_eq!(Module::load(&entry).unwrap().view()["state"], "crashed");
        write(&d.path().join("state/status.json"), &json!({"state": "watching", "pid": std::process::id()}));
        assert_eq!(Module::load(&entry).unwrap().view()["state"], "watching");
    }

    #[test]
    fn dead_pid_but_live_watch_pid_is_not_crashed() {
        let d = tempfile::tempdir().unwrap();
        let entry = fake_module(d.path());
        write(&d.path().join("state/status.json"), &json!({"state": "watching", "pid": 4_000_000_000u64}));
        std::fs::write(d.path().join("state/watch.pid"), std::process::id().to_string()).unwrap();
        assert_eq!(Module::load(&entry).unwrap().view()["state"], "watching");
    }

    #[test]
    fn status_from_before_reboot_is_stopped_not_crashed() {
        let d = tempfile::tempdir().unwrap();
        let entry = fake_module(d.path());
        write(&d.path().join("state/status.json"),
              &json!({"state": "watching", "pid": 4_000_000_000u64, "updated_at": "2000-01-01T00:00:00+00:00"}));
        let v = Module::load(&entry).unwrap().view();
        assert_eq!(v["state"], "stopped");
        assert!(v["state_note"].as_str().unwrap().contains("reinici"));
    }

    #[test]
    fn alive_but_silent_is_stalled() {
        let d = tempfile::tempdir().unwrap();
        let entry = fake_module(d.path());
        let old = (chrono::Utc::now() - chrono::Duration::minutes(10)).to_rfc3339();
        let fresh = chrono::Utc::now().to_rfc3339();
        write(&d.path().join("state/status.json"), &json!({"state": "watching", "pid": std::process::id(), "heartbeat_at": old}));
        assert_eq!(Module::load(&entry).unwrap().view()["state"], "stalled");
        write(&d.path().join("state/status.json"), &json!({"state": "watching", "pid": std::process::id(), "heartbeat_at": fresh}));
        assert_eq!(Module::load(&entry).unwrap().view()["state"], "watching");
        // sin latido (moderador, bots antiguos): no se juzga por eso
        write(&d.path().join("state/status.json"), &json!({"state": "watching", "pid": std::process::id()}));
        assert_eq!(Module::load(&entry).unwrap().view()["state"], "watching");
    }

    #[test]
    fn reads_pinned_key() {
        let d = tempfile::tempdir().unwrap();
        let entry = fake_module(d.path());
        assert!(Module::load(&entry).unwrap().pinned_key().is_null());
        write(&d.path().join("wall_rules.json"), &json!({"aprobadores_humanos": {"lirio": {"id": "lirio-x", "llave_publica": "AAA"}}}));
        assert_eq!(Module::load(&entry).unwrap().pinned_key()["id"], "lirio-x");
    }

    #[test]
    fn half_written_status_does_not_break() {
        let d = tempfile::tempdir().unwrap();
        let entry = fake_module(d.path());
        std::fs::create_dir_all(d.path().join("state")).unwrap();
        std::fs::write(d.path().join("state/status.json"), "{\"state\": \"runn").unwrap();
        assert_eq!(Module::load(&entry).unwrap().view()["state"], "unknown");
    }

    #[test]
    fn sub_bot_uses_parent_cwd_and_has_no_status() {
        let d = tempfile::tempdir().unwrap();
        let sub = d.path().join("pkg").join("bots").join("thumb");
        write(&sub.join("aniuzka.json"), &json!({
            "spec": "aniuzka-module/0.1", "id": "thumb", "name": "Miniaturas", "parent": "bot-x",
            "entrypoint": {"python": "../../../.venv/Scripts/python.exe", "module": "pkg.bots.thumb", "cwd": "../../.."},
            "commands": {"run": {"argv": ["<out_dir>"]}}
        }));
        // el editor tiene una solicitud pendiente en el estado que comparten: sale en el editor, no en el sub-bot
        write(&d.path().join("state/approvals.json"), &json!([{"id": "28ae4db4", "action": "files.delete_por_usuario", "status": "pending"}]));
        let m = Module::load(&ModuleEntry { ruta: sub, tarea: None }).unwrap();
        assert_eq!(m.cwd(), d.path());
        assert_eq!(m.view()["state"], "on_demand");
        assert_eq!(m.view()["approvals_pending"], json!([]), "sin duplicados en el bot de miniaturas");
    }

    #[test]
    fn defaults_only_include_existing_bots() {
        let d = tempfile::tempdir().unwrap();
        assert!(LirioConfig::defaults_in(d.path()).modulos.is_empty(), "en el PC de un amigo no hay nada");
        write(&d.path().join("twitch-moderator/aniuzka.json"), &json!({}));
        let cfg = LirioConfig::defaults_in(d.path());
        assert_eq!(cfg.modulos.len(), 1);
        assert_eq!(cfg.modulos[0].tarea.as_deref(), Some("TwitchModeratorWatch"));
    }

    #[test]
    fn rejects_non_aniuzka_manifest_and_duplicates() {
        let d = tempfile::tempdir().unwrap();
        write(&d.path().join("a/aniuzka.json"), &json!({"spec": "otra/1", "id": "x"}));
        let e1 = fake_module(&d.path().join("b"));
        let e2 = fake_module(&d.path().join("c"));
        let cfg = LirioConfig { usuario: None, modulos: vec![
            ModuleEntry { ruta: d.path().join("a"), tarea: None }, e1, e2] };
        let (mods, errs) = discover(&cfg);
        assert_eq!(mods.len(), 1);
        assert_eq!(errs.len(), 2);
    }
}
