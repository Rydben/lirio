//! Utilidades de Windows: DPAPI (cifrado ligado a tu usuario), comprobar si un PID vive y lanzar procesos sin ventana.

use std::process::Command;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Prepara un `Command` para que no abra ninguna ventana de consola (cero PowerShell a la vista).
pub fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// True si existe un proceso con ese PID. No usa `kill(pid, 0)`, que en Windows lo mataría.
#[cfg(windows)]
pub fn pid_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    if pid == 0 {
        return false;
    }
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut code: u32 = 0;
        let ok = GetExitCodeProcess(h, &mut code) != 0;
        CloseHandle(h);
        ok && code == STILL_ACTIVE as u32
    }
}

#[cfg(not(windows))]
pub fn pid_alive(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{pid}")).exists()
}

/// Cifra con DPAPI (solo tu usuario de Windows puede descifrarlo).
#[cfg(windows)]
pub fn dpapi_protect(data: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(data, true)
}

#[cfg(windows)]
pub fn dpapi_unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(data, false)
}

#[cfg(windows)]
fn dpapi(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        if protect {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(),
                             std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(),
                               std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        }
    };
    if ok == 0 {
        return Err(format!("DPAPI falló ({})", std::io::Error::last_os_error()));
    }
    let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { LocalFree(out.pbData as _) };
    Ok(v)
}

#[cfg(not(windows))]
pub fn dpapi_protect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
}

#[cfg(not(windows))]
pub fn dpapi_unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
}

/// Cuándo arrancó Windows (para saber si un estado es de antes de reiniciar el PC).
#[cfg(windows)]
pub fn boot_time() -> Option<chrono::DateTime<chrono::Utc>> {
    let ms = unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() };
    Some(chrono::Utc::now() - chrono::Duration::milliseconds(ms as i64))
}

#[cfg(not(windows))]
pub fn boot_time() -> Option<chrono::DateTime<chrono::Utc>> {
    None
}

/// Marca un archivo como solo lectura (como hacen los bots con wall_rules.json).
pub fn set_readonly(p: &std::path::Path) -> Result<(), String> {
    let mut perm = std::fs::metadata(p).map_err(|e| e.to_string())?.permissions();
    perm.set_readonly(true);
    std::fs::set_permissions(p, perm).map_err(|e| e.to_string())
}

#[allow(clippy::permissions_set_readonly_false)]
pub fn clear_readonly(p: &std::path::Path) -> Result<(), String> {
    let mut perm = std::fs::metadata(p).map_err(|e| e.to_string())?.permissions();
    perm.set_readonly(false);
    std::fs::set_permissions(p, perm).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpapi_roundtrip() {
        let secret = b"llave de prueba";
        let enc = dpapi_protect(secret).unwrap();
        assert_ne!(enc.as_slice(), secret);
        assert_eq!(dpapi_unprotect(&enc).unwrap(), secret);
    }

    #[test]
    fn own_pid_is_alive() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(0));
    }
}
