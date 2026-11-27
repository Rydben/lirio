//! Voz del narrador del editor (Kokoro, Apache 2.0): ~115 MB que NO van en el instalador. Se bajan aparte con un
//! botón, con progreso real, reanudable y comprobando la huella de cada archivo. Sin ella el editor narra solo con
//! tarjetas de texto.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{Emitter, State};

use crate::{fetch, installer, AppState};

pub const EVENT: &str = "lirio://voz-narrador";
const BASE: &str = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";

/// (archivo, sha256, bytes): comprobados contra la descarga oficial de kokoro-onnx.
pub const FILES: &[(&str, &str, u64)] = &[
    ("kokoro-v1.0.int8.onnx", "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb", 92_361_271),
    ("voices-v1.0.bin", "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d", 28_214_398),
];

pub fn voices_dir(bot_dir: &Path) -> PathBuf {
    bot_dir.join("models").join("voces")
}

/// ¿Están los dos archivos y con su tamaño exacto?
pub fn installed(bot_dir: &Path) -> bool {
    let d = voices_dir(bot_dir);
    FILES.iter().all(|(f, _, size)| std::fs::metadata(d.join(f)).is_ok_and(|m| m.len() == *size))
}

pub fn items(bot_dir: &Path) -> Vec<fetch::Item> {
    let d = voices_dir(bot_dir);
    FILES.iter().filter(|(f, _, size)| !std::fs::metadata(d.join(f)).is_ok_and(|m| m.len() == *size))
        .map(|(f, sha, size)| fetch::Item { name: f.to_string(), url: format!("{BASE}/{f}"), dest: d.join(f),
                                            sha256: sha.to_string(), size: *size })
        .collect()
}

static CANCEL: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

#[tauri::command]
pub fn narrator_voice_status(state: State<AppState>, id: String) -> Result<Value, String> {
    let m = state.module(&id)?;
    let total: u64 = FILES.iter().map(|f| f.2).sum();
    Ok(json!({"instalada": installed(&m.dir), "bytes": total, "descargando": CANCEL.lock().unwrap().is_some()}))
}

/// Baja la voz en segundo plano y avisa por `lirio://voz-narrador` {percent, detalle, hecho, ok, error}.
#[tauri::command]
pub fn narrator_voice_install(app: tauri::AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    let m = state.module(&id)?;
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut c = CANCEL.lock().unwrap();
        if c.is_some() { return Err("Ya se está descargando.".into()); }
        *c = Some(flag.clone());
    }
    let dir = m.dir.clone();
    std::thread::spawn(move || {
        let todo = items(&dir);
        let res = if todo.is_empty() { Ok(()) } else {
            let _ = std::fs::create_dir_all(voices_dir(&dir));
            installer::with_cancel(flag, || fetch::fetch_all(todo, 2, |p| {
                let _ = app.emit(EVENT, json!({"percent": p.percent(), "detalle": p.text(), "hecho": false}));
            }))
        };
        *CANCEL.lock().unwrap() = None;
        let ok = res.is_ok() && installed(&dir);
        let _ = app.emit(EVENT, json!({"hecho": true, "ok": ok, "error": res.err()}));
    });
    Ok(())
}

#[tauri::command]
pub fn narrator_voice_cancel() -> bool {
    CANCEL.lock().unwrap().as_ref().map(|f| f.store(true, Ordering::Relaxed)).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_missing_or_wrong_size_files_are_downloaded() {
        let d = tempfile::tempdir().unwrap();
        assert!(!installed(d.path()));
        assert_eq!(items(d.path()).len(), 2);
        let it = &items(d.path())[0];
        assert!(it.url.starts_with("https://github.com/thewh1teagle/kokoro-onnx/releases/download/"));
        assert_eq!(it.sha256.len(), 64);
        assert!(it.dest.starts_with(voices_dir(d.path())));
        // un archivo a medias (otro tamaño) se vuelve a pedir
        std::fs::create_dir_all(voices_dir(d.path())).unwrap();
        std::fs::write(voices_dir(d.path()).join("voices-v1.0.bin"), b"a medias").unwrap();
        assert_eq!(items(d.path()).len(), 2);
    }
}
