//! Lirio portátil (en una USB, para jugar en cybers).
//!
//! - Se activa si junto a `Lirio.exe` hay un archivo `portable.txt`. Entonces TODO va a `<USB>\LirioDatos`:
//!   configuración (con rutas relativas: la letra de la USB cambia en cada PC), diario, descargas, bots, la caché de
//!   WebView2, TEMP y las cachés de las librerías de los bots. Nada en %APPDATA% / %LOCALAPPDATA% ni en el registro
//!   (sin «arrancar con Windows»).
//! - En cada cyber es otro PC, así que DPAPI no sirve: la llave de aprobaciones y la clave de los secretos de los bots
//!   van en un LLAVERO cifrado con el PIN del amigo (Argon2id + XChaCha20-Poly1305). Sin PIN, la USB no sirve de nada.
//!   El gesto de mantener pulsado 2 s sigue siendo obligatorio para aprobar.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const MARKER: &str = "portable.txt";
pub const VAULT: &str = "llavero.pin";
pub const PIN_MIN: usize = 6;
/// Variable con la que el bot recibe la clave de sus secretos (solo en el proceso del bot)
pub const BOT_KEY_ENV: &str = "LIRIO_CLAVE_SECRETOS";

/// Carpeta de la edición portátil (la del exe) si hay `portable.txt` junto a él.
pub fn root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    dir.join(MARKER).exists().then_some(dir)
}

pub fn data_dir(root: &Path) -> PathBuf {
    root.join("LirioDatos")
}

/// Lo que va dentro de LirioDatos en modo portátil (para que nada caiga en el PC del cyber).
pub fn env_vars(data: &Path) -> Vec<(&'static str, PathBuf)> {
    let cache = data.join("cache");
    vec![
        ("WEBVIEW2_USER_DATA_FOLDER", data.join("webview")),
        ("TEMP", data.join("tmp")),
        ("TMP", data.join("tmp")),
        ("HF_HOME", cache.join("huggingface")),
        ("TORCH_HOME", cache.join("torch")),
        ("XDG_CACHE_HOME", cache.clone()),
        ("PIP_CACHE_DIR", cache.join("pip")),
        ("PYTHONPYCACHEPREFIX", cache.join("pycache")),
        ("OLLAMA_MODELS", cache.join("ollama")),
    ]
}

/// Antes de nada: variables de entorno hacia la USB (las heredan WebView2 y los bots) y el runtime de WebView2.
/// Devuelve un aviso si este PC no tiene WebView2 y la USB tampoco lo trae.
pub fn prepare(root: &Path) -> Result<(), String> {
    let data = data_dir(root);
    for (k, v) in env_vars(&data) {
        let _ = std::fs::create_dir_all(&v);
        std::env::set_var(k, &v);
    }
    std::env::set_var("LIRIO_PORTATIL", "1");
    // limpia lo temporal de la sesión anterior (en la USB) y una actualización ya aplicada
    let _ = std::fs::remove_file(root.join("Lirio.old.exe"));
    // WebView2: el del PC, o el «runtime fijo» si viene en la USB (carpeta WebView2)
    let fixed = root.join("WebView2");
    if fixed.join("msedgewebview2.exe").exists() {
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &fixed);
        return Ok(());
    }
    if !webview2_installed() {
        return Err("Este PC no tiene Microsoft Edge WebView2, que Lirio necesita para su ventana.\n\n\
                    Pide en el cyber que lo instalen (es gratis, de Microsoft) o usa otro PC.".into());
    }
    Ok(())
}

/// ¿Está instalado el runtime de WebView2 (para todos o para este usuario)?
#[cfg(windows)]
pub fn webview2_installed() -> bool {
    const KEY: &str = r"\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let probe = |root: &str| {
        let mut c = std::process::Command::new("reg");
        c.args(["query", root, "/v", "pv"]);
        c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
        crate::winutil::hidden(&mut c);
        c.output().ok().is_some_and(|o| o.status.success() && {
            let t = String::from_utf8_lossy(&o.stdout);
            t.contains("pv") && !t.contains("0.0.0.0")
        })
    };
    [format!(r"HKLM\SOFTWARE\WOW6432Node{KEY}"), format!(r"HKLM\SOFTWARE{KEY}"), format!(r"HKCU\Software{KEY}")]
        .iter().any(|k| probe(k))
}

