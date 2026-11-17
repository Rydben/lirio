//! Herramienta del CREADOR para firmar lo que se publica (no va en el instalador de los amigos).
//!
//!   lirio-publicar nueva-llave          crea la llave de publicador (una sola vez) y escribe publicador.pub
//!   lirio-publicar firmar <archivo>     escribe <archivo>.sig (firma Ed25519, base64) de sus bytes exactos
//!   lirio-publicar guardar-secreto <n>  guarda lo que llegue por la entrada estándar, cifrado con DPAPI
//!   lirio-publicar leer-secreto <n>     lo imprime (solo lo usa el script de publicación, en tu PC)
//!
//! La llave privada se guarda cifrada con DPAPI en %USERPROFILE%\.lirio-publicador\publicador.key: solo tu usuario
//! de Windows la puede usar y nunca entra en el repositorio.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use lirio_lib::winutil;
use rand::RngCore;
use std::path::PathBuf;

fn key_path() -> PathBuf {
    dirs::home_dir().expect("sin carpeta de usuario").join(".lirio-publicador").join("publicador.key")
}

fn load() -> Result<SigningKey, String> {
    let enc = std::fs::read(key_path()).map_err(|_| "no hay llave de publicador: ejecuta `nueva-llave`".to_string())?;
    let raw = winutil::dpapi_unprotect(&enc)?;
    let seed: [u8; 32] = raw.as_slice().try_into().map_err(|_| "llave dañada")?;
    Ok(SigningKey::from_bytes(&seed))
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let res = match args.first().map(String::as_str) {
        Some("nueva-llave") => (|| {
            let p = key_path();
            if p.exists() {
                return Err(format!("ya existe {} (no se sobrescribe)", p.display()));
            }
            let mut seed = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut seed);
            std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
            std::fs::write(&p, winutil::dpapi_protect(&seed)?).map_err(|e| e.to_string())?;
            let public = B64.encode(SigningKey::from_bytes(&seed).verifying_key().as_bytes());
            let pub_file = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("publicador.pub");
            std::fs::write(&pub_file, format!("{public}\n")).map_err(|e| e.to_string())?;
            Ok(format!("Llave creada en {}\nPública: {public} (guardada en {})", p.display(), pub_file.display()))
        })(),
        Some("firmar") if args.len() == 2 => (|| {
            let file = PathBuf::from(&args[1]);
            let data = std::fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))?;
            let sig = load()?.sign(&data);
            let out = PathBuf::from(format!("{}.sig", file.display()));
            std::fs::write(&out, B64.encode(sig.to_bytes())).map_err(|e| e.to_string())?;
            Ok(format!("Firmado: {}", out.display()))
        })(),
        Some("guardar-secreto") if args.len() == 2 && valid_name(&args[1]) => (|| {
            let mut s = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut s).map_err(|e| e.to_string())?;
            let p = key_path().with_file_name(format!("{}.secreto", args[1]));
            std::fs::write(&p, winutil::dpapi_protect(s.trim().as_bytes())?).map_err(|e| e.to_string())?;
            Ok(format!("Guardado cifrado en {}", p.display()))
        })(),
        Some("leer-secreto") if args.len() == 2 && valid_name(&args[1]) => (|| {
            let p = key_path().with_file_name(format!("{}.secreto", args[1]));
            let raw = winutil::dpapi_unprotect(&std::fs::read(&p).map_err(|e| format!("{}: {e}", p.display()))?)?;
            String::from_utf8(raw).map_err(|e| e.to_string())
        })(),
        _ => Err("uso: lirio-publicar nueva-llave | firmar <archivo> | guardar-secreto <nombre> | leer-secreto <nombre>".into()),
    };
    match res {
        Ok(msg) => println!("{msg}"),
        Err(e) => { eprintln!("{e}"); std::process::exit(1) }
    }
}
