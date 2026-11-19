//! «Crear Lirio en una USB»: Lirio portátil + el moderador, listo para un cyber.
//! Elige la unidad, mira el espacio y la velocidad (aviso si parece USB 2.0), copia Lirio con su `portable.txt`,
//! crea el llavero con el PIN del amigo e instala el moderador DENTRO de la USB (rutas relativas).
//! El editor de vídeo no va: es demasiado pesado para un cyber.

use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{Emitter, State};

use crate::{approver::Approver, catalog, installer, modules::{LirioConfig, ModuleEntry}, portable, AppState};

/// Bots que van en la USB (solo el moderador)
pub const PORTABLE_BOTS: &[&str] = &["twitch-moderator"];
/// Espacio mínimo libre: Python + librerías del moderador (torch en CPU) + margen
pub const MIN_FREE: u64 = 4_000_000_000;
/// Por debajo de esto (escritura) avisamos: parece USB 2.0 o una memoria lenta
pub const SLOW_MBPS: f64 = 20.0;

#[derive(Debug, Clone, serde::Serialize)]
pub struct Drive {
    pub letra: String,
    pub nombre: String,
    pub extraible: bool,
    pub libre: u64,
    pub total: u64,
}

#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

/// Unidades donde se puede crear (extraíbles y discos externos; nunca la del sistema).
#[cfg(windows)]
pub fn drives() -> Vec<Drive> {
    use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetVolumeInformationW};
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
    let mut out = vec![];
    for c in b'D'..=b'Z' {
        let letter = format!("{}:", c as char);
        if letter == system { continue; }
        let root = wide(&format!("{letter}\\"));
        let kind = unsafe { GetDriveTypeW(root.as_ptr()) };
        if kind != DRIVE_REMOVABLE && kind != DRIVE_FIXED { continue; }
        let (mut free, mut total) = (0u64, 0u64);
        if unsafe { GetDiskFreeSpaceExW(root.as_ptr(), &mut free, &mut total, std::ptr::null_mut()) } == 0 { continue; }
        let mut name = [0u16; 128];
        unsafe { GetVolumeInformationW(root.as_ptr(), name.as_mut_ptr(), name.len() as u32, std::ptr::null_mut(),
                                       std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0) };
        let end = name.iter().position(|&x| x == 0).unwrap_or(0);
        out.push(Drive { letra: letter, nombre: String::from_utf16_lossy(&name[..end]), extraible: kind == DRIVE_REMOVABLE, libre: free, total });
    }
    out
}

#[cfg(not(windows))]
pub fn drives() -> Vec<Drive> { vec![] }

/// Escribe 64 MB y mide la velocidad (MB/s). Borra el archivo de prueba.
pub fn write_speed(dir: &Path) -> Result<f64, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let p = dir.join(".prueba-velocidad");
    let chunk = vec![0x5au8; 4 * 1024 * 1024];
    let t0 = std::time::Instant::now();
    let r = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&p)?;
        for _ in 0..16 { f.write_all(&chunk)?; }
        f.sync_all()
    })();
    let secs = t0.elapsed().as_secs_f64().max(0.001);
    let _ = std::fs::remove_file(&p);
    r.map_err(|e| e.to_string())?;
    Ok(64.0 / secs)
}

pub const PORTABLE_TXT: &str = "Esta carpeta es Lirio PORTÁTIL.\r\n\
Todo lo de Lirio (configuración, bots, llaves) se guarda aquí dentro, en LirioDatos.\r\n\
No borres este archivo: es lo que le dice a Lirio que no escriba nada en el PC.\r\n";

pub const LEEME: &str = "LIRIO PORTÁTIL (para jugar en cybers)\r\n\r\n\
1. Conecta la USB y abre Lirio.exe (no hace falta instalar nada ni ser administrador).\r\n\
2. Escribe tu PIN. Sin el PIN, la USB no sirve de nada si la pierdes.\r\n\
3. Al terminar, cierra Lirio y quita la USB: no queda nada tuyo en el PC.\r\n\r\n\
OJO: muchos cybers bloquean los programas que se abren desde una USB o borran todo al reiniciar.\r\n\
Pregunta antes en tu cyber si se puede.\r\n\r\n\
En esta edición va el moderador de Twitch. El editor de vídeo NO va: es demasiado pesado para un cyber.\r\n";

/// Copia Lirio portátil en `root` (la carpeta `Lirio` de la USB): exe, `portable.txt` y LÉEME.
pub fn write_portable_files(root: &Path, exe: &Path) -> Result<(), String> {
    std::fs::create_dir_all(portable::data_dir(root)).map_err(|e| e.to_string())?;
    std::fs::copy(exe, root.join("Lirio.exe")).map_err(|e| format!("no se pudo copiar Lirio: {e}"))?;
    std::fs::write(root.join(portable::MARKER), PORTABLE_TXT).map_err(|e| e.to_string())?;
    std::fs::write(root.join("LEEME.txt"), LEEME).map_err(|e| e.to_string())?;
    Ok(())
}

