[홈](../index.md) > [레퍼런스](.) > 환경변수 전체 목록

# 환경변수 전체 목록

xzawedOrchestrator에서 사용하는 모든 환경변수를 설명합니다.

---

## 서버 모드

| 변수 | 기본값 | 필수 | 가능한 값 | 설명 |
|------|--------|------|-----------|------|
| `MODE` | `local` | 아니오 | `local`, `remote` | 배포 환경. `local`은 단일 사용자 PC, `remote`는 클라우드/팀 서버 |
| `PORT` | `3000` | 아니오 | 1–65535 | HTTP 서버 리슨 포트 |
| `AUTH` | `none` | 아니오 | `none`, `jwt` | 인증 방식. `jwt`는 팀 서버에서 사용 |

---

## Claude 실행기

| 변수 | 기본값 | 필수 | 가능한 값 | 설명 |
|------|--------|------|-----------|------|
| `CLAUDE_MODE` | `cli` | 아니오 | `cli`, `api`, `remote` | Claude 실행 방식 선택 |
| `ANTHROPIC_API_KEY` | — | `CLAUDE_MODE=api` 시 필수 | `sk-ant-...` | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | 아니오 | Claude 모델 ID | `CLAUDE_MODE=api` 시 사용할 모델 |

### CLAUDE_MODE 상세

| 값 | 동작 | 요구 사항 |
|----|------|-----------|
| `cli` | 로컬 `claude` CLI 서브프로세스 실행 | Claude Code CLI 설치 필요 |
| `api` | Anthropic SDK를 통한 직접 API 호출 | `ANTHROPIC_API_KEY` 필수 |
| `remote` | 원격 서버의 Claude CLI 사용 | `REMOTE_CLI_URL` 또는 SSH 변수 필요 |

---

## 원격 CLI 모드

`CLAUDE_MODE=remote` 일 때 사용됩니다.

| 변수 | 기본값 | 필수 | 설명 |
|------|--------|------|------|
| `REMOTE_CLI_URL` | — | `REMOTE_HOST` 없을 시 필수 | 원격 서버의 Claude CLI HTTP 래퍼 URL |
| `REMOTE_HOST` | — | `REMOTE_CLI_URL` 없을 시 필수 | SSH 원격 호스트 (예: `my.server.com`) |
| `REMOTE_USER` | — | SSH 모드 시 권장 | SSH 접속 사용자명 (예: `ubuntu`) |
| `REMOTE_KEY_PATH` | — | SSH 모드 시 권장 | SSH 프라이빗 키 파일 경로 (예: `~/.ssh/id_rsa`) |

> **Note:** `CLAUDE_MODE=remote`일 때 `REMOTE_CLI_URL`과 `REMOTE_HOST` 중 하나는 반드시 설정해야 합니다. 둘 다 없으면 서버 기동 시 에러가 발생합니다.

---

## 인증 (AUTH=jwt)

| 변수 | 기본값 | 필수 | 설명 |
|------|--------|------|------|
| `SERVICE_JWT_SECRET` | — | `AUTH=jwt` 시 필수 (32자 이상) | 서비스 간 JWT 서명 시크릿 |
| `USER_JWT_SECRET` | — | 사용자 인증 사용 시 필수 | 사용자 access token 서명 시크릿 |

## 데이터베이스 (PostgreSQL)

| 변수 | 기본값 | 필수 | 설명 |
|------|--------|------|------|
| `DATABASE_URL` | — | 사용자 인증 사용 시 필수 | PostgreSQL 연결 URL (`postgres://user:pass@host:5432/db`) |

## GitHub 토큰 암호화

| 변수 | 기본값 | 필수 | 설명 |
|------|--------|------|------|
| `GITHUB_TOKEN_ENCRYPTION_KEY` | — | GitHub PAT 저장 기능 사용 시 필수 | AES-256-GCM 암호화 키 (32바이트 base64) |

## xzawedManager 연동

| 변수 | 기본값 | 필수 | 설명 |
|------|--------|------|------|
| `MANAGER_URL` | `http://localhost:3001` | 아니오 | xzawedManager HTTP 엔드포인트 URL |

## Redis

| 변수 | 기본값 | 필수 | 설명 |
|------|--------|------|------|
| `REDIS_URL` | `redis://localhost:6379` | 아니오 | Redis 연결 URL. 미설정 또는 연결 실패 시 인메모리 폴백 사용 |

### Redis URL 포맷

```
redis://[username:password@]host[:port][/db]
redis://localhost:6379
redis://default:mypassword@redis.example.com:6379
redis://default:password@redis.railway.internal:6379/0
```

---

## Electron 앱 (클라이언트)

Electron 앱의 설정은 앱 내 Settings 화면에서 변경할 수 있습니다. 환경변수로도 설정 가능합니다.

| 변수 | 기본값 | 필수 | 설명 |
|------|--------|------|------|
| `SERVER_URL` | `http://localhost:3000` | `MODE=remote` 시 필요 | Electron 앱이 접속할 서버 URL |

---

## 전체 .env.example

```env
# ===== 서버 모드 =====
# local: 사용자 PC에서 직접 실행 (기본값)
# remote: 클라우드 서버 배포
MODE=local

# 서버 포트 (기본: 3000)
PORT=3000

# 인증 방식
# none: 인증 없음 (개인 사용, 기본값)
# jwt: JWT 인증 (팀 서버 — SERVICE_JWT_SECRET, USER_JWT_SECRET, DATABASE_URL 필수)
AUTH=none


# ===== Claude 실행 모드 =====
# cli: 로컬 Claude Code CLI 사용 (기본값, Claude 구독 필요)
# api: Anthropic API 직접 호출 (API 키 필요)
# remote: 원격 서버의 Claude CLI 사용
CLAUDE_MODE=cli


# ===== API 모드 설정 (CLAUDE_MODE=api) =====
# ANTHROPIC_API_KEY=sk-ant-api03-...
# CLAUDE_MODEL=claude-sonnet-4-6


# ===== 원격 CLI 모드 설정 (CLAUDE_MODE=remote) =====
# --- HTTP 래퍼 방식 ---
# REMOTE_CLI_URL=https://claude-proxy.my-server.com

# --- SSH 방식 ---
# REMOTE_HOST=my.server.com
# REMOTE_USER=ubuntu
# REMOTE_KEY_PATH=~/.ssh/id_rsa


# ===== Redis =====
# 미설정 또는 연결 실패 시 인메모리 폴백 사용
# 운영 환경에서는 반드시 Redis를 사용하세요
REDIS_URL=redis://localhost:6379
```

---

## 설정 유효성 검사

서버 시작 시 `packages/server/src/config.ts`에서 설정값을 검증합니다.

| 조건 | 에러 메시지 |
|------|-------------|
| `CLAUDE_MODE=api`이고 `ANTHROPIC_API_KEY` 없음 | `ANTHROPIC_API_KEY is required when CLAUDE_MODE=api` |
| `CLAUDE_MODE=remote`이고 `REMOTE_CLI_URL`과 `REMOTE_HOST` 모두 없음 | `REMOTE_CLI_URL or REMOTE_HOST is required when CLAUDE_MODE=remote` |

---

## 다음 단계

- [설정 옵션 완전 가이드](../guides/configuration.md) — 시나리오별 설정 예시
- [로컬 배포](../guides/local-deployment.md) — 로컬 환경 최적화
- [원격 배포](../guides/remote-deployment.md) — 클라우드 배포 설정

---

## 관련 문서

- [Claude 실행 모드](../concepts/claude-runners.md)
- [설치 가이드](../guides/installation.md)
