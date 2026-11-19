//! Lirio: launcher de escritorio para los bots (módulos Aniuzka). Fase 1.
//!
//! Principios: los bots están en producción, así que Lirio SOLO lee su estado y usa sus CLIs; las
//! aprobaciones van firmadas tras un gesto humano (ver approver.rs); parar siempre es libre, y reanudar
//! tras un STOP pide el mismo gesto. Aniuzka (privada) no vive aquí: será un módulo aparte en la fase 3.

mod approver;
mod autostart;
pub mod catalog;
mod cli;
pub mod fetch;
mod ollama;
pub mod portable;
pub mod usb;
mod flags;
pub mod installer;
mod jobs;
mod journal;
mod modules;
mod upload;
pub mod winutil;
mod wizard;
mod youtube;
mod watch;
mod monetizacion;

use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, State};

use approver::Approver;
use modules::{read_json, LirioConfig, Module};

pub struct AppState {
    pub(crate) config_path: PathBuf,
    pub(crate) data_dir: PathBuf,
    pub(crate) approver: Approver,
    uploads: Mutex<HashSet<String>>,
    /// false si se usa LIRIO_CONFIG (pruebas): entonces nunca se rellenan los bots del creador
    pub(crate) use_defaults: bool,
    pub(crate) journal: journal::Journal,
}

impl AppState {
    pub(crate) fn config(&self) -> LirioConfig {
        LirioConfig::load_with(&self.config_path, self.use_defaults)
    }

    pub(crate) fn module(&self, id: &str) -> Result<Module, String> {
        let (mods, _) = modules::discover(&self.config());
        mods.into_iter().find(|m| m.id == id).ok_or_else(|| format!("No encuentro el bot '{id}'"))
    }
}

