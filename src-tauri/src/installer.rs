//! Instalación de bots en el PC de un amigo (fase 2).
//!
//! Todo lo que se descarga se comprueba con SHA-256 antes de usarlo: el paquete del bot (hash del catálogo firmado),
//! el Python oficial (hash fijado aquí), pip (hash que publica PyPI) y los modelos (hash del manifiesto del bot).
//! Nada se ejecuta desde una descarga sin comprobar.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

use crate::winutil;

/// Python oficial "embeddable" (python.org). Sin registro de Windows ni instalador: se descomprime en el bot.
pub const PYTHON_VERSION: &str = "3.12.10";
pub const PYTHON_URL: &str = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip";
/// SHA-256 del zip anterior, comprobado contra el SPDX oficial de python.org
/// (python-3.12.10-embed-amd64.zip.spdx.json, paquete CPython). Si no coincide, no se usa.
pub const PYTHON_SHA256: &str = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3";
pub const PIP_VERSION: &str = "25.3";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogEntry {
    pub id: String,
    pub nombre: String,
    #[serde(default)]
    pub descripcion: String,
    pub version: String,
    #[serde(default)]
    pub padre: Option<String>,
    pub archivo: String,
    pub bytes: u64,
    pub sha256: String,
    #[serde(default)]
    pub requirements_gpu: Option<String>,
    #[serde(default)]
    pub modelos: Vec<Model>,
    /// Sub-bots que vienen dentro del paquete (p. ej. el de miniaturas dentro del editor)
    #[serde(default)]
    pub incluye: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub nombre: String,
    pub url: String,
    pub sha256: String,
    pub destino: String,
}

/// Un paso del progreso que ve el amigo.
#[derive(Debug, Clone, Serialize)]
pub struct Step {
    pub bot: String,
    pub paso: String,
    pub detalle: String,
    pub percent: Option<u8>,
}

pub fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex(&h.finalize())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Copia `src` en `dest` calculando el SHA-256; si no coincide con `expected`, borra lo escrito y falla.
pub fn copy_verified(mut src: impl Read, total: Option<u64>, dest: &Path, expected: &str,
                     mut progress: impl FnMut(u8)) -> Result<(), String> {
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("no hay un hash válido para comprobar {}", dest.display()));
    }
    if let Some(p) = dest.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    let tmp = dest.with_extension("descargando");
    let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut done: u64 = 0;
    let mut last = 255u8;
    loop {
        let n = src.read(&mut buf).map_err(|e| format!("descarga interrumpida: {e}"))?;
        if n == 0 { break; }
        h.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if let Some(t) = total.filter(|t| *t > 0) {
            let p = ((done * 100) / t).min(100) as u8;
            if p != last { progress(p); last = p; }
        }
    }
    drop(out);
    let got = hex(&h.finalize());
    if !got.eq_ignore_ascii_case(expected) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("el archivo descargado no es el esperado (hash distinto): {}", dest.display()));
    }
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

/// Descarga por HTTPS (o copia desde una carpeta local con `file://`, para pruebas) comprobando el hash.
pub fn download(url: &str, dest: &Path, sha256: &str, progress: impl FnMut(u8)) -> Result<(), String> {
    if let Some(path) = url.strip_prefix("file://") {
        let f = std::fs::File::open(path).map_err(|e| format!("{path}: {e}"))?;
        let total = f.metadata().ok().map(|m| m.len());
        return copy_verified(f, total, dest, sha256, progress);
    }
    if !url.starts_with("https://") {
        return Err(format!("solo se descarga por https: {url}"));
    }
    let resp = ureq::get(url).timeout(std::time::Duration::from_secs(60 * 30)).call()
        .map_err(|e| format!("no se pudo descargar {url}: {e}"))?;
    let total = resp.header("Content-Length").and_then(|v| v.parse().ok());
    copy_verified(resp.into_reader(), total, dest, sha256, progress)
}

/// Descomprime sin permitir rutas que salgan de `dest` (zip-slip) ni rutas absolutas.
pub fn extract_zip(zip_path: &Path, dest: &Path) -> Result<usize, String> {
    let f = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut n = 0;
    for i in 0..z.len() {
        let mut entry = z.by_index(i).map_err(|e| e.to_string())?;
        let rel = PathBuf::from(entry.name().replace('\\', "/"));
        if rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
            return Err(format!("ruta no permitida dentro del paquete: {}", entry.name()));
        }
        let out = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(p) = out.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
        let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut w).map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

