//! Descargas grandes para la instalación de los bots: varias a la vez, con reanudación (Range), reintentos,
//! detección de atascos (30 s sin recibir nada) y SHA-256 obligatorio. Informa del avance real por bytes.

use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Sin recibir ni un byte durante este tiempo, la descarga se da por atascada y se reintenta desde donde iba.
pub const STALL: Duration = Duration::from_secs(30);
pub const RETRIES: u32 = 6;

#[derive(Debug, Clone)]
pub struct Item {
    pub name: String,
    pub url: String,
    pub dest: PathBuf,
    /// SHA-256 obligatorio. Solo puede ir vacío si quien llama comprueba el archivo de otra forma después
    /// (el instalador de Ollama: firma Authenticode de Ollama, ver `ollama::check_signature`).
    pub sha256: String,
    /// Tamaño conocido (si no, se averigua con HEAD)
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Progress {
    pub done_bytes: u64,
    pub total_bytes: u64,
    pub done_items: usize,
    pub total_items: usize,
    /// bytes por segundo (media de los últimos segundos)
    pub speed: f64,
    /// Lo que se está bajando ahora (el más grande)
    pub current: String,
}

impl Progress {
    pub fn percent(&self) -> u8 {
        if self.total_bytes == 0 { return 0; }
        ((self.done_bytes as f64 / self.total_bytes as f64) * 100.0).clamp(0.0, 100.0) as u8
    }
    pub fn eta_s(&self) -> Option<u64> {
        (self.speed > 1.0 && self.total_bytes > self.done_bytes)
            .then(|| ((self.total_bytes - self.done_bytes) as f64 / self.speed) as u64)
    }
    /// «12 de 40 paquetes · 1,2 de 3,4 GB · 15 MB/s · quedan 2 min»
    pub fn text(&self) -> String {
        let mut s = format!("{} de {} paquetes · {} de {}", self.done_items, self.total_items,
                            human(self.done_bytes), human(self.total_bytes));
        if self.speed > 1.0 { s += &format!(" · {}/s", human(self.speed as u64)); }
        if let Some(eta) = self.eta_s() { s += &format!(" · quedan {}", human_time(eta)); }
        s
    }
}

pub fn human(b: u64) -> String {
    let f = b as f64;
    let s = if f >= 1e9 { format!("{:.1} GB", f / 1e9) } else if f >= 1e6 { format!("{:.0} MB", f / 1e6) }
            else { format!("{:.0} KB", f / 1e3) };
    s.replace('.', ",")
}

pub fn human_time(s: u64) -> String {
    if s < 60 { "menos de 1 min".into() } else if s < 3600 { format!("{} min", s.div_ceil(60)) }
    else { format!("{} h {} min", s / 3600, (s % 3600) / 60) }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(20)).timeout_read(STALL).build()
}

fn hash_file(p: &Path) -> Result<String, String> {
    let mut f = std::fs::File::open(p).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(crate::installer::hex_digest(&h.finalize()))
}

fn head_size(a: &ureq::Agent, url: &str) -> u64 {
    a.head(url).call().ok().and_then(|r| r.header("Content-Length")?.parse().ok()).unwrap_or(0)
}