#[tauri::command]
fn overview(state: State<AppState>) -> Value {
    let cfg = state.config();
    let (mods, errors) = modules::discover(&cfg);
    let usuario = cfg.usuario.clone().unwrap_or_else(|| {
        std::env::var("USERNAME").map(|u| capitalize(&u)).unwrap_or_else(|_| "amigo".into())
    });
    json!({
        "usuario": usuario,
        "modules": mods.iter().map(Module::view).collect::<Vec<_>>(),
        "errors": errors,
        "uploads": state.uploads.lock().unwrap().iter().cloned().collect::<Vec<_>>(),
        "my_key": state.approver.public_info(),
    })
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// Detalle de un bot: cola de subida, vídeos en espera, fallos, aprobaciones y vídeos editados.
#[tauri::command]
fn module_details(state: State<AppState>, id: String) -> Result<Value, String> {
    let m = state.module(&id)?;
    let root = m.state_root();
    let queue = read_json(&m.state_file("upload_queue.json"));
    let unlisted = read_json(&m.state_file("unlisted_uploads.json"));
    let queued_dirs: HashSet<String> = queue.as_array().into_iter().flatten()
        .filter_map(|q| q["out_dir"].as_str().map(String::from)).collect();
    let mut outputs = Vec::new();
    if let Ok(rd) = std::fs::read_dir(root.join("output")) {
        for e in rd.flatten() {
            let meta = read_json(&e.path().join("metadata.json"));
            if meta.is_null() { continue; }
            let lv = &meta["long_video"];
            let dir = e.path().to_string_lossy().to_string();
            let file = lv["file"].as_str().unwrap_or_default();
            let modified = e.metadata().and_then(|md| md.modified()).ok()
                .map(|t| chrono::DateTime::<chrono::Local>::from(t).to_rfc3339());
            outputs.push(json!({
                "dir": dir,
                "name": e.file_name().to_string_lossy(),
                "title": lv["title"],
                "file": file,
                "file_exists": std::path::Path::new(file).exists(),
                "shorts": meta["shorts"].as_array().map(|a| a.len()).unwrap_or(0),
                "thumbnail": lv["thumbnail"],
                "in_queue": queued_dirs.contains(&dir),
                "unlisted": unlisted.get(file).cloned().unwrap_or(Value::Null),
                "modified": modified,
            }));
        }
    }
    outputs.sort_by(|a, b| b["modified"].as_str().cmp(&a["modified"].as_str()));
    Ok(json!({
        "module": m.view(),
        "queue": queue,
        "hold": read_json(&m.state_file("hold.json")),
        "failures": read_json(&m.state_file("failures.json")),
        "approvals": read_json(&m.approvals_path()),
        "quota": read_json(&m.state_file("youtube_quota.json")),
        "outputs": outputs,
    }))
}

/// Actividad reciente: las últimas decisiones de The Wall y los últimos trabajos de cada bot.
#[tauri::command]
fn activity(state: State<AppState>) -> Vec<Value> {
    let (mods, _) = modules::discover(&state.config());
    let mut items = Vec::new();
    for m in mods.iter().filter(|m| !m.is_sub_bot()) {
        let st = read_json(&m.status_path());
        if let Some(job) = st.get("last_job").filter(|j| j.is_object()) {
            items.push(json!({"module": m.id, "name": m.name(), "kind": "job", "ok": job["ok"],
                              "text": job_text(job), "at": job["finished_at"]}));
        }
        let log = m.log_dir().join("wall.log");
        if let Ok(txt) = std::fs::read_to_string(&log) {
            for line in txt.lines().rev().take(400) {
                let Some(i) = line.find('{') else { continue };
                let Ok(v) = serde_json::from_str::<Value>(&line[i..]) else { continue };
                if v["dry_run"] == true { continue; }
                let interesting = v["action"] == "wall.decision" || v["status"] == "pending" || v["status"] == "denied";
                if !interesting { continue; }
                items.push(json!({"module": m.id, "name": m.name(), "kind": "wall",
                                  "ok": v["status"] != "denied", "text": wall_text(&v),
                                  "at": local_ts(&line[..i])}));
                if items.iter().filter(|x| x["module"] == m.id.as_str() && x["kind"] == "wall").count() >= 6 { break; }
            }
        }
    }
    items.sort_by(|a, b| b["at"].as_str().unwrap_or("").cmp(a["at"].as_str().unwrap_or("")));
    items.truncate(8);
    items
}

fn job_text(job: &Value) -> String {
    let src = job["source"].as_str().unwrap_or("");
    let name = std::path::Path::new(src).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    if job["ok"] == true { format!("Vídeo editado: {name}") } else { format!("Falló la edición de {name}") }
}

fn wall_text(v: &Value) -> String {
    let action = v["action"].as_str().unwrap_or("");
    if action == "wall.decision" {
        let who = if v["by"] == "lirio" { "desde Lirio" } else { "desde la terminal" };
        let rid = v["request_id"].as_str().unwrap_or("?");
        if let Some(vod) = rid.strip_prefix("hold:") {
            return format!("VOD {vod} liberado {who}");
        }
        if let Some(name) = rid.strip_prefix("failure:") {
            return format!("{name}: reintento pedido {who}");
        }
        return format!("Solicitud {rid} {who}: {}",
                       match v["status"].as_str() { Some("approved") => "aprobada", Some("denied") => "rechazada", _ => "decidida" });
    }
    match v["status"].as_str() {
        Some("pending") => format!("Pide tu aprobación: {action}"),
        Some("denied") => format!("The Wall bloqueó {action}"),
        _ => action.to_string(),
    }
}

/// "2026-11-16 22:41:05,888 " -> "2026-11-16T22:41:05" (hora local, ordenable como texto)
fn local_ts(prefix: &str) -> String {
    prefix.trim().split(',').next().unwrap_or("").replacen(' ', "T", 1)
}

/// Comandos sencillos de la CLI (lista blanca en cli.rs). Las subidas y las aprobaciones tienen su propio camino.
#[tauri::command]
async fn run_command(state: State<'_, AppState>, id: String, command: String, args: Vec<String>) -> Result<cli::CliResult, String> {
    if matches!(command.as_str(), "aprobar-firmado" | "upload") {
        return Err("este comando tiene su propio botón".into());
    }
    let m = state.module(&id)?;
    let (name, bot) = (m.name(), m.id.clone());
    let cmd = command.clone();
    let r = tauri::async_runtime::spawn_blocking(move || cli::run(&m, &command, &args)).await.map_err(|e| e.to_string())?;
    let what = match cmd.as_str() {
        "stop" => Some(("parada", format!("{name}: parada pedida"))),
        "doctor" => Some(("diagnostico", format!("{name}: diagnóstico {}", if r.ok { "correcto" } else { "con avisos" }))),
        "auth" => Some(("youtube", format!("{name}: autorizar YouTube {}", if r.ok { "hecho" } else { "no terminado" }))),
        _ => None,
    };
    if let Some((kind, text)) = what {
        state.journal.add(kind, Some(&bot), &text, r.ok);
    }
    Ok(r)
}

/// Sube un vídeo editado (o toda la cola) y emite `lirio://upload` con el % cada medio segundo.
#[tauri::command]
fn start_upload(app: tauri::AppHandle, state: State<AppState>, id: String, dir: Option<String>) -> Result<(), String> {
    let m = state.module(&id)?;
    let st = read_json(&m.status_path());
    if !st["current_job"].is_null() {
        return Err("El bot está editando ahora mismo; espera a que termine para subir".into());
    }
    if m.kill_switch_path().exists() {
        return Err("El bot está parado con STOP: reanúdalo antes de subir".into());
    }
    {
        let mut ups = state.uploads.lock().unwrap();
        if !ups.insert(id.clone()) {
            return Err("Ya hay una subida en marcha para este bot".into());
        }
    }
    let args: Vec<String> = dir.into_iter().collect();
    let mut cmd = cli::build_command(&m, "upload", &args)
        .inspect_err(|_| { state.uploads.lock().unwrap().remove(&id); })?;
    let log = m.log_dir().join(format!("{}.log", m.py_module()));
    std::thread::spawn(move || {
        let mut tail = upload::LogTail::at_end(&log);
        let emit = |payload: Value| { let _ = app.emit("lirio://upload", payload); };
        emit(json!({"module": id, "percent": 0, "item": null, "done": false}));
        let child = cmd.spawn();
        let result = match child {
            Err(e) => cli::CliResult { ok: false, code: -1, data: Value::Null, message: format!("no se pudo lanzar: {e}") },
            Ok(mut child) => {
                // leer stdout en otro hilo para que el proceso nunca se bloquee con la tubería llena
                let mut stdout = child.stdout.take().unwrap();
                let mut stderr = child.stderr.take().unwrap();
                let out_h = std::thread::spawn(move || { let mut b = Vec::new(); let _ = std::io::Read::read_to_end(&mut stdout, &mut b); b });
                let err_h = std::thread::spawn(move || { let mut b = Vec::new(); let _ = std::io::Read::read_to_end(&mut stderr, &mut b); b });
                let mut last: Option<upload::Progress> = None;
                let code = loop {
                    let p = upload::from_status(&read_json(&m.status_path()))
                        .or_else(|| upload::last_progress(&tail.read_new()));
                    if p.is_some() && p != last {
                        let pr = p.clone().unwrap();
                        emit(json!({"module": id, "percent": pr.percent, "item": pr.item, "done": false}));
                        last = p;
                    }
                    match child.try_wait() {
                        Ok(Some(s)) => break s.code().unwrap_or(-1),
                        Ok(None) => std::thread::sleep(Duration::from_millis(500)),
                        Err(_) => break -1,
                    }
                };
                cli::interpret(code, &out_h.join().unwrap_or_default(), &err_h.join().unwrap_or_default())
            }
        };
        if let Some(st) = app.try_state::<AppState>() {
            st.uploads.lock().unwrap().remove(&id);
            st.journal.add("subida", Some(&id), if result.ok { "Subida a YouTube terminada" } else { "La subida no terminó" }, result.ok);
        }
        emit(json!({"module": id, "percent": if result.ok { 100 } else { 0 }, "done": true, "result": result}));
    });
    Ok(())
}

/// Paso 1 del gesto humano: la interfaz lo llama al empezar a mantener pulsado.
#[tauri::command]
fn gesture_begin(state: State<AppState>) -> String {
    state.approver.gesture_begin()
}

/// Paso 2: tras 2 s pulsado, firma la decisión y se la entrega al bot con `aprobar-firmado`.
#[tauri::command]
async fn signed_decision(state: State<'_, AppState>, token: String, id: String, operacion: String,
                         objetivo: String, accion: Option<String>, clave: Option<String>) -> Result<cli::CliResult, String> {
    state.approver.gesture_finish(&token)?;
    let m = state.module(&id)?;
    check_pinned(&m, &state.approver.public_info())?;
    let signed = state.approver.sign(&m.id, &operacion, &objetivo, accion, clave, chrono::Utc::now())?;
    let dir = state.data_dir.clone();
    let (name, bot) = (m.name(), m.id.clone());
    let r = tauri::async_runtime::spawn_blocking(move || deliver_signed(&m, &dir, &signed))
        .await.map_err(|e| e.to_string())??;
    let verb = match operacion.as_str() { "approve" => "aprobado", "deny" => "rechazado", "liberar" => "liberado", _ => "reintento pedido" };
    state.journal.add("aprobacion", Some(&bot), &format!("{name}: {verb} desde Lirio"), r.ok);
    Ok(r)
}

/// Un solo gesto para borrar UNA cosa que crea varias solicitudes (un vídeo con sus Shorts: una por archivo).
/// Solo aprueba, solo solicitudes de borrado de archivos (`files.delete*`) que el bot tiene pendientes ahora mismo,
/// como mucho 20, y la acción y la clave se leen del propio bot (no de la interfaz).
#[tauri::command]
async fn signed_approve_deletes(state: State<'_, AppState>, token: String, id: String, objetivos: Vec<String>)
    -> Result<cli::CliResult, String> {
    state.approver.gesture_finish(&token)?;
    if objetivos.is_empty() || objetivos.len() > 20 { return Err("hay que aprobar entre 1 y 20 solicitudes".into()); }
    let m = state.module(&id)?;
    check_pinned(&m, &state.approver.public_info())?;
    let pending = m.view()["approvals_pending"].as_array().cloned().unwrap_or_default();
    let mut signed = Vec::new();
    for obj in &objetivos {
        let a = pending.iter().find(|a| a["id"].as_str() == Some(obj.as_str()))
            .ok_or_else(|| format!("la solicitud {obj} ya no está pendiente"))?;
        let accion = a["action"].as_str().unwrap_or_default();
        if !accion.starts_with("files.delete") { return Err(format!("{obj} no es un borrado de archivos")); }
        signed.push(state.approver.sign(&m.id, "approve", obj, Some(accion.to_string()),
                                        a["key"].as_str().map(String::from), chrono::Utc::now())?);
    }
    let dir = state.data_dir.clone();
    let (name, bot, n) = (m.name(), m.id.clone(), signed.len());
    let r = tauri::async_runtime::spawn_blocking(move || -> Result<cli::CliResult, String> {
        let mut last = None;
        for s in &signed {
            let r = deliver_signed(&m, &dir, s)?;
            if !r.ok { return Ok(r); }
            last = Some(r);
        }
        last.ok_or_else(|| "nada que aprobar".to_string())
    }).await.map_err(|e| e.to_string())??;
    state.journal.add("aprobacion", Some(&bot), &format!("{name}: borrado aprobado desde Lirio ({n} archivo{})",
                                                          if n == 1 { "" } else { "s" }), r.ok);
    Ok(r)
}

/// Antes de firmar: ¿es la llave de ESTE Lirio la que el bot tiene fijada? Si no, no se firma y se explica por qué
/// (en lugar del críptico "la firma no es válida" del bot). La llave fijada nunca la cambia Lirio: solo el usuario.
fn check_pinned(m: &Module, mine: &approver::PublicKeyInfo) -> Result<(), String> {
    let pinned = m.pinned_key();
    if pinned.is_null() {
        return Err(format!("{} no tiene fijada ninguna llave de Lirio en su wall_rules.json: hay que fijar {} \
                            (la tienes en Configuración)", m.name(), mine.id));
    }
    if pinned["llave_publica"].as_str() != Some(mine.llave_publica.as_str()) {
        return Err(format!(
            "La llave de este Lirio ({}) no es la que tiene fijada {} ({}). No firmo, porque el bot la rechazaría. \
             Este Lirio usa la carpeta de datos {} y el programa {}. \
             Si se perdió la llave o cambiaste de PC, fija la nueva a mano en su wall_rules.json (la tienes en Configuración).",
            mine.id, m.name(), pinned["id"].as_str().unwrap_or("?"), data_dir().display(),
            std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()));
    }
    Ok(())
}

/// Entrega una aprobación ya firmada al bot (`aprobar-firmado <archivo>`) y borra el archivo después.
fn deliver_signed(m: &Module, data_dir: &std::path::Path, signed: &approver::SignedApproval) -> Result<cli::CliResult, String> {
    if !m.has_command("aprobar-firmado") {
        return Err(format!("{} todavía no acepta aprobaciones desde Lirio; actualiza el bot", m.name()));
    }
    let file = approver::write_temp(data_dir, signed)?;
    let res = cli::run(m, "aprobar-firmado", &[file.to_string_lossy().to_string()]);
    let _ = std::fs::remove_file(&file);
    Ok(res)
}

/// Parada inmediata y persistente (kill switch). Parar es siempre seguro: no pide gesto.
#[tauri::command]
fn kill_switch_on(state: State<AppState>, id: String) -> Result<(), String> {
    let m = state.module(&id)?;
    if m.is_sub_bot() { return Err("este bot se para con su bot principal".into()); }
    let note = format!("Creado por Lirio el {}. Bórralo (o pulsa Reanudar en Lirio) para que el bot vuelva a trabajar.\n",
                       chrono::Local::now().format("%Y-%m-%d %H:%M"));
    std::fs::write(m.kill_switch_path(), note).map_err(|e| e.to_string())?;
    state.journal.add("stop", Some(&m.id), &format!("{}: STOP activado", m.name()), true);
    Ok(())
}

/// Quitar el STOP sí pide el gesto humano: es volver a dejar trabajar a la IA.
#[tauri::command]
fn kill_switch_off(state: State<AppState>, token: String, id: String) -> Result<(), String> {
    state.approver.gesture_finish(&token)?;
    let m = state.module(&id)?;
    let p = m.kill_switch_path();
    if p.exists() { std::fs::remove_file(p).map_err(|e| e.to_string())?; }
    state.journal.add("stop", Some(&m.id), &format!("{}: STOP quitado (reanudar)", m.name()), true);
    Ok(())
}

/// Arranca el bot con su tarea programada de Windows.
#[tauri::command]
fn start_bot(state: State<AppState>, id: String) -> Result<(), String> {
    let m = state.module(&id)?;
    if m.kill_switch_path().exists() {
        return Err("Primero quita el STOP (botón Reanudar)".into());
    }
    let r = match m.task.clone() {
        Some(task) => cli::start_task(&task),
        // Bots instalados por Lirio (PC de un amigo): se lanza `watch` en segundo plano, sin ventana
        None if m.has_command("watch") => cli::spawn_watch(&m),
        None => Err("Este bot se usa a demanda: no tiene modo vigilante".into()),
    };
    state.journal.add("arranque", Some(&m.id), &format!("{}: arrancar", m.name()), r.is_ok());
    r
}

/// Comando con opciones (huella de voz: textos y micros; conectar Twitch; ajustes; estadísticas).
#[tauri::command]
async fn run_with(state: State<'_, AppState>, id: String, command: String, flags: serde_json::Map<String, Value>)
    -> Result<cli::CliResult, String> {
    if matches!(command.as_str(), "enroll" | "registrar-voz") {
        return Err("la grabación tiene su propio botón".into());
    }
    if jobs::LONG.contains(&command.as_str()) {
        return Err("esto tarda: se lanza como trabajo en segundo plano".into());
    }
    let m = state.module(&id)?;
    let cmd = cli::build_command_with_flags(&m, &command, &flags)?;
    // Nunca se espera sin límite: conectar Twitch espera al navegador (10 min); lo demás, 3 min como mucho
    let limit = std::time::Duration::from_secs(if matches!(command.as_str(), "connect" | "estadisticas") { 600 } else { 180 });
    let out = tauri::async_runtime::spawn_blocking(move || jobs::output_with_timeout(cmd, limit)).await.map_err(|e| e.to_string())??;
    let r = cli::interpret(out.status.code().unwrap_or(-1), &out.stdout, &out.stderr);
    if command == "connect" && flags.get("--esperar").and_then(Value::as_bool) == Some(true) {
        state.journal.add("twitch", Some(&m.id), &format!("{}: conectar Twitch {}", m.name(), if r.ok { "hecho" } else { "no terminado" }), r.ok);
    }
    Ok(r)
}

/// Graba una huella de voz (micro o audio del PC) y emite `lirio://voz` con el % mientras graba.
#[tauri::command]
fn record_voice(app: tauri::AppHandle, state: State<AppState>, id: String, command: String,
                flags: serde_json::Map<String, Value>) -> Result<(), String> {
    if !matches!(command.as_str(), "enroll" | "registrar-voz") {
        return Err("comando de grabación no permitido".into());
    }
    let m = state.module(&id)?;
    let mut cmd = cli::build_command_with_flags(&m, &command, &flags)?;
    let name = m.name();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let emit = |v: Value| { let _ = app.emit("lirio://voz", v); };
        emit(json!({"module": id, "percent": 0, "hecho": false}));
        let result = match cmd.spawn() {
            Err(e) => cli::CliResult { ok: false, code: -1, data: Value::Null, message: format!("no se pudo lanzar: {e}") },
            Ok(mut child) => {
                let mut stdout = child.stdout.take().unwrap();
                let out_h = std::thread::spawn(move || { let mut b = Vec::new(); let _ = std::io::Read::read_to_end(&mut stdout, &mut b); b });
                let mut err_tail = Vec::new();
                for line in std::io::BufReader::new(child.stderr.take().unwrap()).lines().map_while(Result::ok) {
                    match flags::progress_line(&line) {
                        Some(p) => emit(json!({"module": id, "percent": p, "hecho": false})),
                        None => { err_tail.extend_from_slice(line.as_bytes()); err_tail.push(b'\n'); }
                    }
                }
                let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
                cli::interpret(code, &out_h.join().unwrap_or_default(), &err_tail)
            }
        };
        if let Some(st) = app.try_state::<AppState>() {
            st.journal.add("voz", Some(&id), &format!("{name}: huella de voz {}", if result.ok { "guardada" } else { "no guardada" }), result.ok);
        }
        emit(json!({"module": id, "hecho": true, "result": result}));
    });
    Ok(())
}

/// Guarda los ajustes de un bot (el propio bot valida tipos, rangos y que no se toque nada protegido).
#[tauri::command]
async fn save_settings(state: State<'_, AppState>, id: String, valores: serde_json::Map<String, Value>) -> Result<cli::CliResult, String> {
    let m = state.module(&id)?;
    let file = state.data_dir.join("aprobaciones").join(format!("ajustes-{}.json", approver::random_hex(6)));
    if let Some(p) = file.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    std::fs::write(&file, serde_json::to_vec(&valores).unwrap()).map_err(|e| e.to_string())?;
    let arg = vec![file.to_string_lossy().to_string()];
    let m2 = m.clone();
    let r = tauri::async_runtime::spawn_blocking(move || cli::run(&m2, "ajustes-guardar", &arg)).await.map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&file);
    let n = r.data["cambiados"].as_array().map(|a| a.len()).unwrap_or(0);
    state.journal.add("ajustes", Some(&m.id), &format!("{}: {n} ajustes cambiados", m.name()), r.ok);
    Ok(r)
}

