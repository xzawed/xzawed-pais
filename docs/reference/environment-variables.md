[홈](../README.md) > [레퍼런스](.) > 환경변수

# 환경변수

xzawedOrchestrator(`packages/server`)에서 사용하는 모든 환경변수입니다.

---

## 서버 모드

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `MODE` | `"local"` \| `"remote"` | `"local"` | 배포 환경. `local`은 단일 사용자 PC, `remote`는 클라우드/팀 서버 |
| `PORT` | number | `3000` | HTTP 서버 리슨 포트 |
| `AUTH` | `"none"` \| `"jwt"` | `"none"` | 서비스 간 인증 방식. `jwt`는 팀 서버에서 사용 |

---

## Claude 실행기

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `CLAUDE_MODE` | `"api"` \| `"cli"` \| `"remote"` | `"api"` | Claude 실행 방식 |
| `ANTHROPIC_API_KEY` | string | — | `CLAUDE_MODE=api` 시 필수. `sk-ant-...` 형식 |
| `CLAUDE_MODEL` | string | `"claude-sonnet-4-6"` | `CLAUDE_MODE=api` 시 사용할 모델 ID |

### CLAUDE_MODE 상세

| 값 | 동작 | 필수 조건 |
|----|------|-----------|
| `api` | Anthropic SDK 직접 호출 | `ANTHROPIC_API_KEY` |
| `cli` | 로컬 `claude` CLI 서브프로세스 실행 | Claude CLI 설치 |
| `remote` | 원격 서버의 Claude CLI 사용 | `REMOTE_CLI_URL` 또는 SSH 변수 |

---

## 원격 CLI 모드

`CLAUDE_MODE=remote`일 때 사용됩니다. `REMOTE_CLI_URL`과 `REMOTE_HOST` 중 하나는 반드시 설정해야 합니다.

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `REMOTE_CLI_URL` | string | — | 원격 서버의 Claude CLI HTTP 래퍼 URL. 설정 시 SSH보다 우선 |
| `REMOTE_HOST` | string | — | SSH 원격 호스트 (예: `my.server.com`) |
| `REMOTE_USER` | string | — | SSH 접속 사용자명 (예: `ubuntu`) |
| `REMOTE_KEY_PATH` | string | — | SSH 프라이빗 키 파일 경로 (예: `~/.ssh/id_rsa`) |

---

## 인증

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `SERVICE_JWT_SECRET` | string | — | `AUTH=jwt` 시 필수. 서비스 간 JWT 서명 시크릿. **32자 이상 필수** — 미달 시 서버 기동 실패 |
| `USER_JWT_SECRET` | string | — | 사용자 인증용 JWT 서명 시크릿. `DATABASE_URL`과 함께 설정 시 `/auth/*`·`/projects` 엔드포인트 활성화 |

---

## 데이터베이스

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `DATABASE_URL` | string | — | PostgreSQL 연결 URL (`postgres://user:pass@host:5432/db`). 설정 시 세션·메시지·사용자 데이터가 DB에 영속됨. 미설정 시 인메모리 |

---

## 서비스 연동

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `MANAGER_URL` | string | `"http://localhost:3001"` | xzawedManager HTTP 엔드포인트 URL |

---

## Redis

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `REDIS_URL` | string | `"redis://localhost:6379"` | Redis 연결 URL. 미설정 또는 연결 실패 시 인메모리 폴백 사용 |

Redis URL 형식:

```
redis://[username:password@]host[:port][/db]

redis://localhost:6379
redis://default:mypassword@redis.example.com:6379
redis://default:password@redis.railway.internal:6379/0
```

---

## CORS

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `ALLOWED_ORIGINS` | string | — | 쉼표 구분 CORS 허용 오리진. `MODE=remote`이고 미설정 시 CORS 전면 차단. `MODE=local`에서는 무시됨 |

---

