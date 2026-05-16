[홈](../index.md) > [가이드](.) > 설치 및 환경 설정

# 설치 및 환경 설정

xzawedOrchestrator를 개발하거나 운영하기 위한 환경을 구성하는 방법을 안내합니다.

---

## Prerequisites

### 필수 항목

| 항목 | 최소 버전 | 설치 방법 |
|------|-----------|-----------|
| Node.js | 20.0.0 | [nodejs.org](https://nodejs.org/) 또는 `nvm install 20` |
| pnpm | 9.0.0 | `npm install -g pnpm` |
| Git | — | [git-scm.com](https://git-scm.com/) |

### 선택 항목

| 항목 | 용도 | 설치 방법 |
|------|------|-----------|
| Redis | 7.0+ | 없으면 인메모리 폴백 사용. 운영 환경에서는 필수 |
| Claude CLI | `CLAUDE_MODE=cli` 사용 시 | `npm install -g @anthropic-ai/claude-code` |

---

## 1단계: Node.js 설치 확인

```bash
node --version
# v20.0.0 이상이어야 합니다

npm --version
# 10.0.0 이상 권장
```

---

## 2단계: pnpm 설치

```bash
npm install -g pnpm

pnpm --version
# 9.0.0 이상이어야 합니다
```

---

## 3단계: 저장소 클론

```bash
git clone https://github.com/xzawed/orchestrator.git
cd orchestrator
```

---

## 4단계: 의존성 설치

```bash
pnpm install
```

이 명령은 다음을 수행합니다.

- `packages/shared` 의존성 설치
- `packages/server` 의존성 설치 (Fastify, ioredis, @anthropic-ai/sdk 등)
- `packages/app` 의존성 설치 (추후 구현)
- 루트 dev 의존성 설치 (Turborepo, TypeScript)

---

## 5단계: 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 편집기로 열어 필요한 값을 입력합니다.

```env
# 서버 모드: local | remote
MODE=local

# 서버 포트
PORT=3000

# 인증: none | jwt
AUTH=none

# Claude 실행 모드: cli | api | remote
CLAUDE_MODE=cli

# API 모드 시 필요
# ANTHROPIC_API_KEY=sk-ant-...
# CLAUDE_MODEL=claude-sonnet-4-6

# Redis (없으면 인메모리 폴백)
REDIS_URL=redis://localhost:6379
```

> **Tip:** `CLAUDE_MODE=cli`이고 Claude CLI가 설치되어 있지 않다면 `CLAUDE_MODE=api`로 변경하고 `ANTHROPIC_API_KEY`를 설정하세요.

---

## 6단계: Redis 설치 (선택)

### macOS (Homebrew)

```bash
brew install redis
brew services start redis
```

### Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis-server
```

### Windows (WSL2 권장)

```bash
# WSL2에서
sudo apt-get install redis-server
sudo service redis-server start
```

### Redis 연결 확인

```bash
redis-cli ping
# PONG 이 출력되면 정상
```

---

## 7단계: 빌드 및 테스트

```bash
# TypeScript 빌드
pnpm build

# 전체 테스트 실행
pnpm test
```

모든 테스트가 통과하면 설치가 완료된 것입니다.

---

## 8단계: 서버 실행 확인

```bash
cd packages/server
pnpm dev
```

```
xzawedOrchestrator server running on port 3000
CLAUDE_MODE=cli | MODE=local
```

다른 터미널에서 헬스체크를 실행합니다.

```bash
curl http://localhost:3000/health
```

```json
{"status":"ok","timestamp":1747267200000}
```

---

## 설치 문제 해결

### pnpm install 실패

```bash
# node_modules 초기화 후 재시도
rm -rf node_modules packages/*/node_modules
pnpm install
```

### TypeScript 빌드 오류

```bash
# shared 패키지를 먼저 빌드
cd packages/shared && pnpm build
cd ../server && pnpm build
```

### Redis 연결 실패

Redis가 없어도 서버는 인메모리 폴백으로 동작합니다. 다음 에러가 표시되어도 서버는 정상 실행됩니다.

```
Redis connection failed, falling back to in-memory store
```

---

## 다음 단계

- [퀵스타트](../quickstart.md) — 첫 세션 만들기
- [설정 옵션 완전 가이드](configuration.md) — 모든 설정값 상세
- [로컬 배포](local-deployment.md) — 로컬 환경 최적화

---

## 관련 문서

- [환경변수 목록](../reference/environment-variables.md)
- [Claude 실행 모드](../concepts/claude-runners.md)
