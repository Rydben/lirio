fn main() {
  // Nítido con el escalado de Windows (125 %, 150 %…): Lirio se declara «consciente del DPI por monitor»
  // desde el primer instante (antes solo lo hacía la ventana al crearse; los avisos nativos salían borrosos).
  let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("lirio.manifest"));
  tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri-build");
}