/// Lo que comprueba antes de empezar: unidad válida, espacio y que no haya ya un Lirio con llavero.
pub fn preflight(letter: &str, free: u64) -> Result<PathBuf, String> {
    let l = letter.trim().trim_end_matches(['\\', '/']).to_uppercase();
    if l.len() != 2 || !l.ends_with(':') || !l.as_bytes()[0].is_ascii_uppercase() {
        return Err("unidad no válida".into());
    }
    let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
    if l == system { return Err("No se puede crear en el disco del sistema".into()); }
    if free < MIN_FREE {
        return Err(format!("Hace falta al menos {:.0} GB libres en la USB (hay {:.1} GB)", MIN_FREE as f64 / 1e9, free as f64 / 1e9));
    }
    let root = PathBuf::from(format!("{l}\\Lirio"));
    if portable::data_dir(&root).join(portable::VAULT).exists() {
        return Err("Esta USB ya tiene un Lirio con su PIN. Ábrelo desde la USB (o borra la carpeta Lirio para empezar de cero).".into());
    }
    Ok(root)
}

/// Crea Lirio en la USB. Avance en `lirio://usb` {paso, detalle, percent} y al final {hecho, ok, error, avisos}.
#[tauri::command]
pub fn usb_create(app: tauri::AppHandle, state: State<AppState>, letra: String, pin: String, nombre: String) -> Result<(), String> {
    portable::check_pin(&pin)?;
    if portable::root().is_some() { return Err("Ya estás en un Lirio portátil".into()); }
    let drive = drives().into_iter().find(|d| d.letra.eq_ignore_ascii_case(letra.trim_end_matches('\\')))
        .ok_or("No encuentro esa unidad")?;
    let root = preflight(&drive.letra, drive.libre)?;
    let journal = crate::journal::Journal::new(&state.data_dir);
    std::thread::spawn(move || {
        let emit = |v: Value| { let _ = app.emit("lirio://usb", v); };
        let say = |paso: &str, detalle: String, percent: Option<u8>| emit(json!({"paso": paso, "detalle": detalle, "percent": percent}));
        let mut avisos: Vec<String> = vec![];
        if !drive.extraible { avisos.push("Esa unidad no es extraíble: asegúrate de que es la USB correcta.".into()); }
        let r = (|| -> Result<(), String> {
            say("velocidad", "Midiendo la velocidad de la USB…".into(), None);
            let mbps = write_speed(&root)?;
            if mbps < SLOW_MBPS {
                avisos.push(format!("La USB escribe a {mbps:.0} MB/s: parece USB 2.0 o lenta. Funcionará, pero irá más despacio. \
                                     Mejor una USB 3.0 en un puerto azul."));
            }
            say("copiar", "Copiando Lirio a la USB…".into(), None);
            write_portable_files(&root, &std::env::current_exe().map_err(|e| e.to_string())?)?;
            say("pin", "Creando tu llavero con el PIN…".into(), None);
            let data = portable::data_dir(&root);
            let secrets = portable::create(&data.join(portable::VAULT), &pin)?;
            let public = serde_json::to_value(Approver::public_info_of(&secrets.approver_seed)).unwrap();
            let (cat, base) = catalog::fetch()?;
            let mut cfg = LirioConfig { usuario: Some(nombre.clone()).filter(|n| !n.is_empty()), modulos: vec![] };
            let answers = json!({"nombre": nombre, "ia": "heuristico"});
            for id in PORTABLE_BOTS {
                let entry = cat.bots.iter().find(|b| b.id == *id).ok_or(format!("{id} no está en el catálogo"))?;
                let job = installer::InstallJob { entry, base: &base, bots_root: &data.join("bots"), cache: &data.join("descargas"),
                                                  approver_public: public.clone(), answers: &answers };
                let dir = installer::install_bot(&job, &mut |s| say("bot", format!("{}: {}", entry.nombre, s.detalle), s.percent))?;
                cfg.modulos.push(ModuleEntry { ruta: dir, tarea: None });
            }
            cfg.save(&data.join("config.json"))?;
            let _ = std::fs::remove_dir_all(data.join("descargas")); // ahorra espacio en la USB
            Ok(())
        })();
        journal.add("usb", None, &format!("Lirio en la USB {}: {}", drive.letra, if r.is_ok() { "creado" } else { "no terminó" }), r.is_ok());
        emit(json!({"hecho": true, "ok": r.is_ok(), "error": r.err(), "avisos": avisos, "carpeta": root.display().to_string()}));
    });
    Ok(())
}

#[tauri::command]
pub fn usb_drives() -> Vec<Drive> {
    drives()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preflight_rules() {
        assert!(preflight("C:", 10_000_000_000).is_err() || std::env::var("SystemDrive").unwrap_or_default() != "C:");
        assert!(preflight("1:", 10_000_000_000).is_err());
        assert!(preflight("E:", 1_000_000_000).unwrap_err().contains("GB libres"));
    }

    #[test]
    fn portable_files_and_speed() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("Lirio");
        let fake_exe = d.path().join("x.exe");
        std::fs::write(&fake_exe, b"MZ").unwrap();
        write_portable_files(&root, &fake_exe).unwrap();
        assert!(root.join("Lirio.exe").exists() && root.join(portable::MARKER).exists() && root.join("LirioDatos").is_dir());
        assert!(std::fs::read_to_string(root.join("LEEME.txt")).unwrap().contains("cyber"));
        assert!(write_speed(&root).unwrap() > 0.0);
        assert!(!root.join(".prueba-velocidad").exists());
    }
}
