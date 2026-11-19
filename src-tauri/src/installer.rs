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

pub fn hex_digest(b: &[u8]) -> String { hex(b) }

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

// ---------- Cancelar una instalación ----------
// Cada instalación corre en su hilo con su bandera de "cancelar". Las descargas y pip la consultan solas.
pub const CANCELLED: &str = "cancelado";

thread_local! {
    static CANCEL: std::cell::RefCell<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>> = const { std::cell::RefCell::new(None) };
}

/// Ejecuta `f` en este hilo con esa bandera de cancelar.
pub fn with_cancel<T>(flag: std::sync::Arc<std::sync::atomic::AtomicBool>, f: impl FnOnce() -> T) -> T {
    CANCEL.with(|c| *c.borrow_mut() = Some(flag));
    let r = f();
    CANCEL.with(|c| *c.borrow_mut() = None);
    r
}

pub fn cancel_flag() -> Option<std::sync::Arc<std::sync::atomic::AtomicBool>> {
    CANCEL.with(|c| c.borrow().clone())
}

pub fn is_cancelled() -> bool {
    cancel_flag().is_some_and(|f| f.load(std::sync::atomic::Ordering::Relaxed))
}

fn check_cancel() -> Result<(), String> {
    if is_cancelled() { Err(CANCELLED.into()) } else { Ok(()) }
}

/// Lo que se descarga a la caché compartida (Python, pip) no lo bajan dos instalaciones a la vez.
static SHARED: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Marca de "instalación sin terminar" dentro de la carpeta del bot (con las respuestas del asistente, para retomarla).
pub const INSTALL_MARK: &str = ".lirio-instalacion.json";

