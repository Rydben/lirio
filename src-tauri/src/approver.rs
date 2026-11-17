//! Aprobaciones firmadas (The Wall, reglas 3 y 6; propuesta aprobada por el usuario el 2026-11-16).
//!
//! Lirio tiene una llave Ed25519 propia. La parte secreta se guarda cifrada con DPAPI en
//! `%LOCALAPPDATA%\Lirio\aprobador.key`. Solo se firma tras un GESTO HUMANO completo en la interfaz:
//! `gesture_begin` al pulsar y `gesture_finish` al cumplirse 2 s manteniendo pulsado. No hay ningún
//! comando, puerto ni API externa que firme: solo la webview de Lirio llega a estas funciones.
//! Los bots verifican con `core/human_approval.py` y la llave pública fijada en su wall_rules.json.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::{DateTime, Duration, Utc};
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use crate::winutil;

pub const FORMAT: &str = "lirio-aprobacion/1";
pub const APPROVER: &str = "lirio";
pub const HOLD_MIN_MS: u128 = 2000;
pub const HOLD_MAX_MS: u128 = 15000;
pub const VALIDITY_MIN: i64 = 10;
pub const OPERATIONS: [&str; 4] = ["approve", "deny", "liberar", "reintentar"];

/// Lo que se firma. Los campos van en este orden fijo; se firma el texto JSON exacto.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Payload {
    pub modulo: String,
    pub operacion: String,
    pub objetivo: String,
    pub accion: Option<String>,
    pub clave: Option<String>,
    pub emitida: String,
    pub caduca: String,
    pub nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedApproval {
    pub formato: String,
    pub aprobador: String,
    pub llave_id: String,
    pub payload: String,
    pub firma: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicKeyInfo {
    pub alg: &'static str,
    pub llave_publica: String,
    pub id: String,
}

pub struct Approver {
    key: SigningKey,
    pub key_id: String,
    gestures: Mutex<HashMap<String, Instant>>,
}

impl Approver {
    /// Carga la llave o la crea la primera vez.
    pub fn load_or_create(dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let path = dir.join("aprobador.key");
        let key = if path.exists() {
            let enc = std::fs::read(&path).map_err(|e| e.to_string())?;
            let raw = winutil::dpapi_unprotect(&enc)?;
            let bytes: [u8; 32] = raw.as_slice().try_into().map_err(|_| "llave dañada".to_string())?;
            SigningKey::from_bytes(&bytes)
        } else {
            let mut seed = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut seed);
            let key = SigningKey::from_bytes(&seed);
            let enc = winutil::dpapi_protect(&seed)?;
            std::fs::write(&path, enc).map_err(|e| e.to_string())?;
            key
        };
        Ok(Self::from_key(key))
    }

    pub fn from_key(key: SigningKey) -> Self {
        let key_id = key_id(&key.verifying_key());
        Self { key, key_id, gestures: Mutex::new(HashMap::new()) }
    }

    pub fn public_info(&self) -> PublicKeyInfo {
        PublicKeyInfo {
            alg: "ed25519",
            llave_publica: B64.encode(self.key.verifying_key().as_bytes()),
            id: self.key_id.clone(),
        }
    }

    /// Empieza el gesto (al pulsar el botón). Devuelve un token de un solo uso.
    pub fn gesture_begin(&self) -> String {
        let token = random_hex(16);
        let mut g = self.gestures.lock().unwrap();
        g.retain(|_, t| t.elapsed().as_millis() < HOLD_MAX_MS);
        g.insert(token.clone(), Instant::now());
        token
    }

    /// Comprueba que el gesto ha durado lo suficiente (y no demasiado) y lo consume.
    pub fn gesture_finish(&self, token: &str) -> Result<(), String> {
        let started = self.gestures.lock().unwrap().remove(token)
            .ok_or_else(|| "gesto desconocido o ya usado".to_string())?;
        check_hold(started.elapsed().as_millis())
    }

    pub fn sign(&self, modulo: &str, operacion: &str, objetivo: &str, accion: Option<String>,
                clave: Option<String>, now: DateTime<Utc>) -> Result<SignedApproval, String> {
        if !OPERATIONS.contains(&operacion) {
            return Err(format!("operación no permitida: {operacion}"));
        }
        if modulo.is_empty() || objetivo.is_empty() {
            return Err("faltan el módulo o el objetivo".into());
        }
        let p = Payload {
            modulo: modulo.into(),
            operacion: operacion.into(),
            objetivo: objetivo.into(),
            accion,
            clave,
            emitida: now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            caduca: (now + Duration::minutes(VALIDITY_MIN)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            nonce: random_hex(16),
        };
        let text = serde_json::to_string(&p).map_err(|e| e.to_string())?;
        let sig = self.key.sign(text.as_bytes());
        Ok(SignedApproval {
            formato: FORMAT.into(),
            aprobador: APPROVER.into(),
            llave_id: self.key_id.clone(),
            payload: text,
            firma: B64.encode(sig.to_bytes()),
        })
    }
}

pub fn check_hold(ms: u128) -> Result<(), String> {
    if ms < HOLD_MIN_MS {
        return Err("mantén pulsado el botón 2 segundos".into());
    }
    if ms > HOLD_MAX_MS {
        return Err("el gesto ha caducado; vuelve a intentarlo".into());
    }
    Ok(())
}

fn key_id(vk: &VerifyingKey) -> String {
    let b = vk.as_bytes();
    format!("lirio-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}", b[0], b[1], b[2], b[3], b[4], b[5])
}

pub fn random_hex(n: usize) -> String {
    let mut buf = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Escribe la aprobación en un archivo temporal propio de Lirio (se borra tras usarla).
pub fn write_temp(dir: &Path, a: &SignedApproval) -> Result<PathBuf, String> {
    let d = dir.join("aprobaciones");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let path = d.join(format!("{}.json", random_hex(8)));
    std::fs::write(&path, serde_json::to_vec_pretty(a).unwrap()).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier};

    fn approver() -> Approver {
        Approver::from_key(SigningKey::from_bytes(&[7u8; 32]))
    }

    #[test]
    fn signature_verifies_over_exact_payload_text() {
        let a = approver();
        let now = Utc::now();
        let s = a.sign("twitch-autoeditor", "approve", "abc123", Some("youtube.publish_public".into()),
                       Some("C:\\out\\ñ.mp4".into()), now).unwrap();
        let vk = a.key.verifying_key();
        let sig = Signature::from_slice(&B64.decode(&s.firma).unwrap()).unwrap();
        assert!(vk.verify(s.payload.as_bytes(), &sig).is_ok());
        let p: Payload = serde_json::from_str(&s.payload).unwrap();
        assert_eq!(p.objetivo, "abc123");
        assert_eq!(p.clave.as_deref(), Some("C:\\out\\ñ.mp4"));
        assert!(s.payload.starts_with("{\"modulo\":"));
        let tampered = s.payload.replace("abc123", "zzz999");
        assert!(vk.verify(tampered.as_bytes(), &sig).is_err());
    }

    #[test]
    fn rejects_unknown_operations_and_empty_target() {
        let a = approver();
        assert!(a.sign("m", "borrar_todo", "x", None, None, Utc::now()).is_err());
        assert!(a.sign("m", "approve", "", None, None, Utc::now()).is_err());
    }

    #[test]
    fn nonces_are_unique_and_validity_is_ten_minutes() {
        let a = approver();
        let now = Utc::now();
        let p1: Payload = serde_json::from_str(&a.sign("m", "liberar", "v1", None, None, now).unwrap().payload).unwrap();
        let p2: Payload = serde_json::from_str(&a.sign("m", "liberar", "v1", None, None, now).unwrap().payload).unwrap();
        assert_ne!(p1.nonce, p2.nonce);
        let e = DateTime::parse_from_rfc3339(&p1.emitida).unwrap();
        let c = DateTime::parse_from_rfc3339(&p1.caduca).unwrap();
        assert_eq!((c - e).num_minutes(), VALIDITY_MIN);
    }

    #[test]
    fn hold_gesture_rules() {
        assert!(check_hold(500).is_err());
        assert!(check_hold(2000).is_ok());
        assert!(check_hold(60_000).is_err());
        let a = approver();
        let t = a.gesture_begin();
        assert!(a.gesture_finish(&t).is_err()); // demasiado rápido
        assert!(a.gesture_finish(&t).is_err()); // y ya consumido
        assert!(a.gesture_finish("inventado").is_err());
    }

    #[test]
    fn key_persists_encrypted() {
        let dir = tempfile::tempdir().unwrap();
        let a = Approver::load_or_create(dir.path()).unwrap();
        let raw = std::fs::read(dir.path().join("aprobador.key")).unwrap();
        assert_ne!(raw.len(), 32, "la llave no debe guardarse en claro");
        let b = Approver::load_or_create(dir.path()).unwrap();
        assert_eq!(a.public_info().llave_publica, b.public_info().llave_publica);
    }

    /// Deja en contrib/fixtures una aprobación firmada por Rust para que el test de Python la verifique.
    #[test]
    fn writes_cross_language_fixture() {
        let a = approver();
        let now = DateTime::parse_from_rfc3339("2026-11-16T20:00:00Z").unwrap().with_timezone(&Utc);
        let s = a.sign("twitch-autoeditor", "approve", "abc123", Some("youtube.publish_public".into()),
                       Some(r"C:\out\vídeo ñ.mp4".into()), now).unwrap();
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("contrib").join("fixtures");
        std::fs::create_dir_all(&dir).unwrap();
        let fixture = serde_json::json!({"llave": a.public_info(), "aprobacion": s});
        std::fs::write(dir.join("firma_rust.json"), serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();
    }
}