/// "Arrancar mis bots al encender el PC" (solo para bots sin tarea programada propia).
#[tauri::command]
fn autostart_get() -> bool {
    portable::root().is_none() && autostart::enabled()
}

#[tauri::command]
fn autostart_set(state: State<AppState>, on: bool) -> Result<bool, String> {
    if portable::root().is_some() {
        return Err("En la USB no se arranca con Windows: no se toca el PC del cyber.".into());
    }
    autostart::set(on)?;
    state.journal.add("ajustes", None, if on { "Arrancar los bots al encender el PC: activado" } else { "Arrancar los bots al encender el PC: desactivado" }, true);
    Ok(autostart::enabled())
}

/// Lo último que ha hecho el bot (moderador: respuestas en el chat y órdenes de voz), de `logs/acciones.jsonl`.
/// Solo lectura, como el resto del estado de los bots.
#[tauri::command]
fn bot_actions(state: State<AppState>, id: String, tipos: Vec<String>, limite: usize) -> Result<Vec<Value>, String> {
    let m = state.module(&id)?;
    let rel = m.manifest["paths"]["actions_log"].as_str().unwrap_or("logs/acciones.jsonl");
    let Ok(txt) = std::fs::read_to_string(m.state_root().join(rel)) else { return Ok(vec![]) };
    Ok(txt.lines().rev()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| tipos.is_empty() || v["type"].as_str().is_some_and(|t| tipos.iter().any(|x| x == t)))
        .take(limite.clamp(1, 200))
        .collect())
}

