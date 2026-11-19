//! Conexión con YouTube de cada amigo (su propio proyecto gratuito de Google Cloud).
//! - Del archivo de credenciales solo se mira el tipo de cliente y el `project_id` (para los enlaces directos a SU
//!   consola); el `client_secret` no sale nunca de la carpeta del bot.
//! - Lirio apunta cuándo se autorizó: en modo «Pruebas» Google caduca el permiso a los 7 días.
//! Todo se queda en el PC del amigo.

use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::State;

use crate::{modules::read_json, wizard::CLIENT_SECRET_REL, AppState};

pub const TOKEN_REL: &str = "secrets/token.json";
/// Días que dura el permiso de una app de Google en modo «Pruebas».
pub const DIAS_PRUEBAS: i64 = 7;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClientInfo {
    /// "installed" (app de escritorio, la buena), "web" u "otro"
    pub tipo: String,
    pub project_id: Option<String>,
}

/// Los ID de proyecto de Google son minúsculas, números y guiones (6–30). Cualquier otra cosa no se usa en enlaces.
pub fn clean_project_id(s: &str) -> Option<String> {
    let ok = (6..=30).contains(&s.len()) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    ok.then(|| s.to_string())
}

pub fn client_info(txt: &str) -> Result<ClientInfo, String> {
    let v: Value = serde_json::from_str(txt).map_err(|_| "ese archivo no es un JSON de Google".to_string())?;
    let (tipo, inner) = if let Some(i) = v.get("installed") {
        ("installed", i)
    } else if let Some(w) = v.get("web") {
        ("web", w)
    } else {
        ("otro", &Value::Null)
    };
    Ok(ClientInfo { tipo: tipo.into(), project_id: inner["project_id"].as_str().and_then(clean_project_id) })
}

fn store_path(data_dir: &Path, bot: &str) -> PathBuf {
    data_dir.join("youtube").join(format!("{bot}.json"))
}

fn store_patch(data_dir: &Path, bot: &str, patch: Value) {
    let p = store_path(data_dir, bot);
    let mut cur = read_json(&p);
    if !cur.is_object() { cur = json!({}); }
    if let (Some(dst), Some(src)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, v) in src { dst.insert(k.clone(), v.clone()); }
    }
    if let Some(d) = p.parent() { let _ = std::fs::create_dir_all(d); }
    let _ = std::fs::write(&p, serde_json::to_string_pretty(&cur).unwrap_or_default());
}

pub fn remember_project(data_dir: &Path, bot: &str, info: &ClientInfo) {
    store_patch(data_dir, bot, json!({"project_id": info.project_id}));
}

/// Se llama al terminar bien `auth`.
pub fn mark_authorized(data_dir: &Path, bot: &str, now: chrono::DateTime<chrono::Utc>) {
    store_patch(data_dir, bot, json!({"autorizado_en": now.to_rfc3339()}));
}

/// Estado de la conexión: sin_archivo | sin_autorizar | ok | caduca_pronto | caducado | desconocido
pub fn status_of(client_secret: bool, token: bool, waiting_auth: bool, store: &Value,
                 now: chrono::DateTime<chrono::Utc>) -> Value {
    let since = store["autorizado_en"].as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc));
    let left = since.map(|d| {
        let secs = (d + chrono::Duration::days(DIAS_PRUEBAS) - now).num_seconds();
        (secs as f64 / 86400.0).ceil() as i64
    });
    let estado = if !client_secret {
        "sin_archivo"
    } else if !token {
        "sin_autorizar"
    } else if waiting_auth || left.is_some_and(|d| d <= 0) {
        "caducado"
    } else if left.is_some_and(|d| d <= 1) {
        "caduca_pronto"
    } else if left.is_none() {
        "desconocido"
    } else {
        "ok"
    };
    json!({"estado": estado, "project_id": store["project_id"], "autorizado_en": store["autorizado_en"],
           "dias_restantes": left.map(|d| d.max(0)), "client_secret": client_secret, "token": token})
}

/// Cómo está la conexión con YouTube de un bot (para avisar de la caducidad de 7 días y ofrecer volver a autorizar).
#[tauri::command]
pub fn youtube_status(state: State<AppState>, id: String) -> Result<Value, String> {
    let m = state.module(&id)?;
    let root = m.state_root();
    let queue = read_json(&m.state_file("upload_queue.json"));
    let waiting = queue.as_array().into_iter().flatten().chain(queue["items"].as_array().into_iter().flatten())
        .any(|q| q["status"] == "waiting_auth");
    Ok(status_of(root.join(CLIENT_SECRET_REL).exists(), root.join(TOKEN_REL).exists(), waiting,
                 &read_json(&store_path(&state.data_dir, &id)), chrono::Utc::now()))
}

/// Mira el archivo que eligió el amigo, sin guardarlo: tipo de cliente y proyecto (para enlazar a SU consola).
#[tauri::command]
pub fn youtube_check_file(path: String) -> Result<ClientInfo, String> {
    let txt = std::fs::read_to_string(&path).map_err(|e| format!("no se pudo leer el archivo: {e}"))?;
    client_info(&txt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_type_and_project_but_nothing_else() {
        let inst = r#"{"installed": {"client_id": "1.apps.googleusercontent.com", "project_id": "lirio-123456", "client_secret": "GOCSPX-x"}}"#;
        assert_eq!(client_info(inst).unwrap(), ClientInfo { tipo: "installed".into(), project_id: Some("lirio-123456".into()) });
        let web = r#"{"web": {"project_id": "mi-proyecto-1"}}"#;
        assert_eq!(client_info(web).unwrap().tipo, "web");
        assert_eq!(client_info(r#"{"installed": {"project_id": "x/../evil?a=1"}}"#).unwrap().project_id, None);
        assert_eq!(client_info("{}").unwrap().tipo, "otro");
        assert!(client_info("hola").is_err());
        let s = serde_json::to_string(&client_info(inst).unwrap()).unwrap();
        assert!(!s.contains("GOCSPX"));
    }

    #[test]
    fn seven_day_expiry() {
        let now = chrono::Utc::now();
        let at = |d: i64| json!({"autorizado_en": (now - chrono::Duration::days(d)).to_rfc3339()});
        assert_eq!(status_of(false, false, false, &json!({}), now)["estado"], "sin_archivo");
        assert_eq!(status_of(true, false, false, &json!({}), now)["estado"], "sin_autorizar");
        assert_eq!(status_of(true, true, false, &json!({}), now)["estado"], "desconocido");
        let ok = status_of(true, true, false, &at(1), now);
        assert_eq!((ok["estado"].as_str(), ok["dias_restantes"].as_i64()), (Some("ok"), Some(6)));
        assert_eq!(status_of(true, true, false, &at(6), now)["estado"], "caduca_pronto");
        assert_eq!(status_of(true, true, false, &at(8), now)["estado"], "caducado");
        assert_eq!(status_of(true, true, false, &at(8), now)["dias_restantes"], 0);
        // el bot ya dice que el permiso no sirve: caducado aunque Lirio crea que quedan días
        assert_eq!(status_of(true, true, true, &at(1), now)["estado"], "caducado");
    }

    #[test]
    fn store_keeps_both_fields() {
        let d = tempfile::tempdir().unwrap();
        remember_project(d.path(), "b", &ClientInfo { tipo: "installed".into(), project_id: Some("proyecto-1".into()) });
        mark_authorized(d.path(), "b", chrono::Utc::now());
        let v = read_json(&store_path(d.path(), "b"));
        assert_eq!(v["project_id"], "proyecto-1");
        assert!(v["autorizado_en"].is_string());
    }
}
