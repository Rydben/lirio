#!/usr/bin/env bash
# Compila Lirio y lo deja en %LOCALAPPDATA%\Lirio: el MISMO sitio que usa el instalador oficial y el actualizador
# (y al que apuntan el acceso directo y el menú Inicio). Así solo hay un Lirio instalado.
# Usa su propia carpeta de compilación para no chocar con un Lirio abierto. Si Lirio está abierto, no lo cierra:
# avisa y lo copia en cuanto se cierre.
set -e
cd "$(dirname "$0")/.."
export PATH="/c/Program Files/nodejs:$HOME/.cargo/bin:$PATH"
CARGO_TARGET_DIR="$(cygpath -w "$PWD/src-tauri/target-instalar")" npx tauri build --no-bundle
DEST="$LOCALAPPDATA/Lirio"
mkdir -p "$DEST"
until cp src-tauri/target-instalar/release/lirio.exe "$DEST/lirio.exe" 2>/dev/null; do
  echo "Lirio está abierto: lo copiaré cuando lo cierres…"; sleep 10
done
echo "Instalado en $DEST"