/// Diario de Lirio: entradas de los últimos `dias` días (la más reciente primero).
#[tauri::command]
fn journal_read(state: State<AppState>, dias: i64) -> Vec<journal::Entry> {
    state.journal.read(dias.clamp(1, 90))
}

/// Nota propia del usuario en el diario (nunca sale en el resumen de uso).
#[tauri::command]
fn journal_note(state: State<AppState>, texto: String) -> Result<(), String> {
    let t = texto.trim();
    if t.is_empty() { return Err("la nota está vacía".into()); }
    state.journal.add("nota", None, t, true);
    Ok(())
}

/// Resumen de uso SIN datos personales (solo cifras) para adjuntar, si el usuario quiere, a "Enviar idea".
#[tauri::command]
fn usage_summary(state: State<AppState>, dias: i64) -> Value {
    let dias = dias.clamp(1, 90);
    let (mods, _) = modules::discover(&state.config());
    let bots: Vec<(String, String)> = mods.iter()
        .map(|m| (m.id.clone(), m.manifest["version"].as_str().unwrap_or("?").to_string())).collect();
    journal::usage_summary(&state.journal.read(dias), env!("CARGO_PKG_VERSION"), &bots, dias)
}

/// Página inicial pedida con LIRIO_PAGINA (p. ej. `bot/twitch-autoeditor/cola`), para las capturas de verificación.
#[tauri::command]
fn start_page() -> Option<String> {
    std::env::var("LIRIO_PAGINA").ok()
        .filter(|p| p.chars().all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '-'))
}

/// Busca una versión nueva de Lirio en GitHub Releases (firmada con la llave de actualizaciones del creador).
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let Some(repo) = option_env!("LIRIO_REPO") else {
        return Ok(json!({"disponible": false, "motivo": "versión de desarrollo"}));
    };
    if portable::root().is_some() {
        // el Portátil mira SU canal (latest-portatil.json); nunca el instalador del Desktop
        let v: Value = tauri::async_runtime::spawn_blocking(move || portable_manifest(repo)).await.map_err(|e| e.to_string())??;
        let remote = v["version"].as_str().unwrap_or_default().to_string();
        return Ok(json!({"disponible": newer(&remote, env!("CARGO_PKG_VERSION")), "version": remote, "notas": v["notes"]}));
    }
    let url = format!("https://github.com/{repo}/releases/latest/download/latest.json").parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    let updater = app.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?
        .build().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(u) => Ok(json!({"disponible": true, "version": u.version, "notas": u.body})),
        None => Ok(json!({"disponible": false})),
    }
}

/// Descarga e instala la versión nueva (el actualizador comprueba la firma antes de instalar nada).
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let repo = option_env!("LIRIO_REPO").ok_or("versión de desarrollo: sin actualizaciones")?;
    if let Some(root) = portable::root() {
        let r = root.clone();
        tauri::async_runtime::spawn_blocking(move || portable_update(&r, repo)).await.map_err(|e| e.to_string())??;
        if let Some(st) = app.try_state::<AppState>() {
            st.journal.add("actualizacion", None, "Lirio de la USB actualizado", true);
        }
        app.restart();
    }
    let url = format!("https://github.com/{repo}/releases/latest/download/latest.json").parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    let updater = app.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?
        .build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?.ok_or("no hay versión nueva")?;
    if let Some(st) = app.try_state::<AppState>() {
        st.journal.add("actualizacion", None, &format!("Actualizando Lirio a {}", update.version), true);
    }
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

/// Versión de Lirio y dónde se publican las versiones (para el botón "Enviar idea" y las actualizaciones).
#[tauri::command]
fn release_info() -> Value {
    json!({"version": env!("CARGO_PKG_VERSION"), "repo": option_env!("LIRIO_REPO"), "portatil": portable::root().is_some(),
           "edicion": portable::edition(),
           // Lirio abierto con carpetas de prueba: se avisa bien visible para no confundirlo con el de verdad
           "prueba": std::env::var_os("LIRIO_DATOS").is_some() || std::env::var_os("LIRIO_CONFIG").is_some(),
           "datos": data_dir().display().to_string()})
}

/// Imagen pequeña como data URL (solo png/jpg/webp de menos de 8 MB).
pub fn image_data_url(p: &std::path::Path) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let ext = p.extension()?.to_string_lossy().to_lowercase();
    let mime = match ext.as_str() { "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp", _ => return None };
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > 8 * 1024 * 1024 { return None; }
    Some(format!("data:{mime};base64,{}", B64.encode(std::fs::read(p).ok()?)))
}

/// Ancho de las miniaturas que se enseñan en Lirio: nítidas hasta con el escalado de Windows al 200 %
/// (las tarjetas miden ~220–360 px), y unas 10 veces más ligeras que la imagen de 1280 px.
pub const THUMB_WIDTH: u32 = 720;

/// Versión reducida de una imagen, guardada en caché por ruta, fecha y tamaño (se rehace sola si la imagen cambia).
/// Si algo falla, la imagen original.
pub fn small_image_data_url(p: &std::path::Path, cache: &std::path::Path) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    use std::hash::{Hash, Hasher};
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > 8 * 1024 * 1024 { return None; }
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (p, meta.len(), meta.modified().ok(), THUMB_WIDTH).hash(&mut h);
    let file = cache.join(format!("{:016x}.jpg", h.finish()));
    if let Ok(bytes) = std::fs::read(&file) {
        return Some(format!("data:image/jpeg;base64,{}", B64.encode(bytes)));
    }
    let made = (|| -> Option<Vec<u8>> {
        let img = image::open(p).ok()?;
        if img.width() <= THUMB_WIDTH { return None; } // ya es pequeña: se usa tal cual
        let small = img.resize(THUMB_WIDTH, u32::MAX, image::imageops::FilterType::Triangle).to_rgb8();
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82).encode_image(&small).ok()?;
        Some(out)
    })();
    match made {
        Some(bytes) => {
            let _ = std::fs::create_dir_all(cache);
            let _ = std::fs::write(&file, &bytes);
            Some(format!("data:image/jpeg;base64,{}", B64.encode(bytes)))
        }
        None => image_data_url(p),
    }
}

/// ¿Es una captura del informe de moderación de este bot? Solo imágenes dentro de su carpeta de vídeos, en una carpeta
/// `*_moderacion` (el editor las saca del vídeo ya difuminado). Cualquier otra ruta se rechaza.
pub fn moderation_capture_ok(root: &std::path::Path, p: &std::path::Path) -> bool {
    let (Ok(root), Ok(p)) = (root.canonicalize(), p.canonicalize()) else { return false };
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    p.starts_with(&root) && matches!(ext.as_str(), "jpg" | "jpeg" | "png")
        && p.parent().and_then(|d| d.file_name()).is_some_and(|n| n.to_string_lossy().ends_with("_moderacion"))
}

/// Capturas del informe de moderación para enseñarlas antes de aprobar (como mucho 12).
#[tauri::command]
fn moderation_captures(state: State<AppState>, id: String, rutas: Vec<String>) -> Result<Vec<Option<String>>, String> {
    let m = state.module(&id)?;
    let root = m.state_root().join("output");
    Ok(rutas.iter().take(12).map(|r| {
        let p = std::path::Path::new(r);
        moderation_capture_ok(&root, p).then(|| image_data_url(p)).flatten()
    }).collect())
}

