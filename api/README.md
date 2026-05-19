# Tetris API

테트리스 프론트(`jooyh965/tetris`, GitHub Pages 배포)의 백엔드. 이메일 회원가입/로그인, JWT 인증, 게임 기록 저장, 전체 최고점수 조회.

## 스택

- **FastAPI** (Python 3.11+)
- **MySQL 8** (로컬 dev, docker-compose) / **SQLite** (Render 운영) — `DATABASE_URL` env로 자동 분기
- **JWT** (access 15분 / refresh 7일, jti 회전)
- **bcrypt** 비밀번호 해싱
- **pymysql** (raw driver, `?` 플레이스홀더는 어댑터가 `%s` 로 변환)

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

## 로컬 실행 (docker compose + MySQL)

```bash
# 1) MySQL 컨테이너 띄우기 (백그라운드)
docker compose up -d mysql

# 2) 컨테이너 상태/health 확인 (status healthy 까지 보통 ~20초)
docker compose ps

# 3) Python 가상환경 + 의존성
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 4) 환경변수 (DATABASE_URL 만 있으면 MySQL 로 자동 전환)
cp .env.example .env
export $(grep -v '^#' .env | xargs)
#   또는 shell 에 직접:
#   export DATABASE_URL=mysql+pymysql://tetris:tetrispass@localhost:3306/tetris

# 5) 서버 기동
uvicorn main:app --reload --port 8002
# Swagger: http://localhost:8002/docs
```

DB 종료/정리:
```bash
docker compose down            # 컨테이너만 제거 (볼륨 유지 → 데이터 보존)
docker compose down -v         # 볼륨까지 제거 (데이터 초기화)
```

## 로컬 실행 (SQLite 폴백)

`DATABASE_URL` 을 미설정하면 자동으로 SQLite 사용 (`./tetris.db`). docker 없는 환경/Render 운영에서 동작.

```bash
unset DATABASE_URL
uvicorn main:app --reload --port 8002
```

## 환경 변수

| 이름 | 기본값 | 설명 |
|------|--------|------|
| `DATABASE_URL` | 미설정 | `mysql+pymysql://USER:PASS@HOST:PORT/DB` 형식. 미설정 시 SQLite 폴백 |
| `JWT_SECRET` | dev 폴백 | **운영에서는 반드시 강한 값으로 설정** |
| `DB_PATH` | `./tetris.db` | SQLite 모드일 때만 사용. Render Disk 마운트 위치 권장 |
| `ALLOWED_ORIGINS` | GH Pages + localhost | CORS 허용 origin 콤마 분리 |

## Render 배포 (운영, SQLite 모드 유지)

1. Render → New → Web Service → GitHub repo 연결 (또는 render.yaml Blueprint)
2. Build command: `pip install -r requirements.txt`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Environment 변수
   - `JWT_SECRET`: `python3 -c "import secrets;print(secrets.token_urlsafe(48))"` 결과
   - (선택) `ALLOWED_ORIGINS`: `https://jooyh965.github.io`
   - **`DATABASE_URL` 은 설정하지 않음** → SQLite 로 동작
5. (선택) Disk 마운트 후 `DB_PATH=/var/data/tetris.db` 로 영속화. 무료 플랜은 Disk 없음 → 재배포 시 DB 초기화

> 운영도 MySQL 로 가려면 외부 MySQL 호스팅(PlanetScale, Aiven, Railway 등)의 접속 URL을 `DATABASE_URL` env 로 추가하면 됨.

## CORS

기본 허용:
- `https://jooyh965.github.io` (프론트 배포 origin)
- 로컬 개발용 `http://localhost:8000`, `8001`, `127.0.0.1:*`
