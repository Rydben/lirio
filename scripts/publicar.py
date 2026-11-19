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
import zipfile
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


PORTABLE_TXT = (
    "Esta carpeta es Lirio PORTÁTIL.\r\n"
    "Todo lo de Lirio (configuración, bots, llaves) se guarda aquí dentro, en LirioDatos.\r\n"
    "No borres este archivo: es lo que le dice a Lirio que no escriba nada en el PC.\r\n"
)
LEEME_PORTATIL = (
    "LIRIO PORTÁTIL (para jugar en cybers). Es distinto de Lirio Desktop, el que se instala.\r\n"
    "\r\n"
    "1. Descomprime esta carpeta en tu USB (mejor USB 3.0) y abre Lirio-Portatil.exe: sin instalar nada ni ser administrador.\r\n"
    "2. La primera vez elige un PIN. Sin el PIN, la USB no sirve de nada si la pierdes.\r\n"
    "3. Lirio instalará el moderador de Twitch DENTRO de la USB (hacen falta unos 4 GB libres).\r\n"
    "4. Al terminar, cierra Lirio y quita la USB: no queda nada tuyo en el PC.\r\n"
    "\r\n"
    "OJO: muchos cybers bloquean los programas que se abren desde una USB o borran todo al reiniciar.\r\n"
    "Pregunta antes en tu cyber si se puede.\r\n"
    "\r\n"
    "El editor de vídeo NO va en esta edición: es demasiado pesado para un cyber.\r\n"
)


def version() -> str:
    return json.loads((TAURI / "tauri.conf.json").read_text(encoding="utf-8"))["version"]


LIMITE_TARGET = 5 * 1024 ** 3


def tamano(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0


def limpiar_target(antes: bool) -> None:
    """Las compilaciones ocupan mucho disco: antes de compilar, si `target` pasa de 5 GB se limpia entero;
    al terminar se borran las de pruebas (debug) y la carpeta vieja de instalación local."""
    target = TAURI / "target"
    viejos = [TAURI / "target-instalar"] + ([] if antes else [target / "debug"])
    for v in viejos:
        shutil.rmtree(v, ignore_errors=True)
    if antes and tamano(target) > LIMITE_TARGET:
        print("target ocupa más de 5 GB: se limpia antes de compilar")
        shutil.rmtree(target, ignore_errors=True)


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
    ap.add_argument("--ya-preparado", action="store_true",
                    help="no vuelve a preparar nada: sube lo que ya está en dist-publicacion/vX.Y.Z (con --subir)")
    args = ap.parse_args(argv)
    if "/" not in args.repo or args.repo.count("/") != 1:
        raise SystemExit("--repo debe ser usuario/repositorio")
    ver = version()
    out = ROOT / "dist-publicacion" / f"v{ver}"
    if args.ya_preparado:
        if not (out / "latest.json").exists():
            raise SystemExit(f"No hay nada preparado en {out}. Ejecuta antes sin --ya-preparado.")
        latest = json.loads((out / "latest.json").read_text(encoding="utf-8"))
        return upload(args, ver, out, latest) if args.subir else 0
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    limpiar_target(antes=True)
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
    # Lirio Desktop (el que se instala). El nombre interno del programa sigue siendo «Lirio» (carpeta de instalación,
    # accesos directos y actualizador de quien ya lo tiene): solo cambia el nombre de la descarga.
    installer_name = f"Lirio-Desktop_{ver}_x64-setup.exe"
    shutil.copy2(setup, out / installer_name)
    shutil.copy2(sig, out / (installer_name + ".sig"))

    # 3b. Lirio PORTÁTIL (USB): el mismo exe + portable.txt + LÉEME, firmado con la llave del publicador
    #     (es lo que comprueba la USB al actualizarse; los bots los instala Lirio dentro de la USB)
    portable_zip = out / f"Lirio-Portatil_{ver}_x64.zip"
    exe = TAURI / "target" / "release" / "lirio.exe"
    with zipfile.ZipFile(portable_zip, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(exe, "Lirio-Portatil.exe")
        z.writestr("portable.txt", PORTABLE_TXT)
        z.writestr("LEEME.txt", LEEME_PORTATIL)
    run([PUBLICAR, "firmar", portable_zip])
    # canal de actualizaciones SOLO del Portátil (el Desktop usa latest.json y nunca ve el zip)
    (out / "latest-portatil.json").write_text(json.dumps(
        {"edicion": "portatil", "version": ver, "notes": args.notas or f"Lirio Portátil {ver}", "archivo": portable_zip.name},
        indent=2, ensure_ascii=False), encoding="utf-8")

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
    # notas de la release: dos descargas claramente separadas
    (out / "notas_release.md").write_text(
        f"{latest['notes']}\n\n"
        f"**Lirio Desktop** (se instala en tu PC): `{installer_name}`\n\n"
        f"**Lirio Portátil** (en una USB, para cybers; solo el moderador): `{portable_zip.name}`. "
        "Descomprímelo en la USB y abre Lirio-Portatil.exe.\n", encoding="utf-8")

    limpiar_target(antes=False)
    print(f"\nPreparado en {out}:")
    for f in sorted(out.iterdir()):
        print(f"  {f.name:45} {f.stat().st_size / 1e6:8.1f} MB")
    if not args.subir:
        print("\nNo se ha subido nada. Para publicar: añade --subir (te pedirá confirmación).")
        return 0
    return upload(args, ver, out, latest)


def gh_exe() -> str | None:
    return shutil.which("gh") or next((str(p) for p in [Path(r"C:\Program Files\GitHub CLI\gh.exe")] if p.exists()), None)


def upload(args, ver: str, out: Path, latest: dict) -> int:
    """5. Publicar (The Wall, regla 3: solo con la confirmación escrita de una persona en su terminal)."""
    files = sorted(f for f in out.iterdir() if f.name != "notas_release.md")
    gh = gh_exe()
    if gh is None:
        raise SystemExit("Falta la herramienta `gh` de GitHub para subir. No se ha publicado nada.")
    if not sys.stdin.isatty():
        raise SystemExit("Publicar exige confirmación en tu terminal (The Wall). No se ha publicado nada.")
    print(f"\nSe subirán a https://github.com/{args.repo}/releases (PÚBLICO):")
    for f in files:
        print(f"  {f.name:45} {f.stat().st_size / 1e6:8.1f} MB")
    resp = input(f"\n¿Publicar v{ver}? Escribe PUBLICAR y pulsa Enter: ")
    if resp.strip() != "PUBLICAR":
        print("Cancelado. No se ha publicado nada.")
        return 1
    run([gh, "release", "create", f"v{ver}", "--repo", args.repo, "--title", f"Lirio {ver}",
         "--notes", (out / "notas_release.md").read_text(encoding="utf-8"), *files])
    print(f"\nPublicado: https://github.com/{args.repo}/releases/tag/v{ver}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