/// Miniaturas de cada vídeo (`miniaturas` del editor) con la imagen ya leída: Lirio solo lee las que el bot lista.
#[tauri::command]
async fn thumbnails(state: State<'_, AppState>, id: String) -> Result<cli::CliResult, String> {
    let m = state.module(&id)?;
    let mut cmd = cli::build_command_with_flags(&m, "miniaturas", &serde_json::Map::new())?;
    let cache = state.data_dir.join("cache").join("miniaturas");
    tauri::async_runtime::spawn_blocking(move || {
        let out = cmd.output().map_err(|e| e.to_string())?;
        let mut r = cli::interpret(out.status.code().unwrap_or(-1), &out.stdout, &out.stderr);
        if let Some(videos) = r.data["videos"].as_array_mut() {
            videos.truncate(30);
            let thumbs: Vec<&mut Value> = videos.iter_mut()
                .flat_map(|v| v["miniaturas"].as_array_mut().into_iter().flatten()).collect();
            // la primera vez hay que reducirlas: en paralelo (luego salen de la caché)
            let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 8);
            let per = thumbs.len().div_ceil(workers).max(1);
            let mut thumbs = thumbs;
            std::thread::scope(|sc| {
                for chunk in thumbs.chunks_mut(per) {
                    let cache = &cache;
                    sc.spawn(move || for t in chunk.iter_mut() {
                        let img = t["ruta"].as_str().and_then(|p| small_image_data_url(std::path::Path::new(p), cache));
                        t["img"] = img.map(Value::String).unwrap_or(Value::Null);
                    });
                }
            });
        }
        Ok(r)
    }).await.map_err(|e| e.to_string())?
}

/// Abre en el Explorador una carpeta del bot, solo si el propio bot la declara (`carpetas`).
#[tauri::command]
async fn open_bot_folder(app: tauri::AppHandle, state: State<'_, AppState>, id: String, ruta: String) -> Result<(), String> {
    let m = state.module(&id)?;
    let mut cmd = cli::build_command_with_flags(&m, "carpetas", &serde_json::Map::new())?;
    let out = tauri::async_runtime::spawn_blocking(move || cmd.output()).await.map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let r = cli::interpret(out.status.code().unwrap_or(-1), &out.stdout, &out.stderr);
    let declared = ["editados", "directos", "miniaturas"].iter().any(|k| r.data[*k].as_str() == Some(ruta.as_str()));
    if !declared { return Err("Esa carpeta no es del bot".into()); }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(&ruta, None::<&str>).map_err(|e| e.to_string())
}

/// Una parte de la interfaz falló al pintarse: se apunta en el Diario (Lirio enseña un aviso en su lugar).
#[tauri::command]
fn ui_error(state: State<AppState>, texto: String) {
    let t: String = texto.chars().filter(|c| !c.is_control()).take(300).collect();
    state.journal.add("error_interfaz", None, &format!("La interfaz falló: {t}"), false);
}

// ------------------------------------------------------------------ Lirio portátil (PIN)

static PIN_FAILS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

#[tauri::command]
fn portable_status(state: State<AppState>) -> Value {
    portable::status(portable::root().as_deref(), state.approver.is_unlocked())
}

fn after_unlock(state: &AppState, s: &portable::Secrets) {
    state.approver.unlock(&s.approver_seed);
    // la clave de los secretos de los bots solo la reciben los procesos de los bots
    std::env::set_var(portable::BOT_KEY_ENV, portable::hex(&s.bot_key));
}

/// Primera vez en la USB: elegir el PIN (crea el llavero con llaves nuevas).
#[tauri::command]
async fn portable_create_pin(state: State<'_, AppState>, pin: String) -> Result<(), String> {
    let root = portable::root().ok_or("Esto solo existe en Lirio portátil")?;
    let path = portable::data_dir(&root).join(portable::VAULT);
    let s = tauri::async_runtime::spawn_blocking(move || portable::create(&path, &pin)).await.map_err(|e| e.to_string())??;
    after_unlock(&state, &s);
    state.journal.add("usb", None, "Llavero creado con tu PIN", true);
    Ok(())
}

/// Desbloquear con el PIN. Cada fallo seguido espera un poco más (contra probar PINs a ciegas).
#[tauri::command]
async fn portable_unlock(state: State<'_, AppState>, pin: String) -> Result<(), String> {
    let root = portable::root().ok_or("Esto solo existe en Lirio portátil")?;
    let path = portable::data_dir(&root).join(portable::VAULT);
    let fails = PIN_FAILS.load(std::sync::atomic::Ordering::Relaxed);
    let wait = std::time::Duration::from_secs(u64::from(fails.min(10)) * 2);
    let r = tauri::async_runtime::spawn_blocking(move || { std::thread::sleep(wait); portable::open(&path, &pin) })
        .await.map_err(|e| e.to_string())?;
    match r {
        Ok(s) => { PIN_FAILS.store(0, std::sync::atomic::Ordering::Relaxed); after_unlock(&state, &s); Ok(()) }
        Err(e) => { PIN_FAILS.fetch_add(1, std::sync::atomic::Ordering::Relaxed); Err(e) }
    }
}

#[tauri::command]
async fn portable_change_pin(state: State<'_, AppState>, actual: String, nuevo: String) -> Result<(), String> {
    let root = portable::root().ok_or("Esto solo existe en Lirio portátil")?;
    let path = portable::data_dir(&root).join(portable::VAULT);
    tauri::async_runtime::spawn_blocking(move || portable::change_pin(&path, &actual, &nuevo)).await.map_err(|e| e.to_string())??;
    state.journal.add("usb", None, "PIN cambiado", true);
    Ok(())
}

/// Canal del Portátil: `latest-portatil.json` → {version, notes, archivo}. El Desktop usa latest.json (instalador)
/// y nunca ve el zip; el Portátil nunca usa el instalador (instalaría en el PC del cyber).
fn portable_manifest(repo: &str) -> Result<Value, String> {
    let url = format!("https://github.com/{repo}/releases/latest/download/latest-portatil.json");
    ureq::get(&url).timeout(std::time::Duration::from_secs(30)).call().map_err(|e| e.to_string())?
        .into_json::<Value>().map_err(|e| e.to_string())
}

/// Solo `Lirio-Portatil_<versión>_x64.zip` (nada de rutas ni otros nombres que vengan en el manifiesto)
pub fn valid_portable_zip_name(n: &str) -> bool {
    n.strip_prefix("Lirio-Portatil_").and_then(|r| r.strip_suffix("_x64.zip"))
        .is_some_and(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit() || c == '.'))
}

/// Actualiza Lirio Portátil DENTRO de la USB: baja el zip del Portátil, comprueba la firma del publicador y cambia
/// el exe (el que está abierto se renombra a «.old.exe»: Windows lo permite). Al reabrir, ya es la nueva.
fn portable_update(root: &std::path::Path, repo: &str) -> Result<String, String> {
    let manifest = portable_manifest(repo)?;
    let name = manifest["archivo"].as_str().unwrap_or_default().to_string();
    if !valid_portable_zip_name(&name) { return Err("el canal del Portátil no trae un zip válido".into()); }
    let base = format!("https://github.com/{repo}/releases/latest/download");
    let get = |file: &str, max: u64| -> Result<Vec<u8>, String> {
        let r = ureq::get(&format!("{base}/{file}")).timeout(std::time::Duration::from_secs(600)).call()
            .map_err(|e| format!("{file}: {e}"))?;
        let mut b = Vec::new();
        std::io::Read::read_to_end(&mut std::io::Read::take(r.into_reader(), max), &mut b).map_err(|e| e.to_string())?;
        Ok(b)
    };
    let zip = get(&name, 200 * 1024 * 1024)?;
    let sig = String::from_utf8(get(&format!("{name}.sig"), 4096)?).map_err(|e| e.to_string())?;
    catalog::verify_signature(&zip, &sig, catalog::PUBLISHER_KEY)?;
    let stage = portable::data_dir(root).join("actualizacion");
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let zpath = stage.join(&name);
    std::fs::write(&zpath, &zip).map_err(|e| e.to_string())?;
    installer::extract_zip(&zpath, &stage)?;
    let new_exe = stage.join(portable::PORTABLE_EXE);
    if !new_exe.exists() { return Err(format!("el zip no trae {}", portable::PORTABLE_EXE)); }
    let cur = std::env::current_exe().map_err(|e| e.to_string())?;
    let stem = cur.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Lirio-Portatil".into());
    let old = root.join(format!("{stem}.old.exe"));
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&cur, &old).map_err(|e| format!("no se pudo apartar el Lirio abierto: {e}"))?;
    if let Err(e) = std::fs::copy(&new_exe, &cur) {
        let _ = std::fs::rename(&old, &cur); // si falla, se deja todo como estaba
        return Err(format!("no se pudo copiar el Lirio nuevo: {e}"));
    }
    let _ = std::fs::remove_dir_all(&stage);
    Ok(cur.display().to_string())
}