/// Deja el Python embeddable listo en `<bot>/.venv/Scripts`: activa `site` (para pip) y añade la raíz del bot.
pub fn configure_embedded_python(py_dir: &Path) -> Result<(), String> {
    let pth = std::fs::read_dir(py_dir).map_err(|e| e.to_string())?.flatten()
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|x| x == "_pth"))
        .ok_or("el Python descargado no tiene archivo ._pth")?;
    let zip_name = pth.file_stem().unwrap().to_string_lossy().to_string() + ".zip";
    let content = format!("{zip_name}\n.\n..\\..\nimport site\n");
    std::fs::write(&pth, content).map_err(|e| e.to_string())
}

/// Añade la llave pública del Lirio de ESTE PC a wall_rules.json del bot recién instalado (antes de su primer arranque).
pub fn pin_approver(rules_path: &Path, public: &Value) -> Result<(), String> {
    let txt = std::fs::read_to_string(rules_path).map_err(|e| e.to_string())?;
    let mut rules: Value = serde_json::from_str(&txt).map_err(|e| e.to_string())?;
    if rules.get("aprobadores_humanos").is_some() {
        return Err("este bot ya tiene un aprobador fijado: no se cambia".into());
    }
    rules["aprobadores_humanos"] = json!({
        "_regla": "3 y 6",
        "_nota": "Llave pública del Lirio de este PC, fijada al instalar. Lirio solo firma tras un gesto humano.",
        "lirio": public,
    });
    let mut out = serde_json::to_string_pretty(&rules).map_err(|e| e.to_string())?;
    out.push('\n');
    std::fs::write(rules_path, out).map_err(|e| e.to_string())?;
    winutil::set_readonly(rules_path)
}

/// Traduce las respuestas del asistente a claves de config del bot según su `paquete.asistente`.
pub fn config_answers(manifest: &Value, answers: &Value) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(map) = manifest["paquete"]["asistente"].as_object() {
        for (answer, key) in map {
            if answer.starts_with('_') { continue; }
            if let (Some(k), Some(v)) = (key.as_str(), answers.get(answer)) {
                if !v.is_null() && v.as_str() != Some("") {
                    out.insert(k.to_string(), v.clone());
                }
            }
        }
    }
    Value::Object(out)
}

pub fn has_nvidia() -> bool {
    let mut c = Command::new("nvidia-smi");
    c.arg("-L").stdout(Stdio::null()).stderr(Stdio::null());
    winutil::hidden(&mut c);
    c.status().map(|s| s.success()).unwrap_or(false)
}

/// Lanza un proceso y entrega cada línea de su salida (para mostrar el avance de pip).
pub fn run_streaming(mut cmd: Command, mut on_line: impl FnMut(&str)) -> Result<(), String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    winutil::hidden(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("no se pudo lanzar: {e}"))?;
    let stderr = child.stderr.take().unwrap();
    let err_h = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = std::io::BufReader::new(stderr).read_to_string(&mut s);
        s
    });
    let out = std::io::BufReader::new(child.stdout.take().unwrap());
    use std::io::BufRead;
    for line in out.lines().map_while(Result::ok) {
        on_line(&line);
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let err = err_h.join().unwrap_or_default();
    if status.success() { Ok(()) } else {
        let last: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).rev().take(3).collect();
        Err(format!("falló ({}): {}", status.code().unwrap_or(-1), last.into_iter().rev().collect::<Vec<_>>().join(" | ")))
    }
}

/// Frase corta y legible a partir de una línea de pip.
pub fn pip_line_summary(line: &str) -> Option<String> {
    let l = line.trim();
    if let Some(rest) = l.strip_prefix("Collecting ") {
        return Some(format!("Preparando {}", rest.split([' ', '=', '<', '>', '[']).next().unwrap_or(rest)));
    }
    if let Some(rest) = l.strip_prefix("Downloading ") {
        let name = rest.split('/').next_back().unwrap_or(rest).split(' ').next().unwrap_or(rest);
        let size = rest.rsplit_once('(').map(|(_, s)| s.trim_end_matches(')')).unwrap_or("");
        return Some(format!("Descargando {name} {size}").trim().to_string());
    }
    if l.starts_with("Installing collected packages") {
        return Some("Instalando las librerías…".into());
    }
    if l.starts_with("Successfully installed") {
        return Some("Librerías instaladas".into());
    }
    None
}

