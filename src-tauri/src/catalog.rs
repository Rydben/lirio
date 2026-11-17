//! Catálogo de bots publicado por el creador de Lirio (GitHub Releases) y firmado con su llave de publicador.
//!
//! `catalogo.json` lista cada paquete con su SHA-256; `catalogo.json.sig` es la firma Ed25519 (base64) de los bytes
//! exactos de `catalogo.json`. La llave pública del publicador va dentro de Lirio (`publicador.pub`): un catálogo
//! cambiado por el camino, o publicado por otra persona, se rechaza, y con él todos sus paquetes.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::io::Read as _;

use crate::installer::CatalogEntry;

/// Llave pública del publicador (no es secreta). La privada solo está en el PC del creador.
pub const PUBLISHER_KEY: &str = include_str!("../publicador.pub");

/// Dónde se publica todo. `LIRIO_REPO` (owner/nombre) se fija al compilar la versión para amigos.
pub fn release_base() -> String {
    if let Ok(dir) = std::env::var("LIRIO_CATALOGO") {
        // pruebas: una carpeta local con catalogo.json, su firma y los paquetes
        return format!("file://{}", dir.trim_end_matches(['\\', '/']));
    }
    let repo = option_env!("LIRIO_REPO").unwrap_or("lirio-bots/lirio");
    format!("https://github.com/{repo}/releases/latest/download")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub formato: String,
    pub bots: Vec<CatalogEntry>,
}

pub fn verify(catalog_bytes: &[u8], sig_b64: &str, publisher_b64: &str) -> Result<Catalog, String> {
    let pk: [u8; 32] = B64.decode(publisher_b64.trim()).map_err(|_| "llave del publicador mal formada")?
        .try_into().map_err(|_| "llave del publicador mal formada")?;
    let vk = VerifyingKey::from_bytes(&pk).map_err(|_| "llave del publicador no válida")?;
    let sig = B64.decode(sig_b64.trim()).ok().and_then(|b| Signature::from_slice(&b).ok())
        .ok_or("firma del catálogo mal formada")?;
    vk.verify(catalog_bytes, &sig).map_err(|_| "la firma del catálogo no es válida: no se instala nada")?;
    let cat: Catalog = serde_json::from_slice(catalog_bytes).map_err(|e| format!("catálogo ilegible: {e}"))?;
    if cat.formato != "lirio-catalogo/1" {
        return Err(format!("formato de catálogo desconocido: {}", cat.formato));
    }
    for b in &cat.bots {
        if b.archivo.contains(['/', '\\']) || b.archivo.contains("..") {
            return Err(format!("nombre de paquete no permitido: {}", b.archivo));
        }
    }
    Ok(cat)
}

fn fetch_bytes(url: &str) -> Result<Vec<u8>, String> {
    if let Some(path) = url.strip_prefix("file://") {
        return std::fs::read(path).map_err(|e| format!("{path}: {e}"));
    }
    let resp = ureq::get(url).timeout(std::time::Duration::from_secs(30)).call()
        .map_err(|e| format!("no se pudo leer el catálogo: {e}"))?;
    let mut buf = Vec::new();
    std::io::Read::read_to_end(&mut resp.into_reader().take(5 * 1024 * 1024), &mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

/// Descarga y verifica el catálogo publicado.
pub fn fetch() -> Result<(Catalog, String), String> {
    let base = release_base();
    let bytes = fetch_bytes(&format!("{base}/catalogo.json"))?;
    let sig = String::from_utf8(fetch_bytes(&format!("{base}/catalogo.json.sig"))?).map_err(|e| e.to_string())?;
    Ok((verify(&bytes, &sig, PUBLISHER_KEY)?, base))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn signed(cat: &str, key: &SigningKey) -> (Vec<u8>, String, String) {
        let sig = key.sign(cat.as_bytes());
        (cat.as_bytes().to_vec(), B64.encode(sig.to_bytes()), B64.encode(key.verifying_key().as_bytes()))
    }

    const CAT: &str = r#"{"formato":"lirio-catalogo/1","bots":[{"id":"b","nombre":"B","version":"1.0.0","archivo":"b-1.0.0.zip","bytes":3,"sha256":"ab"}]}"#;

    #[test]
    fn accepts_signed_catalog() {
        let k = SigningKey::from_bytes(&[3u8; 32]);
        let (b, s, p) = signed(CAT, &k);
        assert_eq!(verify(&b, &s, &p).unwrap().bots[0].id, "b");
    }

    #[test]
    fn rejects_tampered_or_foreign_catalog() {
        let k = SigningKey::from_bytes(&[3u8; 32]);
        let (b, s, p) = signed(CAT, &k);
        let mut tampered = b.clone();
        let i = tampered.iter().position(|&c| c == b'a').unwrap();
        tampered[i] = b'f';
        assert!(verify(&tampered, &s, &p).is_err());
        let other = SigningKey::from_bytes(&[4u8; 32]);
        let (_, s2, _) = signed(CAT, &other);
        assert!(verify(&b, &s2, &p).unwrap_err().contains("firma"));
    }

    #[test]
    fn rejects_paths_in_package_names() {
        let k = SigningKey::from_bytes(&[3u8; 32]);
        let evil = CAT.replace("b-1.0.0.zip", "../../malo.zip");
        let (b, s, p) = signed(&evil, &k);
        assert!(verify(&b, &s, &p).unwrap_err().contains("no permitido"));
    }

    #[test]
    fn embedded_publisher_key_is_valid() {
        let raw = B64.decode(PUBLISHER_KEY.trim()).unwrap();
        assert_eq!(raw.len(), 32);
    }
}
