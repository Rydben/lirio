"""Antes de subir el código de Lirio a GitHub: pasa el detector de datos personales por TODO lo que se subiría.

    python scripts/revisar_repo.py        -> 0 si está limpio; 2 (y la lista) si algo no debe salir

Usa las mismas reglas que el empaquetador de bots (secretos, correos, rutas personales y tu lista privada
no-publicar.txt, que vive fuera del repositorio) sobre los archivos que git subiría (respeta .gitignore).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import empaquetar as emp  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
# Archivos del propio detector: contienen los patrones a propósito
SELF = {"scripts/empaquetar.py", "scripts/test_empaquetar.py", "scripts/revisar_repo.py"}


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout
    return [l for l in out.splitlines() if l]


def main() -> int:
    terms = emp.private_terms()
    problems = []
    for rel in tracked_files():
        if rel in SELF:
            continue
        try:
            emp.check_path(rel) if not rel.startswith(("src", "public", "assets", "docs", "contrib", "scripts")) else None
            emp.check_content(rel, (ROOT / rel).read_bytes(), terms)
        except emp.Fuga as e:
            problems.append(str(e))
    if problems:
        print("NO SUBIR. Revisa:\n  " + "\n  ".join(problems))
        return 2
    print(f"Limpio: {len(tracked_files())} archivos revisados.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
