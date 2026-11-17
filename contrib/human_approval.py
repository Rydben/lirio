"""Aprobaciones firmadas por Lirio (The Wall, reglas 3 y 6). Sin dependencias: copiar tal cual en core/ de cada bot.

Lirio firma con Ed25519 una aprobación concreta SOLO tras un gesto humano en su interfaz (mantener pulsado 2 s).
El bot verifica la firma con la llave pública fijada en su wall_rules.json (solo lectura, vigilado):

    "aprobadores_humanos": {"lirio": {"alg": "ed25519", "llave_publica": "<base64 de 32 bytes>", "id": "..."}}

Formato del archivo de aprobación (lirio-aprobacion/1):

    {"formato": "lirio-aprobacion/1", "aprobador": "lirio", "llave_id": "...",
     "payload": "<texto JSON EXACTO que se firmó>", "firma": "<base64 de 64 bytes>"}

    payload = {"modulo": "twitch-autoeditor", "operacion": "approve|deny|liberar|reintentar",
               "objetivo": "<id de solicitud, id de VOD o nombre de archivo>",
               "accion": "<id de acción o null>", "clave": "<details.key o null>",
               "emitida": "ISO-8601", "caduca": "ISO-8601", "nonce": "<32 hex>"}

Se firma el texto del payload tal cual (sin canonicalizar), así no hay ambigüedades entre Rust y Python.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
from pathlib import Path

FORMATO = "lirio-aprobacion/1"
OPERACIONES = ("approve", "deny", "liberar", "reintentar")
VALIDEZ_MAXIMA = dt.timedelta(minutes=10)
TOLERANCIA_RELOJ = dt.timedelta(minutes=2)


class AprobacionInvalida(Exception):
    """La aprobación firmada no vale (firma, módulo, caducidad, nonce…). Código de salida sugerido: 7."""


# ------------------------------------------------------------------ Ed25519 (RFC 8032), solo verificación
_P = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_SQRT_M1 = pow(2, (_P - 1) // 4, _P)
_G = None  # se calcula al primer uso


def _add(a, b):
    x1, y1, z1, t1 = a
    x2, y2, z2, t2 = b
    A = (y1 - x1) * (y2 - x2) % _P
    B = (y1 + x1) * (y2 + x2) % _P
    C = 2 * t1 * t2 * _D % _P
    Dd = 2 * z1 * z2 % _P
    E, F, G, H = B - A, Dd - C, Dd + C, B + A
    return (E * F % _P, G * H % _P, F * G % _P, E * H % _P)


def _mul(s: int, pt):
    q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            q = _add(q, pt)
        pt = _add(pt, pt)
        s >>= 1
    return q


def _equal(a, b) -> bool:
    return (a[0] * b[2] - b[0] * a[2]) % _P == 0 and (a[1] * b[2] - b[1] * a[2]) % _P == 0


def _recover_x(y: int, sign: int):
    if y >= _P:
        return None
    x2 = (y * y - 1) * pow(_D * y * y + 1, _P - 2, _P)
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _SQRT_M1 % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


def _decompress(b: bytes):
    if len(b) != 32:
        return None
    y = int.from_bytes(b, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % _P)


def _base():
    global _G
    if _G is None:
        gy = 4 * pow(5, _P - 2, _P) % _P
        _G = (_recover_x(gy, 0), gy, 1, _recover_x(gy, 0) * gy % _P)
    return _G


def ed25519_verify(public: bytes, msg: bytes, sig: bytes) -> bool:
    if len(public) != 32 or len(sig) != 64:
        return False
    A = _decompress(public)
    R = _decompress(sig[:32])
    if A is None or R is None:
        return False
    s = int.from_bytes(sig[32:], "little")
    if s >= _L:
        return False
    h = int.from_bytes(hashlib.sha512(sig[:32] + public + msg).digest(), "little") % _L
    return _equal(_mul(s, _base()), _add(R, _mul(h, A)))


# ------------------------------------------------------------------ validación de la aprobación

def _parse_time(value: str) -> dt.datetime:
    t = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if t.tzinfo is None:
        raise AprobacionInvalida("las fechas deben llevar zona horaria")
    return t


def llaves_fijadas(rules: dict) -> dict[str, bytes]:
    """Llaves públicas de wall_rules.json -> {aprobador: 32 bytes}. Ignora entradas mal formadas."""
    out = {}
    for name, entry in (rules.get("aprobadores_humanos") or {}).items():
        if name.startswith("_") or not isinstance(entry, dict) or entry.get("alg") != "ed25519":
            continue
        try:
            raw = base64.b64decode(entry["llave_publica"], validate=True)
        except Exception:
            continue
        if len(raw) == 32:
            out[name] = raw
    return out


def verificar(doc: dict | str | Path, rules: dict, modulo: str, nonces_path: Path,
              ahora: dt.datetime | None = None, consumir: bool = True) -> dict:
    """Devuelve el payload si la aprobación es válida; si no, lanza AprobacionInvalida.
    consumir=True registra el nonce (un solo uso). Llamar SOLO después de comprobar que la operación es aplicable,
    o con consumir=False y luego `consumir_nonce`."""
    if isinstance(doc, Path):
        doc = doc.read_text(encoding="utf-8")
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except ValueError as exc:
            raise AprobacionInvalida(f"archivo de aprobación ilegible: {exc}") from None
    if not isinstance(doc, dict) or doc.get("formato") != FORMATO:
        raise AprobacionInvalida("formato desconocido")
    llaves = llaves_fijadas(rules)
    pub = llaves.get(str(doc.get("aprobador", "")))
    if pub is None:
        raise AprobacionInvalida("aprobador no fijado en wall_rules.json (aprobadores_humanos)")
    payload_txt = doc.get("payload")
    if not isinstance(payload_txt, str):
        raise AprobacionInvalida("falta el payload")
    try:
        sig = base64.b64decode(str(doc.get("firma", "")), validate=True)
    except Exception:
        raise AprobacionInvalida("firma mal codificada") from None
    if not ed25519_verify(pub, payload_txt.encode("utf-8"), sig):
        raise AprobacionInvalida("la firma no es válida")
    p = json.loads(payload_txt)
    if p.get("modulo") != modulo:
        raise AprobacionInvalida(f"la aprobación es para otro módulo ({p.get('modulo')})")
    if p.get("operacion") not in OPERACIONES:
        raise AprobacionInvalida("operación desconocida")
    if not p.get("objetivo"):
        raise AprobacionInvalida("falta el objetivo")
    nonce = str(p.get("nonce", ""))
    if len(nonce) < 16:
        raise AprobacionInvalida("nonce demasiado corto")
    ahora = ahora or dt.datetime.now(dt.timezone.utc)
    emitida, caduca = _parse_time(p["emitida"]), _parse_time(p["caduca"])
    if caduca - emitida > VALIDEZ_MAXIMA:
        raise AprobacionInvalida("validez demasiado larga")
    if emitida > ahora + TOLERANCIA_RELOJ:
        raise AprobacionInvalida("emitida en el futuro")
    if ahora > caduca:
        raise AprobacionInvalida("la aprobación ha caducado")
    if nonce in _leer_nonces(nonces_path):
        raise AprobacionInvalida("esta aprobación ya se usó")
    if consumir:
        consumir_nonce(nonces_path, nonce, ahora)
    return p


def _leer_nonces(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def consumir_nonce(path: Path, nonce: str, ahora: dt.datetime | None = None) -> None:
    """Registra el nonce como usado (se guardan 30 días; los caducados ya no pueden reutilizarse igualmente)."""
    ahora = ahora or dt.datetime.now(dt.timezone.utc)
    data = _leer_nonces(path)
    limite = ahora - dt.timedelta(days=30)
    data = {k: v for k, v in data.items() if _safe_time(v) > limite}
    data[nonce] = ahora.isoformat(timespec="seconds")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    tmp.replace(path)


def _safe_time(v) -> dt.datetime:
    try:
        return _parse_time(v)
    except Exception:
        return dt.datetime.min.replace(tzinfo=dt.timezone.utc)


def comprobar_solicitud(payload: dict, solicitud: dict) -> None:
    """Para approve/deny: la solicitud de state/approvals.json debe estar pendiente y coincidir en acción y clave."""
    if solicitud.get("id") != payload["objetivo"]:
        raise AprobacionInvalida("la solicitud no coincide")
    if solicitud.get("status") != "pending":
        raise AprobacionInvalida(f"la solicitud ya está {solicitud.get('status')}")
    if payload.get("accion") != solicitud.get("action"):
        raise AprobacionInvalida("la acción firmada no coincide con la solicitud")
    if (payload.get("clave") or "") != (solicitud.get("key") or ""):
        raise AprobacionInvalida("el archivo firmado no coincide con la solicitud")
