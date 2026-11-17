#!/usr/bin/env bash
# Abre Lirio en varias páginas y guarda una captura de cada una en docs/capturas/.
# Uso (Git Bash): scripts/capturas.sh nombre:pagina [nombre:pagina...]   p. ej. 02_cola:bot/twitch-autoeditor/cola
set -e
cd "$(dirname "$0")/.."
PY=../twitch-autoeditor/.venv/Scripts/python.exe
for spec in "$@"; do
  name=${spec%%:*}; page=${spec#*:}
  taskkill //IM lirio.exe //F >/dev/null 2>&1 || true
  LIRIO_PAGINA="$page" src-tauri/target/debug/lirio.exe >/dev/null 2>&1 &
  sleep "${ESPERA:-7}"
  "$PY" scripts/captura.py "docs/capturas/$name.png"
  echo "docs/capturas/$name.png"
done