/// Lanza un proceso y entrega cada línea de su salida (para mostrar el avance de pip). Si la instalación se cancela,
/// se cierra el proceso (y sus hijos).
pub fn run_streaming(mut cmd: Command, mut on_line: impl FnMut(&str)) -> Result<(), String> {
    check_cancel()?;
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    winutil::hidden(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("no se pudo lanzar: {e}"))?;
    let pid = child.id();
    let stderr = child.stderr.take().unwrap();
    let err_h = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = std::io::BufReader::new(stderr).read_to_string(&mut s);
        s
    });
    let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Some(flag) = cancel_flag() {
        let finished = finished.clone();
        std::thread::spawn(move || {
            use std::sync::atomic::Ordering::Relaxed;
            while !finished.load(Relaxed) {
                if flag.load(Relaxed) {
                    let mut k = Command::new("taskkill");
                    k.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
                    winutil::hidden(&mut k);
                    let _ = k.status();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
        });
    }
    let out = std::io::BufReader::new(child.stdout.take().unwrap());
    use std::io::BufRead;
    for line in out.lines().map_while(Result::ok) {
        on_line(&line);
    }
    let status = child.wait().map_err(|e| e.to_string());
    finished.store(true, std::sync::atomic::Ordering::Relaxed);
    check_cancel()?;
    let status = status?;
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

/// Instala un requirements.txt rápido y con avance real:
/// 1) pip calcula qué hace falta SIN descargar los paquetes grandes (`--dry-run --report`);
/// 2) Lirio los baja en paralelo, reanudando, reintentando y comprobando el SHA-256 que da PyPI;
/// 3) pip instala desde esa carpeta, sin volver a internet. La carpeta se borra al acabar.
/// Si el paso 1 falla (pip antiguo, sin red al índice…), se usa pip normal como antes.
pub fn install_requirements(python: &Path, dir: &Path, req: &Path, wheels: &Path, paso: &str,
                            say: &mut dyn FnMut(&str, String, Option<u8>)) -> Result<(), String> {
    say(paso, "Preparando las herramientas de construcción…".into(), None);
    ensure_build_tools(python, dir)?;
    say(paso, "Calculando qué librerías hacen falta…".into(), None);
    std::fs::create_dir_all(wheels).map_err(|x| x.to_string())?;
    let plan = pip_plan(python, dir, req, wheels, None);
    // --no-build-isolation: el Python embebido ignora las rutas que pip usa para construir en un entorno aparte
    // («Cannot import setuptools.build_meta»); se construye con el setuptools ya instalado en el propio bot.
    let base_args = ["-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check", "--no-build-isolation", "--no-cache-dir"];
    match plan {
        Some(items) if items.is_empty() => { say(paso, "Las librerías ya estaban".into(), Some(100)); }
        Some(items) => {
            crate::fetch::fetch_all(items, 4, |p| {
                let what = if p.current.is_empty() { String::new() } else { format!(" ({})", p.current) };
                say(paso, format!("Descargando librerías{what}: {}", p.text()), Some(p.percent()));
            })?;
            // Los paquetes que solo existen como código fuente (p. ej. `srt`, un .tar.gz) hay que construirlos.
            // Se hace aquí, con internet (pip trae su herramienta de construcción, setuptools u otra), y se deja
            // la rueda construida junto a las demás: así la instalación de después sí puede ir sin internet.
            let sdists: Vec<PathBuf> = std::fs::read_dir(wheels).into_iter().flatten().flatten().map(|e| e.path())
                .filter(|p| p.is_file() && is_sdist(p)).collect();
            for (i, sd) in sdists.iter().enumerate() {
                let name = sd.file_name().unwrap_or_default().to_string_lossy().to_string();
                say(paso, format!("Preparando {name} ({} de {})", i + 1, sdists.len()), None);
                let before = wheel_count(wheels);
                let mut c = Command::new(python);
                c.current_dir(dir).args(["-m", "pip", "wheel", "--no-deps", "--no-build-isolation", "--disable-pip-version-check", "--no-cache-dir", "-w"])
                    .arg(wheels).arg(sd);
                // pip a veces se cae AL CERRARSE cuando no tiene ventana; vale si dejó la rueda hecha
                if let Err(e) = run_streaming(c, |_| {}) {
                    if e == CANCELLED || wheel_count(wheels) <= before { return Err(e); }
                }
                let _ = std::fs::remove_file(sd);
            }
            say(paso, "Instalando las librerías (sin internet, desde lo descargado)…".into(), None);
            let mut c = Command::new(python);
            c.current_dir(dir).args(base_args).arg("--no-index").arg("--find-links").arg(wheels).arg("-r").arg(req);
            let r = run_streaming(c, |line| if let Some(s) = pip_line_summary(line) { say(paso, s, None) });
            confirm_installed(r, python, dir, req, wheels, Some(wheels), paso, say)?;
        }
        None => {
            say(paso, "Instalando librerías con pip (puede tardar varios minutos)".into(), None);
            let mut c = Command::new(python);
            c.current_dir(dir).args(base_args).arg("-r").arg(req);
            let r = run_streaming(c, |line| if let Some(s) = pip_line_summary(line) { say(paso, s, None) });
            confirm_installed(r, python, dir, req, wheels, None, paso, say)?;
        }
    }
    let _ = std::fs::remove_dir_all(wheels);
    Ok(())
}

/// setuptools y wheel dentro del Python del bot (para construir los paquetes que solo vienen como código fuente).
fn ensure_build_tools(python: &Path, dir: &Path) -> Result<(), String> {
    let has = || {
        let mut c = Command::new(python);
        c.current_dir(dir).args(["-c", "import setuptools, wheel"]).stdout(Stdio::null()).stderr(Stdio::null());
        winutil::hidden(&mut c);
        c.status().is_ok_and(|s| s.success())
    };
    if has() { return Ok(()); }
    let mut c = Command::new(python);
    c.current_dir(dir).args(["-m", "pip", "install", "--no-warn-script-location", "--disable-pip-version-check", "--no-cache-dir", "setuptools", "wheel"]);
    let r = run_streaming(c, |_| {});
    if matches!(&r, Err(e) if e == CANCELLED) { return r; }
    // pip puede caerse al cerrarse sin ventana: vale si quedaron instalados
    if has() { Ok(()) } else { r.and(Err("no se pudo preparar setuptools".into())) }
}

fn wheel_count(d: &Path) -> usize {
    std::fs::read_dir(d).into_iter().flatten().flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "whl")).count()
}

