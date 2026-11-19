//! Llamadas a la CLI estable de cada módulo: `<python> -m <module> --json <argv…>`, sin ventana.
//! Solo se permiten los comandos de esta lista blanca: la interfaz nunca puede lanzar algo arbitrario.

use serde::Serialize;
use serde_json::Value;
use std::process::{Command, Stdio};

use crate::modules::Module;
use crate::winutil;

/// Comandos que Lirio puede lanzar, y cuántos argumentos libres aceptan.
/// `approve`, `deny` y `liberar` NO están: se hacen solo con `aprobar-firmado` (The Wall, regla 6).
pub const ALLOWED: &[(&str, usize)] = &[
    ("status", 0),
    ("stop", 0),
    ("approvals", 0),
    ("doctor", 0),
    ("upload", 1),
    ("auth", 0),
    ("hold", 1),
    ("aprobar-firmado", 1),
    ("run", 0),
    ("ajustes-guardar", 1),
];

#[derive(Debug, Clone, Serialize)]
pub struct CliResult {
    pub ok: bool,
    pub code: i32,
    pub data: Value,
    pub message: String,
}

pub fn check_allowed(command: &str, args: &[String]) -> Result<(), String> {
    match ALLOWED.iter().find(|(c, _)| *c == command) {
        None => Err(format!("Lirio no lanza el comando '{command}'")),
        Some((_, n)) if args.len() > *n => Err(format!("demasiados argumentos para '{command}'")),
        Some(_) if args.iter().any(|a| a.starts_with('-')) => Err("argumento no permitido".into()),
        Some(_) => Ok(()),
    }
}

pub fn build_command(m: &Module, command: &str, args: &[String]) -> Result<Command, String> {
    check_allowed(command, args)?;
    command_for(m, command, args)
}

/// Comando con opciones ya validadas por `flags::build_args` (lista blanca propia).
pub fn build_command_with_flags(m: &Module, command: &str, flags: &serde_json::Map<String, Value>) -> Result<Command, String> {
    let args = crate::flags::build_args(command, flags)?;
    command_for(m, command, &args)
}

fn command_for(m: &Module, command: &str, args: &[String]) -> Result<Command, String> {
    let common = matches!(command, "approvals" | "doctor" | "upload" | "auth" | "hold" | "voz-texto" | "voz-dispositivos"
                                   | "ajustes-esquema" | "ajustes" | "ajustes-guardar" | "estadisticas" | "registrar-voz"
                                   | "probar-voz" | "ultimo-directo" | "bans-recientes"
                                   // miniaturas, papelera y estilo del editor (no están en su manifiesto, que es protegido)
                                   | "miniaturas" | "miniatura-elegir" | "miniaturas-generar" | "papelera" | "carpetas"
                                   | "papelera-borrar" | "estilo" | "estilo-chat" | "estilo-instruccion" | "estilo-borrar"
                                   | "estilo-video" | "estilo-miniatura" | "editar"
                                   | "aprendido" | "aprendido-borrar" | "aprendido-activar" | "monetizacion"
                                   | "censura" | "censura-anadir" | "censura-quitar");
    if !m.has_command(command) && !common {
        return Err(format!("{} no tiene el comando '{command}'", m.name()));
    }
    let py = m.python();
    if !py.exists() {
        return Err(format!("Falta el Python del bot ({}). Puede que tu antivirus lo haya puesto en cuarentena:                             mira Configuración → Ayuda con el antivirus.", py.display()));
    }
    let mut cmd = Command::new(py);
    cmd.current_dir(m.cwd())
        .arg("-m").arg(m.py_module())
        .arg("--json").arg(command)
        .args(args)
        .env("PYTHONIOENCODING", "utf-8")
        .env_remove("ANTHROPIC_API_KEY") // regla 1: coste cero, nunca la API de pago
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    winutil::hidden(&mut cmd);
    Ok(cmd)
}

pub fn run(m: &Module, command: &str, args: &[String]) -> CliResult {
    let mut cmd = match build_command(m, command, args) {
        Ok(c) => c,
        Err(e) => return CliResult { ok: false, code: -1, data: Value::Null, message: e },
    };
    match cmd.output() {
        Ok(out) => interpret(out.status.code().unwrap_or(-1), &out.stdout, &out.stderr),
        Err(e) => CliResult { ok: false, code: -1, data: Value::Null, message: format!("no se pudo lanzar: {e}") },
    }
}

