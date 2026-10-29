"""Criptografia de campos em repouso (AES-256-GCM), no mesmo formato de server/crypto.js:
enc:v1:<base64(iv[12] + texto cifrado + tag[16])>, com "tabela.coluna" como dado autenticado."""
import base64
import os
import re

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import env

PREFIX = "enc:v1:"


def _key() -> bytes:
    raw = (env("DATA_KEY") or "").strip()
    key = bytes.fromhex(raw) if re.fullmatch(r"[0-9a-fA-F]{64}", raw) else base64.b64decode(raw or "")
    if len(key) != 32:
        raise SystemExit("DATA_KEY ausente ou inválida (precisa ter 32 bytes, em hex ou base64). Use o mesmo valor do servidor.")
    return key


def is_encrypted(value) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


def encrypt(value: str | None, context: str) -> str | None:
    if not value or is_encrypted(value):
        return value
    iv = os.urandom(12)
    return PREFIX + base64.b64encode(iv + AESGCM(_key()).encrypt(iv, value.encode(), context.encode())).decode()


def decrypt(value: str | None, context: str) -> str | None:
    if not is_encrypted(value):
        return value  # valor antigo, ainda sem criptografia
    raw = base64.b64decode(value[len(PREFIX):])
    return AESGCM(_key()).decrypt(raw[:12], raw[12:], context.encode()).decode()
