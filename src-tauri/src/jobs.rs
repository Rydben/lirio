//! Trabajos largos de los bots (analizar un vídeo de referencia, hacer miniaturas, editar ahora…) en segundo plano.
//! - Nunca se espera a la CLI con la interfaz parada: se lanza, y el avance llega por `lirio://trabajo`.
//! - El bot avisa con líneas `PROGRESO n` y `ETAPA texto` en stderr.
//! - No se lanza dos veces el mismo trabajo del mismo bot mientras uno siga en marcha.
//! - Se puede cancelar (se cierra el proceso y sus hijos).

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::BufRead;
use std::process::Stdio;
use std::sync::{LazyLock, Mutex};
use tauri::{Emitter, State};

use crate::{cli, flags, winutil, AppState};

/// Comandos que van siempre como trabajo en segundo plano (los demás, con `run_with` y tiempo límite).
/// (`editar` vuelve enseguida: a la cola del watcher o en segundo plano; su avance sale en status.json)
/// `auth` también: espera a que el amigo acepte en su navegador (o a que se cancele si Google le enseña un error).
pub const LONG: &[&str] = &["estilo-video", "estilo-miniatura", "miniaturas-generar", "auth", "guion"];

struct Job {
    pid: Option<u32>,
    last: Value,
}

static JOBS: LazyLock<Mutex<BTreeMap<String, Job>>> = LazyLock::new(Default::default);

pub fn key(bot: &str, command: &str) -> String {
    format!("{bot}:{command}")
}

/// `ETAPA Analizando cortes` -> "Analizando cortes"
pub fn stage_line(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("ETAPA")?.trim();
    (!rest.is_empty()).then(|| rest.chars().take(120).collect())
}

pub fn is_running(k: &str) -> bool {
    JOBS.lock().unwrap().get(k).is_some_and(|j| j.last["hecho"] == false)
}

