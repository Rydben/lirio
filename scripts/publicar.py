"""Prepara (y, solo si lo pides, publica) una versión de Lirio para tus amigos.

    python scripts/publicar.py --repo usuario/lirio                  # PREPARA todo en dist-publicacion/ (no sube nada)
    python scripts/publicar.py --repo usuario/lirio --subir          # además lo sube a GitHub Releases (necesita `gh`)

Pasos:
  1. Empaqueta los bots (lista blanca + detector de datos personales; ver empaquetar.py).
  2. Firma catalogo.json con tu llave de publicador (lirio-publicar firmar).
  3. Compila el instalador de Lirio (NSIS) con LIRIO_REPO y lo firma con la llave de actualizaciones.
  4. Escribe latest.json (lo que lee el actualizador de Lirio de tus amigos).
  5. Solo con --subir: crea la release vX.Y.Z en GitHub y sube los archivos. Publicar pasa por The Wall (regla 3):
     se ejecuta solo si TÚ lo pides, y antes enseña la lista de archivos y pide confirmación escrita en la consola.

Las llaves nunca salen de tu PC: están cifradas con DPAPI en %USERPROFILE%\\.lirio-publicador\\.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAURI = ROOT / "src-tauri"
PUBLICAR = TAURI / "target" / "release" / "lirio-publicar.exe"
KEYS = Path.home() / ".lirio-publicador"
BOTS = [Path.home() / "Projects" / "twitch-autoeditor", Path.home() / "Projects" / "twitch-moderator"]


def run(cmd: list, env: dict | None = None, capture: bool = False) -> str:
    print("·", " ".join(str(c) for c in cmd[:4]), "…" if len(cmd) > 4 else "")
    res = subprocess.run([str(c) for c in cmd], cwd=ROOT, env=env, text=True, encoding="utf-8",
                         capture_output=capture, shell=False)
    if res.returncode != 0:
        raise SystemExit(f"PARADO: falló {cmd[0]} ({res.returncode})\n{(res.stderr or '')[-1500:]}")
    return res.stdout if capture else ""


def version() -> str:
    return json.loads((TAURI / "tauri.conf.json").read_text(encoding="utf-8"))["version"]


def build_tools() -> None:
    run(["cargo", "build", "--release", "--bin", "lirio-publicar", "--manifest-path", TAURI / "Cargo.toml"])


def secret(name: str) -> str:
    return run([PUBLICAR, "leer-secreto", name], capture=True).strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", required=True, help="usuario/repositorio público de GitHub (p. ej. pepe/lirio)")
    ap.add_argument("--notas", default="", help="qué cambia en esta versión (lo ven tus amigos al actualizar)")
    ap.add_argument("--subir", action="store_true", help="subir a GitHub Releases (pide confirmación)")
    ap.add_argument("--bots", nargs="*", type=Path, default=BOTS)
    args = ap.parse_args(argv)
    if "/" not in args.repo or args.repo.count("/") != 1:
        raise SystemExit("--repo debe ser usuario/repositorio")
    ver = version()
    out = ROOT / "dist-publicacion" / f"v{ver}"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    build_tools()
    # 1-2. Bots y catálogo firmado
    run([sys.executable, ROOT / "scripts" / "empaquetar.py", *args.bots, "--salida", out])
    run([PUBLICAR, "firmar", out / "catalogo.json"])

    # 3. Instalador firmado (la contraseña de la llave de actualizaciones va cifrada con DPAPI)
    env = dict(os.environ, LIRIO_REPO=args.repo,
               TAURI_SIGNING_PRIVATE_KEY=(KEYS / "updater.key").read_text(encoding="utf-8").strip(),
               TAURI_SIGNING_PRIVATE_KEY_PASSWORD=secret("updater-pass"))
    run(["npx.cmd", "tauri", "build"], env=env)
    nsis = TAURI / "target" / "release" / "bundle" / "nsis"
    setup = next(nsis.glob(f"Lirio_{ver}_x64-setup.exe"))
    sig = setup.with_name(setup.name + ".sig")
    installer_name = f"Lirio_{ver}_x64-setup.exe"
    shutil.copy2(setup, out / installer_name)
    shutil.copy2(sig, out / (installer_name + ".sig"))

    # 4. latest.json para el actualizador
    latest = {
        "version": ver,
        "notes": args.notas or f"Lirio {ver}",
        "pub_date": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "platforms": {"windows-x86_64": {
            "signature": sig.read_text(encoding="utf-8").strip(),
            "url": f"https://github.com/{args.repo}/releases/download/v{ver}/{installer_name}",
        }},
    }
    (out / "latest.json").write_text(json.dumps(latest, indent=2, ensure_ascii=False), encoding="utf-8")

    files = sorted(out.iterdir())
    print(f"\nPreparado en {out}:")
    for f in files:
        print(f"  {f.name:45} {f.stat().st_size / 1e6:8.1f} MB")
    if not args.subir:
        print("\nNo se ha subido nada. Para publicar: añade --subir (te pedirá confirmación).")
        return 0

    # 5. Publicar (The Wall, regla 3: solo con tu confirmación escrita)
    if shutil.which("gh") is None:
        raise SystemExit("Falta la herramienta `gh` de GitHub para subir. No se ha publicado nada.")
    if not sys.stdin.isatty():
        raise SystemExit("Publicar exige confirmación en tu terminal (The Wall). No se ha publicado nada.")
    resp = input(f"\n¿Publicar v{ver} en https://github.com/{args.repo} (público)? Escribe PUBLICAR: ")
    if resp.strip() != "PUBLICAR":
        print("Cancelado. No se ha publicado nada.")
        return 1
    run(["gh", "release", "create", f"v{ver}", "--repo", args.repo, "--title", f"Lirio {ver}",
         "--notes", latest["notes"], *files])
    print(f"Publicado: https://github.com/{args.repo}/releases/tag/v{ver}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
