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
    #[allow(dead_code)]
    Choice(&'static [&'static str]),
    /// Lista de rutas absolutas (1 a 50)
    PathList,
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
    // Los nombres que empiezan por «@» son argumentos posicionales (se pasan solo con su valor, en este orden).
    // Miniaturas de cada vídeo (comandos del editor; el bot de miniaturas usa su mismo Python)
    ("miniaturas", &[("--video", Kind::Text)]),
    ("miniatura-elegir", &[("@video", Kind::Text), ("@archivo", Kind::Path)]),
    ("miniaturas-generar", &[("@video", Kind::Text)]),
    // Papelera: el primer `papelera-borrar` NO borra; crea una solicitud por archivo que se aprueba con el gesto
    // (aprobar-firmado) y luego se repite. Ninguna IA borra sola.
    ("papelera", &[]),
    ("carpetas", &[]),
    ("papelera-borrar", &[("@rutas", Kind::PathList), ("--carpeta-entera", Kind::Flag)]),
    // Estilo propio de cada usuario (se guarda como preferencia, sin IA)
    ("estilo", &[]),
    ("estilo-chat", &[("@mensaje", Kind::LongText)]),
    ("estilo-instruccion", &[("@texto", Kind::LongText)]),
    ("estilo-borrar", &[("@que", Kind::Text)]),
    ("estilo-video", &[("@archivo", Kind::Path)]),
    ("estilo-miniatura", &[("@archivo", Kind::Path)]),
    // Poner a editar ya un directo descargado (trabajo largo; el avance sale en status.json)
    ("editar-ahora", &[("@ruta", Kind::Path)]),
];

pub fn build_args(command: &str, flags: &Map<String, Value>) -> Result<Vec<String>, String> {
    let allowed = COMMANDS.iter().find(|(c, _)| *c == command)
        .ok_or_else(|| format!("Lirio no lanza «{command}» con opciones"))?.1;
    let mut out = Vec::new();
    // los posicionales se ponen primero, en el orden de la lista blanca
    let mut positional: Vec<(usize, Vec<String>)> = Vec::new();
    for (name, value) in flags {
        let (idx, kind) = allowed.iter().enumerate().find(|(_, (n, _))| n == name).map(|(i, (_, k))| (i, *k))
            .ok_or_else(|| format!("opción no permitida: {name}"))?;
        if name.starts_with('@') {
            let vals = positional_values(name, kind, value)?;
            if !vals.is_empty() { positional.push((idx, vals)); }
            continue;
        }
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
            Kind::PathList => return Err(format!("{name}: una lista solo puede ser posicional")),
        }
    }
    positional.sort_by_key(|(i, _)| *i);
    let mut pos: Vec<String> = positional.into_iter().flat_map(|(_, v)| v).collect();
    pos.append(&mut out);
    let mut out = pos;
    // falta un posicional obligatorio: mejor decirlo aquí que dejar que el bot falle
    for (n, _) in allowed.iter().filter(|(n, _)| n.starts_with('@')) {
        if !flags.contains_key(*n) { return Err(format!("falta {}", &n[1..])); }
    }
    // la grabación del editor sin consola: el gesto lo pone el botón de Lirio
    if matches!(command, "registrar-voz" | "enroll") && !out.iter().any(|a| a == "--desde-lirio") {
        out.push("--desde-lirio".into());
    }
    Ok(out)
}

/// `C:\carpeta\archivo` o `\\servidor\carpeta` (sin `..`)
fn text_ok(name: &str, kind: Kind, t: &str) -> Result<(), String> {
    let max = match kind { Kind::Text => 80, Kind::LongText => 500, _ => 400 };
    if t.starts_with('-') || t.chars().count() > max || t.chars().any(|c| c.is_control()) {
        return Err(format!("valor no permitido para {}", name.trim_start_matches('@')));
    }
    if matches!(kind, Kind::Path | Kind::PathList) && !is_absolute_windows_path(t) {
        return Err(format!("{} debe ser una ruta completa", name.trim_start_matches('@')));
    }
    Ok(())
}

fn positional_values(name: &str, kind: Kind, value: &Value) -> Result<Vec<String>, String> {
    match kind {
        Kind::PathList => {
            let list = value.as_array().filter(|a| !a.is_empty() && a.len() <= 50)
                .ok_or_else(|| format!("{} debe ser una lista de 1 a 50 rutas", &name[1..]))?;
            list.iter().map(|v| {
                let t = v.as_str().unwrap_or("").trim();
                text_ok(name, kind, t)?;
                Ok(t.to_string())
            }).collect()
        }
        Kind::Text | Kind::LongText | Kind::Path => {
            let t = value.as_str().unwrap_or("").trim();
            if t.is_empty() { return Err(format!("falta {}", &name[1..])); }
            text_ok(name, kind, t)?;
            Ok(vec![t.to_string()])
        }
        _ => Err(format!("{name}: tipo no admitido como posicional")),
    }
}

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
    fn positional_paths_and_long_messages() {
        assert_eq!(build_args("papelera-borrar", &m(json!({"@rutas": ["D:\\Vídeos\\directo 1.mp4"], "--carpeta-entera": true}))).unwrap(),
                   vec!["D:\\Vídeos\\directo 1.mp4", "--carpeta-entera"]);
        assert!(build_args("papelera-borrar", &m(json!({"@rutas": ["directo.mp4"]}))).is_err(), "solo rutas completas");
        assert!(build_args("papelera-borrar", &m(json!({"@rutas": ["C:\\a\\..\\..\\Windows"]}))).is_err());
        assert!(build_args("papelera-borrar", &m(json!({"@rutas": ["-rf"]}))).is_err());
        assert!(build_args("papelera-borrar", &m(json!({"@rutas": []}))).is_err());
        assert!(build_args("papelera-borrar", &m(json!({}))).is_err(), "sin rutas no se lanza");
        assert!(build_args("papelera-borrar", &m(json!({"--borrar-ya": true}))).is_err());
        // el orden de los posicionales es el de la lista blanca, venga como venga
        assert_eq!(build_args("miniatura-elegir", &m(json!({"@archivo": "C:\\o\\v_miniatura_2.jpg", "@video": "v"}))).unwrap(),
                   vec!["v", "C:\\o\\v_miniatura_2.jpg"]);
        assert!(build_args("estilo-chat", &m(json!({"@mensaje": "a".repeat(300)}))).is_ok());
        assert!(build_args("estilo-chat", &m(json!({"@mensaje": "a".repeat(501)}))).is_err());
        assert_eq!(build_args("estilo-borrar", &m(json!({"@que": "video"}))).unwrap(), vec!["video"]);
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