/// Lo que pip instalaría (`--dry-run --report`, sin descargar los paquetes grandes). `find_links`: solo desde esa
/// carpeta, sin internet. Se usa el informe aunque pip se caiga al cerrarse, si llegó a escribirlo entero.
fn pip_plan(python: &Path, dir: &Path, req: &Path, wheels: &Path, find_links: Option<&Path>) -> Option<Vec<crate::fetch::Item>> {
    let report = wheels.join("plan.json");
    let _ = std::fs::remove_file(&report);
    let mut c = Command::new(python);
    c.current_dir(dir).args(["-m", "pip", "install", "--dry-run", "--quiet", "--disable-pip-version-check", "--no-build-isolation", "--no-cache-dir"]);
    if let Some(fl) = find_links { c.arg("--no-index").arg("--find-links").arg(fl); }
    c.arg("--report").arg(&report).arg("-r").arg(req);
    let ran = run_streaming(c, |_| {});
    if matches!(&ran, Err(e) if e == CANCELLED) { return None; }
    let v: Value = serde_json::from_str(&std::fs::read_to_string(&report).ok()?).ok()?;
    crate::fetch::items_from_pip_report(&v, wheels).ok()
}

/// pip a veces termina con un fallo de Windows (0xC0000005) AL CERRARSE cuando se lanza sin ventana, después de
/// haber instalado todo. Si falla, se le vuelve a preguntar qué falta: si no falta nada, la instalación vale.
#[allow(clippy::too_many_arguments)]
fn confirm_installed(r: Result<(), String>, python: &Path, dir: &Path, req: &Path, wheels: &Path, find_links: Option<&Path>,
                     paso: &str, say: &mut dyn FnMut(&str, String, Option<u8>)) -> Result<(), String> {
    let Err(err) = r else { return Ok(()) };
    if err == CANCELLED { return Err(err); }
    say(paso, "Comprobando que todo quedó instalado…".into(), None);
    match pip_plan(python, dir, req, wheels, find_links) {
        Some(left) if left.is_empty() => Ok(()),
        Some(left) => Err(format!("{err}. Faltan {} librerías: {}", left.len(),
                                  left.iter().take(5).map(|i| i.name.as_str()).collect::<Vec<_>>().join(", "))),
        None => Err(err),
    }
}

/// ¿Paquete de código fuente (hay que construirlo) en vez de rueda ya hecha?
pub fn is_sdist(p: &Path) -> bool {
    let n = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
    n.ends_with(".tar.gz") || n.ends_with(".zip") || n.ends_with(".tar.bz2") || n.ends_with(".tgz")
}

/// Librerías de la gráfica NVIDIA de un bot (si las declara): ¿hacen falta, ya están?
pub fn gpu_info(bot_dir: &Path) -> Value {
    let req = bot_dir.join("requirements-gpu.txt");
    let installed = bot_dir.join(".venv").join("Lib").join("site-packages").join("nvidia").join("cudnn").exists();
    json!({ "declara": req.exists(), "instalado": installed })
}

/// Avance de las instalaciones de GPU en curso (por bot), para que la página del bot lo enseñe al volver.
pub static GPU_PROGRESS: std::sync::LazyLock<std::sync::Mutex<std::collections::BTreeMap<String, Value>>> =
    std::sync::LazyLock::new(Default::default);

