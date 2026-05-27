[홈](../README.md) > [가이드](.) > 로컬 배포

# 로컬 배포

개인 PC에서 xzawedOrchestrator를 실행하는 방법을 안내합니다.

## 전체 스택 실행 (Docker Compose 권장)

xzawedPAIS 전체 9개 서비스를 한 번에 실행하는 방법이다.

### 사전 요구사항
- Docker Desktop 설치 및 실행
- `.env` 파일 설정 (`cp .env.example .env` 후 ANTHROPIC_API_KEY 입력)

### 실행

```bash
# 저장소 루트에서
docker compose up -d
```

### 서비스 상태 확인

```bash
docker compose ps
```

모든 서비스가 `running` 상태인지 확인한다.

### 접속

- Orchestrator API: http://localhost:3000
- Electron 앱: xzawedLauncher 사용 권장 (비개발자)

---

## 개별 서비스 수동 실행 (개발자용)

## 사전 조건

- Node.js 22 이상
- pnpm 10 이상 (`corepack enable && corepack prepare pnpm@10 --activate`)
- 아래 중 하나:
  - Anthropic API 키 (`CLAUDE_MODE=api` 사용 시)
  - Claude CLI 설치 (`CLAUDE_MODE=cli` 사용 시)
- (선택) Redis — 없으면 인메모리 폴백 사용

---

## 아키텍처

```
사용자 PC
┌─────────────────────────────────────────┐
│  Electron 앱 (packages/app)              │
│    └─ main process                       │
│         └─ child_process.spawn(server)  │
│                    │ localhost:3000      │
│               Fastify 서버              │
│               (packages/server)         │
│                    │                    │
│               Redis (로컬)              │
│               또는 인메모리 폴백        │
│                    │                    │
│            Claude CLI (로컬)            │
│            또는 Anthropic API           │
└─────────────────────────────────────────┘
```

`MODE=local`에서 Electron 앱은 서버를 child process로 자동 기동합니다.

---

## 서버 단독 실행 (Electron 없이)

개발 시 서버만 별도로 실행할 수 있습니다.

1. 의존성 설치:

   ```bash
   cd xzawedOrchestrator
   pnpm install
   ```

2. `.env` 파일 생성:

   ```bash
   cp .env.example packages/server/.env
   ```

3. 최소 필수 내용으로 편집:

   ```env
   MODE=local
   PORT=3000
   AUTH=none
   CLAUDE_MODE=api
   ANTHROPIC_API_KEY=sk-ant-api03-...
   REDIS_URL=redis://localhost:6379
   ```

4. 개발 모드로 실행:

   ```bash
   cd packages/server
   pnpm dev
   ```

5. 헬스체크로 서버 확인:

   ```bash
   curl http://localhost:3000/health
   # {"status":"ok","timestamp":1747267200000}
   ```

---

## Redis 없이 실행

Redis가 없는 환경에서는 `REDIS_URL`을 설정하지 않으면 인메모리 폴백이 자동으로 적용됩니다.

```env
MODE=local
PORT=3000
AUTH=none
CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-...
# REDIS_URL 미설정 → 인메모리 폴백 사용
```

> **주의:** 인메모리 폴백은 서버 재시작 시 모든 세션·메시지 데이터가 초기화됩니다. 개발·테스트 환경에서만 사용하세요.

---

## 복수 세션 병렬 처리

하나의 서버에서 여러 세션을 동시에 사용할 수 있습니다. 각 세션은 독립된 Redis Streams 채널을 사용합니다.

```bash
# 세션 1 생성
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-1"}'
# → {"sessionId": "sess-aaa-..."}

# 세션 2 생성
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-1"}'
# → {"sessionId": "sess-bbb-..."}

# 두 세션에 동시 메시지 전송
curl -X POST http://localhost:3000/sessions/sess-aaa-.../messages \
  -H "Content-Type: application/json" \
  -d '{"content": "쇼핑몰 만들어줘"}' &

curl -X POST http://localhost:3000/sessions/sess-bbb-.../messages \
  -H "Content-Type: application/json" \
  -d '{"content": "랜딩 페이지 만들어줘"}' &
```

---

## MCP 서버로 Claude Code 연동

로컬 서버를 Claude Code의 MCP 서버로 등록합니다.

1. 서버를 빌드합니다:

   ```bash
   cd xzawedOrchestrator
   pnpm build
   ```

2. Claude Code `settings.json`에 등록합니다:

   ```json
   {
     "mcpServers": {
       "xzawed-orchestrator": {
         "command": "node",
         "args": ["packages/server/dist/mcp/entry.js"],
         "cwd": "/path/to/xzawedOrchestrator",
         "env": {
           "MODE": "local",
           "CLAUDE_MODE": "api",
           "ANTHROPIC_API_KEY": "sk-ant-..."
         }
       }
     }
   }
   ```

자세한 내용은 [MCP 서버 통합 가이드](mcp-integration.md)를 참고하세요.

---

## 문제 해결

### 포트 충돌

```
Error: listen EADDRINUSE: address already in use :::3000
```

`PORT` 변수로 다른 포트를 지정합니다:

```env
PORT=4000
```

### Redis 연결 실패

Redis가 실행 중인지 확인합니다:

```bash
redis-cli ping
# PONG
```

Redis가 없으면 `REDIS_URL`을 설정하지 않으면 인메모리 폴백이 자동으로 사용됩니다.

### ANTHROPIC_API_KEY 누락 오류

```
Error: ANTHROPIC_API_KEY is required when CLAUDE_MODE=api.
```

`ANTHROPIC_API_KEY`를 설정하거나, Claude CLI 구독을 사용한다면 `CLAUDE_MODE=cli`로 변경합니다.

---

## 다음 단계

- [원격/팀 서버 배포](remote-deployment.md) — 클라우드 배포
- [MCP 서버 통합](mcp-integration.md) — Claude Code 연동
- [설정 가이드](configuration.md) — 전체 설정 옵션
