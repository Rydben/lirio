//! Comandos de la CLI de los bots que llevan opciones (huella de voz, conectar Twitch, ajustes).
//! Lista blanca estricta: cada comando con sus opciones permitidas y el tipo de cada una. La interfaz manda
//! un mapa {opción: valor}; aquí se valida todo y se construye el argv. Nada fuera de esta lista se lanza.

use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Flag,
    Int(i64, i64),
    /// Texto corto de una línea (≤ 80)
    Text,
    /// Mensaje de chat de una línea (≤ 500)
    LongText,
    /// Ruta absoluta de Windows (≤ 400). El bot comprueba que esté dentro de sus carpetas.
    Path,
    /// Uno de estos valores
    Choice(&'static [&'static str]),
}

/// (comando, [(opción, tipo)])
pub const COMMANDS: &[(&str, &[(&str, Kind)])] = &[
    ("voz-texto", &[]),
    ("voz-dispositivos", &[]),
    ("ajustes-esquema", &[]),
    ("ajustes", &[]),
    ("connect", &[("--iniciar", Kind::Flag), ("--esperar", Kind::Flag), ("--streamer", Kind::Flag), ("--encuestas", Kind::Flag)]),
    // prueba los comandos de voz SIN ejecutar nada (solo dice qué entendería)
    ("probar-voz", &[("--segundos", Kind::Int(3, 15)), ("--texto", Kind::Text)]),
    ("ultimo-directo", &[]),
    ("enroll", &[("--segundos", Kind::Int(10, 120)), ("--nombre", Kind::Text), ("--desde-pc", Kind::Flag),
                 ("--dispositivo", Kind::Text), ("--desde-lirio", Kind::Flag)]),
    ("bans-recientes", &[]),
    // solo PIDE deshacer un ban: crea una solicitud que luego hay que aprobar con el gesto (aprobar-firmado)
    ("deshacer", &[("--solicitar", Kind::Text)]),
    ("registrar-voz", &[("--segundos", Kind::Int(10, 120)), ("--dispositivo", Kind::Text), ("--desde-lirio", Kind::Flag)]),
    ("estadisticas", &[("--refrescar", Kind::Flag), ("--sin-ia", Kind::Flag)]),
    // permiso extra de solo lectura para leer los comentarios de tus vídeos (abre el navegador de Google)
    ("auth", &[("--comentarios", Kind::Flag)]),
    // Bot de miniaturas: las de cada vídeo y elegir cuál va con él
    ("miniaturas-listar", &[]),
    ("miniatura-elegir", &[("--video", Kind::Text), ("--archivo", Kind::Path)]),
    // Papelera del editor: borrar SIEMPRE es pedir una solicitud que se aprueba con el gesto (aprobar-firmado)
    ("papelera-listar", &[]),
    ("papelera-borrar", &[("--solicitar", Kind::Path)]),
    ("papelera-auto", &[("--solicitar", Kind::Flag), ("--directos", Kind::Choice(&["on", "off"])),
                        ("--videos", Kind::Choice(&["on", "off"]))]),
    // Estilo propio de cada usuario
    ("estilo-chat", &[("--mensaje", Kind::LongText)]),
    ("estilo-ver", &[]),
    ("referencia-video", &[("--archivo", Kind::Path)]),
    ("referencia-miniatura", &[("--archivo", Kind::Path)]),
];

pub fn build_args(command: &str, flags: &Map<String, Value>) -> Result<Vec<String>, String> {
    let allowed = COMMANDS.iter().find(|(c, _)| *c == command)
        .ok_or_else(|| format!("Lirio no lanza «{command}» con opciones"))?.1;
    let mut out = Vec::new();
    for (name, value) in flags {
        let kind = allowed.iter().find(|(n, _)| n == name).map(|(_, k)| *k)
            .ok_or_else(|| format!("opción no permitida: {name}"))?;
        match kind {
            Kind::Flag => {
                if value.as_bool() == Some(true) { out.push(name.clone()); }
            }
            Kind::Int(min, max) => {
                let n = value.as_i64().filter(|n| (min..=max).contains(n))
                    .ok_or_else(|| format!("{name} debe ser un número entre {min} y {max}"))?;
                out.push(name.clone());
                out.push(n.to_string());
            }
            Kind::Text | Kind::LongText | Kind::Path => {
                let t = value.as_str().unwrap_or("").trim();
                if t.is_empty() { continue; }
                let max = match kind { Kind::Text => 80, Kind::LongText => 500, _ => 400 };
                if t.starts_with('-') || t.chars().count() > max || t.chars().any(|c| c.is_control()) {
                    return Err(format!("valor no permitido para {name}"));
                }
                if kind == Kind::Path && !is_absolute_windows_path(t) {
                    return Err(format!("{name} debe ser una ruta completa"));
                }
                out.push(name.clone());
                out.push(t.to_string());
            }
            Kind::Choice(options) => {
                let t = value.as_str().filter(|t| options.contains(t))
                    .ok_or_else(|| format!("{name} debe ser uno de: {}", options.join(", ")))?;
                out.push(name.clone());
                out.push(t.to_string());
            }
        }
    }
    // la grabación del editor sin consola: el gesto lo pone el botón de Lirio
    if matches!(command, "registrar-voz" | "enroll") && !out.iter().any(|a| a == "--desde-lirio") {
        out.push("--desde-lirio".into());
    }
    Ok(out)
}

