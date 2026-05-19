"""
DB layer — SQLite (default) 또는 MySQL(pymysql) 선택.

선택 규칙:
- 환경변수 DATABASE_URL 이 "mysql://" 또는 "mysql+pymysql://" 로 시작하면 MySQL.
- 그 외(미설정 포함)는 SQLite 폴백 (Render 운영 그대로).

main.py / auth.py 는 SQL 에서 '?' 플레이스홀더만 쓰고, MySQL 어댑터가
실행 직전에 '%s' 로 치환. row 접근은 dict-style (row["col"]) 가능 — sqlite3.Row
와 pymysql DictCursor 모두 이를 지원하므로 호출부 수정 불필요.
"""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import unquote, urlparse

DATABASE_URL = os.getenv("DATABASE_URL", "")
USE_MYSQL = DATABASE_URL.startswith("mysql")

# ---------- SQLite (default / fallback) ----------
DB_PATH = Path(os.getenv("DB_PATH", Path(__file__).parent / "tetris.db"))

_SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    jti        TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS game_sessions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    score     INTEGER NOT NULL,
    `lines`   INTEGER NOT NULL DEFAULT 0,
    level     INTEGER NOT NULL DEFAULT 1,
    played_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_score
    ON game_sessions(score DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user
    ON game_sessions(user_id, played_at DESC);
"""

# ---------- MySQL ----------
_SCHEMA_MYSQL_STMTS = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id            INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        email         VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at    VARCHAR(40)  NOT NULL,
        UNIQUE KEY uq_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS refresh_tokens (
        jti        VARCHAR(64) NOT NULL PRIMARY KEY,
        user_id    INT NOT NULL,
        expires_at VARCHAR(40) NOT NULL,
        revoked    TINYINT NOT NULL DEFAULT 0,
        KEY idx_refresh_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS game_sessions (
        id        INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id   INT NOT NULL,
        score     INT NOT NULL,
        `lines`   INT NOT NULL DEFAULT 0,
        level     INT NOT NULL DEFAULT 1,
        played_at VARCHAR(40) NOT NULL,
        KEY idx_game_sessions_score (score),
        KEY idx_game_sessions_user (user_id, played_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
]


def _mysql_config():
    """
    DATABASE_URL 예:
      mysql://user:pass@host:3306/dbname
      mysql+pymysql://user:pass@localhost/tetris
    """
    parsed = urlparse(DATABASE_URL)
    return {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username) if parsed.username else "root",
        "password": unquote(parsed.password) if parsed.password else "",
        "database": (parsed.path or "/").lstrip("/") or "tetris",
        "charset": "utf8mb4",
        "autocommit": False,
    }


if USE_MYSQL:
    import pymysql
    import pymysql.cursors


# ---------- adapter so main.py can keep using sqlite3-style API ----------


class _MySQLCursorAdapter:
    """Mimics sqlite3 cursor's .lastrowid / .rowcount / .fetchone / .fetchall."""

    def __init__(self, cursor):
        self._cursor = cursor

    @property
    def lastrowid(self):
        return self._cursor.lastrowid

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()


class _MySQLConnAdapter:
    """Mimics sqlite3 connection: .execute(sql, params) returns cursor-like."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        # Translate '?' placeholders to '%s' for pymysql.
        # main.py 의 SQL 에는 '?' 외에 다른 형태의 '?' 가 없음.
        translated = sql.replace("?", "%s")
        cur = self._conn.cursor()
        cur.execute(translated, params)
        return _MySQLCursorAdapter(cur)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


# ---------- public API: same shape regardless of backend ----------


def init_db() -> None:
    if USE_MYSQL:
        conn = pymysql.connect(**_mysql_config())
        try:
            with conn.cursor() as cur:
                for stmt in _SCHEMA_MYSQL_STMTS:
                    cur.execute(stmt)
            conn.commit()
        finally:
            conn.close()
    else:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(DB_PATH) as conn:
            conn.executescript(_SCHEMA_SQLITE)


@contextmanager
def connect():
    if USE_MYSQL:
        raw = pymysql.connect(
            **_mysql_config(),
            cursorclass=pymysql.cursors.DictCursor,
        )
        conn = _MySQLConnAdapter(raw)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def get_db():
    with connect() as conn:
        yield conn