/// Lanza un trabajo largo. Error si ya hay uno igual en marcha.
#[tauri::command]
pub fn job_start(app: tauri::AppHandle, state: State<AppState>, id: String, command: String,
                 flags: serde_json::Map<String, Value>) -> Result<String, String> {
    if !LONG.contains(&command.as_str()) {
        return Err(format!("«{command}» no es un trabajo largo"));
    }
    let m = state.module(&id)?;
    let mut cmd = cli::build_command_with_flags(&m, &command, &flags)?;
    let k = key(&id, &command);
    {
        let mut jobs = JOBS.lock().unwrap();
        if jobs.get(&k).is_some_and(|j| j.last["hecho"] == false) {
            return Err("Ya se está haciendo: espera a que termine (o cancélalo).".into());
        }
        let start = json!({"clave": k, "bot": id, "comando": command, "percent": null, "etapa": "Empezando…", "hecho": false});
        jobs.insert(k.clone(), Job { pid: None, last: start });
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    let journal = crate::journal::Journal::new(&state.data_dir);
    let data_dir = state.data_dir.clone();
    let name = m.name();
    let k2 = k.clone();
    std::thread::spawn(move || {
        let update = |patch: Value| {
            let mut jobs = JOBS.lock().unwrap();
            if let Some(j) = jobs.get_mut(&k2) {
                if let (Some(dst), Some(src)) = (j.last.as_object_mut(), patch.as_object()) {
                    for (a, b) in src { dst.insert(a.clone(), b.clone()); }
                }
                let _ = app.emit("lirio://trabajo", j.last.clone());
            }
        };
        let result = match cmd.spawn() {
            Err(e) => cli::CliResult { ok: false, code: -1, data: Value::Null, message: format!("no se pudo lanzar: {e}") },
            Ok(mut child) => {
                if let Some(j) = JOBS.lock().unwrap().get_mut(&k2) { j.pid = Some(child.id()); }
                let mut stdout = child.stdout.take().unwrap();
                let out_h = std::thread::spawn(move || { let mut b = Vec::new(); let _ = std::io::Read::read_to_end(&mut stdout, &mut b); b });
                let mut err_tail: Vec<String> = Vec::new();
                for line in std::io::BufReader::new(child.stderr.take().unwrap()).lines().map_while(Result::ok) {
                    if let Some(p) = flags::progress_line(&line) {
                        update(json!({"percent": p}));
                    } else if let Some(s) = stage_line(&line) {
                        update(json!({"etapa": s}));
                    } else if !line.trim().is_empty() {
                        err_tail.push(line);
                        if err_tail.len() > 5 { err_tail.remove(0); }
                    }
                }
                let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
                let out = out_h.join().unwrap_or_default();
                cli::interpret(code, &out, err_tail.join("\n").as_bytes())
            }
        };
        let cancelled = JOBS.lock().unwrap().get(&k2).is_some_and(|j| j.last["cancelado"] == true);
        if result.ok && !cancelled && k2.ends_with(":auth") {
            crate::youtube::mark_authorized(&data_dir, k2.split(':').next().unwrap_or_default(), chrono::Utc::now());
        }
        journal.add("trabajo", Some(&k2.split(':').next().unwrap_or_default().to_string()),
                    &format!("{name}: {} {}", k2.split(':').nth(1).unwrap_or_default(),
                             if cancelled { "cancelado" } else if result.ok { "hecho" } else { "falló" }), result.ok);
        update(json!({"hecho": true, "ok": result.ok && !cancelled, "resultado": result.data, "mensaje": result.message,
                      "percent": if result.ok { json!(100) } else { Value::Null }}));
        if let Some(j) = JOBS.lock().unwrap().get_mut(&k2) { j.pid = None; }
    });
    Ok(k)
}

/// Cómo van los trabajos (en marcha y los últimos terminados), para enseñarlos al volver a una página.
#[tauri::command]
pub fn jobs_status() -> Value {
    Value::Object(JOBS.lock().unwrap().iter().map(|(k, j)| (k.clone(), j.last.clone())).collect())
}

/// Cancela un trabajo en marcha (cierra el proceso del bot y sus hijos).
#[tauri::command]
pub fn job_cancel(clave: String) -> bool {
    let pid = {
        let mut jobs = JOBS.lock().unwrap();
        let Some(j) = jobs.get_mut(&clave) else { return false };
        if j.last["hecho"] != false { return false; }
        j.last["cancelado"] = json!(true);
        j.pid
    };
    if let Some(pid) = pid {
        let mut k = std::process::Command::new("taskkill");
        k.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        winutil::hidden(&mut k);
        let _ = k.status();
    }
    true
}

/// Espera a un comando corto como mucho `limit`; si se pasa, lo cierra y avisa (la interfaz nunca se queda colgada).
pub fn output_with_timeout(mut cmd: std::process::Command, limit: std::time::Duration) -> Result<std::process::Output, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("no se pudo lanzar: {e}"))?;
    let mut so = child.stdout.take().unwrap();
    let mut se = child.stderr.take().unwrap();
    let oh = std::thread::spawn(move || { let mut b = Vec::new(); let _ = std::io::Read::read_to_end(&mut so, &mut b); b });
    let eh = std::thread::spawn(move || { let mut b = Vec::new(); let _ = std::io::Read::read_to_end(&mut se, &mut b); b });
    let t0 = std::time::Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? { break s; }
        if t0.elapsed() > limit {
            let mut k = std::process::Command::new("taskkill");
            k.args(["/PID", &child.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
            winutil::hidden(&mut k);
            let _ = k.status();
            let _ = child.wait();
            return Err(format!("El bot tardó más de {} s en responder y lo he parado. Prueba otra vez en un rato.", limit.as_secs()));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    Ok(std::process::Output { status, stdout: oh.join().unwrap_or_default(), stderr: eh.join().unwrap_or_default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage_lines() {
        assert_eq!(stage_line("ETAPA Analizando cortes").as_deref(), Some("Analizando cortes"));
        assert_eq!(stage_line("ETAPA   "), None);
        assert_eq!(stage_line("PROGRESO 3"), None);
    }

    #[test]
    fn short_commands_are_cut_at_the_limit() {
        let mut c = std::process::Command::new("ping");
        c.args(["-n", "30", "127.0.0.1"]);
        let t0 = std::time::Instant::now();
        let r = output_with_timeout(c, std::time::Duration::from_millis(500));
        assert!(r.unwrap_err().contains("tardó"));
        assert!(t0.elapsed() < std::time::Duration::from_secs(10));
        let mut ok = std::process::Command::new("cmd");
        ok.args(["/c", "echo hola"]);
        assert!(String::from_utf8_lossy(&output_with_timeout(ok, std::time::Duration::from_secs(10)).unwrap().stdout).contains("hola"));
    }
}
