[홈](../index.md) > [가이드](.) > 설정 옵션 완전 가이드

# 설정 옵션 완전 가이드

xzawedOrchestrator의 모든 설정 옵션과 시나리오별 `.env` 파일 예시를 설명합니다.

---

## 설정 방법

모든 설정은 프로젝트 루트의 `.env` 파일 또는 실행 환경의 환경변수로 제공합니다.

```bash
# .env 파일 생성
cp .env.example .env

# 또는 환경변수로 직접 설정
PORT=4000 CLAUDE_MODE=api pnpm dev
```

---

## 전체 설정 목록

### 서버 모드

| 변수 | 기본값 | 가능한 값 | 설명 |
|------|--------|-----------|------|
| `MODE` | `local` | `local`, `remote` | 배포 환경. `local`은 단일 사용자 PC, `remote`는 클라우드 서버 |
| `PORT` | `3000` | 1–65535 | HTTP 서버 리슨 포트 |
| `AUTH` | `none` | `none`, `jwt` | 인증 방식. `jwt`는 팀 서버 환경에서 사용 |

### Claude 실행기

| 변수 | 기본값 | 가능한 값 | 설명 |
|------|--------|-----------|------|
| `CLAUDE_MODE` | `cli` | `cli`, `api`, `remote` | Claude 실행 방식 |
| `ANTHROPIC_API_KEY` | — | `sk-ant-...` | `CLAUDE_MODE=api` 시 필수 |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | 모델 ID | API 모드에서 사용할 Claude 모델 |

### 원격 CLI 모드

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `REMOTE_CLI_URL` | — | `CLAUDE_MODE=remote` 시 HTTP 래퍼 URL |
| `REMOTE_HOST` | — | SSH 원격 호스트 (예: `my.server.com`) |
| `REMOTE_USER` | — | SSH 사용자 (예: `ubuntu`) |
| `REMOTE_KEY_PATH` | — | SSH 프라이빗 키 경로 (예: `~/.ssh/id_rsa`) |

### Redis

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `REDIS_URL` | `redis://localhost:6379` | Redis 연결 URL. 없으면 인메모리 폴백 |

### Electron 앱 (클라이언트 설정)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `SERVER_URL` | — | `MODE=remote` 시 Electron 앱이 접속할 서버 URL |

---

## 시나리오별 .env 예시

### 시나리오 1: 로컬 개발 (Claude CLI 구독)

가장 일반적인 개발 환경입니다. Claude CLI가 로컬에 설치되어 있어야 합니다.

```env
MODE=local
PORT=3000
AUTH=none

CLAUDE_MODE=cli

REDIS_URL=redis://localhost:6379
```

### 시나리오 2: 로컬 개발 (API 키)

Claude CLI 없이 Anthropic API 키만으로 실행합니다.

```env
MODE=local
PORT=3000
AUTH=none

CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-sonnet-4-6

REDIS_URL=redis://localhost:6379
```

### 시나리오 3: 로컬 개발 (Redis 없음)

Redis 없이 인메모리 폴백으로 실행합니다. 개발·테스트에만 권장합니다.

```env
MODE=local
PORT=3000
AUTH=none

CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-api03-...

# REDIS_URL 없으면 자동으로 인메모리 폴백 사용
```

### 시나리오 4: 개인 원격 서버 (Railway)

클라우드 서버에 배포할 때 사용합니다.

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

팀원이 JWT 인증으로 접속하는 팀 서버 설정입니다.

```env
MODE=remote
PORT=3000
AUTH=jwt
SERVICE_JWT_SECRET=your-service-secret-key-min-32-chars
USER_JWT_SECRET=your-user-jwt-secret-key-min-32-chars

DATABASE_URL=postgres://user:password@db.example.com:5432/xzawed
GITHUB_TOKEN_ENCRYPTION_KEY=<32바이트 base64 키>

MANAGER_URL=http://manager.internal:3001

CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-sonnet-4-6

REDIS_URL=redis://default:password@redis.example.com:6379
```

### 시나리오 6: 원격 Claude CLI (HTTP 래퍼)

원격 서버에 Claude CLI가 설치되어 있고 HTTP로 노출된 경우입니다.

```env
MODE=local
PORT=3000
AUTH=none

CLAUDE_MODE=remote
REMOTE_CLI_URL=https://claude-proxy.my-server.com

REDIS_URL=redis://localhost:6379
```

### 시나리오 7: 원격 Claude CLI (SSH)

SSH로 원격 서버의 Claude CLI를 사용하는 경우입니다.

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

서버 시작 시 `config.ts`에서 설정값을 검증합니다. 필수 값이 누락된 경우 명확한 에러 메시지와 함께 서버 기동이 실패합니다.

```
Error: ANTHROPIC_API_KEY is required when CLAUDE_MODE=api
Error: REMOTE_CLI_URL or REMOTE_HOST is required when CLAUDE_MODE=remote
```

---

## 다음 단계

- [로컬 단일 사용자 배포](local-deployment.md)
- [원격/팀 서버 배포](remote-deployment.md)
- [환경변수 전체 목록](../reference/environment-variables.md)

---

## 관련 문서

- [Claude 실행 모드](../concepts/claude-runners.md)
- [설치 가이드](installation.md)
