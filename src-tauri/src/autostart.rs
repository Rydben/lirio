//! "Arrancar mis bots al encender el PC" (PC de un amigo, sin tareas programadas ni permisos de administrador).
//!
//! Se usa el inicio normal de Windows del usuario (HKCU\...\Run, valor "Lirio"): al iniciar sesión se lanza
//! `lirio.exe --arrancar-bots`, que pone en marcha `watch` de cada bot que lo tenga y no esté en STOP, y se cierra
//! sin abrir ninguna ventana. Desactivarlo borra ese valor. Solo lo cambia el usuario con la casilla de Lirio.

use std::process::{Command, Stdio};

use crate::winutil;

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE: &str = "Lirio";
pub const FLAG: &str = "--arrancar-bots";

fn reg(args: &[&str]) -> Result<String, String> {
    let mut c = Command::new("reg");
    c.args(args).stdin(Stdio::null());
    winutil::hidden(&mut c);
    let out = c.output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// El comando que se registra: la ruta exacta de este lirio.exe, entre comillas, más el flag.
pub fn command_line(exe: &std::path::Path) -> String {
    format!("\"{}\" {FLAG}", exe.display())
}

pub fn enabled() -> bool {
    reg(&["query", RUN_KEY, "/v", VALUE]).map(|o| o.contains(FLAG)).unwrap_or(false)
}

pub fn set(on: bool) -> Result<(), String> {
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        reg(&["add", RUN_KEY, "/v", VALUE, "/t", "REG_SZ", "/d", &command_line(&exe), "/f"]).map(|_| ())
    } else if enabled() {
        reg(&["delete", RUN_KEY, "/v", VALUE, "/f"]).map(|_| ())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_line_quotes_paths_with_spaces() {
        let p = std::path::Path::new(r"C:\Users\Ana Pérez\AppData\Local\Lirio\lirio.exe");
        assert_eq!(command_line(p), "\"C:\\Users\\Ana Pérez\\AppData\\Local\\Lirio\\lirio.exe\" --arrancar-bots");
    }
}