/// URL y hash del wheel de pip publicado en PyPI para la versión fijada.
pub fn pip_wheel_from_pypi(meta: &Value) -> Result<(String, String), String> {
    meta["urls"].as_array().into_iter().flatten()
        .find(|u| u["packagetype"] == "bdist_wheel")
        .and_then(|u| Some((u["url"].as_str()?.to_string(), u["digests"]["sha256"].as_str()?.to_string())))
        .ok_or_else(|| "PyPI no devolvió el wheel de pip".into())
}

/// Lo necesario para instalar un bot del catálogo.
pub struct InstallJob<'a> {
    pub entry: &'a CatalogEntry,
    /// Base de descarga (`https://…/releases/latest/download` o `file://carpeta` en pruebas)
    pub base: &'a str,
    /// Carpeta donde viven los bots instalados (`%LOCALAPPDATA%\Lirio\bots`)
    pub bots_root: &'a Path,
    /// Caché de descargas compartidas (Python, pip)
    pub cache: &'a Path,
    /// Llave pública del Lirio de este PC (se fija en wall_rules.json del bot)
    pub approver_public: Value,
    /// Respuestas del asistente (canal, IA…)
    pub answers: &'a Value,
}

/// Instala un bot: paquete -> Python -> librerías -> modelos -> llave -> configuración -> setup.
/// Devuelve la carpeta del bot. Si falla a medias, se puede repetir: cada paso comprueba lo que ya está hecho.
pub fn install_bot(job: &InstallJob, emit: &mut dyn FnMut(Step)) -> Result<PathBuf, String> {
    let e = job.entry;
    let dir = job.bots_root.join(&e.id);
    let mut say = |paso: &str, detalle: String, percent: Option<u8>| {
        emit(Step { bot: e.id.clone(), paso: paso.into(), detalle, percent })
    };

    // 1. Paquete del bot (hash del catálogo firmado)
    if !dir.join("aniuzka.json").exists() {
        let zip = job.cache.join(&e.archivo);
        say("paquete", format!("Descargando {} ({:.1} MB)", e.nombre, e.bytes as f64 / 1e6), Some(0));
        download(&format!("{}/{}", job.base, e.archivo), &zip, &e.sha256, |p| say("paquete", format!("Descargando {}", e.nombre), Some(p)))?;
        std::fs::create_dir_all(&dir).map_err(|x| x.to_string())?;
        extract_zip(&zip, &dir)?;
    }
    let manifest: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("aniuzka.json")).map_err(|x| x.to_string())?)
        .map_err(|x| x.to_string())?;
    let module = manifest["entrypoint"]["module"].as_str().ok_or("manifiesto sin entrypoint.module")?.to_string();

    // 2. Python privado del bot
    let py_dir = dir.join(".venv").join("Scripts");
    let python = py_dir.join("python.exe");
    if !python.exists() {
        let zip = job.cache.join(format!("python-{PYTHON_VERSION}-embed-amd64.zip"));
        if !zip.exists() {
            say("python", format!("Descargando Python {PYTHON_VERSION} (python.org)"), Some(0));
            download(PYTHON_URL, &zip, PYTHON_SHA256, |p| say("python", format!("Descargando Python {PYTHON_VERSION}"), Some(p)))?;
        }
        say("python", "Preparando Python".into(), None);
        extract_zip(&zip, &py_dir)?;
        configure_embedded_python(&py_dir)?;
    }

    // 3. pip (wheel oficial de PyPI, con el hash que publica PyPI)
    if !py_dir.join("Lib").join("site-packages").join("pip").exists() {
        say("pip", "Preparando el instalador de librerías (pip)".into(), None);
        let meta: Value = if let Some(local) = job.base.strip_prefix("file://") {
            serde_json::from_str(&std::fs::read_to_string(Path::new(local).join("pip.json")).map_err(|x| x.to_string())?)
                .map_err(|x| x.to_string())?
        } else {
            ureq::get(&format!("https://pypi.org/pypi/pip/{PIP_VERSION}/json")).call()
                .map_err(|x| format!("PyPI: {x}"))?.into_json().map_err(|x| x.to_string())?
        };
        let (url, sha) = pip_wheel_from_pypi(&meta)?;
        let whl = job.cache.join(url.rsplit('/').next().unwrap_or("pip.whl"));
        download(&url, &whl, &sha, |_| {})?;
        // Un wheel es un zip con el paquete y su .dist-info: descomprimirlo en site-packages es instalarlo
        // (pip se niega a «instalarse a sí mismo» lanzado desde el propio wheel).
        extract_zip(&whl, &py_dir.join("Lib").join("site-packages"))?;
    }

    // 4. Librerías del bot
    let mut reqs = vec![dir.join("requirements.txt")];
    if let Some(gpu) = e.requirements_gpu.as_deref().filter(|_| has_nvidia()) {
        reqs.push(dir.join(gpu));
    }
    for r in reqs.iter().filter(|r| r.exists()) {
        say("librerias", "Instalando librerías (puede tardar varios minutos)".into(), None);
        let mut c = Command::new(&python);
        c.current_dir(&dir).args(["-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check", "-r"]).arg(r);
        run_streaming(c, |line| if let Some(s) = pip_line_summary(line) { say("librerias", s, None) })?;
    }

    // 5. Modelos (descargados aquí, nunca en el paquete)
    for m in &e.modelos {
        let dest = dir.join(&m.destino);
        if dest.exists() { continue; }
        say("modelos", format!("Descargando el modelo {}", m.nombre), Some(0));
        download(&m.url, &dest, &m.sha256, |p| say("modelos", format!("Descargando el modelo {}", m.nombre), Some(p)))?;
    }

    // 6. Llave de aprobaciones del Lirio de este PC
    let rules = dir.join("wall_rules.json");
    let pinned: Value = serde_json::from_str(&std::fs::read_to_string(&rules).map_err(|x| x.to_string())?).unwrap_or(Value::Null);
    if pinned.get("aprobadores_humanos").is_none() {
        say("wall", "Fijando tu llave de aprobaciones (The Wall)".into(), None);
        pin_approver(&rules, &job.approver_public)?;
    }

    // 7. Configuración con las respuestas del asistente (el bot nunca pisa una config que ya exista)
    if !dir.join("config.yaml").exists() {
        say("config", "Creando tu configuración".into(), None);
        let answers = config_answers(&manifest, job.answers);
        let file = job.cache.join(format!("respuestas-{}.json", e.id));
        std::fs::write(&file, serde_json::to_vec(&answers).unwrap()).map_err(|x| x.to_string())?;
        let mut c = Command::new(&python);
        c.current_dir(&dir).args(["-m", &module, "--json", "config-inicial"]).arg(&file);
        let res = run_streaming(c, |_| {});
        let _ = std::fs::remove_file(&file);
        res?;
    }

    // 8. Preparación final del propio bot (carpetas, comprobaciones)
    if manifest["commands"].get("setup").is_some() {
        say("setup", "Comprobando que todo funciona".into(), None);
        let mut c = Command::new(&python);
        c.current_dir(&dir).args(["-m", &module, "--json", "setup", "--no-install"]);
        if let Err(err) = run_streaming(c, |_| {}) {
            say("setup", format!("Aviso: {err}. Puedes revisarlo con Diagnóstico."), None);
        }
    }
    say("listo", format!("{} instalado", e.nombre), Some(100));
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_copy_accepts_good_and_rejects_bad_hash() {
        let d = tempfile::tempdir().unwrap();
        let data = b"hola lirio".to_vec();
        let good = sha256_hex(&data);
        let mut seen = vec![];
        copy_verified(&data[..], Some(data.len() as u64), &d.path().join("a.bin"), &good, |p| seen.push(p)).unwrap();
        assert_eq!(std::fs::read(d.path().join("a.bin")).unwrap(), data);
        assert_eq!(seen.last(), Some(&100));
        let bad = "0".repeat(64);
        let err = copy_verified(&data[..], None, &d.path().join("b.bin"), &bad, |_| {}).unwrap_err();
        assert!(err.contains("hash"));
        assert!(!d.path().join("b.bin").exists() && !d.path().join("b.descargando").exists());
        assert!(copy_verified(&data[..], None, &d.path().join("c.bin"), "PENDIENTE", |_| {}).is_err());
    }

    #[test]
    fn download_only_https_or_local_file() {
        let d = tempfile::tempdir().unwrap();
        assert!(download("http://example.com/x", &d.path().join("x"), &"0".repeat(64), |_| {}).unwrap_err().contains("https"));
        let src = d.path().join("src.zip");
        std::fs::write(&src, b"abc").unwrap();
        let url = format!("file://{}", src.display());
        download(&url, &d.path().join("out.zip"), &sha256_hex(b"abc"), |_| {}).unwrap();
    }

    fn zip_with(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut z = zip::ZipWriter::new(std::fs::File::create(f.path()).unwrap());
        for (name, data) in entries {
            z.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(data).unwrap();
        }
        z.finish().unwrap();
        f
    }

    #[test]
    fn extract_refuses_zip_slip() {
        let d = tempfile::tempdir().unwrap();
        let ok = zip_with(&[("bot/a.py", b"x"), ("aniuzka.json", b"{}")]);
        assert_eq!(extract_zip(ok.path(), d.path()).unwrap(), 2);
        assert!(d.path().join("bot/a.py").exists());
        let evil = zip_with(&[("../fuera.txt", b"x")]);
        assert!(extract_zip(evil.path(), &d.path().join("x")).is_err());
        assert!(!d.path().join("fuera.txt").exists());
    }

    #[test]
    fn embedded_python_pth_is_rewritten() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("python312._pth"), "python312.zip\n.\n#import site\n").unwrap();
        configure_embedded_python(d.path()).unwrap();
        let t = std::fs::read_to_string(d.path().join("python312._pth")).unwrap();
        assert_eq!(t, "python312.zip\n.\n..\\..\nimport site\n");
    }

    #[test]
    fn pin_approver_only_once_and_readonly() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("wall_rules.json");
        std::fs::write(&p, r#"{"version": "0.1"}"#).unwrap();
        let key = json!({"alg": "ed25519", "llave_publica": "AAAA", "id": "lirio-x"});
        pin_approver(&p, &key).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["aprobadores_humanos"]["lirio"]["id"], "lirio-x");
        assert!(std::fs::metadata(&p).unwrap().permissions().readonly());
        winutil::clear_readonly(&p).unwrap();
        assert!(pin_approver(&p, &key).unwrap_err().contains("ya tiene"));
    }

    #[test]
    fn answers_are_mapped_only_when_declared() {
        let manifest = json!({"paquete": {"asistente": {"canal_twitch": "canal.twitch_login", "ia": "editorial.backend",
                                                        "_nota": "x"}}});
        let answers = json!({"canal_twitch": "pepe", "ia": "ollama", "carpeta_obs": "D:/OBS", "nombre_canal": ""});
        assert_eq!(config_answers(&manifest, &answers), json!({"canal.twitch_login": "pepe", "editorial.backend": "ollama"}));
        assert_eq!(config_answers(&json!({}), &answers), json!({}));
    }

    #[test]
    fn pip_lines() {
        assert_eq!(pip_line_summary("Collecting numpy>=1.26 (from -r requirements.txt (line 2))").unwrap(), "Preparando numpy");
        assert_eq!(pip_line_summary("  Downloading https://files.pythonhosted.org/x/torch-2.5.1-cp312-win_amd64.whl (203.1 MB)").unwrap(),
                   "Descargando torch-2.5.1-cp312-win_amd64.whl 203.1 MB");
        assert!(pip_line_summary("   ━━━━━━━━ 1.2/203.1 MB").is_none());
    }

    #[test]
    fn pypi_wheel() {
        let meta = json!({"urls": [{"packagetype": "sdist", "url": "s", "digests": {"sha256": "a"}},
                                   {"packagetype": "bdist_wheel", "url": "w", "digests": {"sha256": "b"}}]});
        assert_eq!(pip_wheel_from_pypi(&meta).unwrap(), ("w".into(), "b".into()));
    }
}