/// `C:\carpeta\archivo` o `\\servidor\carpeta` (sin `..`)
fn is_absolute_windows_path(t: &str) -> bool {
    let b = t.as_bytes();
    let drive = b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/');
    let unc = t.starts_with("\\\\");
    (drive || unc) && !t.split(['\\', '/']).any(|p| p == "..")
}

/// "PROGRESO 42" (o "PROGRESO 42%") en una línea de stderr -> 42
pub fn progress_line(line: &str) -> Option<u8> {
    let rest = line.trim().strip_prefix("PROGRESO")?.trim().trim_end_matches('%');
    rest.parse::<f64>().ok().map(|p| p.clamp(0.0, 100.0) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn m(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn builds_only_whitelisted_options() {
        assert_eq!(build_args("enroll", &m(json!({"--segundos": 30, "--nombre": "Ana", "--desde-pc": true}))).unwrap(),
                   vec!["--segundos", "30", "--nombre", "Ana", "--desde-pc", "--desde-lirio"]);
        assert_eq!(build_args("connect", &m(json!({"--iniciar": true, "--streamer": false}))).unwrap(), vec!["--iniciar"]);
        assert!(build_args("enroll", &m(json!({"--borrar-todo": true}))).is_err());
        assert!(build_args("approve", &m(json!({}))).is_err(), "approve nunca va por aquí");
        assert!(build_args("aprobar-firmado", &m(json!({}))).is_err());
    }

    #[test]
    fn validates_values() {
        assert!(build_args("enroll", &m(json!({"--segundos": 5000}))).is_err());
        assert!(build_args("enroll", &m(json!({"--nombre": "--json"}))).is_err());
        assert!(build_args("enroll", &m(json!({"--nombre": "a\nb"}))).is_err());
        // un nombre vacío no se pasa (solo queda la marca de que la grabación la pide Lirio)
        assert_eq!(build_args("enroll", &m(json!({"--nombre": "  "}))).unwrap(), vec!["--desde-lirio"]);
    }

    #[test]
    fn paths_choices_and_long_messages() {
        assert_eq!(build_args("papelera-borrar", &m(json!({"--solicitar": "D:\\Vídeos\\directo 1.mp4"}))).unwrap(),
                   vec!["--solicitar", "D:\\Vídeos\\directo 1.mp4"]);
        assert!(build_args("papelera-borrar", &m(json!({"--solicitar": "directo.mp4"}))).is_err(), "solo rutas completas");
        assert!(build_args("papelera-borrar", &m(json!({"--solicitar": "C:\\a\\..\\..\\Windows"}))).is_err());
        assert!(build_args("papelera-borrar", &m(json!({"--borrar-ya": true}))).is_err(), "borrar sin aprobación no existe");
        assert_eq!(build_args("papelera-auto", &m(json!({"--solicitar": true, "--directos": "on"}))).unwrap(),
                   vec!["--solicitar", "--directos", "on"]);
        assert!(build_args("papelera-auto", &m(json!({"--directos": "siempre"}))).is_err());
        let long = "a".repeat(300);
        assert!(build_args("estilo-chat", &m(json!({"--mensaje": long}))).is_ok());
        assert!(build_args("estilo-chat", &m(json!({"--mensaje": "a".repeat(501)}))).is_err());
    }

    #[test]
    fn editor_recording_always_says_it_comes_from_lirio() {
        assert_eq!(build_args("registrar-voz", &m(json!({"--segundos": 45}))).unwrap(),
                   vec!["--segundos", "45", "--desde-lirio"]);
    }

    #[test]
    fn progress_lines() {
        assert_eq!(progress_line("PROGRESO 42"), Some(42));
        assert_eq!(progress_line("  PROGRESO 100%"), Some(100));
        assert_eq!(progress_line("grabando…"), None);
    }
}
