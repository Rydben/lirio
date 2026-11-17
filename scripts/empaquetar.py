"""Empaqueta los bots para tus amigos: SOLO el código de la lista blanca del manifiesto, nunca nada tuyo.

    python scripts/empaquetar.py <carpeta_bot> [<carpeta_bot>...] --salida dist-bots

Cada bot declara en su aniuzka.json:
    "paquete": {"incluir": ["mi_bot/**/*.py", "requirements.txt", "config.example.yaml", ...],
                "requirements_gpu": "requirements-gpu.txt", "modelos": [{"nombre", "url", "sha256", "destino"}]}

Barreras (si cualquiera falla, NO se genera nada):
  1. Lista blanca: solo se copia lo que casa con `incluir` (nunca "todo menos…").
  2. Rutas prohibidas aunque estén en la lista: secrets/, state/, logs/, output/, downloads/, work/, cache/, models/,
     .venv/, config.yaml, tokens, huellas de voz, client_secret…
  3. Contenido: patrones de secretos (los de The Wall) y la lista PRIVADA de datos personales, que vive fuera del
     repositorio público (`%APPDATA%\\Lirio\\privado\\no-publicar.txt`, una palabra o frase por línea).
  4. wall_rules.json se publica SIN `aprobadores_humanos`: cada amigo fija la llave de SU Lirio al instalar.

Salida: <id>-<versión>.zip por bot y catalogo.json (id, nombre, versión, tamaño, sha256, modelos, requirements).
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath

FORBIDDEN_DIRS = {"secrets", "state", "logs", "output", "downloads", "work", "cache", "models", ".venv", "venv",
                  "__pycache__", ".pytest_cache", ".git", "referencias"}
FORBIDDEN_NAMES = {"config.yaml", "token.json", "client_secret.json", "voice_print.json", "stop", "stop.flag"}
FORBIDDEN_NAME_PATTERNS = ["*token*.json", "*client_secret*", "*voice_print*", "*huella*.json", "*.key", "*.pem",
                           "*.env", ".env*", "*.log"]
TEXT_SUFFIXES = {".py", ".txt", ".md", ".json", ".yaml", ".yml", ".toml", ".cfg", ".ini", ".bat", ".cmd", ".ps1"}
# Patrones genéricos de secretos (los mismos que redacta The Wall, regla 4)
SECRET_PATTERNS = [
    r"sk-ant-[A-Za-z0-9_\-]{10,}", r"AIza[0-9A-Za-z_\-]{30,}", r"ya29\.[0-9A-Za-z_\-]{20,}",
    r"1//[0-9A-Za-z_\-]{20,}", r"(?i)\boauth:[a-z0-9]{20,}", r"GOCSPX-[A-Za-z0-9_\-]{10,}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
]
# El dominio empieza por letra: así `icono@2x.png` no cuenta como correo
EMAIL = r"[A-Za-z0-9._%+\-]+@[A-Za-z][A-Za-z0-9\-]*(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}"
EMAIL_ALLOWED = {"noreply@anthropic.com"}
# Ruta real de un usuario (C:/Users/pepe/...). Se permiten plantillas: C:\Users\<tu usuario>, %USERNAME%, Public…
PERSONAL_PATH = r"(?i)c:[/\\]+users[/\\]+(?![<%{]|tu[ _]|usuario|public\b|default\b)[a-z0-9][a-z0-9._-]*"


class Fuga(Exception):
    """Algo personal o secreto iba a salir en el paquete."""


def private_terms(path: Path | None = None) -> list[str]:
    path = path or Path(os.environ.get("APPDATA", Path.home())) / "Lirio" / "privado" / "no-publicar.txt"
    if not path.exists():
        return []
    return [l.strip() for l in path.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")]


def _matches(rel: str, pattern: str) -> bool:
    p = PurePosixPath(rel)
    if "**" in pattern:
        base, _, tail = pattern.partition("**/")
        return rel.startswith(base) and (fnmatch.fnmatch(p.name, tail) if tail else True)
    return fnmatch.fnmatch(rel, pattern)


def select_files(root: Path, include: list[str]) -> list[str]:
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in FORBIDDEN_DIRS]  # nunca se baja a estas carpetas
        for f in filenames:
            rel = Path(dirpath, f).relative_to(root).as_posix()
            if any(_matches(rel, pat) for pat in include):
                out.append(rel)
    return sorted(out)


def check_path(rel: str) -> None:
    parts = rel.split("/")
    if any(p.lower() in FORBIDDEN_DIRS for p in parts[:-1]):
        raise Fuga(f"{rel}: carpeta prohibida")
    name = parts[-1].lower()
    if name in FORBIDDEN_NAMES or any(fnmatch.fnmatch(name, p) for p in FORBIDDEN_NAME_PATTERNS):
        raise Fuga(f"{rel}: archivo prohibido")


def check_content(rel: str, data: bytes, terms: list[str]) -> None:
    if Path(rel).suffix.lower() not in TEXT_SUFFIXES:
        return
    text = data.decode("utf-8", errors="ignore")
    for pat in SECRET_PATTERNS:
        if re.search(pat, text):
            raise Fuga(f"{rel}: parece contener un secreto ({pat[:20]}…)")
    for m in re.findall(EMAIL, text):
        if m.lower() not in EMAIL_ALLOWED:
            raise Fuga(f"{rel}: contiene una dirección de correo")
    low = text.lower()
    for t in terms:
        if t.lower() in low:
            raise Fuga(f"{rel}: contiene un dato privado de la lista no-publicar")
    if re.search(PERSONAL_PATH, text):
        raise Fuga(f"{rel}: contiene una ruta personal (C:/Users/...)")


def clean_wall_rules(data: bytes) -> bytes:
    rules = json.loads(data.decode("utf-8"))
    rules.pop("aprobadores_humanos", None)
    return (json.dumps(rules, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def build(bot_dir: Path, out_dir: Path, terms: list[str]) -> dict:
    manifest = json.loads((bot_dir / "aniuzka.json").read_text(encoding="utf-8"))
    pkg = manifest.get("paquete")
    if not pkg or not pkg.get("incluir"):
        raise Fuga(f"{manifest.get('id')}: aniuzka.json no tiene la lista blanca 'paquete.incluir'")
    files = select_files(bot_dir, pkg["incluir"] + ["aniuzka.json", "wall_rules.json"])
    replace = pkg.get("sustituir", {})  # p. ej. {"wall_rules.json": "paquete/wall_rules.json"}
    if "config.example.yaml" not in files:
        raise Fuga(f"{manifest['id']}: falta config.example.yaml (la configuración sin datos personales)")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in files:
            check_path(rel)
            data = (bot_dir / replace.get(rel, rel)).read_bytes()
            if rel == "wall_rules.json":
                data = clean_wall_rules(data)
            check_content(rel, data, terms)
            z.writestr(zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0)), data)  # zip reproducible
    blob = buf.getvalue()
    subs = []
    for rel in files:  # sub-bots que vienen dentro (otros aniuzka.json con "parent")
        if rel.endswith("/aniuzka.json"):
            m = json.loads((bot_dir / rel).read_text(encoding="utf-8"))
            subs.append({"id": m["id"], "nombre": m.get("name", m["id"])})
    name = f"{manifest['id']}-{manifest['version']}.zip"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / name).write_bytes(blob)
    return {"id": manifest["id"], "nombre": manifest["name"], "descripcion": manifest.get("description", ""),
            "version": manifest["version"], "padre": manifest.get("parent"), "archivo": name, "incluye": subs,
            "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(), "archivos": len(files),
            "requirements_gpu": pkg.get("requirements_gpu"), "modelos": pkg.get("modelos", []),
            "necesita": manifest.get("needs", {}).get("setup", {})}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("bots", nargs="+", type=Path)
    ap.add_argument("--salida", type=Path, default=Path("dist-bots"))
    args = ap.parse_args(argv)
    terms = private_terms()
    if not terms:
        print("AVISO: no hay lista privada no-publicar.txt; solo se comprueban los patrones genéricos.", file=sys.stderr)
    entries = []
    try:
        for b in args.bots:
            entries.append(build(b.resolve(), args.salida, terms))
    except Fuga as e:
        print(f"PARADO: {e}. No se ha generado ningún catálogo.", file=sys.stderr)
        return 2
    catalog = {"formato": "lirio-catalogo/1", "bots": entries}
    (args.salida / "catalogo.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    for e in entries:
        print(f"{e['archivo']}: {e['archivos']} archivos, {e['bytes'] / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
