//! Diario de Lirio: qué ha hecho el launcher (y los bots desde Lirio), día a día, más las notas del usuario.
//! Vive solo en este PC (`<datos>\diario.jsonl`, una línea JSON por evento).
//!
//! Alimenta el "resumen de uso" que puede acompañar a "Enviar idea". Ese resumen solo lleva CIFRAS
//! (versión, bots y sus versiones, cuántas veces se usó cada función, cuántos errores por bot): ni textos, ni rutas,
//! ni nombres de canal, ni nada que identifique a la persona (The Wall, regla 4).

use chrono::{DateTime, Duration, Local};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    pub at: String,
    /// aprobacion | subida | arranque | parada | stop | instalacion | actualizacion | diagnostico | youtube | twitch |
    /// voz | ajustes | error | nota
    pub kind: String,
    #[serde(default)]
    pub bot: Option<String>,
    pub text: String,
    #[serde(default = "yes")]
    pub ok: bool,
}

fn yes() -> bool {
    true
}

pub struct Journal {
    path: PathBuf,
}

/// Se guardan como mucho 90 días: el diario no crece sin límite.
const KEEP_DAYS: i64 = 90;

impl Journal {
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join("diario.jsonl") }
    }

    pub fn add(&self, kind: &str, bot: Option<&str>, text: &str, ok: bool) {
        let e = Entry { at: Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false), kind: kind.into(),
                        bot: bot.map(String::from), text: text.chars().take(500).collect(), ok };
        if let Some(p) = self.path.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&self.path) {
            let _ = writeln!(f, "{}", serde_json::to_string(&e).unwrap());
        }
    }

    /// Entradas de los últimos `days` días, de la más reciente a la más antigua. Poda lo que pase de 90 días.
    pub fn read(&self, days: i64) -> Vec<Entry> {
        let Ok(txt) = std::fs::read_to_string(&self.path) else { return vec![] };
        let all: Vec<Entry> = txt.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
        let now = Local::now();
        let keep: Vec<&Entry> = all.iter().filter(|e| age_days(e, now) <= KEEP_DAYS).collect();
        if keep.len() < all.len() {
            let body: String = keep.iter().map(|e| serde_json::to_string(e).unwrap() + "\n").collect();
            let _ = std::fs::write(&self.path, body);
        }
        let mut out: Vec<Entry> = keep.into_iter().filter(|e| age_days(e, now) <= days).cloned().collect();
        out.reverse();
        out
    }
}

fn age_days(e: &Entry, now: DateTime<Local>) -> i64 {
    DateTime::parse_from_rfc3339(&e.at).map(|t| (now - t.with_timezone(&Local)).num_days()).unwrap_or(i64::MAX)
}

/// Resumen de uso SIN datos personales: solo cifras. `bots`: [(id, versión)] de los bots instalados.
pub fn usage_summary(entries: &[Entry], version: &str, bots: &[(String, String)], days: i64) -> Value {
    let mut uses: BTreeMap<String, u32> = BTreeMap::new();
    let mut errors: BTreeMap<String, u32> = BTreeMap::new();
    let mut active_days = std::collections::BTreeSet::new();
    for e in entries {
        if e.kind == "nota" { continue; } // las notas son del usuario: nunca salen
        *uses.entry(e.kind.clone()).or_default() += 1;
        if !e.ok {
            *errors.entry(e.bot.clone().unwrap_or_else(|| "lirio".into())).or_default() += 1;
        }
        active_days.insert(e.at.get(..10).unwrap_or("").to_string());
    }
    json!({
        "lirio": version,
        "windows": std::env::consts::OS,
        "periodo_dias": days,
        "dias_con_actividad": active_days.len(),
        "bots": bots.iter().map(|(id, v)| json!({"id": id, "version": v})).collect::<Vec<_>>(),
        "usos": uses,
        "errores_por_bot": errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_reads_newest_first_and_prunes_old() {
        let d = tempfile::tempdir().unwrap();
        let j = Journal::new(d.path());
        j.add("arranque", Some("bot-x"), "Arrancado", true);
        j.add("error", Some("bot-x"), "falló C:\\Users\\alguien\\x", false);
        let old = Entry { at: (Local::now() - Duration::days(200)).to_rfc3339(), kind: "nota".into(), bot: None,
                          text: "vieja".into(), ok: true };
        let mut f = std::fs::OpenOptions::new().append(true).open(d.path().join("diario.jsonl")).unwrap();
        writeln!(f, "{}", serde_json::to_string(&old).unwrap()).unwrap();
        writeln!(f, "línea rota").unwrap();
        let got = j.read(30);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].kind, "error");
        let txt = std::fs::read_to_string(d.path().join("diario.jsonl")).unwrap();
        assert!(!txt.contains("vieja"), "lo de más de 90 días se poda");
    }

    #[test]
    fn summary_has_only_numbers_never_texts_or_notes() {
        let e = |kind: &str, ok: bool, text: &str| Entry { at: Local::now().to_rfc3339(), kind: kind.into(),
                                                           bot: Some("bot-x".into()), text: text.into(), ok };
        let entries = vec![e("aprobacion", true, "canal secreto"), e("error", false, "C:\\Users\\pepe"),
                           e("nota", true, "mi nota privada"), e("subida", true, "vídeo de pepe")];
        let s = usage_summary(&entries, "0.2.0", &[("bot-x".into(), "1.0".into())], 30);
        let txt = s.to_string();
        for private in ["secreto", "pepe", "nota privada", "Users"] {
            assert!(!txt.contains(private), "el resumen no debe contener «{private}»: {txt}");
        }
        assert_eq!(s["usos"]["aprobacion"], 1);
        assert_eq!(s["errores_por_bot"]["bot-x"], 1);
        assert!(s["usos"].get("nota").is_none());
        assert_eq!(s["dias_con_actividad"], 1);
    }
}
