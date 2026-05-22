[홈](../index.md) > [가이드](.) > 설정 가이드

# 설정 가이드

xzawedOrchestrator의 환경변수를 설정하고 시나리오별 `.env` 파일을 구성하는 방법을 안내합니다.

## 사전 조건

- xzawedOrchestrator 소스 체크아웃 완료
- 아래 중 하나:
  - Anthropic API 키 (`CLAUDE_MODE=api` 사용 시)
  - 로컬에 Claude CLI 설치 (`CLAUDE_MODE=cli` 사용 시)

---

## .env 파일 생성

```bash
cp xzawedOrchestrator/.env.example xzawedOrchestrator/.env
```

모든 설정은 `.env` 파일 또는 환경변수로 제공합니다. 환경변수가 `.env` 파일보다 우선합니다.

---

## Claude 실행 모드 선택

`CLAUDE_MODE`는 Claude를 어떤 방식으로 실행할지 결정합니다.

| 값 | 동작 | 필수 조건 |
|----|------|-----------|
| `api` | Anthropic SDK 직접 호출 (기본값) | `ANTHROPIC_API_KEY` |
| `cli` | 로컬 `claude` CLI 서브프로세스 실행 | Claude CLI 설치 |
| `remote` | 원격 서버의 Claude CLI 사용 | `REMOTE_CLI_URL` 또는 SSH 변수 |

---

## 인증 방식 선택

`AUTH` 변수로 서비스 간 인증 방식을 설정합니다.

| 값 | 용도 |
|----|------|
| `none` | 인증 없음. 개인 로컬 환경에 적합 (기본값) |
| `jwt` | JWT 인증. 팀 공유 서버 환경에서 사용. `SERVICE_JWT_SECRET` 필수 |

사용자 인증(`/auth/*`, `/projects` 엔드포인트)은 `DATABASE_URL`과 `USER_JWT_SECRET`을 모두 설정할 때 별도로 활성화됩니다.

---

## 시나리오별 설정 예시

### 시나리오 1: 로컬 개발 — API 키 사용

```env
MODE=local
PORT=3000
AUTH=none

CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-sonnet-4-6

REDIS_URL=redis://localhost:6379
```

### 시나리오 2: 로컬 개발 — Claude CLI 구독 사용

Claude CLI(`claude` 명령어)가 로컬에 설치되어 있어야 합니다.

```env
MODE=local
PORT=3000
AUTH=none

CLAUDE_MODE=cli

REDIS_URL=redis://localhost:6379
```

### 시나리오 3: 로컬 개발 — Redis 없음

Redis 없이 인메모리 폴백으로 실행합니다. 서버 재시작 시 모든 세션 데이터가 초기화됩니다.

```env
MODE=local
PORT=3000
AUTH=none

CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-api03-...

# REDIS_URL 미설정 시 자동으로 인메모리 폴백 사용
```

### 시나리오 4: 개인 원격 서버

```env
MODE=remote
PORT=3000
AUTH=none

CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-sonnet-4-6

REDIS_URL=redis://default:password@redis.railway.internal:6379
```

### 시나리오 5: 팀 공유 서버

`SERVICE_JWT_SECRET`은 32자 이상이어야 합니다. 미달 시 서버 기동에 실패합니다.

```env
MODE=remote
PORT=3000
AUTH=jwt
SERVICE_JWT_SECRET=your-strong-32-char-secret-here

CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-sonnet-4-6

REDIS_URL=redis://default:password@redis.example.com:6379
```

### 시나리오 6: 원격 Claude CLI — HTTP 래퍼

```env
MODE=local
PORT=3000
AUTH=none

CLAUDE_MODE=remote
REMOTE_CLI_URL=https://claude-proxy.my-server.com

REDIS_URL=redis://localhost:6379
```

### 시나리오 7: 원격 Claude CLI — SSH

```env
MODE=local
PORT=3000
AUTH=none

CLAUDE_MODE=remote
REMOTE_HOST=my.server.com
REMOTE_USER=ubuntu
REMOTE_KEY_PATH=~/.ssh/id_rsa

REDIS_URL=redis://localhost:6379
```

---

## 설정 유효성 검사

서버 시작 시 `packages/server/src/config.ts`에서 필수 값을 검증합니다. 검증 실패 시 다음 메시지와 함께 프로세스가 종료됩니다.

| 조건 | 에러 메시지 |
|------|-------------|
| `CLAUDE_MODE=api`이고 `ANTHROPIC_API_KEY` 없음 | `ANTHROPIC_API_KEY is required when CLAUDE_MODE=api. Set CLAUDE_MODE=cli to use Claude CLI subscription instead.` |
| `CLAUDE_MODE=remote`이고 `REMOTE_CLI_URL`과 `REMOTE_HOST` 모두 없음 | `REMOTE_CLI_URL or REMOTE_HOST is required when CLAUDE_MODE=remote` |
| `AUTH=jwt`이고 `SERVICE_JWT_SECRET`이 없거나 32자 미만 | `SERVICE_JWT_SECRET must be at least 32 characters when AUTH=jwt` |

---

## 다음 단계

- [로컬 배포](local-deployment.md) — 로컬 환경에서 실행
- [원격/팀 서버 배포](remote-deployment.md) — 클라우드 배포
- [환경변수 전체 목록](../reference/environment-variables.md) — 모든 변수의 타입·기본값·설명
