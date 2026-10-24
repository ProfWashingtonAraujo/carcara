import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]

# python/.env tem prioridade; server/.env serve de reserva para reaproveitar DATABASE_URL
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / "server" / ".env")

OUT_DIR = ROOT / "out"


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, default)
    return value or default


def require(name: str) -> str:
    value = env(name)
    if not value:
        raise SystemExit(f"Variável de ambiente {name} não definida (veja python/.env.example).")
    return value