fn newer(remote: &str, local: &str) -> bool {
    let parse = |v: &str| v.trim_start_matches('v').split('.').map(|x| x.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    parse(remote) > parse(local)
}

/// Carpetas de Lirio en este PC (para añadirlas como excepción en el antivirus).
#[tauri::command]
fn help_paths(state: State<AppState>) -> Value {
    let programa = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.display().to_string())).unwrap_or_default();
    json!({ "programa": programa, "datos": state.data_dir.display().to_string() })
}

/// Marca de "Lirio abierto". Si al arrancar sigue ahí y el PC no se ha reiniciado desde entonces,
/// Lirio se cerró de golpe (lo típico cuando un antivirus lo para): se avisa con la ayuda del antivirus.
pub const SESSION_MARK: &str = "sesion-abierta";

pub fn closed_unexpectedly(mark: &std::path::Path, boot: Option<chrono::DateTime<chrono::Utc>>) -> bool {
    let Ok(modified) = std::fs::metadata(mark).and_then(|m| m.modified()) else { return false };
    let modified: chrono::DateTime<chrono::Utc> = modified.into();
    boot.is_none_or(|b| modified > b)
}

static UNEXPECTED_CLOSE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn last_session() -> Value {
    json!({ "cerrado_de_golpe": UNEXPECTED_CLOSE.load(std::sync::atomic::Ordering::Relaxed) })
}

/// Llave pública de Lirio (no es secreta): la que se fija en wall_rules.json de cada bot.
#[tauri::command]
fn approver_key(state: State<AppState>) -> approver::PublicKeyInfo {
    state.approver.public_info()
}

/// Carpeta de datos de Lirio: llave de aprobaciones, bots instalados y descargas.
/// NO es `%LOCALAPPDATA%\Lirio`, porque ahí instala el instalador de Windows y desinstalar la vaciaría.
pub fn data_dir() -> PathBuf {
    // Lirio portátil: todo dentro de la USB
    if let Some(root) = portable::root() {
        return portable::data_dir(&root);
    }
    // LIRIO_DATOS: otra carpeta de datos (pruebas que simulan el PC nuevo de un amigo)
    if let Some(d) = std::env::var_os("LIRIO_DATOS") {
        return PathBuf::from(d);
    }
    let base = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("LirioDatos");
    migrate_data(&base.join("Lirio"), &dir);
    dir
}

