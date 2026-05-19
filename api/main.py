import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field

from auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    hash_password,
    revoke_refresh_jti,
    verify_password,
)
from db import get_db, init_db

app = FastAPI(title="Tetris API", version="1.0.0")

# CORS — 콤마 분리된 origin 목록을 env로 받음
default_origins = [
    "https://jooyh965.github.io",
    "http://localhost:8000",
    "http://localhost:8001",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8001",
]
origins_env = os.getenv("ALLOWED_ORIGINS")
allow_origins = [o.strip() for o in origins_env.split(",")] if origins_env else default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,  # JWT을 Authorization 헤더로 보내므로 쿠키 불필요
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()


# ---------------------------------------------------------------------------
# schemas
# ---------------------------------------------------------------------------


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class UserOut(BaseModel):
    id: int
    email: EmailStr
    created_at: datetime


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshIn(BaseModel):
    refresh_token: str


class ScoreIn(BaseModel):
    score: int = Field(..., ge=0, le=10_000_000)
    lines: int = Field(default=0, ge=0, le=10_000)
    level: int = Field(default=1, ge=1, le=100)


class ScoreOut(BaseModel):
    id: int
    score: int
    lines: int
    level: int
    played_at: datetime


class HighScoreOut(BaseModel):
    score: int
    lines: int
    level: int
    played_at: datetime
    email: EmailStr  # 표시용. 원하면 익명화 가능


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------


@app.post("/auth/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupIn, db=Depends(get_db)):
    email = payload.email.lower()
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다")

    now = _now_iso()
    cur = db.execute(
        "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
        (email, hash_password(payload.password), now),
    )
    return UserOut(id=cur.lastrowid, email=email, created_at=now)


@app.post("/auth/login", response_model=TokenPair)
def login(form: OAuth2PasswordRequestForm = Depends(), db=Depends(get_db)):
    # OAuth2PasswordRequestForm.username 자리에 이메일을 넣는 관례
    email = (form.username or "").lower()
    row = db.execute(
        "SELECT id, password_hash FROM users WHERE email = ?", (email,)
    ).fetchone()
    if row is None or not verify_password(form.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 비밀번호가 올바르지 않습니다",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = row["id"]
    return TokenPair(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id, db),
    )


@app.post("/auth/refresh", response_model=TokenPair)
def refresh(payload: RefreshIn, db=Depends(get_db)):
    decoded = decode_token(payload.refresh_token, "refresh")
    jti = decoded.get("jti")
    user_id = int(decoded["sub"])

    row = db.execute(
        "SELECT revoked FROM refresh_tokens WHERE jti = ?", (jti,)
    ).fetchone()
    if row is None or row["revoked"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="만료되었거나 사용된 refresh token 입니다",
            headers={"WWW-Authenticate": "Bearer"},
        )

    revoke_refresh_jti(jti, db)
    return TokenPair(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id, db),
    )


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(payload: RefreshIn, db=Depends(get_db)):
    try:
        decoded = decode_token(payload.refresh_token, "refresh")
    except HTTPException:
        return None
    revoke_refresh_jti(decoded["jti"], db)
    return None


@app.get("/auth/me", response_model=UserOut)
def me(user=Depends(get_current_user)):
    return UserOut(**user)


# ---------------------------------------------------------------------------
# scores
# ---------------------------------------------------------------------------


@app.post("/scores", response_model=ScoreOut, status_code=status.HTTP_201_CREATED)
def submit_score(payload: ScoreIn, db=Depends(get_db), user=Depends(get_current_user)):
    now = _now_iso()
    cur = db.execute(
        "INSERT INTO game_sessions (user_id, score, `lines`, level, played_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (user["id"], payload.score, payload.lines, payload.level, now),
    )
    return ScoreOut(
        id=cur.lastrowid,
        score=payload.score,
        lines=payload.lines,
        level=payload.level,
        played_at=now,
    )


@app.get("/scores/highest", response_model=Optional[HighScoreOut])
def highest_score(db=Depends(get_db)):
    """전체 사용자 중 최고 점수 1건을 반환. 기록이 없으면 null."""
    row = db.execute(
        "SELECT s.score, s.`lines`, s.level, s.played_at, u.email "
        "FROM game_sessions s "
        "JOIN users u ON u.id = s.user_id "
        "ORDER BY s.score DESC, s.played_at ASC "
        "LIMIT 1"
    ).fetchone()
    if row is None:
        return None
    return HighScoreOut(
        score=row["score"],
        lines=row["lines"],
        level=row["level"],
        played_at=row["played_at"],
        email=row["email"],
    )


@app.get("/scores/me", response_model=list[ScoreOut])
def my_scores(
    limit: int = 20,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    """내 최근 게임 기록 (기본 20건, 최신순)."""
    limit = max(1, min(limit, 100))
    rows = db.execute(
        "SELECT id, score, `lines`, level, played_at FROM game_sessions "
        "WHERE user_id = ? ORDER BY played_at DESC LIMIT ?",
        (user["id"], limit),
    ).fetchall()
    return [
        ScoreOut(
            id=r["id"],
            score=r["score"],
            lines=r["lines"],
            level=r["level"],
            played_at=r["played_at"],
        )
        for r in rows
    ]
