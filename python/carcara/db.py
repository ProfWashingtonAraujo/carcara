import psycopg
from psycopg.rows import dict_row

from .config import require


def connect() -> psycopg.Connection:
    """Conexão com o mesmo Postgres usado pelo painel; linhas como dicionários."""
    return psycopg.connect(require("DATABASE_URL"), row_factory=dict_row)
