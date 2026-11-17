"""Tests del empaquetador: nada personal ni secreto puede salir. python -m pytest scripts -q"""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import pytest

import empaquetar as emp


def make_bot(root: Path, **files: str) -> Path:
    base = {
        "aniuzka.json": json.dumps({"spec": "aniuzka-module/0.1", "id": "bot-x", "name": "Bot X", "version": "1.2.3",
                                    "paquete": {"incluir": ["bot_x/**/*.py", "requirements.txt", "config.example.yaml"]}}),
        "wall_rules.json": json.dumps({"version": "0.1", "aprobadores_humanos": {"lirio": {"llave_publica": "AAA"}}}),
        "requirements.txt": "pillow\n",
        "config.example.yaml": "canal:\n  nombre: \"\"\n",
        "bot_x/__init__.py": "",
        "bot_x/main.py": "print('hola')\n",
        "config.yaml": "canal:\n  nombre: \"micanal_secreto\"\n",
        "secrets/token.json": '{"refresh_token": "x"}',
        "state/status.json": "{}",
        "logs/bot.log": "x",
    }
    base.update(files)
    for rel, content in base.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
    return root


def names(zip_path: Path) -> set[str]:
    with zipfile.ZipFile(zip_path) as z:
        return set(z.namelist())


def test_only_whitelist_and_no_personal_files(tmp_path):
    bot = make_bot(tmp_path / "bot")
    entry = emp.build(bot, tmp_path / "out", [])
    got = names(tmp_path / "out" / entry["archivo"])
    assert got == {"aniuzka.json", "wall_rules.json", "requirements.txt", "config.example.yaml",
                   "bot_x/__init__.py", "bot_x/main.py"}
    assert entry["sha256"] == hashlib.sha256((tmp_path / "out" / entry["archivo"]).read_bytes()).hexdigest()


def test_wall_rules_ship_without_owner_key(tmp_path):
    bot = make_bot(tmp_path / "bot")
    entry = emp.build(bot, tmp_path / "out", [])
    with zipfile.ZipFile(tmp_path / "out" / entry["archivo"]) as z:
        rules = json.loads(z.read("wall_rules.json"))
    assert "aprobadores_humanos" not in rules and rules["version"] == "0.1"


def test_whitelist_cannot_reach_forbidden_dirs(tmp_path):
    bot = make_bot(tmp_path / "bot", **{"aniuzka.json": json.dumps({
        "id": "bot-x", "name": "X", "version": "1", "paquete": {"incluir": ["**/*.json", "**/*.py", "config.example.yaml"]}})})
    entry = emp.build(bot, tmp_path / "out", [])
    got = names(tmp_path / "out" / entry["archivo"])
    assert not any(n.startswith(("secrets/", "state/", "logs/")) for n in got), got


def test_too_broad_whitelist_stops_instead_of_skipping(tmp_path):
    """Una lista blanca de "todo" alcanza config.yaml: mejor parar y avisar que saltárselo en silencio."""
    bot = make_bot(tmp_path / "bot", **{"aniuzka.json": json.dumps({
        "id": "bot-x", "name": "X", "version": "1", "paquete": {"incluir": ["**/*"]}})})
    with pytest.raises(emp.Fuga, match="config.yaml"):
        emp.build(bot, tmp_path / "out", [])


@pytest.mark.parametrize("content,why", [
    ("TOKEN = 'ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxx'\n", "secreto"),
    ("CLAVE = 'sk-ant-api03-abcdefghijklmnop'\n", "secreto"),
    ('{"installed": {"client_secret": "GOCSPX-abcdefghijklmnop"}}', "secreto"),
    ("CONTACTO = 'alguien@example.com'\n", "correo"),
    ("RUTA = 'C:/Users/pepe/Videos'\n", "ruta personal"),
    ("CANAL = 'MiCanalPrivado'\n", "dato privado"),
])
def test_content_leaks_stop_everything(tmp_path, content, why):
    bot = make_bot(tmp_path / "bot", **{"bot_x/main.py": content})
    with pytest.raises(emp.Fuga, match=why):
        emp.build(bot, tmp_path / "out", ["micanalprivado"])
    assert not (tmp_path / "out").exists() or not any((tmp_path / "out").iterdir())


@pytest.mark.parametrize("ok", [r"C:\Users\<tu usuario>\Videos", "C:/Users/%USERNAME%/x", r"C:\Users\Public\x"])
def test_path_placeholders_are_fine(ok):
    emp.check_content("README.md", ok.encode(), [])


def test_retina_icon_names_are_not_emails():
    emp.check_content("tauri.conf.json", b'"icons/128x128@2x.png"', [])


def test_missing_example_config_or_whitelist(tmp_path):
    bot = make_bot(tmp_path / "a")
    (bot / "config.example.yaml").unlink()
    with pytest.raises(emp.Fuga, match="config.example.yaml"):
        emp.build(bot, tmp_path / "out", [])
    bot2 = make_bot(tmp_path / "b", **{"aniuzka.json": json.dumps({"id": "y", "name": "Y", "version": "1"})})
    with pytest.raises(emp.Fuga, match="lista blanca"):
        emp.build(bot2, tmp_path / "out", [])


def test_forbidden_file_names_even_if_whitelisted(tmp_path):
    for bad in ("bot_x/voice_print.json", "bot_x/client_secret.json", "bot_x/llave.key"):
        with pytest.raises(emp.Fuga, match="prohibido"):
            emp.check_path(bad)


def test_reproducible_zip(tmp_path):
    bot = make_bot(tmp_path / "bot")
    a = emp.build(bot, tmp_path / "o1", [])
    b = emp.build(bot, tmp_path / "o2", [])
    assert a["sha256"] == b["sha256"]


def test_main_writes_catalog_and_private_terms_file(tmp_path, monkeypatch):
    bot = make_bot(tmp_path / "bot")
    priv = tmp_path / "appdata" / "Lirio" / "privado"
    priv.mkdir(parents=True)
    (priv / "no-publicar.txt").write_text("# comentario\nnadie_lo_usa\n", encoding="utf-8")
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    assert emp.private_terms() == ["nadie_lo_usa"]
    assert emp.main([str(bot), "--salida", str(tmp_path / "dist")]) == 0
    cat = json.loads((tmp_path / "dist" / "catalogo.json").read_text(encoding="utf-8"))
    assert cat["formato"] == "lirio-catalogo/1" and cat["bots"][0]["id"] == "bot-x"
