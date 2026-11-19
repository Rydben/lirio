//! Avisa a la interfaz cuando cambia algo de un bot, en vez de que la interfaz pregunte cada pocos segundos.
//! Cada segundo mira solo las fechas de unos pocos archivos (no los lee ni lanza Python) y, si alguno cambió,
//! emite `lirio://cambio` con los bots afectados. La interfaz recarga solo entonces (y muy de vez en cuando por si acaso).

use serde_json::json;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{Emitter, Manager};

use crate::modules::{self, Module};
use crate::AppState;

pub const TICK: Duration = Duration::from_millis(1000);
pub const EVENT: &str = "lirio://cambio";

/// Huella de un archivo o carpeta: fecha de modificación y tamaño (una carpeta cambia de fecha al añadir o quitar algo).
fn stamp(p: &Path) -> (Option<SystemTime>, u64) {
    std::fs::metadata(p).map(|m| (m.modified().ok(), m.len())).unwrap_or((None, 0))
}

/// Lo que se vigila de un bot: su carpeta de estado (y cada archivo de dentro), aprobaciones, STOP,
/// el registro de The Wall y la carpeta de vídeos editados.
pub fn watched_paths(m: &Module) -> Vec<PathBuf> {
    let mut v = vec![m.status_path(), m.approvals_path(), m.kill_switch_path(), m.log_dir().join("wall.log"),
                     m.state_root().join("output")];
    let state_dir = m.state_root().join("state");
    if let Ok(rd) = std::fs::read_dir(&state_dir) {
        v.extend(rd.flatten().map(|e| e.path()).filter(|p| p.is_file()));
    }
    v.push(state_dir);
    v
}

pub type Fingerprint = Vec<(Option<SystemTime>, u64)>;

/// Campos del estado que cambian en cada latido aunque no pase nada (el moderador lo escribe cada 5 s).
const HEARTBEAT_FIELDS: &[&str] = &["updated_at", "uptime_s"];

/// Huella del contenido de status.json sin los campos del latido: un bot que solo «late» no avisa de nada.
fn status_stamp(p: &Path) -> (Option<SystemTime>, u64) {
    use std::hash::{Hash, Hasher};
    let Ok(txt) = std::fs::read_to_string(p) else { return (None, 0) };
    let mut v: serde_json::Value = serde_json::from_str(&txt).unwrap_or(serde_json::Value::String(txt));
    if let Some(o) = v.as_object_mut() { for f in HEARTBEAT_FIELDS { o.remove(*f); } }
    let mut h = std::collections::hash_map::DefaultHasher::new();
    v.to_string().hash(&mut h);
    (None, h.finish())
}

pub fn fingerprint(paths: &[PathBuf]) -> Fingerprint {
    paths.iter().map(|p| if p.file_name().is_some_and(|n| n == "status.json") { status_stamp(p) } else { stamp(p) }).collect()
}

/// Bots cuya huella ha cambiado (y actualiza `last`). La primera vez no avisa de nada.
pub fn changed(last: &mut BTreeMap<String, Fingerprint>, now: BTreeMap<String, Fingerprint>) -> Vec<String> {
    let first = last.is_empty();
    let mut out: Vec<String> = now.iter().filter(|(id, f)| last.get(*id) != Some(f)).map(|(id, _)| id.clone()).collect();
    out.extend(last.keys().filter(|id| !now.contains_key(*id)).cloned());
    *last = now;
    if first { vec![] } else { out }
}

pub fn start(app: tauri::AppHandle) {
    std::thread::Builder::new().name("lirio-vigia".into()).spawn(move || {
        let mut last: BTreeMap<String, Fingerprint> = BTreeMap::new();
        let mut mods: Vec<Module> = vec![];
        let mut cfg_stamp = None;
        loop {
            std::thread::sleep(TICK);
            let state = app.state::<AppState>();
            // la lista de bots solo se vuelve a leer si cambia la configuración
            let s = stamp(&state.config_path);
            if Some(s) != cfg_stamp {
                cfg_stamp = Some(s);
                mods = modules::discover(&state.config()).0;
                if !last.is_empty() { let _ = app.emit(EVENT, json!({"bots": [], "config": true})); }
            }
            let now = mods.iter().map(|m| (m.id.clone(), fingerprint(&watched_paths(m)))).collect();
            let bots = changed(&mut last, now);
            if !bots.is_empty() {
                let _ = app.emit(EVENT, json!({"bots": bots, "config": false}));
            }
        }
    }).expect("no se pudo arrancar el vigía de cambios");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_alone_is_not_a_change() {
        let d = tempfile::tempdir().unwrap();
        let st = d.path().join("status.json");
        std::fs::write(&st, r#"{"state": "watching", "updated_at": "10:00:00", "uptime_s": 5}"#).unwrap();
        let a = fingerprint(&[st.clone()]);
        std::fs::write(&st, r#"{"state": "watching", "updated_at": "10:00:05", "uptime_s": 10}"#).unwrap();
        assert_eq!(fingerprint(&[st.clone()]), a);
        std::fs::write(&st, r#"{"state": "running", "updated_at": "10:00:10", "uptime_s": 15}"#).unwrap();
        assert_ne!(fingerprint(&[st.clone()]), a);
    }

    #[test]
    fn only_reports_bots_that_changed() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a.json");
        let b = d.path().join("b.json");
        std::fs::write(&a, "1").unwrap();
        std::fs::write(&b, "1").unwrap();
        let snap = || BTreeMap::from([("a".to_string(), fingerprint(&[a.clone()])), ("b".to_string(), fingerprint(&[b.clone()]))]);
        let mut last = BTreeMap::new();
        assert!(changed(&mut last, snap()).is_empty(), "la primera vuelta no avisa");
        assert!(changed(&mut last, snap()).is_empty());
        std::fs::write(&b, "22").unwrap(); // cambia el tamaño: se nota aunque la fecha sea la misma
        assert_eq!(changed(&mut last, snap()), vec!["b".to_string()]);
        std::fs::remove_file(&a).unwrap();
        assert_eq!(changed(&mut last, snap()), vec!["a".to_string()]);
        let only_b = BTreeMap::from([("b".to_string(), fingerprint(&[b.clone()]))]);
        assert_eq!(changed(&mut last, only_b), vec!["a".to_string()], "un bot quitado también avisa");
    }
}
