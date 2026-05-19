import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from db import get_db

SECRET_KEY = os.getenv("JWT_SECRET", "dev-secret-change-me-please-use-32-byte-key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 7

TokenType = Literal["access", "refresh"]

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def _encode(user_id: int, token_type: TokenType, expires_delta: timedelta):
    now = datetime.now(timezone.utc)
    expire = now + expires_delta
    jti = secrets.token_urlsafe(16)
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM), jti, expire


def create_access_token(user_id: int) -> str:
    token, _, _ = _encode(user_id, "access", timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    return token


def create_refresh_token(user_id: int, db) -> str:
    token, jti, expire = _encode(user_id, "refresh", timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))
    db.execute(
        "INSERT INTO refresh_tokens (jti, user_id, expires_at, revoked) VALUES (?, ?, ?, 0)",
        (jti, user_id, expire.isoformat()),
    )
    return token


def decode_token(token: str, expected_type: TokenType) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers=_UNAUTHORIZED,
        ) from exc

    if payload.get("type") != expected_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Expected {expected_type} token",
            headers=_UNAUTHORIZED,
        )
    return payload


def revoke_refresh_jti(jti: str, db) -> None:
    db.execute("UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?", (jti,))


def get_current_user(token: str = Depends(oauth2_scheme), db=Depends(get_db)) -> dict:
    payload = decode_token(token, "access")
    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
            headers=_UNAUTHORIZED,
        ) from exc

    row = db.execute(
        "SELECT id, email, created_at FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
            headers=_UNAUTHORIZED,
        )
    return {"id": row["id"], "email": row["email"], "created_at": row["created_at"]}