/// Descarga un archivo (o lo copia, si la URL es file://), reanudando lo que ya hubiera en `<dest>.part`.
fn fetch_one(a: &ureq::Agent, it: &Item, got: &AtomicU64, cancel: &AtomicBool) -> Result<(), String> {
    if it.dest.exists() && (it.sha256.is_empty() || hash_file(&it.dest)?.eq_ignore_ascii_case(&it.sha256)) {
        got.fetch_add(it.size, Ordering::Relaxed);
        return Ok(());
    }
    let part = it.dest.with_extension(format!("{}part", it.dest.extension().map(|e| format!("{}.", e.to_string_lossy())).unwrap_or_default()));
    if let Some(d) = it.dest.parent() { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    let mut counted = 0u64; // lo ya sumado al progreso por este archivo
    let mut last_err = String::new();
    let mut bad_hash = 0;
    for attempt in 0..=RETRIES {
        if cancel.load(Ordering::Relaxed) { return Err("cancelado".into()); }
        if attempt > 0 && !it.url.starts_with("file://") { std::thread::sleep(Duration::from_secs(2u64.pow(attempt.min(4)))); }
        let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        if have > counted { got.fetch_add(have - counted, Ordering::Relaxed); counted = have; }
        let res: Result<(), String> = (|| {
            let (mut reader, append): (Box<dyn Read>, bool) = if let Some(local) = it.url.strip_prefix("file://") {
                let mut f = std::fs::File::open(local).map_err(|e| e.to_string())?;
                use std::io::Seek;
                f.seek(std::io::SeekFrom::Start(have)).map_err(|e| e.to_string())?;
                (Box::new(f), true)
            } else if it.url.starts_with("https://") {
                let mut req = a.get(&it.url);
                if have > 0 { req = req.set("Range", &format!("bytes={have}-")); }
                let r = req.call().map_err(|e| e.to_string())?;
                let append = have > 0 && r.status() == 206;
                (Box::new(r.into_reader()), append)
            } else {
                return Err("solo se descarga por https".into());
            };
            if !append && have > 0 {
                // el servidor no reanuda: se empieza de cero
                got.fetch_sub(counted, Ordering::Relaxed);
                counted = 0;
            }
            let mut out = std::fs::OpenOptions::new().create(true).write(true).append(append).truncate(!append)
                .open(&part).map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 256 * 1024];
            loop {
                if cancel.load(Ordering::Relaxed) { return Err("cancelado".into()); }
                let n = reader.read(&mut buf).map_err(|e| format!("atascada o cortada: {e}"))?;
                if n == 0 { break; }
                out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
                got.fetch_add(n as u64, Ordering::Relaxed);
                counted += n as u64;
            }
            out.flush().map_err(|e| e.to_string())?;
            drop(out);
            let h = if it.sha256.is_empty() { String::new() } else { hash_file(&part)? };
            if !h.eq_ignore_ascii_case(&it.sha256) {
                let _ = std::fs::remove_file(&part);
                got.fetch_sub(counted, Ordering::Relaxed);
                counted = 0;
                return Err(format!("{}: el archivo no coincide con su huella SHA-256", it.name));
            }
            std::fs::rename(&part, &it.dest).map_err(|e| e.to_string())
        })();
        match res {
            Ok(()) => {
                // ajusta el progreso al tamaño anunciado (por si HEAD no lo dio)
                if it.size > counted { got.fetch_add(it.size - counted, Ordering::Relaxed); }
                return Ok(());
            }
            Err(e) if e == "cancelado" => return Err(e),
            // una huella que no cuadra se reintenta una sola vez (puede ser un corte); dos, es que el archivo no es el bueno
            Err(e) if e.contains("SHA-256") => { bad_hash += 1; if bad_hash >= 2 { return Err(e); } last_err = e; }
            Err(e) => last_err = e,
        }
    }
    Err(format!("No se pudo descargar {} tras {} intentos: {last_err}", it.name, RETRIES + 1))
}

