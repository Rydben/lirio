//! IA local para el amigo, sin que tenga que hacer nada: Lirio descarga Ollama de su web oficial, comprueba que el
//! instalador lleva la firma de Windows de Ollama, lo instala en silencio (solo para su usuario, sin administrador),
//! lo arranca y baja el modelo recomendado para su gráfica. Avance en `lirio://ollama` con `fase` y `percent`.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use crate::{fetch, winutil};

pub const SETUP_URL: &str = "https://ollama.com/download/OllamaSetup.exe";
pub const API: &str = "http://127.0.0.1:11434";

pub fn install_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_default().join("Programs").join("Ollama")
}

pub fn api_up() -> bool {
    ureq::get(&format!("{API}/api/tags")).timeout(Duration::from_secs(2)).call().is_ok()
}

/// La firma Authenticode del instalador debe ser válida y de Ollama. Si no, no se ejecuta.
pub fn check_signature(exe: &Path) -> Result<(), String> {
    let script = "$s = Get-AuthenticodeSignature -LiteralPath $env:LIRIO_FIRMA; \
                  $s.Status.ToString() + '|' + $s.SignerCertificate.Subject";
    let mut c = Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-Command", script]).env("LIRIO_FIRMA", exe);
    winutil::hidden(&mut c);
    let out = c.output().map_err(|e| format!("no se pudo comprobar la firma: {e}"))?;
    signature_ok(&String::from_utf8_lossy(&out.stdout))
}

pub fn signature_ok(ps_out: &str) -> Result<(), String> {
    let (status, subject) = ps_out.trim().split_once('|').unwrap_or((ps_out.trim(), ""));
    // Firmante real del instalador oficial (comprobado el 2026-11-17): "CN=Ollama Inc., O=Ollama Inc., …"
    if status == "Valid" && subject.starts_with("CN=Ollama Inc.,") && subject.contains("O=Ollama Inc.") {
        Ok(())
    } else {
        Err(format!("El instalador descargado no lleva la firma de Ollama ({status}). No se ha instalado nada."))
    }
}

fn dir_size(p: &Path) -> u64 {
    std::fs::read_dir(p).into_iter().flatten().flatten().map(|e| {
        let m = e.metadata();
        match m { Ok(m) if m.is_dir() => dir_size(&e.path()), Ok(m) => m.len(), Err(_) => 0 }
    }).sum()
}

/// Descarga, comprueba, instala y arranca Ollama. `emit(fase, detalle, percent)`.
pub fn install(cache: &Path, emit: &mut dyn FnMut(&str, String, Option<u8>)) -> Result<(), String> {
    if api_up() { return Ok(()); }
    let exe_app = install_dir().join("ollama app.exe");
    if !exe_app.exists() {
        // 1. Descarga (reanudable; el SHA no se fija porque cambia con cada versión: se exige la firma de Ollama)
        let setup = cache.join("OllamaSetup.exe");
        let item = fetch::Item { name: "Ollama".into(), url: SETUP_URL.into(), dest: setup.clone(), sha256: String::new(), size: 0 };
        fetch::fetch_all(vec![item], 1, |p| emit("descarga", format!("Descargando Ollama (ollama.com): {}", p.text()), Some(p.percent())))?;
        emit("descarga", "Comprobando la firma de Ollama…".into(), Some(100));
        check_signature(&setup)?;

        // 2. Instalación en silencio (Inno Setup, por usuario). Avance aproximado: lo ya copiado frente al tamaño del instalador.
        let expected = std::fs::metadata(&setup).map(|m| m.len()).unwrap_or(1).max(1) * 2;
        let mut c = Command::new(&setup);
        c.args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"]);
        let mut child = c.spawn().map_err(|e| format!("no se pudo abrir el instalador de Ollama: {e}"))?;
        loop {
            if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
                if !st.success() { return Err(format!("el instalador de Ollama terminó con error ({})", st.code().unwrap_or(-1))); }
                break;
            }
            let pct = (dir_size(&install_dir()) as f64 / expected as f64 * 100.0).min(95.0) as u8;
            emit("instalacion", "Instalando Ollama…".into(), Some(pct));
            std::thread::sleep(Duration::from_millis(700));
        }
        emit("instalacion", "Ollama instalado".into(), Some(100));
        let _ = std::fs::remove_file(&setup);
    }
    // 3. Arrancar (el instalador suele abrirlo solo; si no, se abre aquí)
    emit("arranque", "Abriendo Ollama…".into(), None);
    let t0 = Instant::now();
    let mut launched = false;
    while !api_up() {
        if !launched && t0.elapsed() > Duration::from_secs(5) && exe_app.exists() {
            let mut c = Command::new(&exe_app);
            winutil::hidden(&mut c);
            let _ = c.spawn();
            launched = true;
        }
        if t0.elapsed() > Duration::from_secs(90) {
            return Err("Ollama se instaló pero no arranca. Ábrelo desde el menú Inicio y vuelve a intentarlo.".into());
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    Ok(())
}

/// Baja un modelo con avance real. `emit(fase, detalle, percent)`.
pub fn pull(model: &str, emit: &mut dyn FnMut(&str, String, Option<u8>)) -> Result<(), String> {
    if !model.chars().all(|c| c.is_ascii_alphanumeric() || ".:-_".contains(c)) {
        return Err("nombre de modelo no válido".into());
    }
    let resp = ureq::post(&format!("{API}/api/pull")).timeout(Duration::from_secs(60 * 60 * 3))
        .send_json(json!({"model": model, "stream": true})).map_err(|e| format!("Ollama no responde: {e}"))?;
    use std::io::BufRead;
    let started = Instant::now();
    for line in std::io::BufReader::new(resp.into_reader()).lines().map_while(Result::ok) {
        let v: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        if let Some(err) = v["error"].as_str() { return Err(err.to_string()); }
        let (c, t) = (v["completed"].as_f64(), v["total"].as_f64());
        let pct = match (c, t) { (Some(c), Some(t)) if t > 0.0 => Some((c / t * 100.0) as u8), _ => None };
        let mut detalle = format!("Bajando el modelo {model}");
        if let (Some(c), Some(t)) = (c, t) {
            let speed = c / started.elapsed().as_secs_f64().max(1.0);
            detalle += &format!(": {} de {}", fetch::human(c as u64), fetch::human(t as u64));
            if speed > 1.0 && t > c { detalle += &format!(" · quedan {}", fetch::human_time(((t - c) / speed) as u64)); }
        } else if let Some(s) = v["status"].as_str() {
            detalle += &format!(" ({s})");
        }
        emit("modelo", detalle, pct);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ollama_signed_installers() {
        assert!(signature_ok("Valid|CN=Ollama Inc., O=Ollama Inc., L=Toronto, S=Ontario, C=CA, SERIALNUMBER=2713355").is_ok());
        assert!(signature_ok("Valid|CN=Ollama Inc. Falso, O=Otro").is_err());
        assert!(signature_ok("NotSigned|").is_err());
        assert!(signature_ok("Valid|CN=Otro, O=Otro").is_err());
        assert!(signature_ok("HashMismatch|CN=Ollama Inc., O=Ollama Inc.").is_err());
    }
}
