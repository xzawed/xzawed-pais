[홈](../index.md) > [가이드](.) > 로컬 단일 사용자 배포

# 로컬 단일 사용자 배포

개인 PC에서 xzawedOrchestrator를 실행하는 방법을 안내합니다. 인터넷 연결 없이도 동작하며, 여러 창을 동시에 열어 복수의 서비스를 병렬로 진행할 수 있습니다.

---

## 로컬 모드 아키텍처

```
사용자 PC
┌────────────────────────────────────────┐
│  Electron 앱 (packages/app)             │
│    └─ main process                      │
│         └─ child_process.spawn(server) │
│                   │ localhost:3000      │
│              Fastify 서버               │
│              (packages/server)          │
│                   │                    │
│              Redis (로컬)               │
│              또는 인메모리 폴백         │
│                   │                    │
│           Claude CLI (로컬)            │
│           또는 Anthropic API           │
└────────────────────────────────────────┘
```

`MODE=local`로 실행하면 Electron 앱이 서버를 child process로 자동 기동합니다. 별도의 서버 실행이 필요 없습니다.

---

## Redis 없이 실행하기

Redis가 설치되지 않은 환경에서는 `ioredis-mock` 인메모리 폴백이 자동으로 적용됩니다.

```env
MODE=local
PORT=3000
AUTH=none
CLAUDE_MODE=cli
# REDIS_URL 미설정 시 인메모리 폴백 사용
```

> **Warning:** 인메모리 폴백은 **서버 재시작 시 모든 스트림 데이터가 초기화**됩니다. 운영 환경에서는 Redis를 사용하세요.

---

## 서버만 실행하기 (Electron 앱 없이)

개발 단계에서는 Electron 앱 없이 서버만 실행할 수 있습니다.

```bash
cd packages/server
pnpm dev
```

브라우저나 curl로 API를 직접 호출할 수 있습니다.

---

## 로컬 설정 예시

### Claude CLI + Redis

```env
MODE=local
PORT=3000
AUTH=none
CLAUDE_MODE=cli
REDIS_URL=redis://localhost:6379
```

### Claude API + 인메모리 (최소 설정)

```env
MODE=local
PORT=3000
CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 멀티 창 사용법

단일 사용자가 복수의 프로젝트를 동시에 진행하려면 Electron 앱을 여러 창으로 열면 됩니다. 각 창은 독립적인 세션을 생성합니다.

### API로 테스트할 때

여러 세션을 생성하여 병렬 처리를 시뮬레이션할 수 있습니다.

```bash
# 세션 1: 쇼핑몰 프로젝트
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-1"}'
# → {"sessionId": "sess-aaa..."}

# 세션 2: 랜딩 페이지 프로젝트
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-1"}'
# → {"sessionId": "sess-bbb..."}

# 두 세션에 동시에 메시지 전송 가능
curl -X POST http://localhost:3000/sessions/sess-aaa.../messages \
  -H "Content-Type: application/json" \
  -d '{"content": "쇼핑몰 만들어줘"}' &

curl -X POST http://localhost:3000/sessions/sess-bbb.../messages \
  -H "Content-Type: application/json" \
  -d '{"content": "랜딩 페이지 만들어줘"}' &
```

각 세션은 별도의 Redis Streams 채널을 사용하므로 서로 간섭하지 않습니다.

---

## MCP 서버로 Claude Code와 연동

로컬 서버를 Claude Code의 MCP 서버로 등록하면 Claude Code 내에서 직접 세션을 관리할 수 있습니다.

```bash
# MCP 서버 실행 (별도 터미널)
cd packages/server
pnpm mcp
```

Claude Code `settings.json`에 등록:

```json
{
  "mcpServers": {
    "xzawed-orchestrator": {
      "command": "node",
      "args": ["packages/server/dist/mcp/entry.js"],
      "cwd": "/path/to/orchestrator"
    }
  }
}
```

자세한 내용은 [MCP 서버 통합 가이드](mcp-integration.md)를 참고하세요.

---

## 성능 고려사항

로컬 모드에서 기대할 수 있는 성능 수준입니다.

| 지표 | 목표값 |
|------|--------|
| 첫 토큰 스트리밍 | 2초 이내 |
| REST API 응답 | 200ms 이내 |
| 동시 세션 수 | Node.js 이벤트 루프 기반, 수십 개 동시 처리 가능 |

---

## 다음 단계

- [원격/팀 서버 배포](remote-deployment.md) — 클라우드 배포
- [MCP 서버 통합](mcp-integration.md) — Claude Code 연동

---

## 관련 문서

- [설정 옵션 완전 가이드](configuration.md)
- [환경변수 목록](../reference/environment-variables.md)
- [Redis Streams 메시징](../concepts/redis-streams.md)