/// Convierte la salida de la CLI en un resultado legible (los códigos vienen de la especificación).
pub fn interpret(code: i32, stdout: &[u8], stderr: &[u8]) -> CliResult {
    let text = String::from_utf8_lossy(stdout);
    let data: Value = serde_json::from_str(text.trim())
        .or_else(|_| last_json_object(&text))
        .unwrap_or(Value::Null);
    let message = match code {
        0 => "Hecho".to_string(),
        3 => "Bloqueado por la regla de coste cero".into(),
        4 => "El bot está parado con el interruptor STOP".into(),
        5 => "Esto pide una terminal interactiva".into(),
        6 => "Claude no tiene la sesión iniciada: abre Claude y entra con tu cuenta".into(),
        7 => format!("Aprobación rechazada por el bot: {}", data["error"].as_str().unwrap_or("firma no válida")),
        75 => "Claude ha llegado a su límite de uso: el bot lo reintentará solo más tarde".into(),
        _ => data["error"].as_str().map(String::from).unwrap_or_else(|| {
            let err = String::from_utf8_lossy(stderr);
            let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("error desconocido");
            last.chars().take(300).collect()
        }),
    };
    let ok = code == 0 && data.get("ok").and_then(Value::as_bool).unwrap_or(true);
    CliResult { ok, code, data, message }
}

fn last_json_object(text: &str) -> Result<Value, ()> {
    let start = text.find('{').ok_or(())?;
    serde_json::from_str(&text[start..]).map_err(|_| ())
}

/// Lanza `watch` del bot en segundo plano con pythonw (sin ventana) y lo deja vivo aunque se cierre Lirio.
pub fn spawn_watch(m: &Module) -> Result<(), String> {
    let pyw = m.python().with_file_name("pythonw.exe");
    let exe = if pyw.exists() { pyw } else { m.python() };
    let mut cmd = Command::new(exe);
    cmd.current_dir(m.cwd()).arg("-m").arg(m.py_module()).arg("watch")
        .env_remove("ANTHROPIC_API_KEY")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        let low = if std::env::var_os("LIRIO_PORTATIL").is_some() { BELOW_NORMAL_PRIORITY_CLASS } else { 0 };
        cmd.creation_flags(winutil::CREATE_NO_WINDOW | DETACHED_PROCESS | low);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("no se pudo arrancar el bot: {e}"))
}

/// Arranca la tarea programada del bot (la misma que usa Windows al iniciar sesión).
pub fn start_task(task: &str) -> Result<(), String> {
    if !task.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("nombre de tarea no válido".into());
    }
    let mut cmd = Command::new("schtasks");
    cmd.args(["/Run", "/TN", task]).stdout(Stdio::null()).stderr(Stdio::piped());
    winutil::hidden(&mut cmd);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else {
        Err(format!("Windows no pudo arrancar la tarea {task}: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitelist() {
        assert!(check_allowed("status", &[]).is_ok());
        assert!(check_allowed("approve", &["x".into()]).is_err(), "approve sin firma no se lanza nunca");
        assert!(check_allowed("liberar", &["x".into()]).is_err());
        assert!(check_allowed("deny", &["x".into()]).is_err());
        assert!(check_allowed("status", &["extra".into()]).is_err());
        assert!(check_allowed("upload", &["--oculto".into()]).is_err());
        assert!(check_allowed("upload", &["C:\\out\\v".into()]).is_ok());
    }

    #[test]
    fn interprets_exit_codes() {
        let r = interpret(0, br#"{"ok": true, "x": 1}"#, b"");
        assert!(r.ok);
        assert_eq!(r.data["x"], 1);
        let r = interpret(7, br#"{"ok": false, "error": "la firma no es valida"}"#, b"");
        assert!(!r.ok);
        assert!(r.message.contains("la firma no es valida"));
        let r = interpret(1, b"", b"Traceback\nValueError: boom\n");
        assert_eq!(r.message, "ValueError: boom");
        let r = interpret(0, br#"{"ok": false, "error": "x"}"#, b"");
        assert!(!r.ok, "ok:false en el JSON manda aunque el código sea 0");
        let r = interpret(0, b"aviso suelto\n{\"ok\": true}", b"");
        assert!(r.ok && r.data["ok"] == true);
    }
}
