import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

# Render 의 Disk 마운트 경로(env DB_PATH)를 우선 사용. 없으면 모듈 옆 tetris.db.
DB_PATH = Path(os.getenv("DB_PATH", Path(__file__).parent / "tetris.db"))

_SCHEMA = """
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
    lines     INTEGER NOT NULL DEFAULT 0,
    level     INTEGER NOT NULL DEFAULT 1,
    played_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_score
    ON game_sessions(score DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user
    ON game_sessions(user_id, played_at DESC);
"""


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(_SCHEMA)


@contextmanager
def connect():
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
