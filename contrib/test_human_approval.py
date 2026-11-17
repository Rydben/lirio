"""Tests del verificador de aprobaciones firmadas. Ejecutar: python -m pytest contrib -q"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import os

import pytest

import human_approval as ha

# RFC 8032, sección 7.1, TEST 1 (mensaje vacío) y TEST 2 (un byte 0x72)
RFC = [
    ("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
     "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"),
    ("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72",
     "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"),
]


@pytest.mark.parametrize("pub,msg,sig", RFC)
def test_rfc8032_vectors(pub, msg, sig):
    assert ha.ed25519_verify(bytes.fromhex(pub), bytes.fromhex(msg), bytes.fromhex(sig))
    bad = bytearray(bytes.fromhex(sig))
    bad[0] ^= 1
    assert not ha.ed25519_verify(bytes.fromhex(pub), bytes.fromhex(msg), bytes(bad))
    assert not ha.ed25519_verify(bytes.fromhex(pub), b"otro", bytes.fromhex(sig))


# --- firmante de prueba (solo para los tests; Lirio firma en Rust) ---
def _sign(seed: bytes, msg: bytes) -> tuple[bytes, bytes]:
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    A = _encode(ha._mul(a, ha._base()))
    r = int.from_bytes(hashlib.sha512(h[32:] + msg).digest(), "little") % ha._L
    R = _encode(ha._mul(r, ha._base()))
    k = int.from_bytes(hashlib.sha512(R + A + msg).digest(), "little") % ha._L
    s = (r + k * a) % ha._L
    return A, R + s.to_bytes(32, "little")


def _encode(pt) -> bytes:
    x, y, z, _ = pt
    zi = pow(z, ha._P - 2, ha._P)
    x, y = x * zi % ha._P, y * zi % ha._P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def test_signer_matches_rfc():
    seed = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    pub, sig = _sign(seed, b"")
    assert pub.hex() == RFC[0][0] and sig.hex() == RFC[0][2]


SEED = os.urandom(32)
PUB, _ = _sign(SEED, b"")
RULES = {"aprobadores_humanos": {"lirio": {"alg": "ed25519", "llave_publica": base64.b64encode(PUB).decode(),
                                           "id": "test"}}}
NOW = dt.datetime(2026, 11, 16, 20, 0, tzinfo=dt.timezone.utc)


def _doc(seed=SEED, **over):
    p = {"modulo": "twitch-autoeditor", "operacion": "approve", "objetivo": "abc123", "accion": "youtube.publish_public",
         "clave": "C:\\out\\v.mp4", "emitida": NOW.isoformat(), "caduca": (NOW + dt.timedelta(minutes=10)).isoformat(),
         "nonce": os.urandom(16).hex()}
    p.update(over)
    txt = json.dumps(p, ensure_ascii=False)
    _, sig = _sign(seed, txt.encode())
    return {"formato": ha.FORMATO, "aprobador": "lirio", "llave_id": "test", "payload": txt,
            "firma": base64.b64encode(sig).decode()}


def test_valid_and_single_use(tmp_path):
    n = tmp_path / "nonces.json"
    doc = _doc()
    p = ha.verificar(doc, RULES, "twitch-autoeditor", n, ahora=NOW)
    assert p["objetivo"] == "abc123"
    with pytest.raises(ha.AprobacionInvalida, match="ya se usó"):
        ha.verificar(doc, RULES, "twitch-autoeditor", n, ahora=NOW)


@pytest.mark.parametrize("mutate,msg", [
    (lambda d: d.update(firma=base64.b64encode(b"\0" * 64).decode()), "firma"),
    (lambda d: d.update(payload=d["payload"].replace("abc123", "zzz999")), "firma"),
    (lambda d: d.update(aprobador="otro"), "no fijado"),
    (lambda d: d.update(formato="x"), "formato"),
])
def test_tampering_rejected(tmp_path, mutate, msg):
    d = _doc()
    mutate(d)
    with pytest.raises(ha.AprobacionInvalida, match=msg):
        ha.verificar(d, RULES, "twitch-autoeditor", tmp_path / "n.json", ahora=NOW)


def test_other_key_rejected(tmp_path):
    with pytest.raises(ha.AprobacionInvalida, match="firma"):
        ha.verificar(_doc(seed=os.urandom(32)), RULES, "twitch-autoeditor", tmp_path / "n.json", ahora=NOW)


def test_wrong_module_expired_and_too_long(tmp_path):
    n = tmp_path / "n.json"
    with pytest.raises(ha.AprobacionInvalida, match="otro módulo"):
        ha.verificar(_doc(), RULES, "twitch-moderator", n, ahora=NOW)
    with pytest.raises(ha.AprobacionInvalida, match="caducado"):
        ha.verificar(_doc(), RULES, "twitch-autoeditor", n, ahora=NOW + dt.timedelta(minutes=11))
    with pytest.raises(ha.AprobacionInvalida, match="demasiado larga"):
        ha.verificar(_doc(caduca=(NOW + dt.timedelta(hours=2)).isoformat()), RULES, "twitch-autoeditor", n, ahora=NOW)
    with pytest.raises(ha.AprobacionInvalida, match="futuro"):
        ha.verificar(_doc(emitida=(NOW + dt.timedelta(minutes=5)).isoformat(),
                          caduca=(NOW + dt.timedelta(minutes=8)).isoformat()), RULES, "twitch-autoeditor", n, ahora=NOW)


def test_no_pinned_key(tmp_path):
    with pytest.raises(ha.AprobacionInvalida, match="no fijado"):
        ha.verificar(_doc(), {}, "twitch-autoeditor", tmp_path / "n.json", ahora=NOW)


def test_request_match():
    p = json.loads(_doc()["payload"])
    req = {"id": "abc123", "status": "pending", "action": "youtube.publish_public", "key": "C:\\out\\v.mp4"}
    ha.comprobar_solicitud(p, req)
    with pytest.raises(ha.AprobacionInvalida, match="acción"):
        ha.comprobar_solicitud(p, {**req, "action": "files.delete_temp"})
    with pytest.raises(ha.AprobacionInvalida, match="archivo"):
        ha.comprobar_solicitud(p, {**req, "key": "otro"})
    with pytest.raises(ha.AprobacionInvalida, match="ya está"):
        ha.comprobar_solicitud(p, {**req, "status": "approved"})


def test_signature_made_by_lirio_rust(tmp_path):
    """La aprobación la firma el código Rust de Lirio (cargo test la genera); el bot la acepta en Python."""
    from pathlib import Path
    f = Path(__file__).parent / "fixtures" / "firma_rust.json"
    if not f.exists():
        pytest.skip("ejecuta antes `cargo test` en src-tauri")
    fx = json.loads(f.read_text(encoding="utf-8"))
    rules = {"aprobadores_humanos": {"lirio": fx["llave"]}}
    p = ha.verificar(fx["aprobacion"], rules, "twitch-autoeditor", tmp_path / "n.json", ahora=NOW)
    assert p["clave"] == r"C:\out\vídeo ñ.mp4" and p["accion"] == "youtube.publish_public"
    bad = dict(fx["aprobacion"], payload=fx["aprobacion"]["payload"].replace("abc123", "abc124"))
    with pytest.raises(ha.AprobacionInvalida):
        ha.verificar(bad, rules, "twitch-autoeditor", tmp_path / "n2.json", ahora=NOW)