#[cfg(not(windows))]
pub fn webview2_installed() -> bool { true }

/// Aviso nativo (antes de que exista la ventana de Lirio).
#[cfg(windows)]
pub fn native_alert(text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
    let w = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    unsafe { MessageBoxW(std::ptr::null_mut(), w(text).as_ptr(), w("Lirio").as_ptr(), MB_OK | MB_ICONWARNING) };
}

#[cfg(not(windows))]
pub fn native_alert(text: &str) { eprintln!("{text}"); }

// ------------------------------------------------------------------ Llavero con PIN

#[derive(Serialize, Deserialize)]
struct VaultFile {
    formato: String,
    kdf: String,
    m_kib: u32,
    t: u32,
    p: u32,
    sal: String,
    nonce: String,
    cifrado: String,
}

/// Lo que guarda el llavero: la semilla de la llave de aprobaciones y la clave de los secretos de los bots.
pub struct Secrets {
    pub approver_seed: [u8; 32],
    pub bot_key: [u8; 32],
}

/// Coste de Argon2id: 64 MiB y 3 pasadas (≈0,3-1 s por intento en un PC normal).
const M_KIB: u32 = 64 * 1024;
const T: u32 = 3;
const P: u32 = 1;

fn derive(pin: &str, salt: &[u8], m: u32, t: u32, p: u32) -> Result<[u8; 32], String> {
    let params = Params::new(m, t, p, Some(32)).map_err(|e| e.to_string())?;
    let mut out = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(pin.as_bytes(), salt, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

pub fn check_pin(pin: &str) -> Result<(), String> {
    if pin.chars().count() < PIN_MIN { return Err(format!("El PIN debe tener al menos {PIN_MIN} caracteres")); }
    if pin.chars().count() > 64 || pin.chars().any(|c| c.is_control()) { return Err("PIN no válido".into()); }
    Ok(())
}

fn seal(pin: &str, s: &Secrets) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let key = derive(pin, &salt, M_KIB, T, P)?;
    let mut plain = Vec::with_capacity(64);
    plain.extend_from_slice(&s.approver_seed);
    plain.extend_from_slice(&s.bot_key);
    let ct = XChaCha20Poly1305::new((&key).into()).encrypt(XNonce::from_slice(&nonce), plain.as_slice())
        .map_err(|_| "no se pudo cifrar".to_string())?;
    let f = VaultFile { formato: "lirio-llavero/1".into(), kdf: "argon2id".into(), m_kib: M_KIB, t: T, p: P,
                        sal: B64.encode(salt), nonce: B64.encode(nonce), cifrado: B64.encode(ct) };
    Ok(serde_json::to_vec_pretty(&f).unwrap())
}

/// Crea el llavero (primera vez): llave de aprobaciones nueva y clave de secretos nueva, cifradas con el PIN.
pub fn create(path: &Path, pin: &str) -> Result<Secrets, String> {
    check_pin(pin)?;
    if path.exists() { return Err("Ya hay un llavero en esta USB".into()); }
    let mut s = Secrets { approver_seed: [0; 32], bot_key: [0; 32] };
    rand::rngs::OsRng.fill_bytes(&mut s.approver_seed);
    rand::rngs::OsRng.fill_bytes(&mut s.bot_key);
    if let Some(d) = path.parent() { std::fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    std::fs::write(path, seal(pin, &s)?).map_err(|e| e.to_string())?;
    Ok(s)
}

/// Abre el llavero con el PIN. «PIN incorrecto» si no cuadra (el cifrado autenticado lo detecta).
pub fn open(path: &Path, pin: &str) -> Result<Secrets, String> {
    let f: VaultFile = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "El llavero de la USB está dañado".to_string())?;
    if f.formato != "lirio-llavero/1" || f.kdf != "argon2id" { return Err("Llavero de otra versión".into()); }
    // límites para que un llavero manipulado no cuelgue el PC
    if f.m_kib > 1024 * 1024 || f.t > 20 || f.p > 8 { return Err("El llavero de la USB está dañado".into()); }
    let dec = |s: &str| B64.decode(s).map_err(|_| "El llavero de la USB está dañado".to_string());
    let (salt, nonce, ct) = (dec(&f.sal)?, dec(&f.nonce)?, dec(&f.cifrado)?);
    if nonce.len() != 24 { return Err("El llavero de la USB está dañado".into()); }
    let key = derive(pin, &salt, f.m_kib, f.t, f.p)?;
    let plain = XChaCha20Poly1305::new((&key).into()).decrypt(XNonce::from_slice(&nonce), ct.as_slice())
        .map_err(|_| "PIN incorrecto".to_string())?;
    if plain.len() != 64 { return Err("El llavero de la USB está dañado".into()); }
    let mut s = Secrets { approver_seed: [0; 32], bot_key: [0; 32] };
    s.approver_seed.copy_from_slice(&plain[..32]);
    s.bot_key.copy_from_slice(&plain[32..]);
    Ok(s)
}

/// Cambia el PIN (mismas llaves, cifradas otra vez). Se escribe a un temporal y se reemplaza.
pub fn change_pin(path: &Path, old: &str, new: &str) -> Result<(), String> {
    check_pin(new)?;
    let s = open(path, old)?;
    let tmp = path.with_extension("nuevo");
    std::fs::write(&tmp, seal(new, &s)?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Estado para la interfaz.
pub fn status(root: Option<&Path>, unlocked: bool) -> Value {
    match root {
        None => json!({"portatil": false}),
        Some(r) => json!({"portatil": true, "llavero": data_dir(r).join(VAULT).exists(), "desbloqueado": unlocked,
                          "carpeta": r.display().to_string()}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_roundtrip_wrong_pin_and_change() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join(VAULT);
        assert!(create(&p, "123").is_err(), "PIN demasiado corto");
        let s = create(&p, "pin-largo-1").unwrap();
        assert!(create(&p, "otro-pin-2").is_err(), "no pisa un llavero que ya existe");
        let o = open(&p, "pin-largo-1").unwrap();
        assert_eq!((o.approver_seed, o.bot_key), (s.approver_seed, s.bot_key));
        assert_eq!(open(&p, "pin-largo-2").err().unwrap(), "PIN incorrecto");
        // en el archivo no está la semilla en claro
        let raw = std::fs::read(&p).unwrap();
        assert!(!raw.windows(32).any(|w| w == s.approver_seed));
        change_pin(&p, "pin-largo-1", "nuevo-pin-9").unwrap();
        assert!(open(&p, "pin-largo-1").is_err());
        assert_eq!(open(&p, "nuevo-pin-9").unwrap().approver_seed, s.approver_seed);
    }

    #[test]
    fn tampered_vault_is_rejected() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join(VAULT);
        create(&p, "pin-largo-1").unwrap();
        let mut f: serde_json::Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
        let mut ct = B64.decode(f["cifrado"].as_str().unwrap()).unwrap();
        ct[3] ^= 1;
        f["cifrado"] = json!(B64.encode(ct));
        std::fs::write(&p, serde_json::to_vec(&f).unwrap()).unwrap();
        assert!(open(&p, "pin-largo-1").is_err());
        f["m_kib"] = json!(u32::MAX);
        std::fs::write(&p, serde_json::to_vec(&f).unwrap()).unwrap();
        assert_eq!(open(&p, "pin-largo-1").err().unwrap(), "El llavero de la USB está dañado");
    }

    #[test]
    fn everything_goes_inside_the_usb() {
        let data = Path::new("E:\\Lirio\\LirioDatos");
        for (k, v) in env_vars(data) {
            assert!(v.starts_with(data), "{k} fuera de la USB: {v:?}");
        }
    }
}