/// Fase 1 guardaba los datos en `%LOCALAPPDATA%\Lirio`: se trasladan una vez, conservando la MISMA llave
/// (es la que está fijada en wall_rules.json de los bots).
pub fn migrate_data(old: &std::path::Path, new: &std::path::Path) {
    if new.join("aprobador.key").exists() || !old.join("aprobador.key").exists() {
        return;
    }
    if std::fs::create_dir_all(new).is_err() {
        return;
    }
    for name in ["aprobador.key", "descargas", "bots", "aprobaciones"] {
        let from = old.join(name);
        if from.exists() {
            let _ = std::fs::rename(&from, new.join(name));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let portable_root = portable::root();
    if let Some(root) = &portable_root {
        // antes que nada: cachés, TEMP y WebView2 dentro de la USB
        if let Err(msg) = portable::prepare(root) {
            portable::native_alert(&msg);
            return;
        }
    }
    let data = data_dir();
    // LIRIO_CONFIG permite apuntar a otra configuración (pruebas con bots de mentira)
    let config_path = if portable_root.is_some() { data.join("config.json") } else {
        std::env::var_os("LIRIO_CONFIG").map(PathBuf::from).unwrap_or_else(|| {
            dirs::config_dir().unwrap_or_else(|| data.clone()).join("Lirio").join("config.json")
        })
    };
    // En la USB la llave está en el llavero con PIN: Lirio arranca bloqueado hasta que se escribe
    let approver = if portable_root.is_some() { Approver::locked() } else {
        Approver::load_or_create(&data).expect("no se pudo preparar la llave de aprobaciones de Lirio")
    };
    if std::env::args().any(|a| a == autostart::FLAG) {
        // Inicio de Windows: arranca el vigilante de cada bot que lo tenga (y no esté en STOP) y termina, sin ventana.
        let cfg = LirioConfig::load_with(&config_path, std::env::var_os("LIRIO_CONFIG").is_none() && portable_root.is_none());
        let journal = journal::Journal::new(&data);
        for m in modules::discover(&cfg).0.iter().filter(|m| !m.is_sub_bot() && m.task.is_none() && m.has_command("watch")) {
            let running = matches!(m.view()["state"].as_str(), Some("watching" | "running"));
            if running || m.kill_switch_path().exists() { continue; }
            let r = cli::spawn_watch(m);
            journal.add("arranque", Some(&m.id), &format!("{}: arrancado al encender el PC", m.name()), r.is_ok());
        }
        return;
    }
    if std::env::args().any(|a| a == "--llave-publica") {
        // Para fijarla en wall_rules.json de cada bot (no es secreta)
        println!("{}", serde_json::to_string_pretty(&approver.public_info()).unwrap());
        return;
    }
    tauri::Builder::default()
        // Lirio se abre UNA sola vez: si ya está abierto, se trae al frente la ventana que hay (va el primero).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.webview_windows().values().next() {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup({
            let mark = data.join(SESSION_MARK);
            let webview_dir = portable_root.as_ref().map(|r| portable::data_dir(r).join("webview"));
            move |app| {
                // la ventana se crea aquí para poder llevar la caché de WebView2 a la USB en modo portátil
                if let Some(conf) = app.config().app.windows.first().cloned() {
                    let mut b = tauri::WebviewWindowBuilder::from_config(app.handle(), &conf)?.title(portable::edition());
                    if let Some(d) = &webview_dir { b = b.data_directory(d.clone()); }
                    b.build()?;
                }
                watch::start(app.handle().clone());
                // aquí ya sabemos que somos la única ventana de Lirio (single-instance va antes)
                UNEXPECTED_CLOSE.store(closed_unexpectedly(&mark, winutil::boot_time()), std::sync::atomic::Ordering::Relaxed);
                let _ = std::fs::write(&mark, chrono::Utc::now().to_rfc3339());
                Ok(())
            }
        })
        .manage(AppState { config_path, journal: journal::Journal::new(&data), data_dir: data, approver, uploads: Mutex::new(HashSet::new()),
                           // en la USB, nunca los bots del creador (sus rutas y su usuario no deben ir en la USB de un amigo)
                           use_defaults: std::env::var_os("LIRIO_CONFIG").is_none() && portable_root.is_none() })
        .invoke_handler(tauri::generate_handler![
            overview, module_details, activity, run_command, start_upload, gesture_begin,
            signed_decision, kill_switch_on, kill_switch_off, start_bot, approver_key, start_page,
            wizard::first_run, wizard::get_catalog, wizard::install_bots, wizard::install_cancel, wizard::install_resume,
            wizard::install_status, wizard::wizard_get, wizard::wizard_save, wizard::wizard_clear, wizard::ai_status, wizard::test_claude,
            wizard::ollama_pull, wizard::ollama_setup, wizard::install_client_secret, wizard::gpu_status, wizard::install_gpu, release_info, check_update, install_update,
            journal_read, journal_note, usage_summary, run_with, record_voice, save_settings, autostart_get, autostart_set, bot_actions,
            help_paths, last_session, open_bot_folder, thumbnails, signed_approve_deletes,
            jobs::job_start, jobs::jobs_status, jobs::job_cancel, ui_error, youtube::youtube_status, youtube::youtube_check_file, monetizacion::monetizacion_datos, moderation_captures,
            portable_status, portable_create_pin, portable_unlock, portable_change_pin, usb::usb_drives, usb::usb_create
        ])
        .build(tauri::generate_context!())
        .expect("error al arrancar Lirio")
        .run({
            let mark = data_dir().join(SESSION_MARK);
            move |_, ev| if let tauri::RunEvent::Exit = ev { let _ = std::fs::remove_file(&mark); }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moderation_captures_only_from_the_bot_folder() {
        let d = tempfile::tempdir().unwrap();
        let out = d.path().join("output");
        let ok_dir = out.join("v1").join("v1_youtube_moderacion");
        std::fs::create_dir_all(&ok_dir).unwrap();
        std::fs::write(ok_dir.join("c1.jpg"), b"x").unwrap();
        std::fs::write(out.join("v1").join("v1.jpg"), b"x").unwrap();
        std::fs::write(d.path().join("fuera_moderacion.jpg"), b"x").unwrap();
        std::fs::write(ok_dir.join("nota.txt"), b"x").unwrap();
        assert!(moderation_capture_ok(&out, &ok_dir.join("c1.jpg")));
        assert!(!moderation_capture_ok(&out, &out.join("v1").join("v1.jpg")), "no es del informe");
        assert!(!moderation_capture_ok(&out, &ok_dir.join("nota.txt")), "no es imagen");
        assert!(!moderation_capture_ok(&out, &ok_dir.join("..").join("..").join("..").join("fuera_moderacion.jpg")), "fuera de la carpeta");
    }

    #[test]
    fn thumbnails_are_shrunk_and_cached() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("v_miniatura.jpg");
        let img = image::RgbImage::from_fn(1280, 720, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x ^ y) % 256) as u8]));
        img.save(&src).unwrap();
        let cache = d.path().join("cache");
        let small = small_image_data_url(&src, &cache).unwrap();
        let full = image_data_url(&src).unwrap();
        assert!(small.starts_with("data:image/jpeg;base64,"));
        assert!(small.len() < full.len(), "{} vs {}", small.len(), full.len());
        let bytes = { use base64::Engine; base64::engine::general_purpose::STANDARD.decode(&small[23..]).unwrap() };
        assert_eq!(image::load_from_memory(&bytes).unwrap().width(), THUMB_WIDTH);
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1);
        assert_eq!(small_image_data_url(&src, &cache).unwrap(), small, "la segunda vez sale de la caché");
        // una imagen pequeña no se toca
        let tiny = d.path().join("t.png");
        image::RgbImage::new(100, 50).save(&tiny).unwrap();
        assert_eq!(small_image_data_url(&tiny, &cache), image_data_url(&tiny));
    }

    /// Cifras reales: `cargo test --lib miniaturas_reales -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn miniaturas_reales() {
        let root = std::path::Path::new(r"C:\Users\carlo\Projects\twitch-autoeditor\output");
        let cache = tempfile::tempdir().unwrap();
        let files: Vec<std::path::PathBuf> = std::fs::read_dir(root).unwrap().flatten()
            .flat_map(|d| std::fs::read_dir(d.path()).unwrap().flatten().map(|f| f.path()))
            .filter(|p| p.file_name().unwrap().to_string_lossy().contains("miniatura") && image_data_url(p).is_some())
            .collect();
        let t0 = std::time::Instant::now();
        let full: usize = files.iter().map(|p| image_data_url(p).unwrap().len()).sum();
        let t_full = t0.elapsed();
        let t1 = std::time::Instant::now();
        let cdir = cache.path();
        let small: usize = std::thread::scope(|sc| {
            let hs: Vec<_> = files.chunks(files.len().div_ceil(8).max(1)).map(|c| sc.spawn(move || c.iter()
                .map(|p| small_image_data_url(p, cdir).unwrap().len()).sum::<usize>())).collect();
            hs.into_iter().map(|h| h.join().unwrap()).sum()
        });
        let t_first = t1.elapsed();
        let t2 = std::time::Instant::now();
        for p in &files { let _ = small_image_data_url(p, cache.path()); }
        println!("{} miniaturas: antes {} KB en {:?}; ahora {} KB (primera vez {:?}, con caché {:?})",
                 files.len(), full / 1024, t_full, small / 1024, t_first, t2.elapsed());
    }

    #[test]
    fn portable_channel_only_accepts_its_own_zip() {
        assert!(valid_portable_zip_name("Lirio-Portatil_0.2.6_x64.zip"));
        assert!(!valid_portable_zip_name("Lirio-Desktop_0.2.6_x64-setup.exe"));
        assert!(!valid_portable_zip_name("../Lirio-Portatil_0.2.6_x64.zip"));
        assert!(!valid_portable_zip_name("Lirio-Portatil_x_x64.zip"));
        assert!(!valid_portable_zip_name("Lirio-Portatil__x64.zip"));
    }

    #[test]
    fn unexpected_close_only_without_reboot() {
        let d = tempfile::tempdir().unwrap();
        let mark = d.path().join(SESSION_MARK);
        assert!(!closed_unexpectedly(&mark, None), "sin marca: se cerró bien");
        std::fs::write(&mark, "x").unwrap();
        let hour = chrono::Duration::hours(1);
        assert!(closed_unexpectedly(&mark, Some(chrono::Utc::now() - hour)), "marca de después de encender: cierre de golpe");
        assert!(!closed_unexpectedly(&mark, Some(chrono::Utc::now() + hour)), "marca de antes de reiniciar: apagado normal");
    }

    #[test]
    fn quarantined_bot_python_is_reported() {
        let d = tempfile::tempdir().unwrap();
        let scripts = d.path().join(".venv").join("Scripts");
        std::fs::create_dir_all(&scripts).unwrap();
        std::fs::write(d.path().join("aniuzka.json"),
                       r#"{"spec":"aniuzka-module/0.1","id":"b","name":"B","version":"1","entrypoint":{"python":".venv/Scripts/python.exe","module":"b","cwd":"."},"commands":{},"paths":{"status":"state/status.json"}}"#).unwrap();
        let entry = modules::ModuleEntry { ruta: d.path().to_path_buf(), tarea: None };
        assert!(modules::Module::load(&entry).unwrap().missing_files().is_empty(), "sin Python instalado aún: no es cuarentena");
        std::fs::write(scripts.join("python312.dll"), "x").unwrap();
        let m = modules::Module::load(&entry).unwrap();
        assert_eq!(m.missing_files().len(), 1);
        assert_eq!(m.view()["state"], "files_missing");
    }

    #[test]
    fn texts() {
        assert_eq!(local_ts("2026-11-16 22:41:05,888 "), "2026-11-16T22:41:05");
        assert_eq!(wall_text(&json!({"action": "wall.decision", "request_id": "ab", "status": "approved", "by": "lirio"})),
                   "Solicitud ab desde Lirio: aprobada");
        assert_eq!(wall_text(&json!({"action": "youtube.publish_public", "status": "pending"})),
                   "Pide tu aprobación: youtube.publish_public");
        assert_eq!(capitalize("carlo"), "Carlo");
    }

    #[test]
    fn signing_is_refused_when_the_bot_pins_another_key() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("aniuzka.json"), serde_json::to_vec(&json!({
            "spec": "aniuzka-module/0.1", "id": "bot-x", "name": "Bot X", "entrypoint": {}, "commands": {}, "paths": {}})).unwrap()).unwrap();
        let m = Module::load(&modules::ModuleEntry { ruta: d.path().to_path_buf(), tarea: None }).unwrap();
        let mine = Approver::from_key(ed25519_dalek::SigningKey::from_bytes(&[5u8; 32])).public_info();
        assert!(check_pinned(&m, &mine).unwrap_err().contains("no tiene fijada"));
        let other = Approver::from_key(ed25519_dalek::SigningKey::from_bytes(&[6u8; 32])).public_info();
        std::fs::write(d.path().join("wall_rules.json"), serde_json::to_vec(&json!({"aprobadores_humanos": {"lirio": other}})).unwrap()).unwrap();
        let err = check_pinned(&m, &mine).unwrap_err();
        assert!(err.contains(&mine.id) && err.contains(&other.id), "{err}");
        std::fs::write(d.path().join("wall_rules.json"), serde_json::to_vec(&json!({"aprobadores_humanos": {"lirio": mine}})).unwrap()).unwrap();
        assert!(check_pinned(&m, &mine).is_ok());
    }

    #[test]
    fn data_is_moved_once_keeping_the_same_key() {
        let d = tempfile::tempdir().unwrap();
        let (old, new) = (d.path().join("Lirio"), d.path().join("LirioDatos"));
        std::fs::create_dir_all(old.join("descargas")).unwrap();
        std::fs::write(old.join("aprobador.key"), b"llave").unwrap();
        std::fs::write(old.join("lirio.exe"), b"exe").unwrap(); // lo del instalador no se toca
        migrate_data(&old, &new);
        assert_eq!(std::fs::read(new.join("aprobador.key")).unwrap(), b"llave");
        assert!(new.join("descargas").exists() && !old.join("aprobador.key").exists());
        assert!(old.join("lirio.exe").exists());
        std::fs::write(old.join("aprobador.key"), b"otra").unwrap();
        migrate_data(&old, &new); // ya migrado: no se pisa
        assert_eq!(std::fs::read(new.join("aprobador.key")).unwrap(), b"llave");
        assert_eq!(wall_text(&json!({"action": "wall.decision", "request_id": "hold:123", "status": "released", "by": "lirio"})),
                   "VOD 123 liberado desde Lirio");
        assert_eq!(wall_text(&json!({"action": "wall.decision", "request_id": "failure:a.mp4", "status": "cleared", "by": "cli"})),
                   "a.mp4: reintento pedido desde la terminal");
    }

    /// De punta a punta, con procesos reales: Lirio firma -> archivo -> CLI de un bot de prueba en Python que verifica
    /// con contrib/human_approval.py (el mismo verificador que usan los bots). Se salta si no hay Python en el PATH.
    #[test]
    fn signed_approval_end_to_end_with_python_bot() {
        let Some(python) = which_python() else { eprintln!("sin python: se omite"); return };
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        let contrib = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("contrib");
        std::fs::create_dir_all(root.join("botx")).unwrap();
        std::fs::create_dir_all(root.join("state")).unwrap();
        std::fs::copy(contrib.join("human_approval.py"), root.join("botx").join("human_approval.py")).unwrap();
        std::fs::write(root.join("botx").join("__init__.py"), "").unwrap();
        std::fs::write(root.join("botx").join("__main__.py"), FAKE_BOT).unwrap();
        let key = ed25519_dalek::SigningKey::from_bytes(&[9u8; 32]);
        let ap = Approver::from_key(key);
        std::fs::write(root.join("wall_rules.json"), serde_json::to_vec(&json!({"aprobadores_humanos": {"lirio": ap.public_info()}})).unwrap()).unwrap();
        std::fs::write(root.join("state").join("approvals.json"), serde_json::to_vec(&json!([
            {"id": "r1", "action": "youtube.schedule_publish", "key": r"C:\out\v.mp4", "status": "pending"}])).unwrap()).unwrap();
        std::fs::write(root.join("aniuzka.json"), serde_json::to_vec(&json!({
            "spec": "aniuzka-module/0.1", "id": "bot-x", "name": "Bot X",
            "entrypoint": {"python": python, "module": "botx", "cwd": "."},
            "commands": {"aprobar-firmado": {"argv": ["aprobar-firmado"]}},
            "paths": {"approvals": "state/approvals.json"}})).unwrap()).unwrap();
        let m = Module::load(&modules::ModuleEntry { ruta: root.to_path_buf(), tarea: None }).unwrap();
        let data = tempfile::tempdir().unwrap();

        // 1) firma buena -> aprobada
        let ok = ap.sign("bot-x", "approve", "r1", Some("youtube.schedule_publish".into()), Some(r"C:\out\v.mp4".into()), chrono::Utc::now()).unwrap();
        let r = deliver_signed(&m, data.path(), &ok).unwrap();
        assert!(r.ok, "{r:?}");
        let reqs = read_json(&root.join("state").join("approvals.json"));
        assert_eq!(reqs[0]["status"], "approved");
        assert!(std::fs::read_dir(data.path().join("aprobaciones")).unwrap().next().is_none(), "el archivo firmado se borra");
        // 2) la misma aprobación otra vez -> rechazada (un solo uso)
        let again = deliver_signed(&m, data.path(), &ok).unwrap();
        assert_eq!(again.code, 7);
        // 3) firmada por otra llave (una IA que se inventa la suya) -> rechazada
        let forger = Approver::from_key(ed25519_dalek::SigningKey::from_bytes(&[1u8; 32]));
        let fake = forger.sign("bot-x", "deny", "r1", None, None, chrono::Utc::now()).unwrap();
        let r = deliver_signed(&m, data.path(), &fake).unwrap();
        assert_eq!(r.code, 7);
        assert!(r.message.contains("firma"), "{}", r.message);
    }

    fn which_python() -> Option<String> {
        let out = std::process::Command::new("python").args(["-c", "import sys; print(sys.executable)"]).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    const FAKE_BOT: &str = r#"
import json, sys
from pathlib import Path
from . import human_approval as ha
args = [a for a in sys.argv[1:] if a != "--json"]
root = Path.cwd()
def out(o, code):
    sys.stdout.write(json.dumps(o)); sys.exit(code)
try:
    rules = json.loads((root / "wall_rules.json").read_text(encoding="utf-8"))
    p = ha.verificar(Path(args[1]), rules, "bot-x", root / "state" / "nonces.json", consumir=False)
    reqs = json.loads((root / "state" / "approvals.json").read_text(encoding="utf-8"))
    req = next((r for r in reqs if r["id"] == p["objetivo"]), None)
    if req is None:
        raise ha.AprobacionInvalida("no existe la solicitud")
    ha.comprobar_solicitud(p, req)
    ha.consumir_nonce(root / "state" / "nonces.json", p["nonce"])
    req["status"] = "approved" if p["operacion"] == "approve" else "denied"
    (root / "state" / "approvals.json").write_text(json.dumps(reqs), encoding="utf-8")
    out({"ok": True, "resultado": req}, 0)
except ha.AprobacionInvalida as e:
    out({"ok": False, "error": str(e)}, 7)
"#;
}

