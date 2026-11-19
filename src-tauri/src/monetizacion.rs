//! Requisitos de monetización (Twitch y YouTube) publicados como datos: `monetizacion.json` firmado junto al catálogo.
//! Así se actualizan sin sacar otra versión de Lirio. Si no hay internet o la firma no cuadra, se usa la última copia
//! buena guardada; y si tampoco hay, la interfaz usa la que lleva dentro.

use serde_json::Value;
use std::path::Path;
use tauri::State;

use crate::{catalog, AppState};

pub const FILE: &str = "monetizacion.json";

/// Comprueba firma y formato. Devuelve el JSON si todo cuadra.
pub fn verify(bytes: &[u8], sig_b64: &str, publisher_b64: &str) -> Result<Value, String> {
    catalog::verify_signature(bytes, sig_b64, publisher_b64)?;
    let v: Value = serde_json::from_slice(bytes).map_err(|e| format!("monetizacion.json no es válido: {e}"))?;
    if v["formato"] != "lirio-monetizacion/1" || v["comprobado"].as_str().is_none() {
        return Err("monetizacion.json con un formato desconocido".into());
    }
    Ok(v)
}

fn cached(cache: &Path) -> Option<Value> {
    std::fs::read(cache).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

/// Los requisitos más recientes que se puedan conseguir (null si no hay ninguno: la interfaz usa los suyos).
#[tauri::command]
pub async fn monetizacion_datos(state: State<'_, AppState>) -> Result<Value, String> {
    let cache = state.data_dir.join("cache").join(FILE);
    tauri::async_runtime::spawn_blocking(move || {
        let base = catalog::release_base();
        let fresh = (|| -> Result<Value, String> {
            let bytes = catalog::fetch_bytes(&format!("{base}/{FILE}"))?;
            let sig = String::from_utf8(catalog::fetch_bytes(&format!("{base}/{FILE}.sig"))?).map_err(|e| e.to_string())?;
            let v = verify(&bytes, &sig, catalog::PUBLISHER_KEY)?;
            if let Some(d) = cache.parent() { let _ = std::fs::create_dir_all(d); }
            let _ = std::fs::write(&cache, &bytes);
            Ok(v)
        })();
        Ok(fresh.ok().or_else(|| cached(&cache)).unwrap_or(Value::Null))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn only_signed_files_in_the_right_format_are_used() {
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let publisher = B64.encode(key.verifying_key().as_bytes());
        let good = br#"{"formato":"lirio-monetizacion/1","comprobado":"2026-11-19","plataformas":{}}"#;
        let sig = B64.encode(key.sign(good).to_bytes());
        assert_eq!(verify(good, &sig, &publisher).unwrap()["comprobado"], "2026-11-19");
        let tampered = br#"{"formato":"lirio-monetizacion/1","comprobado":"2030-01-01","plataformas":{}}"#;
        assert!(verify(tampered, &sig, &publisher).is_err(), "cambiado después de firmar");
        let other = br#"{"formato":"otro","comprobado":"x"}"#;
        assert!(verify(other, &B64.encode(key.sign(other).to_bytes()), &publisher).is_err());
    }

    #[test]
    fn the_bundled_copy_is_valid() {
        let v: Value = serde_json::from_str(include_str!("../../src/data/monetizacion.json")).unwrap();
        assert_eq!(v["formato"], "lirio-monetizacion/1");
        for p in ["twitch", "youtube"] {
            let plat = &v["plataformas"][p];
            assert!(plat["programas"].as_array().is_some_and(|a| !a.is_empty()), "{p}");
            for prog in plat["programas"].as_array().unwrap() {
                assert!(prog["fuente"].as_str().is_some_and(|u| u.starts_with("https://")), "{p}: fuente");
            }
            assert!(plat["pago"]["fuente"].as_str().is_some_and(|u| u.starts_with("https://")));
        }
    }
}