/// Instala las librerías de la gráfica NVIDIA de un bot (paso aparte y opcional; el bot sigue en CPU mientras).
pub fn install_gpu(bot_id: &str, bot_dir: &Path, cache: &Path, emit: &mut dyn FnMut(Value)) -> Result<(), String> {
    let req = bot_dir.join("requirements-gpu.txt");
    if !req.exists() { return Err("Este bot no usa la gráfica".into()); }
    if !has_nvidia() { return Err("No hay una gráfica NVIDIA en este PC: el bot funciona en CPU".into()); }
    let python = bot_dir.join(".venv").join("Scripts").join("python.exe");
    let mut say = |_: &str, detalle: String, percent: Option<u8>| {
        let v = json!({ "bot": bot_id, "detalle": detalle, "percent": percent, "hecho": false });
        GPU_PROGRESS.lock().unwrap().insert(bot_id.to_string(), v.clone());
        emit(v);
    };
    let r = install_requirements(&python, bot_dir, &req, &cache.join(format!("gpu-{bot_id}")), "gpu", &mut say);
    let v = json!({ "bot": bot_id, "hecho": true, "ok": r.is_ok(), "error": r.as_ref().err() });
    GPU_PROGRESS.lock().unwrap().insert(bot_id.to_string(), v.clone());
    emit(v);
    r
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
    check_cancel()?;
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
    check_cancel()?;
    let shared = SHARED.lock().unwrap_or_else(|p| p.into_inner());
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

    drop(shared);

    // 4. Librerías del bot. Las de la gráfica NVIDIA (cuDNN, cuBLAS: GB) van aparte, después, con `install_gpu`:
    //    el bot ya funciona en CPU mientras tanto.
    let req = dir.join("requirements.txt");
    if req.exists() {
        install_requirements(&python, &dir, &req, &job.cache.join(format!("librerias-{}", e.id)), "librerias", &mut say)?;
    }

    // 5. Modelos (descargados aquí, nunca en el paquete)
    check_cancel()?;
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
    fn cancel_stops_a_running_process_quickly() {
        use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
        let flag = Arc::new(AtomicBool::new(false));
        let f2 = flag.clone();
        std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_millis(400)); f2.store(true, Ordering::Relaxed); });
        let t0 = std::time::Instant::now();
        let mut c = Command::new("ping");
        c.args(["-n", "30", "127.0.0.1"]);
        let r = with_cancel(flag, || run_streaming(c, |_| {}));
        assert_eq!(r.unwrap_err(), CANCELLED);
        assert!(t0.elapsed() < std::time::Duration::from_secs(10), "{:?}", t0.elapsed());
        assert!(!is_cancelled(), "la bandera es solo de ese trabajo");
    }

    #[test]
    fn source_packages_are_detected() {
        assert!(is_sdist(Path::new("C:/w/srt-3.5.3.tar.gz")));
        assert!(is_sdist(Path::new("C:/w/x-1.0.zip")));
        assert!(!is_sdist(Path::new("C:/w/numpy-2.0-cp312-win_amd64.whl")));
        assert!(!is_sdist(Path::new("C:/w/plan.json")));
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

#[cfg(test)]
mod pc_nuevo {
    /// Instalación COMPLETA de los bots del catálogo en un "PC nuevo" simulado (descarga Python, pip y librerías
    /// de verdad). No corre por defecto:
    /// LIRIO_E2E_DIST=<dist-publicacion\vX> LIRIO_E2E_DIR=<carpeta vacía> cargo test pc_nuevo -- --ignored --nocapture
    #[test]
    #[ignore]
    fn full_install_of_every_bot() {
        let dist = std::path::PathBuf::from(std::env::var("LIRIO_E2E_DIST").expect("LIRIO_E2E_DIST"));
        let root = std::path::PathBuf::from(std::env::var("LIRIO_E2E_DIR").expect("LIRIO_E2E_DIR"));
        let cat: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dist.join("catalogo.json")).unwrap()).unwrap();
        let bots: Vec<super::CatalogEntry> = serde_json::from_value(cat["bots"].clone()).unwrap();
        let base = format!("file://{}", dist.display());
        let answers = serde_json::json!({"nombre": "Prueba", "canal_twitch": "", "nombre_canal": "", "carpeta_obs": "", "ia": "heuristico"});
        let key = serde_json::json!({"alg": "ed25519", "llave_publica": "mWqreChhlTG9a/LV+SBgohzdIsIa3loNwkd+hY+VBKY=", "id": "lirio-prueba"});
        for e in bots.iter().filter(|b| b.padre.is_none()) {
            let t0 = std::time::Instant::now();
            let job = super::InstallJob { entry: e, base: &base, bots_root: &root.join("bots"), cache: &root.join("descargas"),
                                          approver_public: key.clone(), answers: &answers };
            let mut last = String::new();
            let dir = super::install_bot(&job, &mut |s| {
                let line = format!("{} [{}] {}", s.bot, s.paso, s.detalle);
                if s.paso != last { println!("{line}"); last = s.paso.clone(); }
            }).unwrap_or_else(|err| panic!("{}: {err}", e.id));
            println!("{} instalado en {:?} ({} s)", e.id, dir, t0.elapsed().as_secs());
            assert!(dir.join(".venv/Scripts/python.exe").exists());
        }
    }
}
