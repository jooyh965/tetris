# Tetris API

테트리스 프론트(`jooyh965/tetris`, GitHub Pages 배포)의 백엔드. 이메일 회원가입/로그인, JWT 인증, 게임 기록 저장, 전체 최고점수 조회.

## 스택

- **FastAPI** (Python 3.11+)
- **SQLite** (Render Disk 에 마운트해 영속화 가능)
- **JWT** (access 15분 / refresh 7일, jti 회전)
- **bcrypt** 비밀번호 해싱

## 엔드포인트

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| `GET` | `/health` | 헬스체크 | 불요 |
| `POST` | `/auth/signup` | 이메일 + 비밀번호 가입 | 불요 |
| `POST` | `/auth/login` | OAuth2 form (username=이메일) → access/refresh | 불요 |
| `POST` | `/auth/refresh` | refresh 토큰 회전 | 불요 (refresh 본문) |
| `POST` | `/auth/logout` | refresh 폐기 | 불요 (refresh 본문) |
| `GET` | `/auth/me` | 내 정보 | access |
| `POST` | `/scores` | 게임 기록 저장 | access |
| `GET` | `/scores/highest` | 전체 사용자 최고점수 1건 | 불요 |
| `GET` | `/scores/me` | 내 최근 기록 (기본 20건) | access |

자동 문서: `/docs` (Swagger UI), `/redoc`

## 로컬 실행

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8002
# Swagger: http://localhost:8002/docs
```

## 환경 변수

| 이름 | 기본값 | 설명 |
|------|--------|------|
| `JWT_SECRET` | dev 폴백 | **운영에서는 반드시 강한 값으로 설정** |
| `DB_PATH` | `./tetris.db` | SQLite 파일 경로. Render Disk 마운트 위치 권장 |
| `ALLOWED_ORIGINS` | GH Pages + localhost | CORS 허용 origin 콤마 분리 |

## Render 배포

1. Render → New → Web Service → GitHub repo 연결
2. Build command: `pip install -r requirements.txt`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Environment 변수
   - `JWT_SECRET`: `python3 -c "import secrets;print(secrets.token_urlsafe(48))"` 결과
   - (선택) `ALLOWED_ORIGINS`: `https://jooyh965.github.io`
5. (선택) Disk 마운트 후 `DB_PATH=/var/data/tetris.db` 로 영속화. 무료 플랜은 Disk 없음 → 재배포 시 DB 초기화됨 (데모용으로 충분)

## CORS

기본 허용:
- `https://jooyh965.github.io` (프론트 배포 origin)
- 로컬 개발용 `http://localhost:8000`, `8001`, `127.0.0.1:*`