## 웹 UI 서빙

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `SERVE_WEB` | `"true"` \| `"false"` | `"false"` | `true`로 설정하면 빌드된 웹 클라이언트(`web/dist/`)를 정적 파일로 서빙 |

---

## GitHub 토큰 암호화

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `GITHUB_TOKEN_ENCRYPTION_KEY` | string | — | AES-256-GCM 암호화 키. **32바이트를 base64 인코딩한 문자열** (`randomBytes(32).toString('base64')`). `PUT /projects/:id/github-token` 사용 시 필수 |

키 생성 예시:

```bash
node -e "const {randomBytes}=require('crypto'); console.log(randomBytes(32).toString('base64'))"
```

---

## Electron 앱 클라이언트

Electron 앱은 앱 내 Settings 화면에서 설정을 변경할 수 있습니다. 환경변수로도 설정 가능합니다.

| 변수 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `SERVER_URL` | string | `"http://localhost:3000"` | Electron 앱이 접속할 서버 URL. `MODE=remote` 시 원격 URL로 설정 |

---

## 설정 유효성 검사

서버 시작 시 `packages/server/src/config.ts`에서 필수 값을 검증합니다. 실패 시 프로세스가 즉시 종료됩니다.

| 조건 | 에러 메시지 |
|------|-------------|
| `CLAUDE_MODE=api`이고 `ANTHROPIC_API_KEY` 없음 | `ANTHROPIC_API_KEY is required when CLAUDE_MODE=api. Set CLAUDE_MODE=cli to use Claude CLI subscription instead.` |
| `CLAUDE_MODE=remote`이고 `REMOTE_CLI_URL`과 `REMOTE_HOST` 모두 없음 | `REMOTE_CLI_URL or REMOTE_HOST is required when CLAUDE_MODE=remote` |
| `AUTH=jwt`이고 `SERVICE_JWT_SECRET`이 없거나 32자 미만 | `SERVICE_JWT_SECRET must be at least 32 characters when AUTH=jwt` |

---

## .env.example 전체

```env
# ===== 서버 모드 =====
MODE=local
PORT=3000
AUTH=none

# ===== Claude 실행 모드 =====
# api: Anthropic API 직접 호출 (기본값)
# cli: 로컬 Claude CLI 사용
# remote: 원격 서버의 Claude CLI 사용
CLAUDE_MODE=api

# ===== API 모드 (CLAUDE_MODE=api) =====
ANTHROPIC_API_KEY=sk-ant-api03-...
# CLAUDE_MODEL=claude-sonnet-4-6

# ===== 원격 CLI 모드 (CLAUDE_MODE=remote) =====
# REMOTE_CLI_URL=https://claude-proxy.my-server.com
# REMOTE_HOST=my.server.com
# REMOTE_USER=ubuntu
# REMOTE_KEY_PATH=~/.ssh/id_rsa

# ===== Redis =====
REDIS_URL=redis://localhost:6379

# ===== 서비스 연동 =====
# MANAGER_URL=http://localhost:3001

# ===== 인증 (AUTH=jwt) =====
# SERVICE_JWT_SECRET=<32자 이상 랜덤 문자열>

# ===== 사용자 인증 (DATABASE_URL + USER_JWT_SECRET 동시 설정 시 활성화) =====
# USER_JWT_SECRET=<32자 이상 랜덤 문자열>
# DATABASE_URL=postgres://user:pass@localhost:5432/xzawed

# ===== GitHub 토큰 암호화 =====
# GITHUB_TOKEN_ENCRYPTION_KEY=<randomBytes(32).toString('base64')>

# ===== CORS (MODE=remote 시 필수) =====
# ALLOWED_ORIGINS=https://your-domain.com,https://app.your-domain.com

# ===== 웹 UI 서빙 =====
# SERVE_WEB=true
```

---

## 다음 단계

- [설정 가이드](../guides/configuration.md) — 시나리오별 설정 예시
- [로컬 배포](../guides/local-deployment.md)
- [원격/팀 서버 배포](../guides/remote-deployment.md)