/// Descarga todo con `workers` descargas a la vez. Llama a `on_progress` cada medio segundo.
pub fn fetch_all(mut items: Vec<Item>, workers: usize, mut on_progress: impl FnMut(&Progress)) -> Result<(), String> {
    let a = agent();
    // tamaños (para el porcentaje real): HEAD en paralelo a los que no lo traen
    std::thread::scope(|s| {
        for chunk in items.chunks_mut(8) {
            let a = a.clone();
            s.spawn(move || for it in chunk.iter_mut().filter(|i| i.size == 0 && i.url.starts_with("https://")) {
                it.size = head_size(&a, &it.url);
            });
        }
    });
    for it in items.iter_mut().filter(|i| i.size == 0) {
        if let Some(local) = it.url.strip_prefix("file://") { it.size = std::fs::metadata(local).map(|m| m.len()).unwrap_or(0); }
    }
    // los grandes primero: así no queda uno enorme solo al final
    items.sort_by(|x, y| y.size.cmp(&x.size));
    let total_bytes: u64 = items.iter().map(|i| i.size).sum();
    let total_items = items.len();
    let queue = Mutex::new(items.into_iter().collect::<VecDeque<_>>());
    let got = AtomicU64::new(0);
    let done = AtomicUsize::new(0);
    let cancel = AtomicBool::new(false);
    let active: Mutex<Vec<(String, u64)>> = Mutex::new(vec![]);
    let error: Mutex<Option<String>> = Mutex::new(None);
    let finished = AtomicUsize::new(0);
    let workers = workers.clamp(1, 8);

    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| {
                loop {
                    let Some(it) = queue.lock().unwrap().pop_front() else { break };
                    if cancel.load(Ordering::Relaxed) { break; }
                    active.lock().unwrap().push((it.name.clone(), it.size));
                    let r = fetch_one(&a, &it, &got, &cancel);
                    active.lock().unwrap().retain(|(n, _)| n != &it.name);
                    match r {
                        Ok(()) => { done.fetch_add(1, Ordering::Relaxed); }
                        Err(e) => {
                            cancel.store(true, Ordering::Relaxed);
                            error.lock().unwrap().get_or_insert(e);
                            break;
                        }
                    }
                }
                finished.fetch_add(1, Ordering::Relaxed);
            });
        }
        // informe cada medio segundo con velocidad media de ~5 s
        let mut samples: VecDeque<(Instant, u64)> = VecDeque::new();
        loop {
            let now = Instant::now();
            let b = got.load(Ordering::Relaxed).min(total_bytes.max(1));
            samples.push_back((now, b));
            while samples.len() > 10 { samples.pop_front(); }
            let speed = match (samples.front(), samples.back()) {
                (Some((t0, b0)), Some((t1, b1))) if t1 > t0 => (b1.saturating_sub(*b0)) as f64 / (*t1 - *t0).as_secs_f64(),
                _ => 0.0,
            };
            let current = active.lock().unwrap().iter().max_by_key(|(_, s)| *s).map(|(n, _)| n.clone()).unwrap_or_default();
            on_progress(&Progress { done_bytes: b, total_bytes, done_items: done.load(Ordering::Relaxed), total_items, speed, current });
            // cancelar desde Lirio: las descargas a medias se quedan en .part para seguir luego
            if crate::installer::is_cancelled() && !cancel.load(Ordering::Relaxed) {
                cancel.store(true, Ordering::Relaxed);
                error.lock().unwrap().get_or_insert(crate::installer::CANCELLED.into());
            }
            if finished.load(Ordering::Relaxed) == workers { break; }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
    match error.into_inner().unwrap() {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Paquetes que pip instalaría, sacados de `pip install --dry-run --report` (sin descargar los grandes).
pub fn items_from_pip_report(report: &serde_json::Value, dir: &Path) -> Result<Vec<Item>, String> {
    let mut out = vec![];
    for i in report["install"].as_array().into_iter().flatten() {
        let info = &i["download_info"];
        let url = info["url"].as_str().ok_or("informe de pip sin url")?;
        let ai = &info["archive_info"];
        let sha = ai["hashes"]["sha256"].as_str().map(str::to_string)
            .or_else(|| ai["hash"].as_str().and_then(|h| h.strip_prefix("sha256=")).map(str::to_string))
            .ok_or_else(|| format!("pip no dio la huella de {url}"))?;
        let file = url.split(['#', '?']).next().unwrap_or(url).rsplit('/').next().unwrap_or("paquete");
        let file = file.replace("%2B", "+").replace("%21", "!");
        let name = i["metadata"]["name"].as_str().unwrap_or(&file).to_string();
        out.push(Item { name, url: url.to_string(), dest: dir.join(&file), sha256: sha, size: 0 });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sha(b: &[u8]) -> String { crate::installer::sha256_hex(b) }

    #[test]
    fn progress_text_is_human() {
        let p = Progress { done_bytes: 1_200_000_000, total_bytes: 3_400_000_000, done_items: 12, total_items: 40,
                           speed: 15_000_000.0, current: "torch".into() };
        assert_eq!(p.percent(), 35);
        assert_eq!(p.text(), "12 de 40 paquetes · 1,2 GB de 3,4 GB · 15 MB/s · quedan 3 min");
    }

    #[test]
    fn report_items() {
        let r = json!({"install": [
            {"metadata": {"name": "numpy"}, "download_info": {"url": "https://files.pythonhosted.org/a/numpy-2.0-cp312-win_amd64.whl",
              "archive_info": {"hashes": {"sha256": "ab"}}}},
            {"metadata": {"name": "x"}, "download_info": {"url": "https://h/x-1.0.tar.gz", "archive_info": {"hash": "sha256=cd"}}}]});
        let it = items_from_pip_report(&r, Path::new("C:/w")).unwrap();
        assert_eq!(it[0].name, "numpy");
        assert_eq!(it[0].dest, Path::new("C:/w").join("numpy-2.0-cp312-win_amd64.whl"));
        assert_eq!(it[1].sha256, "cd");
        assert!(items_from_pip_report(&json!({"install": [{"download_info": {"url": "https://h/y.whl", "archive_info": {}}}]}),
                                      Path::new("C:/w")).is_err(), "sin huella no se descarga");
    }

    #[test]
    fn parallel_fetch_resumes_and_verifies() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        let mut items = vec![];
        for (i, len) in [300_000usize, 5, 1_000_000].iter().enumerate() {
            let data: Vec<u8> = (0..*len).map(|x| (x * 7 + i) as u8).collect();
            let p = src.path().join(format!("f{i}.whl"));
            std::fs::write(&p, &data).unwrap();
            items.push(Item { name: format!("f{i}"), url: format!("file://{}", p.display()), dest: dst.path().join(format!("f{i}.whl")),
                              sha256: sha(&data), size: 0 });
        }
        // media descarga previa del grande: se reanuda
        let big = std::fs::read(src.path().join("f2.whl")).unwrap();
        std::fs::write(dst.path().join("f2.whl.part"), &big[..400_000]).unwrap();
        let mut last = None;
        fetch_all(items.clone(), 3, |p| last = Some(p.clone())).unwrap();
        let last = last.unwrap();
        assert_eq!((last.done_items, last.total_items, last.percent()), (3, 3, 100));
        assert_eq!(std::fs::read(dst.path().join("f2.whl")).unwrap(), big);
        assert!(!dst.path().join("f2.whl.part").exists());

        // huella mala: no se acepta
        let mut bad = items[1].clone();
        bad.dest = dst.path().join("malo.whl");
        bad.sha256 = "00".into();
        let err = fetch_all(vec![bad], 1, |_| {}).unwrap_err();
        assert!(err.contains("SHA-256"), "{err}");
        assert!(!dst.path().join("malo.whl").exists());
    }
}

#[cfg(test)]
mod e2e {
    /// Prueba real contra PyPI (no corre por defecto): LIRIO_E2E_PY=<python de un venv desechable> cargo test e2e -- --ignored
    #[test]
    #[ignore]
    fn install_requirements_real() {
        let py = std::path::PathBuf::from(std::env::var("LIRIO_E2E_PY").expect("LIRIO_E2E_PY"));
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("requirements.txt"), "six\npyyaml>=6\n").unwrap();
        let wheels = dir.path().join("w");
        let mut log = vec![];
        crate::installer::install_requirements(&py, dir.path(), &dir.path().join("requirements.txt"), &wheels, "librerias",
                                               &mut |_, d, p| log.push(format!("{p:?} {d}"))).unwrap();
        for l in &log { println!("{l}"); }
        assert!(log.iter().any(|l| l.contains("Descargando librerías")), "usó la descarga en paralelo");
        assert!(!wheels.exists(), "borra lo descargado");
    }
}