#[cfg(test)]
mod editor_real {
    /// Contra el editor real del creador (solo comandos de lectura). No corre por defecto:
    /// LIRIO_EDITOR=<carpeta del editor> cargo test editor_real -- --ignored --nocapture
    #[test]
    #[ignore]
    fn read_only_commands_work() {
        let dir = std::path::PathBuf::from(std::env::var("LIRIO_EDITOR").expect("LIRIO_EDITOR"));
        let m = crate::modules::Module::load(&crate::modules::ModuleEntry { ruta: dir, tarea: None }).unwrap();
        for c in ["carpetas", "estilo", "papelera", "miniaturas"] {
            let out = crate::cli::build_command_with_flags(&m, c, &serde_json::Map::new()).unwrap().output().unwrap();
            let r = crate::cli::interpret(out.status.code().unwrap_or(-1), &out.stdout, &out.stderr);
            println!("{c}: ok={} claves={:?}", r.ok, r.data.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()));
            assert!(r.ok, "{c}: {}", r.message);
            if c == "miniaturas" {
                let first = r.data["videos"][0]["miniaturas"][0]["ruta"].as_str().map(std::path::PathBuf::from);
                if let Some(p) = first {
                    let img = super::image_data_url(&p);
                    println!("imagen {}: {}", p.display(), img.as_ref().map(|s| s.len()).unwrap_or(0));
                    assert!(img.is_some());
                }
            }
        }
    }
}
