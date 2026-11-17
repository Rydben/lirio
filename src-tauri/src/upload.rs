//! Subidas con barra de porcentaje en tiempo real.
//! El % sale de `status.upload` si el bot lo publica, y si no, de las líneas «Subiendo X: NN%» de su log
//! (lectura incremental desde donde estaba el log al empezar; tolera la rotación).

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Progress {
    pub item: String,
    pub percent: u8,
}

fn progress_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"Subiendo(?: \(oculto\))? (.+?): (\d{1,3})%").unwrap())
}

/// Último progreso que aparece en un trozo de log.
pub fn last_progress(text: &str) -> Option<Progress> {
    text.lines().rev().find_map(|l| {
        progress_re().captures(l).map(|c| Progress {
            item: c[1].to_string(),
            percent: c[2].parse::<u8>().unwrap_or(0).min(100),
        })
    })
}

/// Progreso publicado por el propio bot en status.json (`upload: {id, percent}`), si existe.
pub fn from_status(status: &Value) -> Option<Progress> {
    let u = status.get("upload")?;
    let pct = u["percent"].as_f64()?;
    Some(Progress {
        item: u["id"].as_str().or_else(|| u["file"].as_str()).unwrap_or("vídeo").to_string(),
        percent: pct.clamp(0.0, 100.0) as u8,
    })
}

/// Sigue un archivo de log desde una posición: devuelve lo nuevo desde la última lectura.
pub struct LogTail {
    path: PathBuf,
    offset: u64,
}

impl LogTail {
    /// Empieza al final actual del log: solo interesa lo que se escriba a partir de ahora.
    pub fn at_end(path: &Path) -> Self {
        let offset = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        Self { path: path.to_path_buf(), offset }
    }

    pub fn read_new(&mut self) -> String {
        let Ok(mut f) = std::fs::File::open(&self.path) else { return String::new() };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        if len < self.offset {
            self.offset = 0; // el log ha rotado
        }
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return String::new();
        }
        let mut buf = Vec::new();
        let _ = f.take(4 * 1024 * 1024).read_to_end(&mut buf);
        // no cortar una línea a medias: lo que no acaba en salto de línea se relee en la próxima vuelta
        let cut = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
        self.offset += cut as u64;
        String::from_utf8_lossy(&buf[..cut]).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    #[test]
    fn parses_both_log_formats() {
        let log = "2026-11-16 17:53:30,478 INFO    Subiendo (oculto) v3_youtube.mp4: 96%\n\
                   2026-11-16 17:53:31,000 INFO    otra cosa\n\
                   2026-11-16 17:53:32,099 INFO    Subiendo twitch_v1_short_2: 12%\n";
        assert_eq!(last_progress(log), Some(Progress { item: "twitch_v1_short_2".into(), percent: 12 }));
        assert_eq!(last_progress("nada"), None);
    }

    #[test]
    fn status_upload_field_wins_when_present() {
        let st = json!({"upload": {"id": "v1", "percent": 42.7}});
        assert_eq!(from_status(&st), Some(Progress { item: "v1".into(), percent: 42 }));
        assert_eq!(from_status(&json!({"upload": null})), None);
        assert_eq!(from_status(&json!({})), None);
    }

    #[test]
    fn tail_reads_only_new_complete_lines_and_survives_rotation() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("bot.log");
        std::fs::write(&p, "vieja: Subiendo a: 50%\n").unwrap();
        let mut t = LogTail::at_end(&p);
        assert_eq!(t.read_new(), "");
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        write!(f, "x Subiendo b: 10%\nx Subiendo b: 2").unwrap();
        assert_eq!(last_progress(&t.read_new()).unwrap().percent, 10);
        write!(f, "0%\n").unwrap();
        assert_eq!(last_progress(&t.read_new()).unwrap().percent, 20);
        std::fs::write(&p, "x Subiendo c: 5%\n").unwrap(); // rotación: archivo nuevo y más corto
        assert_eq!(last_progress(&t.read_new()).unwrap().item, "c");
    }
}
